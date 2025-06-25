#include "root.h"
#include "wtf-bindings.h"
#include <wtf/StackBounds.h>
#include <wtf/StackCheck.h>
#include <wtf/StackTrace.h>
#include <wtf/dtoa.h>
#include <atomic>

#include "wtf/SIMDUTF.h"
#if OS(WINDOWS)
#include <uv.h>
#endif

#if !OS(WINDOWS)
#include <stdatomic.h>

#include <termios.h>
static int orig_termios_fd = -1;
static struct termios orig_termios;
static std::atomic<int> orig_termios_spinlock;
static std::once_flag reset_once_flag;

static int current_tty_mode = 0;
static struct termios orig_tty_termios;

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

extern "C" int uv_tty_reset_mode(void)
{
    int saved_errno;
    int err;

    saved_errno = errno;

    if (atomic_exchange(&orig_termios_spinlock, 1))
        return 16; // UV_EBUSY; /* In uv_tty_set_mode(). */

    err = 0;
    if (orig_termios_fd != -1)
        err = uv__tcsetattr(orig_termios_fd, TCSANOW, &orig_termios);

    atomic_store(&orig_termios_spinlock, 0);
    errno = saved_errno;

    return err;
}

static void uv__tty_make_raw(struct termios* tio)
{
    assert(tio != NULL);

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

extern "C" int Bun__ttySetMode(int fd, int mode)
{
#if !OS(WINDOWS)
    struct termios tmp;
    int expected;
    int rc;

    if (current_tty_mode == mode)
        return 0;

    if (current_tty_mode == 0 && mode != 0) {
        do {
            rc = tcgetattr(fd, &orig_tty_termios);
        } while (rc == -1 && errno == EINTR);

        if (rc == -1)
            return errno;

        /* This is used for uv_tty_reset_mode() */
        do {
            expected = 0;
        } while (!atomic_compare_exchange_strong(&orig_termios_spinlock, &expected, 1));

        if (orig_termios_fd == -1) {
            orig_termios = orig_tty_termios;
            orig_termios_fd = fd;
        }

        atomic_store(&orig_termios_spinlock, 0);
    }

    tmp = orig_tty_termios;
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

    /* Apply changes after draining */
    rc = uv__tcsetattr(fd, TCSADRAIN, &tmp);
    if (rc == 0)
        current_tty_mode = mode;

    return rc;
#else
    return 0;

#endif
}

extern "C" double WTF__parseDouble(const LChar* string, size_t length, size_t* position)
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

namespace Bun {
String base64URLEncodeToString(Vector<uint8_t> data)
{
    auto size = data.size();
    size_t encodedLength = ((size * 4) + 2) / 3;
    if (!encodedLength)
        return String();

    std::span<LChar> ptr;
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

    GregorianDateTime gregorianDateTime;
    vm.dateCache.msToGregorianDateTime(date, WTF::TimeType::UTCTime, gregorianDateTime);

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

extern "C" void Bun__StackCheck__initialize()
{
    stackBoundsForCurrentThread = WTF::StackBounds::currentThreadStackBounds();
}

extern "C" void* Bun__StackCheck__getMaxStack()
{
    return stackBoundsForCurrentThread.end();
}

extern "C" void WTF__DumpStackTrace(void** stack, size_t stack_count)
{
    WTFPrintBacktrace({ stack, stack_count });
}
}
