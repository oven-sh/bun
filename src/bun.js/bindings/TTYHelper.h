#pragma once

#include <termios.h>

#ifndef STDIN_FILENO
#define STDIN_FILENO 0
#endif

#ifndef UNLIKELY
#define UNLIKELY(x) __builtin_expect(!!(x), 0)
#endif

#ifndef LIKELY
#define LIKELY(x) __builtin_expect(!!(x), 1)
#endif

namespace Zig {

extern "C" typedef enum {
    TTY_MODE_NORMAL,
    TTY_MODE_RAW,
    TTY_MODE_RAW_ASYNC_IO,
    TTY_MODE_UNSET = -1,
} tty_mode_t;

extern "C" int32_t tty__is_tty(int32_t fd);
extern "C" int32_t tty__get_termios(int32_t fd, termios* termios_p);
extern "C" int32_t tty__is_raw(int32_t fd);
extern "C" int32_t tty__set_mode(int32_t fd, tty_mode_t mode);
extern "C" tty_mode_t tty__get_mode(int32_t fd);

int tty__set_async_io_mode(int fd, bool enabled);

} // namespace Zig
