#pragma once

#include <termios.h>
#include <unistd.h>

#ifndef STDIN_FILENO
#define STDIN_FILENO 0
#endif

extern "C" typedef enum {
    TTY_MODE_NORMAL,
    TTY_MODE_RAW,
} tty_mode_t;

static struct termios tty__orig_termios;
static struct termios tty__termios_tmp;
static int32_t tty__is_tty_val = -1;
static tty_mode_t tty__stdin_mode = TTY_MODE_NORMAL;

extern "C" int32_t tty__is_tty(int32_t fd)
{
    if (fd != STDIN_FILENO)
        return 0;

    if (tty__is_tty_val == -1)
        tty__is_tty_val = isatty(fd);

    return tty__is_tty_val;
}

extern "C" int32_t tty__get_termios(int32_t fd, termios* termios_p)
{
    if (fd != STDIN_FILENO || !tty__is_tty(fd))
        return -3;

    if (termios_p == NULL)
        termios_p = &tty__orig_termios;

    if (tcgetattr(fd, termios_p))
        return -1;

    return 0;
}

extern "C" int32_t tty__is_raw(int32_t fd)
{
    if (fd != STDIN_FILENO || !tty__is_tty(fd))
        return -3;
    // printf("tty__is_raw(%d) = %s", fd,
    //     fd == STDIN_FILENO
    //         ? (tty__stdin_mode == TTY_MODE_RAW ? "true" : "false")
    //         : "not_stdin");
    return tty__stdin_mode == TTY_MODE_RAW;
}

// If mode is cooked, restore the original termios
// If mode is raw, set the termios to raw mode
extern "C" int32_t tty__set_mode(int32_t fd, tty_mode_t mode)
{
    if (fd != STDIN_FILENO || !tty__is_tty(fd))
        return -3;

    switch (mode) {
    case TTY_MODE_NORMAL:
        if (!tty__is_raw(fd))
            return 0;

        break;

    // NOTE: This is based on the code from libuv for TTY_MODE_RAW
    case TTY_MODE_RAW:
        if (tty__is_raw(fd))
            return 0;
        if (tcgetattr(fd, &tty__termios_tmp))
            return -1;

        tty__termios_tmp.c_iflag &= ~(BRKINT | ICRNL | INPCK | ISTRIP | IXON);
        tty__termios_tmp.c_oflag |= (ONLCR);
        tty__termios_tmp.c_cflag |= (CS8);
        tty__termios_tmp.c_lflag &= ~(ECHO | ICANON | IEXTEN | ISIG);
        tty__termios_tmp.c_cc[VMIN] = 1;
        tty__termios_tmp.c_cc[VTIME] = 0;

        if (tcsetattr(fd, TCSADRAIN, &tty__termios_tmp))
            return -1;

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
    default:
        return -1;
    }

    tty__stdin_mode = mode;
    return 0;
}
