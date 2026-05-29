use core::ffi::c_char;
#[cfg(debug_assertions)]
use std::io::Write as _;

#[cfg(debug_assertions)]
use crate::{CallFrame, VirtualMachineRef as VirtualMachine};
#[cfg(debug_assertions)]
use bun_core::{self, Error, err};

// Port of the subset of Zig `std.debug.*` used by btjs.zig: `SelfInfo`, `StackIterator`,
// plus the symbol-lookup helpers. The frame-pointer unwinder lives in `bun_core::debug`.
#[cfg(debug_assertions)]
mod zig_std_debug {
    pub(super) use bun_core::debug::{StackIterator, frame_address};

    // ── SelfInfo (vendor/zig/lib/std/debug/SelfInfo.zig) ─────────────────
    // D104: relocated to `bun_crash_handler::debug` (lower-tier crate, also
    // needed by the crash handler's stack-trace printer). Re-export so the
    // in-file callers below compile unchanged.
    pub(super) use bun_crash_handler::debug::{
        Module, SelfInfo, SourceLocation, SymbolInfo, get_self_debug_info,
    };
}
#[cfg(debug_assertions)]
use zig_std_debug::{Module, SelfInfo, SourceLocation, StackIterator, SymbolInfo};

// Port of the subset of `std.io.tty.{Config,Color,detectConfig}` used by btjs.zig
// (vendor/zig/lib/std/Io/tty.zig). The `windows_api` variant is omitted because
// btjs writes to an in-memory `Vec<u8>` returned to lldb, not to the live console
// handle, so `SetConsoleTextAttribute` would colour the wrong stream.
#[cfg(debug_assertions)]
mod tty {
    // D089: `Config`/`Color`/`set_color` deduped to the canonical port in
    // `bun_crash_handler::debug` (lower-tier crate; `Vec<u8>` already impls
    // `bun_io::Write` so the generic `set_color` covers btjs's in-memory sink).
    // `detect_config_stdout` stays LOCAL — it ports a *different* Zig call
    // site (`detectConfig(stdout())` with NO_COLOR/CLICOLOR_FORCE/isatty) than
    // crash_handler's `detect_tty_config_stderr()` (Output::ENABLE_ANSI_COLORS_STDERR).
    pub(super) use bun_crash_handler::debug::{Color, TtyConfig as Config};

    /// Port of `process.hasNonEmptyEnvVarConstant`.
    fn has_non_empty_env_var(name: &core::ffi::CStr) -> bool {
        #[cfg(windows)]
        {
            // Zig spec (vendor/zig/lib/std/process.zig:435-446) reads the Win32
            // environment via `getenvW`, NOT MSVCRT `getenv`. The CRT keeps its
            // own narrow-string env cache that is not updated by
            // `SetEnvironmentVariableW`, which is how Bun mutates env vars at
            // runtime — so `libc::getenv` would silently miss those.
            unsafe extern "system" {
                fn GetEnvironmentVariableW(
                    lpName: *const u16,
                    lpBuffer: *mut u16,
                    nSize: u32,
                ) -> u32;
            }
            // `name` is a compile-time ASCII C string (c"NO_COLOR" / c"CLICOLOR_FORCE");
            // widen byte-by-byte into a NUL-terminated WCHAR buffer on the stack.
            let bytes = name.to_bytes();
            let mut name_w = [0u16; 32];
            if bytes.len() >= name_w.len() {
                return false;
            }
            for (i, &b) in bytes.iter().enumerate() {
                name_w[i] = b as u16;
            }
            let mut buf = [0u16; 2];
            // SAFETY: `name_w` is NUL-terminated; `buf` is a valid 2-WCHAR out-param.
            // With nSize=2: empty value copies successfully and returns 0 (chars
            // written, excluding NUL); not-found also returns 0; any non-empty
            // value returns >=1 (either chars written, or required size if it
            // didn't fit). So `rc != 0` ⇔ "exists and non-empty".
            let rc = unsafe {
                GetEnvironmentVariableW(name_w.as_ptr(), buf.as_mut_ptr(), buf.len() as u32)
            };
            return rc != 0;
        }
        #[cfg(not(windows))]
        {
            // SAFETY: getenv only reads; name is a valid NUL-terminated C string.
            let val = unsafe { libc::getenv(name.as_ptr()) };
            // SAFETY: getenv returns either NULL or a valid NUL-terminated C string.
            !val.is_null() && unsafe { *val } != 0
        }
    }

