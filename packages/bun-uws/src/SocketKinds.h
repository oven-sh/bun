#pragma once
/* `src/uws_sys/SocketKind.rs` is the source of truth for these ordinals.
 * The Rust side exports them as `#[no_mangle]` statics so the dispatch ABI can't silently drift if
 * the enum is reordered — C++ links against the actual values instead of
 * hand-mirrored literals. */
extern "C" const unsigned char BUN_SOCKET_KIND_DYNAMIC;
