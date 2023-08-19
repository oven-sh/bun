#include "wtf-bindings.h"

#include "wtf/StackTrace.h"
#include "wtf/dtoa.h"
#include "wtf/Lock.h"
#include "termios.h"

extern "C" double WTF__parseDouble(const LChar* string, size_t length, size_t* position)
{
    return WTF::parseDouble(string, length, *position);
}

extern "C" void WTF__copyLCharsFromUCharSource(LChar* destination, const UChar* source, size_t length)
{
    WTF::StringImpl::copyCharacters(destination, source, length);
}

static int orig_termios_fd = -1;
static struct termios orig_termios;
static WTF::Lock orig_termios_lock;

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

extern "C" int
Bun__ttySetMode(int fd, int mode)
{
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

        {
            /* This is used for uv_tty_reset_mode() */
            LockHolder locker(orig_termios_lock);

            if (orig_termios_fd == -1) {
                orig_termios = orig_termios;
                orig_termios_fd = fd;
            }
        }
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
        break;
    case 2: // io
        uv__tty_make_raw(&tmp);
        break;
    }

    /* Apply changes after draining */
    rc = uv__tcsetattr(fd, TCSADRAIN, &tmp);
    if (rc == 0)
        current_tty_mode = mode;

    return rc;
}

int uv_tty_reset_mode(void)
{
    int saved_errno;
    int err;

    saved_errno = errno;

    if (orig_termios_lock.tryLock())
        return 16; // UV_EBUSY; /* In uv_tty_set_mode(). */

    err = 0;
    if (orig_termios_fd != -1)
        err = uv__tcsetattr(orig_termios_fd, TCSANOW, &orig_termios);

    orig_termios_lock.unlock();
    errno = saved_errno;

    return err;
}

extern "C" void Bun__crashReportWrite(void* ctx, const char* message, size_t length);
extern "C" void Bun__crashReportDumpStackTrace(void* ctx)
{
    static constexpr int framesToShow = 32;
    static constexpr int framesToSkip = 2;
    void* stack[framesToShow + framesToSkip];
    int frames = framesToShow + framesToSkip;
    WTFGetBacktrace(stack, &frames);
    int size = frames - framesToSkip;
    bool isFirst = true;
    for (int frameNumber = 0; frameNumber < size; ++frameNumber) {
        auto demangled = WTF::StackTraceSymbolResolver::demangle(stack[frameNumber]);

        StringPrintStream out;
        if (isFirst) {
            isFirst = false;
            if (demangled)
                out.printf("\n%-3d %p %s", frameNumber, stack[frameNumber], demangled->demangledName() ? demangled->demangledName() : demangled->mangledName());
            else
                out.printf("\n%-3d %p", frameNumber, stack[frameNumber]);
        } else {
            if (demangled)
                out.printf("%-3d ??? %s", frameNumber, demangled->demangledName() ? demangled->demangledName() : demangled->mangledName());
            else
                out.printf("%-3d ???", frameNumber);
        }

        auto str = out.toCString();
        Bun__crashReportWrite(ctx, str.data(), str.length());
    }
}

// For whatever reason
// Doing this in C++/C is 2x faster than doing it in Zig.
// However, it's still slower than it should be.
static constexpr size_t encodeMapSize = 64;
static constexpr char base64URLEncMap[encodeMapSize] = {
    0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A, 0x4B,
    0x4C, 0x4D, 0x4E, 0x4F, 0x50, 0x51, 0x52, 0x53, 0x54, 0x55, 0x56,
    0x57, 0x58, 0x59, 0x5A, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67,
    0x68, 0x69, 0x6A, 0x6B, 0x6C, 0x6D, 0x6E, 0x6F, 0x70, 0x71, 0x72,
    0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7A, 0x30, 0x31, 0x32,
    0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x2D, 0x5F
};

extern "C" size_t WTF__base64URLEncode(const unsigned char* __restrict inputDataBuffer, size_t inputDataBufferSize,
    unsigned char* __restrict destinationDataBuffer,
    size_t destinationDataBufferSize)
{
    size_t sidx = 0;
    size_t didx = 0;

    if (inputDataBufferSize > 1) {
        while (sidx < inputDataBufferSize - 2) {
            destinationDataBuffer[didx++] = base64URLEncMap[(inputDataBuffer[sidx] >> 2) & 077];
            destinationDataBuffer[didx++] = base64URLEncMap[((inputDataBuffer[sidx + 1] >> 4) & 017) | ((inputDataBuffer[sidx] << 4) & 077)];
            destinationDataBuffer[didx++] = base64URLEncMap[((inputDataBuffer[sidx + 2] >> 6) & 003) | ((inputDataBuffer[sidx + 1] << 2) & 077)];
            destinationDataBuffer[didx++] = base64URLEncMap[inputDataBuffer[sidx + 2] & 077];
            sidx += 3;
        }
    }

    if (sidx < inputDataBufferSize) {
        destinationDataBuffer[didx++] = base64URLEncMap[(inputDataBuffer[sidx] >> 2) & 077];
        if (sidx < inputDataBufferSize - 1) {
            destinationDataBuffer[didx++] = base64URLEncMap[((inputDataBuffer[sidx + 1] >> 4) & 017) | ((inputDataBuffer[sidx] << 4) & 077)];
            destinationDataBuffer[didx++] = base64URLEncMap[(inputDataBuffer[sidx + 1] << 2) & 077];
        } else
            destinationDataBuffer[didx++] = base64URLEncMap[(inputDataBuffer[sidx] << 4) & 077];
    }

    while (didx < destinationDataBufferSize)
        destinationDataBuffer[didx++] = '=';

    return destinationDataBufferSize;
}