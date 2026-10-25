#include "root.h"
#include "wtf-bindings.h"
#include "helpers.h"
#include "BunTTYState.h"
#include <wtf/StackBounds.h>
#include <wtf/StackCheck.h>
#include <wtf/StackTrace.h>
#include <wtf/dtoa.h>
#include <wtf/DateMath.h>
#include <wtf/NumberOfCores.h>
#include <JavaScriptCore/JSDateMath-v8.h>
#include <atomic>
#include <cassert>

static_assert(WTF::maxECMAScriptTime == 8.64e15, "bun_jsc::wtf::MAX_ECMASCRIPT_TIME in WTF.rs must match");

#include "wtf/SIMDUTF.h"
#if OS(WINDOWS)
#include <uv.h>
#endif

#if !OS(WINDOWS)
#include <stdatomic.h>

#include <cassert>
#include <signal.h>
#include <sys/stat.h>
#include <termios.h>
#include <wtf/Lock.h>
static int orig_termios_fd = -1;
static struct termios orig_termios;
static std::atomic<int> orig_termios_spinlock;
static std::once_flag reset_once_flag;

// A blocking read of one typed line (alert(), confirm(), prompt(), a CLI
// question) holds the terminal of stdin in line mode. The mode belongs to the
// terminal and not to a thread, so the holders are counted: the first one
// saves the termios it found and the last one writes it back.
static WTF::Lock stdinLineModeLock;
static unsigned stdinLineModeHolders WTF_GUARDED_BY_LOCK(stdinLineModeLock) = 0;
static struct termios stdinLineModeSaved WTF_GUARDED_BY_LOCK(stdinLineModeLock);
static sig_atomic_t stdinLineModeSavedModified WTF_GUARDED_BY_LOCK(stdinLineModeLock) = 0;

int uv__tcsetattr(int fd, int how, const struct termios* term)
{
    int rc;

    do
        rc = tcsetattr(fd, how, term);
    while (rc == -1 && errno == EINTR);

    if (rc == -1)
        return errno;

    return 0;
}

extern "C" BUN_EXPORT int uv_tty_reset_mode(void)
{
    int saved_errno;
    int err;

    saved_errno = errno;

    if (atomic_exchange(&orig_termios_spinlock, 1))
        return -EBUSY; // UV_EBUSY, ttySetMode() is taking the snapshot

    err = 0;
    if (orig_termios_fd != -1)
        err = -uv__tcsetattr(orig_termios_fd, TCSANOW, &orig_termios); // UV__ERR(errno)

    atomic_store(&orig_termios_spinlock, 0);
    errno = saved_errno;

    return err;
}

static void uv__tty_make_raw(struct termios* tio)
{
    ASSERT(tio != NULL);

#if defined __sun || defined __MVS__
    /*
     * This implementation of cfmakeraw for Solaris and derivatives is taken from
     * http://www.perkin.org.uk/posts/solaris-portability-cfmakeraw.html.
     */
    tio->c_iflag &= ~(IMAXBEL | IGNBRK | BRKINT | PARMRK | ISTRIP | INLCR | IGNCR | ICRNL | IXON);
    tio->c_oflag &= ~OPOST;
    tio->c_lflag &= ~(ECHO | ECHONL | ICANON | ISIG | IEXTEN);
    tio->c_cflag &= ~(CSIZE | PARENB);
    tio->c_cflag |= CS8;

    /*
     * By default, most software expects a pending read to block until at
     * least one byte becomes available.  As per termio(7I), this requires
     * setting the MIN and TIME parameters appropriately.
     *
     * As a somewhat unfortunate artifact of history, the MIN and TIME slots
     * in the control character array overlap with the EOF and EOL slots used
     * for canonical mode processing.  Because the EOF character needs to be
     * the ASCII EOT value (aka Control-D), it has the byte value 4.  When
     * switching to raw mode, this is interpreted as a MIN value of 4; i.e.,
     * reads will block until at least four bytes have been input.
     *
     * Other platforms with a distinct MIN slot like Linux and FreeBSD appear
     * to default to a MIN value of 1, so we'll force that value here:
     */
    tio->c_cc[VMIN] = 1;
    tio->c_cc[VTIME] = 0;
#else
    cfmakeraw(tio);
#endif /* #ifdef __sun */
}