    /// Port of `std.io.tty.detectConfig(std.fs.File.stdout())`.
    pub(super) fn detect_config_stdout() -> Config {
        let force_color: Option<bool> = if has_non_empty_env_var(c"NO_COLOR") {
            Some(false)
        } else if has_non_empty_env_var(c"CLICOLOR_FORCE") {
            Some(true)
        } else {
            None
        };

        if force_color == Some(false) {
            return Config::NoColor;
        }

        // `file.getOrEnableAnsiEscapeSupport()` — on POSIX this is `isatty(fd)`;
        // on Windows it tries to enable VT processing on the console handle.
        // PORT NOTE: btjs writes into a `Vec<u8>` returned to lldb, so the
        // `.windows_api` variant (which calls `SetConsoleTextAttribute` mid-write)
        // cannot apply; fall through to escape_codes / no_color.
        if bun_sys::isatty(bun_sys::Fd::stdout()) {
            return Config::EscapeCodes;
        }

        if force_color == Some(true) {
            Config::EscapeCodes
        } else {
            Config::NoColor
        }
    }
}
#[cfg(debug_assertions)]
use tty::Color;

#[cfg(debug_assertions)]
unsafe extern "C" {
    // safe: link-time section markers — only their *addresses* are taken
    // (`&raw const … as usize`), never dereferenced; no Rust-side precondition.
    safe static jsc_llint_begin: u8;
    safe static jsc_llint_end: u8;
}

/// allocated using bun.default_allocator. when called from lldb, it is never freed.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn dumpBtjsTrace() -> *const c_char {
    // Zig: `if (comptime bun.Environment.isDebug)` — must use #[cfg], not cfg!(), so the
    // entire debug impl is DCE'd from release builds.
    #[cfg(debug_assertions)]
    {
        return dump_btjs_trace_debug_impl();
    }
    #[cfg(not(debug_assertions))]
    {
        b"btjs is disabled in release builds\0"
            .as_ptr()
            .cast::<c_char>()
    }
}

#[cfg(debug_assertions)]
fn dump_btjs_trace_debug_impl() -> *const c_char {
    let mut result_writer: Vec<u8> = Vec::new();
    let w = &mut result_writer;

    let debug_info: &mut SelfInfo = match get_self_debug_info() {
        // SAFETY: lazy debug-only singleton; lldb stopped-process, sole `&mut`.
        Ok(di) => unsafe { &mut *di },
        Err(err) => {
            if write!(
                w,
                "Unable to dump stack trace: Unable to open debug info: {}\x00",
                err.name()
            )
            .is_err()
            {
                return c"<oom>".as_ptr();
            }
            // leak intentionally — caller is lldb and never frees
            return bun_core::heap::into_raw(result_writer.into_boxed_slice())
                .cast::<c_char>()
                .cast_const();
        }
    };

    // std.log.info("jsc_llint_begin: {x}", .{@intFromPtr(&jsc_llint_begin)});
    // std.log.info("jsc_llint_end: {x}", .{@intFromPtr(&jsc_llint_end)});

    let tty_config = tty::detect_config_stdout();

    let mut it = StackIterator::init(zig_std_debug::frame_address());

    while let Some(return_address) = it.next() {
        // On arm64 macOS, the address of the last frame is 0x0 rather than 0x1 as on x86_64 macOS,
        // therefore, we do a check for `return_address == 0` before subtracting 1 from it to avoid
        // an overflow. We do not need to signal `StackIterator` as it will correctly detect this
        // condition on the subsequent iteration and return `null` thus terminating the loop.
        // same behaviour for x86-windows-msvc
        let address = return_address.saturating_sub(1);
        let _ = print_source_at_address(debug_info, w, address, tty_config, it.fp);
    }

    // remove nulls
    for itm in result_writer.iter_mut() {
        if *itm == 0 {
            *itm = b' ';
        }
    }
    // add null terminator
    result_writer.push(0);
    // leak intentionally — caller is lldb and never frees
    bun_core::heap::into_raw(result_writer.into_boxed_slice())
        .cast::<c_char>()
        .cast_const()
}

