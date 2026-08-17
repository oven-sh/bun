//! The symbols this crate's tests reach that only the full bun binary defines, for `cargo test`.

use bun_core::Fd;
use bun_core::output::{File, QuietWriter};

/// Returns `haystack_len` when `needle` is absent, like the kernel.
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_char(
    haystack: *const u8,
    haystack_len: usize,
    needle: u8,
) -> usize {
    // SAFETY: `bun_highway::index_of_char` passes a live slice's (ptr, len).
    let haystack = unsafe { core::slice::from_raw_parts(haystack, haystack_len) };
    haystack
        .iter()
        .position(|&b| b == needle)
        .unwrap_or(haystack_len)
}

/// Returns `usize::MAX` for no match and `haystack_len` for an empty needle, like the kernel.
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_memrmem(
    haystack: *const u8,
    haystack_len: usize,
    needle: *const u8,
    needle_len: usize,
) -> usize {
    // SAFETY: `bun_highway::memrmem` passes two live slices' (ptr, len) pairs.
    let (haystack, needle) = unsafe {
        (
            core::slice::from_raw_parts(haystack, haystack_len),
            core::slice::from_raw_parts(needle, needle_len),
        )
    };
    let Some(last_start) = haystack_len.checked_sub(needle_len) else {
        return usize::MAX;
    };
    (0..=last_start)
        .rev()
        .find(|&i| haystack[i..].starts_with(needle))
        .unwrap_or(usize::MAX)
}

// Reached via `RefCount`'s `ThreadLock` -> `bun_core::dump_stack_trace`; everything goes to stderr.
bun_core::link_impl_OutputSink! {
    Sys for () => |_this| {
        stderr() => File(Fd::stderr()),
        make_path(_cwd, _dir) => Err(bun_core::Error::Unexpected),
        create_file(_cwd, _path) => Err(bun_core::Error::Unexpected),
        quiet_writer_from_fd(_fd) => QuietWriter::ZEROED,
        quiet_writer_adapt(_qw, _buf, _len) => {
            unreachable!("bun_ptr tests never initialize a bun_core::output::Source")
        },
        quiet_writer_flush(_qw) => (),
        quiet_writer_write_all(_qw, bytes) => {
            std::io::Write::write_all(&mut std::io::stderr(), bytes).is_ok()
        },
        quiet_writer_fd(_qw) => Fd::stderr(),
        tty_winsize(_fd) => None,
        is_terminal(_fd) => false,
        read(_fd, _buf) => Err(bun_core::Error::Unexpected),
    }
}
