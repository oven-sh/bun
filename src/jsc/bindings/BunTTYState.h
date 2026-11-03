#pragma once

#include "root.h"

#if !OS(WINDOWS)
#include <termios.h>
#endif

// Per-handle raw-mode state, the fields of libuv's `uv_tty_t`: the mode that this handle set, and the terminal from before it left normal mode, which setRawMode(false) writes back. What a close writes is not per handle: see Bun__ttyClose.
struct BunTTYState {
    // The owner sets the mode through a descriptor that it made and that only its close ends, as a `uv_tty_t` does.
    static constexpr int OwnsDescriptor = 1 << 0;
    // This state holds the snapshot of the process. Only a state with OwnsDescriptor takes it.
    static constexpr int HoldsResetSnapshot = 1 << 1;

    int mode = 0;
    int flags = 0;
    // With OwnsDescriptor: the descriptor of the caller that the owner stands for. 0 to 2 are the ones that bun_restore_stdio() puts back.
    int caller_fd = 0;
#if !OS(WINDOWS)
    struct termios orig_termios {};
#endif
};

// `state` is zero-initialized and lives as long as its owner. Its layout is the one of `bun_core::tty::State`.
// `drain` nonzero applies the change with TCSADRAIN (libuv's behavior, for
// real ttys); zero uses TCSANOW, required for PTY masters (see the comment in
// wtf-bindings.cpp).
extern "C" int Bun__ttySetMode(int fd, int mode, BunTTYState* state, int drain);
// The termios part of libuv's uv__tty_close(), for the `state` of an owner that closes. `fd` is the one that it set the mode through.
extern "C" void Bun__ttyClose(int fd, BunTTYState* state);