#[cfg(debug_assertions)]
fn print_source_at_address(
    debug_info: &mut SelfInfo,
    out_stream: &mut Vec<u8>,
    address: usize,
    tty_config: tty::Config,
    fp: usize,
) -> Result<(), Error> {
    // TODO(port): narrow error set
    if !cfg!(debug_assertions) {
        unreachable!();
    }
    let module = match get_module_for_address(debug_info, address) {
        Ok(m) => m,
        Err(e) if e == err!("MissingDebugInfo") || e == err!("InvalidDebugInfo") => {
            return print_unknown_source(debug_info, out_stream, address, tty_config);
        }
        Err(e) => return Err(e),
    };

    let symbol_info: SymbolInfo = match get_symbol_at_address(module, address) {
        Ok(s) => s,
        Err(e) if e == err!("MissingDebugInfo") || e == err!("InvalidDebugInfo") => {
            return print_unknown_source(debug_info, out_stream, address, tty_config);
        }
        Err(e) => return Err(e),
    };
    // defer free(sl.file_name) — handled by Drop on SourceLocation.file_name: Box<[u8]>

    // jsc_llint_begin/end are link-time symbols; `&raw const` avoids creating a reference to extern static
    let llint_begin = (&raw const jsc_llint_begin) as usize;
    let llint_end = (&raw const jsc_llint_end) as usize;
    let probably_llint = address > llint_begin && address < llint_end;
    let mut allow_llint = true;
    if symbol_info.name.starts_with(b"__") {
        allow_llint = false; // disallow llint for __ZN3JSC11Interpreter20executeModuleProgramEPNS_14JSModuleRecordEPNS_23ModuleProgramExecutableEPNS_14JSGlobalObjectEPNS_19JSModuleEnvironmentENS_7JSValueES9_
    }
    if symbol_info.name.starts_with(b"_llint_call_javascript") {
        allow_llint = false; // disallow llint for _llint_call_javascript
    }
    let do_llint = probably_llint && allow_llint;

    // SAFETY: fp is a raw frame pointer from the stack iterator; only dereferenced when
    // do_llint holds (i.e. address is inside the JSC LLInt range, so fp is a JSC CallFrame).
    // Single audited backref-deref hoisted for both LLInt branches below.
    let frame: Option<&CallFrame> = do_llint.then(|| unsafe { &*(fp as *const CallFrame) });
    if let Some(frame) = frame {
        // VM singleton is process-lifetime; `global` is set before any
        // JS frame can be on the stack to inspect.
        let srcloc = frame.get_caller_src_loc(VirtualMachine::get().global());
        tty_config.set_color(out_stream, Color::Bold)?;
        write!(
            out_stream,
            "{}:{}:{}: ",
            srcloc.str, srcloc.line, srcloc.column
        )?;
        tty_config.set_color(out_stream, Color::Reset)?;
    }

    print_line_info(
        out_stream,
        symbol_info.source_location.as_ref(),
        address,
        &symbol_info.name,
        &symbol_info.compile_unit_name,
        tty_config,
        print_line_from_file_any_os,
        do_llint,
    )?;
    if let Some(frame) = frame {
        let desc = frame.describe_frame();
        write!(out_stream, "    {}\n    ", bstr::BStr::new(desc))?;
        tty_config.set_color(out_stream, Color::Green)?;
        out_stream.extend_from_slice(b"^");
        tty_config.set_color(out_stream, Color::Reset)?;
        out_stream.extend_from_slice(b"\n");
    }
    Ok(())
}