#endif

extern "C" void Bun__atexit(void (*func)(void));

#if !OS(WINDOWS)
extern "C" volatile sig_atomic_t bun_stdio_modified[3];
#endif

extern "C" size_t Bun__ttyStateSize()
{
    return sizeof(BunTTYState);
}

#if !OS(WINDOWS)
static bool isTerminalOfStdin(int fd)
{
    if (fd == STDIN_FILENO)
        return true;

    struct stat other;
    struct stat stdinStat;
    return fstat(fd, &other) == 0 && fstat(STDIN_FILENO, &stdinStat) == 0
        && S_ISCHR(other.st_mode) && S_ISCHR(stdinStat.st_mode)
        && other.st_rdev == stdinStat.st_rdev;
}

// Port of libuv's uv_tty_set_mode(), with `state` standing in for the
// per-handle fields of uv_tty_t. The file statics above are only the
// uv_tty_reset_mode() snapshot, which is process-wide in libuv too.
// `action` is the tcsetattr() action: TCSADRAIN (libuv's choice) or TCSANOW.
static int ttySetMode(int fd, int mode, BunTTYState& state, int action)
{
    struct termios tmp;
    int expected;
    int rc;

    if (state.mode == mode)
        return 0;

    // While a dialog holds this terminal in line mode, its owner reads and
    // changes the termios that the dialog writes back, not the device. The
    // dialog keeps its line mode, and the owner's change is not lost when the
    // dialog ends.
    Locker locker { stdinLineModeLock };
    struct termios* held = stdinLineModeHolders && isTerminalOfStdin(fd) ? &stdinLineModeSaved : nullptr;

    if (state.mode == 0 && mode != 0) {
        if (held) {
            state.orig_termios = *held;
        } else {
            do {
                rc = tcgetattr(fd, &state.orig_termios);
            } while (rc == -1 && errno == EINTR);

            if (rc == -1)
                return errno;
        }

        /* This is used for uv_tty_reset_mode() */
        do {
            expected = 0;
        } while (!atomic_compare_exchange_strong(&orig_termios_spinlock, &expected, 1));

        if (orig_termios_fd == -1) {
            orig_termios = state.orig_termios;
            orig_termios_fd = fd;
        }

        atomic_store(&orig_termios_spinlock, 0);
    }

    tmp = state.orig_termios;
    switch (mode) {
    case 0: // normal
        break;
    case 1: // raw
        tmp.c_iflag &= ~(BRKINT | ICRNL | INPCK | ISTRIP | IXON);
        tmp.c_oflag |= (ONLCR);
        tmp.c_cflag |= (CS8);
        tmp.c_lflag &= ~(ECHO | ICANON | IEXTEN | ISIG);
        tmp.c_cc[VMIN] = 1;
        tmp.c_cc[VTIME] = 0;

        std::call_once(reset_once_flag, [] {
            Bun__atexit([] {
                uv_tty_reset_mode();
            });
        });
        break;
    case 2: // io
        uv__tty_make_raw(&tmp);

        std::call_once(reset_once_flag, [] {
            Bun__atexit([] {
                uv_tty_reset_mode();
            });
        });
        break;
    }

    // Mark the fd as modified *before* applying the change. If a
    // SIGINT/SIGTERM lands between the device going raw and our bookkeeping
    // catching up, bun_restore_stdio would otherwise read 0 and skip the
    // restore — leaving the terminal in raw mode after exit. A spurious set
    // when uv__tcsetattr fails is harmless: bun_restore_stdio then writes
    // the cooked startup snapshot back to a still-cooked device (no-op,
    // pre-PR behavior). Bounds-checked because the PTY master fd from
    // Bun.Terminal calls through here too. See #29592.
    //
    // Marked on every transition, including setRawMode(true)→(false), so
    // the signal-exit path (which runs only bun_restore_stdio, not the
    // atexit uv_tty_reset_mode hook) still restores cooked mode on Ctrl-C.
    if (fd >= 0 && fd < 3) {
        bun_stdio_modified[fd] = 1;
    }

    if (held) {
        *held = tmp;
        if (fd == STDIN_FILENO)
            stdinLineModeSavedModified = 1;
        state.mode = mode;
        return 0;
    }

    rc = uv__tcsetattr(fd, action, &tmp);
    if (rc == 0) {
        state.mode = mode;
    }

    return rc;
}

