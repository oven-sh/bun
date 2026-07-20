#pragma once

#include "root.h"

#if !OS(WINDOWS)
#include <termios.h>
#endif

// Per-handle raw-mode state, mirroring libuv's `uv_tty_t`: every tty handle
// keeps its own mode plus the termios snapshot captured when it left normal
// mode, so one handle going back to cooked never disturbs another.
struct BunTTYState {
    int mode = 0;
#if !OS(WINDOWS)
    struct termios orig_termios {};
#endif
};

// `state` points at `Bun__ttyStateSize()` zero-initialized bytes, owned by the
// caller for as long as the handle lives. The bytes are copied in and out, so
// the buffer carries no alignment requirement.
extern "C" int Bun__ttySetMode(int fd, int mode, void* state);
extern "C" size_t Bun__ttyStateSize();
