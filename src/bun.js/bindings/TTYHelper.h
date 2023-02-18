#pragma once

#include <termios.h>

namespace Zig {

extern "C" typedef enum {
    TTY_MODE_NORMAL,
    TTY_MODE_RAW,
} tty_mode_t;

extern "C" int32_t tty__is_tty(int32_t fd);
extern "C" int32_t tty__get_termios(int32_t fd, termios* termios_p);
extern "C" int32_t tty__is_raw(int32_t fd);
extern "C" int32_t tty__set_mode(int32_t fd, tty_mode_t mode);

} // namespace Zig