// Puts the terminal of stdin in line mode when Enter cannot end a read of it:
// Enter gives LF, typing is echoed and can be edited, Ctrl+C is SIGINT.
// Returns 1 when the caller holds line mode and has to call
// Bun__ttyLeaveStdinLineMode(). This is not a mode of ttySetMode(), because
// tty_wrap passes any integer from JS as the mode.
extern "C" int Bun__ttyEnterStdinLineMode()
{
    Locker locker { stdinLineModeLock };
    if (stdinLineModeHolders) {
        stdinLineModeHolders++;
        return 1;
    }

    struct termios found;
    int rc;
    do {
        rc = tcgetattr(STDIN_FILENO, &found);
    } while (rc == -1 && errno == EINTR);

    // With ICANON or ICRNL set, Enter ends a read. Such a terminal is not
    // written: an ECHO that the user turned off stays off, and cbreak input
    // stays unbuffered.
    if (rc == -1 || (found.c_lflag & ICANON) || (found.c_iflag & ICRNL))
        return 0;

    // The termios found is the only one to start from: a terminal that was
    // raw when the process started has no line mode saved anywhere.
    struct termios line = found;
    line.c_iflag |= ICRNL;
    line.c_lflag |= ICANON | ECHO | ISIG | IEXTEN;

    // Marked before the change, as in ttySetMode(): Ctrl+C is a signal from
    // here on, and bun_restore_stdio() then has to restore the terminal.
    sig_atomic_t modified = bun_stdio_modified[STDIN_FILENO];
    bun_stdio_modified[STDIN_FILENO] = 1;

    // TCSANOW: only input flags change, so there is no output to wait for.
    // SIGTTOU is not blocked: a background job stops here until it is in the
    // foreground, as it stops at the read.
    if (uv__tcsetattr(STDIN_FILENO, TCSANOW, &line) != 0) {
        bun_stdio_modified[STDIN_FILENO] = modified;
        return 0;
    }

    stdinLineModeSaved = found;
    stdinLineModeSavedModified = modified;
    stdinLineModeHolders = 1;
    return 1;
}

extern "C" void Bun__ttyLeaveStdinLineMode()
{
    Locker locker { stdinLineModeLock };
    ASSERT(stdinLineModeHolders);
    if (--stdinLineModeHolders)
        return;

    uv__tcsetattr(STDIN_FILENO, TCSANOW, &stdinLineModeSaved);
    // Put back, so that a pipeline producer that did not change the terminal
    // itself does not write its startup termios at exit. See #29592.
    bun_stdio_modified[STDIN_FILENO] = stdinLineModeSavedModified;
}
#endif

extern "C" int Bun__ttySetMode(int fd, int mode, void* rawState, int drain)
{
#if !OS(WINDOWS)
    // Copied in and out so callers can hand us an unaligned byte buffer: the
    // JS streams keep theirs in a Uint8Array.
    BunTTYState state;
    memcpy(&state, rawState, sizeof(state));
    // TCSADRAIN matches libuv on real ttys. It must never be used on a PTY
    // master: draining waits on the slave's write lock, and a child blocked
    // in write() holds that lock until the master's owner (this caller)
    // reads the master, so the two deadlock. Those callers pass drain == 0.
    int rc = ttySetMode(fd, mode, state, drain ? TCSADRAIN : TCSANOW);
    memcpy(rawState, &state, sizeof(state));
    return rc;
#else
    UNUSED_PARAM(fd);
    UNUSED_PARAM(mode);
    UNUSED_PARAM(rawState);
    UNUSED_PARAM(drain);
    return 0;
#endif
}

extern "C" double WTF__parseDouble(const Latin1Character* string, size_t length, size_t* position)
{
    return WTF::parseDouble({ string, length }, *position);
}

extern "C" size_t WTF__base64URLEncode(const char* __restrict inputDataBuffer, size_t inputDataBufferSize,
    char* __restrict destinationDataBuffer,
    size_t destinationDataBufferSize)
{
    UNUSED_PARAM(destinationDataBufferSize);
    return simdutf::binary_to_base64(inputDataBuffer, inputDataBufferSize, destinationDataBuffer, simdutf::base64_url);
}