#[cfg(debug_assertions)]
fn print_unknown_source(
    debug_info: &mut SelfInfo,
    out_stream: &mut Vec<u8>,
    address: usize,
    tty_config: tty::Config,
) -> Result<(), Error> {
    // TODO(port): narrow error set
    if !cfg!(debug_assertions) {
        unreachable!();
    }
    let module_name = get_module_name_for_address(debug_info, address);
    print_line_info(
        out_stream,
        None,
        address,
        b"???",
        module_name.as_deref().unwrap_or(b"???"),
        tty_config,
        print_line_from_file_any_os,
        false,
    )
}

#[cfg(debug_assertions)]
fn print_line_info(
    out_stream: &mut Vec<u8>,
    source_location: Option<&SourceLocation>,
    address: usize,
    symbol_name: &[u8],
    compile_unit_name: &[u8],
    tty_config: tty::Config,
    // Zig: `comptime printLineFromFile: anytype` — anytype maps to generic/impl-Trait so it
    // monomorphizes (PORTING.md type map), not a runtime fn pointer.
    print_line_from_file: impl Fn(&mut Vec<u8>, &SourceLocation) -> Result<(), Error>,
    do_llint: bool,
) -> Result<(), Error> {
    // TODO(port): narrow error set
    if !cfg!(debug_assertions) {
        unreachable!();
    }

    // nosuspend { ... } — no Rust equivalent needed (no async)
    tty_config.set_color(out_stream, Color::Bold)?;

    if let Some(sl) = source_location {
        write!(
            out_stream,
            "{}:{}:{}",
            bstr::BStr::new(&sl.file_name),
            sl.line,
            sl.column
        )?;
    } else if !do_llint {
        out_stream.extend_from_slice(b"???:?:?");
    }

    tty_config.set_color(out_stream, Color::Reset)?;
    if !do_llint || source_location.is_some() {
        out_stream.extend_from_slice(b": ");
    }
    tty_config.set_color(out_stream, Color::Dim)?;
    write!(
        out_stream,
        "0x{:x} in {} ({})",
        address,
        bstr::BStr::new(symbol_name),
        bstr::BStr::new(compile_unit_name)
    )?;
    tty_config.set_color(out_stream, Color::Reset)?;
    out_stream.extend_from_slice(b"\n");

    // Show the matching source code line if possible
    if let Some(sl) = source_location {
        match print_line_from_file(out_stream, sl) {
            Ok(()) => {
                if sl.column > 0 {
                    // The caret already takes one char
                    let space_needed = usize::try_from(sl.column - 1).expect("int cast");

                    // splatByteAll(' ', n)
                    out_stream.extend(core::iter::repeat_n(b' ', space_needed));
                    tty_config.set_color(out_stream, Color::Green)?;
                    out_stream.extend_from_slice(b"^");
                    tty_config.set_color(out_stream, Color::Reset)?;
                }
                out_stream.extend_from_slice(b"\n");
            }
            Err(e)
                if e == err!("EndOfFile")
                    || e == err!("FileNotFound")
                    || e == err!("BadPathName")
                    || e == err!("AccessDenied") => {}
            Err(e) => return Err(e),
        }
    }
    Ok(())
}

