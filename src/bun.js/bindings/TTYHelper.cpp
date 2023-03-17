#include <termios.h>
#include <unistd.h>
#include <cstdio>

#include "TTYHelper.h"

namespace Zig {

static bool tty__orig_set = false;
static struct termios tty__orig_termios;
static struct termios tty__termios_tmp;
static int32_t tty__is_tty_val = -1;
static tty_mode_t tty__stdin_mode = TTY_MODE_UNSET;

int32_t tty__is_tty(int32_t fd)
{
    // Only cache is_tty for stdin
    if (UNLIKELY(fd != STDIN_FILENO)) {
        return isatty(fd);
    }

    if (tty__is_tty_val == -1)
        tty__is_tty_val = isatty(fd);

    return tty__is_tty_val;
}

int32_t tty__get_termios(int32_t fd, termios* termios_p)
{
    if (UNLIKELY(!tty__is_tty(fd)))
        return -3;

    if (termios_p == NULL && fd == STDIN_FILENO)
        termios_p = &tty__orig_termios;

    if (UNLIKELY(tcgetattr(fd, termios_p)))
        return -1;

    return 0;
}

int32_t tty__is_raw(int32_t fd)
{
    if (UNLIKELY(!tty__is_tty(fd)))
        return -3;

    if (UNLIKELY(tty__get_termios(fd, &tty__termios_tmp)))
        return -4;

    tty__stdin_mode = tty__termios_tmp.c_lflag & ICANON
        ? TTY_MODE_NORMAL
        : TTY_MODE_RAW;

    return tty__stdin_mode == TTY_MODE_RAW;
}

int32_t tty__set_mode(int32_t fd, tty_mode_t mode)
{
    if (UNLIKELY(!tty__is_tty(fd)))
        return -3;

    switch (mode) {
    case TTY_MODE_NORMAL:
        if (UNLIKELY(!tty__is_raw(fd)))
            return 0;

        if (UNLIKELY(tcsetattr(fd, TCSADRAIN, &tty__orig_termios)))
            return -6;

        break;

    // NOTE: This is based on the code from libuv for TTY_MODE_RAW
    case TTY_MODE_RAW:
        if (UNLIKELY(tty__is_raw(fd)))
            return 0;

        if (!tty__orig_set) {
            if (UNLIKELY(tty__get_termios(fd, nullptr)))
                return -4;
            tty__orig_set = true;
        }

        if (UNLIKELY(tcgetattr(fd, &tty__termios_tmp)))
            return -5;

        tty__termios_tmp.c_iflag &= ~(BRKINT | ICRNL | INPCK | ISTRIP | IXON);
        tty__termios_tmp.c_oflag |= (ONLCR);
        tty__termios_tmp.c_cflag |= (CS8);
        tty__termios_tmp.c_lflag &= ~(ECHO | ICANON | IEXTEN | ISIG);
        tty__termios_tmp.c_cc[VMIN] = 1;
        tty__termios_tmp.c_cc[VTIME] = 0;

        // What cfmakeraw does:
        // tty__termios_tmp.c_iflag &= ~(BRKINT | ICRNL |  ISTRIP | IXON | INLCR | IGNCR | IGNBRK | PARMRK );
        // tty__termios_tmp.c_oflag &= ~OPOST;
        // tty__termios_tmp.c_lflag &= ~(ECHO | ICANON | IEXTEN | ISIG | ECHONL);
        // tty__termios_tmp.c_cflag &= ~(CSIZE | PARENB);
        // tty__termios_tmp.c_cflag |= CS8;

        if (UNLIKELY(tcsetattr(fd, TCSADRAIN, &tty__termios_tmp)))
            return -6;

        break;

    // NOTE: This config is actually considered UV_TTY_MODE_IO in libuv
    // case TTY_MODE_RAW:
    //   if (tty__is_raw(fd))
    //     return 0;
    //   if (tcgetattr(fd, &tty__termios_tmp))
    //     cfmakeraw(&tty__termios_tmp);
    //   if (tcsetattr(fd, TCSADRAIN, &tty__termios_tmp) < 0)
    //     return -1;

    //   return 0;
    case TTY_MODE_UNSET:
        // User should never call this with TTY_MODE_UNSET
        return -10;
    default:
        return -1;
    }

    tty__stdin_mode = mode;
    return 0;
}

} // namespace Zig