// JS `Date.parse` with no VM, except that a date-time with no time zone reads as UTC.
extern "C" double Bun__parseDateTimeString(const Latin1Character* string, size_t length)
{
    bool isLocalTime = false;
    return v8::TimeClip(v8::ParseDateTimeString(byteCast<uint8_t>(string), length, isLocalTime));
}

namespace Bun {
String base64URLEncodeToString(const Vector<uint8_t>& data)
{
    auto size = data.size();
    size_t encodedLength = ((size * 4) + 2) / 3;
    if (!encodedLength)
        return String();

    // String::createUninitialized CRASH()es above String::MaxLength.
    if (encodedLength > std::min(Bun__stringSyntheticAllocationLimit, static_cast<size_t>(String::MaxLength))) [[unlikely]]
        return String();

    std::span<Latin1Character> ptr;
    auto result = String::createUninitialized(encodedLength, ptr);

    encodedLength = WTF__base64URLEncode(reinterpret_cast<const char*>(data.begin()), data.size(), reinterpret_cast<char*>(ptr.data()), encodedLength);
    if (result.length() != encodedLength) {
        return result.substringSharingImpl(0, encodedLength);
    }
    return result;
}

// https://github.com/oven-sh/WebKit/blob/b7bc2ba65db9774d201018f2e1a0a891d6365c13/Source/JavaScriptCore/runtime/DatePrototype.cpp#L323-L345
size_t toISOString(JSC::VM& vm, double date, char in[64])
{
    if (!std::isfinite(date))
        return 0;

    auto gregorianDateTime = vm.dateCache.msToGregorianDateTime(date, WTF::TimeType::UTCTime);

    // Maximum amount of space we need in buffer: 8 (max. digits in year) + 2 * 5 (2 characters each for month, day, hour, minute, second) + 4 (. + 3 digits for milliseconds)
    // 6 for formatting and one for null termination = 29.
    char buffer[29];
    // If the year is outside the bounds of 0 and 9999 inclusive we want to use the extended year format (ES 15.9.1.15.1).
    int ms = static_cast<int>(fmod(date, msPerSecond));
    if (ms < 0)
        ms += msPerSecond;

    int charactersWritten;
    if (gregorianDateTime.year() > 9999 || gregorianDateTime.year() < 0)
        charactersWritten = snprintf(buffer, sizeof(buffer), "%+07d-%02d-%02dT%02d:%02d:%02d.%03dZ", gregorianDateTime.year(), gregorianDateTime.month() + 1, gregorianDateTime.monthDay(), gregorianDateTime.hour(), gregorianDateTime.minute(), gregorianDateTime.second(), ms);
    else
        charactersWritten = snprintf(buffer, sizeof(buffer), "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ", gregorianDateTime.year(), gregorianDateTime.month() + 1, gregorianDateTime.monthDay(), gregorianDateTime.hour(), gregorianDateTime.minute(), gregorianDateTime.second(), ms);

    ASSERT(charactersWritten > 0 && static_cast<unsigned>(charactersWritten) < sizeof(buffer));

    memcpy(in, buffer, charactersWritten + 1);
    if (static_cast<unsigned>(charactersWritten) >= sizeof(buffer))
        return 0;

    return charactersWritten;
}

static thread_local WTF::StackBounds stackBoundsForCurrentThread = WTF::StackBounds::emptyBounds();

extern "C" [[ZIG_EXPORT(nothrow)]] void Bun__StackCheck__initialize()
{
    // A thread's bounds are fixed. On Windows they are the reserved range, and the stack grows inside it.
    if (!stackBoundsForCurrentThread.isEmpty())
        return;
    stackBoundsForCurrentThread = WTF::StackBounds::currentThreadStackBoundsForEmbedder();
}

extern "C" [[ZIG_EXPORT(nothrow)]] __attribute__((__always_inline__)) void* Bun__StackCheck__getMaxStack()
{
    return stackBoundsForCurrentThread.end();
}

extern "C" void WTF__DumpStackTrace(void** stack, size_t stack_count)
{
    WTFPrintBacktrace({ stack, stack_count });
}

extern "C" int WTF__numberOfProcessorCores()
{
    return WTF::numberOfProcessorCores();
}

}
