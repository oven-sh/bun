#include <termios.h>
#include <unistd.h>
#include <cstdio>

#include "TTYHelper.h"

namespace Zig {

static bool tty__orig_set = false;
static bool tty__raw_mode_set = false;
static tty_mode_t tty__cached_mode = TTY_MODE_UNSET;
static struct termios tty__orig_termios;
static struct termios tty__raw_mode_termios;
static struct termios tty__termios_tmp;
static int32_t tty__is_tty_val = -1;

int32_t tty__is_tty(int32_t fd)
{
    // Only cache is_tty for stdin
    // NOTE: This caching behavior assumes that stdin doesn't change for the duration of the program
    // This may be a dangerous assumption but it's probably fine in 99% of cases as far as I can tell
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

    return (tty__termios_tmp.c_lflag & (ECHO | ICANON)) == 0;
}

static inline tty_mode_t tty__internal_get_mode(termios* termios_p)
{
    // If ICANON and ECHO are unset, we're in (one of the) raw mode(s)
    if ((termios_p->c_lflag & (ECHO | ICANON)) == 0) {
        // If OPOST is unset, we're in raw async I/O mode
        if ((termios_p->c_oflag & OPOST) == 0)
            return TTY_MODE_RAW_ASYNC_IO;
        else // Otherwise, we're in normal raw mode
            return TTY_MODE_RAW;
    }

    return TTY_MODE_NORMAL;
}

tty_mode_t tty__get_mode(int32_t fd)
{
    if (UNLIKELY(!tty__is_tty(fd)))
        return TTY_MODE_UNSET;

    if (UNLIKELY(tty__get_termios(fd, &tty__termios_tmp)))
        return TTY_MODE_UNSET;

    return tty__internal_get_mode(&tty__termios_tmp);
}

int32_t tty__set_mode(int32_t fd, tty_mode_t mode)
{
    if (UNLIKELY(!tty__is_tty(fd)))
        return -3;

    bool orig_just_set_now = false;

    switch (mode) {
    case TTY_MODE_NORMAL:
        if (UNLIKELY(!tty__is_raw(fd)))
            break;

        if (UNLIKELY(tcsetattr(fd, TCSADRAIN, &tty__orig_termios)))
            return -6;

        break;

    // NOTE: This is based on the code from libuv for TTY_MODE_RAW
    case TTY_MODE_RAW:
        if (!tty__orig_set) {
            if (UNLIKELY(tty__get_termios(fd, nullptr)))
                return -4;
            tty__orig_set = true;
            orig_just_set_now = true;
        }

        // If we set original this time, then we can make a copy of that for our new struct
        if (orig_just_set_now) {
            tty__termios_tmp = tty__orig_termios;
        } else if (UNLIKELY(tcgetattr(fd, &tty__termios_tmp)))
            return -5;

        // Check if we are already in raw mode
        // if so, then break
        if (UNLIKELY(tty__internal_get_mode(&tty__termios_tmp) == TTY_MODE_RAW))
            break;

        // If we already have a raw mode struct, use that
        if (tty__raw_mode_set) {
            if (UNLIKELY(tcsetattr(fd, TCSADRAIN, &tty__raw_mode_termios)))
                return -6;
            break;
        }

        tty__termios_tmp.c_iflag &= ~(BRKINT | ICRNL | INPCK | ISTRIP | IXON);
        tty__termios_tmp.c_oflag |= (ONLCR);
        tty__termios_tmp.c_cflag |= (CS8);
        tty__termios_tmp.c_lflag &= ~(ECHO | ICANON | IEXTEN | ISIG);
        tty__termios_tmp.c_cc[VMIN] = 1;
        tty__termios_tmp.c_cc[VTIME] = 0;

        tty__raw_mode_termios = tty__termios_tmp;
        tty__raw_mode_set = true;

        if (UNLIKELY(tcsetattr(fd, TCSADRAIN, &tty__termios_tmp)))
            return -6;

        break;

    case TTY_MODE_RAW_ASYNC_IO:

        if (!tty__orig_set) {
            if (UNLIKELY(tty__get_termios(fd, nullptr)))
                return -4;
            tty__orig_set = true;
            orig_just_set_now = true;
        }

        // If we set original this time, then we can make a copy of that for our new struct
        if (orig_just_set_now) {
            tty__termios_tmp = tty__orig_termios;
        } else if (UNLIKELY(tcgetattr(fd, &tty__termios_tmp)))
            return -5;

        // Check if we are already in raw mode
        // if so, then break
        if (UNLIKELY(tty__internal_get_mode(&tty__termios_tmp) == TTY_MODE_RAW_ASYNC_IO))
            break;

        // Here are the main difference between this (TTY_MODE_RAW_ASYNC_IO)
        // and what Node and libuv consider "raw mode", as well as what we call "raw mode" (TTY_MODE_RAW):

        // - We unset INLCR, which means we don't convert newlines to carriage returns
        // - We unset IGNCR, which means we don't ignore carriage returns
        // - We unset IGNBRK, which means we don't ignore break conditions
        // - We unset PARMRK, which means we don't mark parity errors
        // - We unset OPOST, which means we don't do any output processing... This means thinks like LF -> CRLF won't happen,
        //   but also that we won't do any other output processing
        // - We unset ECHONL, which means we don't echo newlines
        // - We unset CSIZE, which means we don't set the character size
        // - We unset PARENB, which means we don't enable parity generation on output and parity checking for input

        // - We don't unset INPCK, which means we *would* check parity... except actually we don't because we unset PARENB

        // Some parts of this config may be redundant, but it's likely just so that things are more explicit semantically
        // I basically pulled out the `cfmakeraw()` config to make it more explicit what we're doing here
        // But the config below *should* be equivalent to `cfmakeraw()` (on most systems)
        tty__termios_tmp.c_iflag &= ~(BRKINT | ICRNL | ISTRIP | IXON | INLCR | IGNCR | IGNBRK | PARMRK);
        tty__termios_tmp.c_oflag &= ~OPOST;
        tty__termios_tmp.c_lflag &= ~(ECHO | ICANON | IEXTEN | ISIG | ECHONL);
        tty__termios_tmp.c_cflag &= ~(CSIZE | PARENB);
        tty__termios_tmp.c_cflag |= CS8;

        if (UNLIKELY(tcsetattr(fd, TCSADRAIN, &tty__termios_tmp)))
            return -6;

        break;
    case TTY_MODE_UNSET:
        // User should really never call this with TTY_MODE_UNSET
        return -10;
    default:
        return -1;
    }

    return 0;
}

int tty__set_async_io_mode(int fd, bool enabled)
{
    tty_mode_t current_mode = tty__get_mode(fd);
    bool is_async_io = current_mode == TTY_MODE_RAW_ASYNC_IO;

    // If already in desired state, then return 0
    if (is_async_io == enabled)
        return 0;

    if (enabled) {
        // If enabling, cache the current mode so we can restore it later
        tty__cached_mode = current_mode;
        // Set the mode to raw async io
        return tty__set_mode(fd, TTY_MODE_RAW_ASYNC_IO);
    } else {
        // If disabling, restore the cached mode and reset cached mode
        // If unset, then default to normal. Though this should never happen under normal circumstances
        auto result = tty__set_mode(fd, tty__cached_mode != TTY_MODE_UNSET ? tty__cached_mode : TTY_MODE_NORMAL);
        tty__cached_mode = TTY_MODE_UNSET;
        return result;
    }
}

} // namespace Zig
