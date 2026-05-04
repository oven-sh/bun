use core::ffi::{c_char, c_void};

use bun_core::{self as bun, Environment, Global, Output};
use bun_crash_handler as crash_handler;

// Binary root: set mimalloc as the global allocator before any Box/Vec/Arc mapping is valid.
#[global_allocator]
static ALLOC: bun_alloc::Mimalloc = bun_alloc::Mimalloc;

// TODO(port): Zig runtime hooks with no direct Rust equivalent.
//   pub const panic = _bun.crash_handler.panic;
//     → Rust std binaries cannot override the panic entry symbol; crash_handler::init()
//       installs a std::panic hook instead (Phase B: verify parity).
//   pub const std_options = std.Options{ .enable_segfault_handler = false, .cryptoRandomSeed = _bun.csprng };
//     → segfault handler is installed by crash_handler::init(); BoringSSL RAND_bytes is
//       wired via bun_core::csprng where randomness is consumed (no global std hook in Rust).
//   pub const io_mode = .blocking;
//     → Zig std-io concept; no Rust analogue.

const _: () = assert!(cfg!(target_endian = "little"));

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn bun_warn_avx_missing(url: *const c_char);
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    pub static mut _environ: *mut c_void;
    pub static mut environ: *mut c_void;
}

pub fn main() {
    crash_handler::init();

    #[cfg(unix)]
    {
        // TODO(port): route through bun_sys once sigaction wrappers exist
        let mut act: libc::sigaction = unsafe { core::mem::zeroed() };
        act.sa_sigaction = libc::SIG_IGN;
        // SAFETY: act is fully initialized; passing null for oldact is allowed.
        unsafe {
            libc::sigemptyset(&mut act.sa_mask);
            libc::sigaction(libc::SIGPIPE, &act, core::ptr::null_mut());
            libc::sigaction(libc::SIGXFSZ, &act, core::ptr::null_mut());
        }
    }

    if cfg!(debug_assertions) {
        // TODO(port): _bun.debug_allocator_data.backing = .init;
        bun_alloc::debug_allocator_data::init_backing();
    }

    // This should appear before we make any calls at all to libuv.
    // So it's safest to put it very early in the main function.
    #[cfg(windows)]
    {
        // SAFETY: mimalloc fns match the libuv allocator signatures.
        unsafe {
            let _ = bun_sys::windows::libuv::uv_replace_allocator(
                bun_alloc::mimalloc::mi_malloc,
                bun_alloc::mimalloc::mi_realloc,
                bun_alloc::mimalloc::mi_calloc,
                bun_alloc::mimalloc::mi_free,
            );
        }
        bun_sys::windows::env::convert_env_to_wtf8();
        // SAFETY: single-threaded at this point; assigning the converted environ block.
        unsafe {
            environ = bun_core::os_environ_ptr().cast::<c_void>();
            _environ = bun_core::os_environ_ptr().cast::<c_void>();
        }
    }

    // TODO(port): bun_core::start_time storage (was `_bun.start_time = std.time.nanoTimestamp()`)
    bun_core::set_start_time(bun_core::time::nano_timestamp());
    if let Err(err) = bun_core::init_argv() {
        Output::panic(format_args!("Failed to initialize argv: {}\n", err.name()));
    }

    Output::source::Stdio::init();
    let _flush = scopeguard::guard((), |_| Output::flush());
    #[cfg(all(target_arch = "x86_64", unix))]
    if Environment::ENABLE_SIMD {
        // SAFETY: BUN_GITHUB_BASELINE_URL is a NUL-terminated static.
        unsafe {
            bun_warn_avx_missing(bun_cli::UpgradeCommand::BUN_GITHUB_BASELINE_URL.as_ptr());
        }
    }

    bun_core::StackCheck::configure_thread();
    bun_core::ParentDeathWatchdog::install();

    bun_cli::Cli::start();
    Global::exit(0);
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__panic(msg: *const u8, len: usize) -> ! {
    // SAFETY: caller guarantees msg points to `len` valid bytes.
    let s = unsafe { core::slice::from_raw_parts(msg, len) };
    Output::panic(format_args!("{}", bstr::BStr::new(s)));
}

// -- Zig Standard Library Additions --
// TODO(port): these overrode std.mem.copyForwards/copyBackwards/eqlBytes via Zig's
// root-module mechanism. Rust has no equivalent override hook; kept as plain fns for
// any direct callers. Phase B: confirm whether anything still references them.
pub fn copy_forwards<T: Copy>(dest: &mut [T], source: &[T]) {
    if source.is_empty() {
        return;
    }
    // SAFETY: dest.len() >= source.len() is the caller's contract (matches Zig); regions may overlap.
    unsafe {
        core::ptr::copy(source.as_ptr(), dest.as_mut_ptr(), source.len());
    }
}
pub fn copy_backwards<T: Copy>(dest: &mut [T], source: &[T]) {
    if source.is_empty() {
        return;
    }
    // SAFETY: dest.len() >= source.len() is the caller's contract (matches Zig); regions may overlap.
    unsafe {
        core::ptr::copy(source.as_ptr(), dest.as_mut_ptr(), source.len());
    }
}
pub fn eql_bytes(src: &[u8], dest: &[u8]) -> bool {
    // SAFETY: both slices are valid for src.len() bytes; caller contract is src.len() == dest.len().
    unsafe { bun_sys::c::memcmp(src.as_ptr().cast(), dest.as_ptr().cast(), src.len()) == 0 }
}
// -- End Zig Standard Library Additions --

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/main.zig (100 lines)
//   confidence: medium
//   todos:      6
//   notes:      Zig root-module hooks (panic/std_options/io_mode, std.mem overrides) have no Rust equivalent — crash_handler::init() must subsume them; verify in Phase B.
// ──────────────────────────────────────────────────────────────────────────