#[cfg(debug_assertions)]
fn print_line_from_file_any_os(
    out_stream: &mut Vec<u8>,
    source_location: &SourceLocation,
) -> Result<(), Error> {
    // TODO(port): narrow error set
    if !cfg!(debug_assertions) {
        unreachable!();
    }

    // Need this to always block even in async I/O mode, because this could potentially
    // be called from e.g. the event loop code crashing.
    // TODO(port): Zig used std.fs.cwd().openFile directly (bypassing bun.sys). PORTING.md
    // forbids std::fs; using bun_sys here. Confirm bun_sys::File is safe to call
    // from inside a crash handler / lldb (must not re-enter event loop).
    let f = bun_sys::File::open_at(
        bun_sys::Fd::cwd(),
        &source_location.file_name,
        bun_sys::O::RDONLY,
        0,
    )
    .map_err(Into::<Error>::into)?;
    // defer f.close() — handled by Drop
    // TODO fstat and make sure that the file has the correct size

    let mut buf = [0u8; 4096];
    let mut amt_read = f.read(&mut buf[..]).map_err(Into::<Error>::into)?;
    let line_start: usize = 'seek: {
        let mut current_line_start: usize = 0;
        let mut next_line: usize = 1;
        while next_line != source_location.line as usize {
            let slice = &buf[current_line_start..amt_read];
            if let Some(pos) = slice.iter().position(|&b| b == b'\n') {
                next_line += 1;
                if pos == slice.len() - 1 {
                    amt_read = f.read(&mut buf[..]).map_err(Into::<Error>::into)?;
                    current_line_start = 0;
                } else {
                    current_line_start += pos + 1;
                }
            } else if amt_read < buf.len() {
                return Err(err!("EndOfFile"));
            } else {
                amt_read = f.read(&mut buf[..]).map_err(Into::<Error>::into)?;
                current_line_start = 0;
            }
        }
        break 'seek current_line_start;
    };
    let slice = &mut buf[line_start..amt_read];
    if let Some(pos) = slice.iter().position(|&b| b == b'\n') {
        let line = &mut slice[0..pos + 1];
        replace_scalar(line, b'\t', b' ');
        out_stream.extend_from_slice(line);
        return Ok(());
    } else {
        // Line is the last inside the buffer, and requires another read to find delimiter. Alternatively the file ends.
        replace_scalar(slice, b'\t', b' ');
        out_stream.extend_from_slice(slice);
        while amt_read == buf.len() {
            amt_read = f.read(&mut buf[..]).map_err(Into::<Error>::into)?;
            if let Some(pos) = buf[0..amt_read].iter().position(|&b| b == b'\n') {
                let line = &mut buf[0..pos + 1];
                replace_scalar(line, b'\t', b' ');
                out_stream.extend_from_slice(line);
                return Ok(());
            } else {
                let line = &mut buf[0..amt_read];
                replace_scalar(line, b'\t', b' ');
                out_stream.extend_from_slice(line);
            }
        }
        // Make sure printing last line of file inserts extra newline
        out_stream.push(b'\n');
    }
    Ok(())
}

#[cfg(debug_assertions)]
#[inline]
fn replace_scalar(slice: &mut [u8], from: u8, to: u8) {
    for b in slice.iter_mut() {
        if *b == from {
            *b = to;
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Thin forwarders to the `zig_std_debug` port — keep the call-site shape
// matching the Zig (`std.debug.getSelfDebugInfo()`, `it.getLastError()`, …).
// ──────────────────────────────────────────────────────────────────────────
#[cfg(debug_assertions)]
#[inline]
fn get_self_debug_info() -> Result<*mut SelfInfo, Error> {
    zig_std_debug::get_self_debug_info()
}
#[cfg(debug_assertions)]
#[inline]
fn get_module_for_address<'a>(di: &'a mut SelfInfo, addr: usize) -> Result<&'a mut Module, Error> {
    di.get_module_for_address(addr)
}
#[cfg(debug_assertions)]
#[inline]
fn get_symbol_at_address(module: &mut Module, addr: usize) -> Result<SymbolInfo, Error> {
    module.get_symbol_at_address(addr)
}
#[cfg(debug_assertions)]
#[inline]
fn get_module_name_for_address(di: &mut SelfInfo, addr: usize) -> Option<Box<[u8]>> {
    di.get_module_name_for_address(addr)
}

// ported from: src/jsc/btjs.zig
