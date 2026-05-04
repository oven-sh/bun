use core::ffi::c_char;
#[cfg(debug_assertions)]
use std::io::Write as _;

#[cfg(debug_assertions)]
use bun_core::{self, err, Error};
#[cfg(debug_assertions)]
use bun_jsc::{CallFrame, VirtualMachine};

// TODO(port): std.debug.* has no mapped Rust crate. These placeholder types stand in for
// Zig's self-debug-info / stack-unwinding machinery. Phase B must wire these to either a
// `bun_crash_handler` equivalent or the `backtrace`/`addr2line` crates (or drop the impl
// and shell out to the existing C++ unwinder). Everything below that touches them is a
// best-effort structural translation only.
#[cfg(debug_assertions)]
mod zig_std_debug {
    pub struct SelfInfo;
    pub struct StackIterator {
        pub fp: usize,
    }
    pub struct ThreadContext;
    pub struct SourceLocation {
        pub file_name: Box<[u8]>,
        pub line: u32,
        pub column: u32,
    }
    pub struct SymbolInfo {
        pub name: Box<[u8]>,
        pub compile_unit_name: Box<[u8]>,
        pub source_location: Option<SourceLocation>,
    }
    pub type UnwindError = bun_core::Error;
    pub struct LastUnwindError {
        pub address: usize,
        pub err: UnwindError,
    }
    pub const HAVE_UCONTEXT: bool = true; // TODO(port): std.debug.have_ucontext
}
#[cfg(debug_assertions)]
use zig_std_debug::{SelfInfo, SourceLocation, StackIterator, SymbolInfo, ThreadContext, UnwindError};

// TODO(port): std.io.tty.Config — terminal color config. Placeholder.
#[cfg(debug_assertions)]
mod tty {
    pub struct Config;
    pub enum Color {
        Bold,
        Reset,
        Dim,
        Green,
    }
    impl Config {
        pub fn set_color(&self, _w: &mut Vec<u8>, _c: Color) -> Result<(), bun_core::Error> {
            // TODO(port): tty_config.setColor
            Ok(())
        }
    }
    pub fn detect_config_stdout() -> Config {
        // TODO(port): std.io.tty.detectConfig(std.fs.File.stdout())
        Config
    }
}
#[cfg(debug_assertions)]
use tty::Color;

#[cfg(debug_assertions)]
unsafe extern "C" {
    static jsc_llint_begin: u8;
    static jsc_llint_end: u8;
}

/// allocated using bun.default_allocator. when called from lldb, it is never freed.
#[unsafe(no_mangle)]
pub extern "C" fn dumpBtjsTrace() -> *const c_char {
    // Zig: `if (comptime bun.Environment.isDebug)` — must use #[cfg], not cfg!(), so the
    // entire debug impl (and its todo!() stubs) is DCE'd from release builds.
    #[cfg(debug_assertions)]
    {
        return dump_btjs_trace_debug_impl();
    }
    #[cfg(not(debug_assertions))]
    {
        b"btjs is disabled in release builds\0".as_ptr() as *const c_char
    }
}

#[cfg(debug_assertions)]
fn dump_btjs_trace_debug_impl() -> *const c_char {
    let mut result_writer: Vec<u8> = Vec::new();
    let w = &mut result_writer;

    // TODO(port): std.debug.getSelfDebugInfo()
    let debug_info: &mut SelfInfo = match get_self_debug_info() {
        Ok(di) => di,
        Err(err) => {
            if write!(
                w,
                "Unable to dump stack trace: Unable to open debug info: {}\x00",
                err.name()
            )
            .is_err()
            {
                return b"<oom>\0".as_ptr() as *const c_char;
            }
            // leak intentionally — caller is lldb and never frees
            return Box::into_raw(result_writer.into_boxed_slice()) as *const c_char;
        }
    };

    // std.log.info("jsc_llint_begin: {x}", .{@intFromPtr(&jsc_llint_begin)});
    // std.log.info("jsc_llint_end: {x}", .{@intFromPtr(&jsc_llint_end)});

    let tty_config = tty::detect_config_stdout();

    // TODO(port): std.debug.ThreadContext / getContext / StackIterator
    let mut context: ThreadContext = unsafe { core::mem::zeroed() }; // SAFETY: Zig used `= undefined`
    let has_context = get_context(&mut context);

    #[allow(unused_mut)]
    let mut it: StackIterator = (if has_context && !cfg!(windows) {
        // TODO(port): StackIterator.initWithContext(null, debug_info, &context) catch null
        stack_iterator_init_with_context(None, debug_info, &mut context).ok()
    } else {
        None
    })
    .unwrap_or_else(|| stack_iterator_init(None, None));
    // defer it.deinit() — handled by Drop

    while let Some(return_address) = it.next() {
        print_last_unwind_error(&mut it, debug_info, w, &tty_config);

        // On arm64 macOS, the address of the last frame is 0x0 rather than 0x1 as on x86_64 macOS,
        // therefore, we do a check for `return_address == 0` before subtracting 1 from it to avoid
        // an overflow. We do not need to signal `StackIterator` as it will correctly detect this
        // condition on the subsequent iteration and return `null` thus terminating the loop.
        // same behaviour for x86-windows-msvc
        let address = return_address.saturating_sub(1);
        let _ = print_source_at_address(debug_info, w, address, &tty_config, it.fp);
    }
    // Zig `while ... else` runs after normal loop exit (no `break` in body), so this is unconditional:
    print_last_unwind_error(&mut it, debug_info, w, &tty_config);

    // remove nulls
    for itm in result_writer.iter_mut() {
        if *itm == 0 {
            *itm = b' ';
        }
    }
    // add null terminator
    result_writer.push(0);
    // leak intentionally — caller is lldb and never frees
    Box::into_raw(result_writer.into_boxed_slice()) as *const c_char
}

#[cfg(debug_assertions)]
fn print_source_at_address(
    debug_info: &mut SelfInfo,
    out_stream: &mut Vec<u8>,
    address: usize,
    tty_config: &tty::Config,
    fp: usize,
) -> Result<(), Error> {
    // TODO(port): narrow error set
    if !cfg!(debug_assertions) {
        unreachable!();
    }
    // TODO(port): debug_info.getModuleForAddress(address)
    let module = match get_module_for_address(debug_info, address) {
        Ok(m) => m,
        Err(e) if e == err!("MissingDebugInfo") || e == err!("InvalidDebugInfo") => {
            return print_unknown_source(debug_info, out_stream, address, tty_config);
        }
        Err(e) => return Err(e),
    };

    // TODO(port): module.getSymbolAtAddress(debug_info.allocator, address)
    let symbol_info: SymbolInfo = match get_symbol_at_address(module, address) {
        Ok(s) => s,
        Err(e) if e == err!("MissingDebugInfo") || e == err!("InvalidDebugInfo") => {
            return print_unknown_source(debug_info, out_stream, address, tty_config);
        }
        Err(e) => return Err(e),
    };
    // defer free(sl.file_name) — handled by Drop on SourceLocation.file_name: Box<[u8]>

    // SAFETY: jsc_llint_begin/end are link-time symbols; addr_of! avoids creating a reference to extern static
    let llint_begin = unsafe { core::ptr::addr_of!(jsc_llint_begin) } as usize;
    let llint_end = unsafe { core::ptr::addr_of!(jsc_llint_end) } as usize;
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
    let frame: &CallFrame = unsafe { &*(fp as *const CallFrame) };
    if do_llint {
        let srcloc = frame.get_caller_src_loc(VirtualMachine::get().global);
        tty_config.set_color(out_stream, Color::Bold)?;
        write!(out_stream, "{}:{}:{}: ", srcloc.str, srcloc.line, srcloc.column)?;
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
    if do_llint {
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
    tty_config: &tty::Config,
) -> Result<(), Error> {
    // TODO(port): narrow error set
    if !cfg!(debug_assertions) {
        unreachable!();
    }
    // TODO(port): debug_info.getModuleNameForAddress(address)
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
    tty_config: &tty::Config,
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
                    let space_needed = usize::try_from(sl.column - 1).unwrap();

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
    // forbids std::fs; using bun_sys here. Phase B: confirm bun_sys::File is safe to call
    // from inside a crash handler / lldb (must not re-enter event loop).
    let mut f = bun_sys::File::open_at(bun_sys::Fd::cwd(), &source_location.file_name, bun_sys::O::RDONLY, 0)
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
fn print_last_unwind_error(
    it: &mut StackIterator,
    debug_info: &mut SelfInfo,
    out_stream: &mut Vec<u8>,
    tty_config: &tty::Config,
) {
    if !cfg!(debug_assertions) {
        unreachable!();
    }
    if !zig_std_debug::HAVE_UCONTEXT {
        return;
    }
    // TODO(port): it.getLastError()
    if let Some(unwind_error) = stack_iterator_get_last_error(it) {
        let _ = print_unwind_error(
            debug_info,
            out_stream,
            unwind_error.address,
            unwind_error.err,
            tty_config,
        );
    }
}

#[cfg(debug_assertions)]
fn print_unwind_error(
    debug_info: &mut SelfInfo,
    out_stream: &mut Vec<u8>,
    address: usize,
    err: UnwindError,
    tty_config: &tty::Config,
) -> Result<(), Error> {
    // TODO(port): narrow error set
    if !cfg!(debug_assertions) {
        unreachable!();
    }

    let module_name = get_module_name_for_address(debug_info, address);
    let module_name = module_name.as_deref().unwrap_or(b"???");
    tty_config.set_color(out_stream, Color::Dim)?;
    if err == err!("MissingDebugInfo") {
        write!(
            out_stream,
            "Unwind information for `{}:0x{:x}` was not available, trace may be incomplete\n\n",
            bstr::BStr::new(module_name),
            address
        )?;
    } else {
        write!(
            out_stream,
            "Unwind error at address `{}:0x{:x}` ({}), trace may be incomplete\n\n",
            bstr::BStr::new(module_name),
            address,
            err.name()
        )?;
    }
    tty_config.set_color(out_stream, Color::Reset)?;
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
// TODO(port): stubs for Zig std.debug.* — no crate-map equivalent. Phase B
// must replace with real unwinder (bun_crash_handler / backtrace / addr2line).
// ──────────────────────────────────────────────────────────────────────────
#[cfg(debug_assertions)]
fn get_self_debug_info() -> Result<&'static mut SelfInfo, Error> {
    todo!("std.debug.getSelfDebugInfo")
}
#[cfg(debug_assertions)]
fn get_context(_ctx: &mut ThreadContext) -> bool {
    todo!("std.debug.getContext")
}
#[cfg(debug_assertions)]
fn stack_iterator_init_with_context(
    _first: Option<usize>,
    _di: &mut SelfInfo,
    _ctx: &mut ThreadContext,
) -> Result<StackIterator, Error> {
    todo!("StackIterator.initWithContext")
}
#[cfg(debug_assertions)]
fn stack_iterator_init(_first: Option<usize>, _fp: Option<usize>) -> StackIterator {
    todo!("StackIterator.init")
}
#[cfg(debug_assertions)]
impl StackIterator {
    fn next(&mut self) -> Option<usize> {
        todo!("StackIterator.next")
    }
}
#[cfg(debug_assertions)]
fn stack_iterator_get_last_error(_it: &mut StackIterator) -> Option<zig_std_debug::LastUnwindError> {
    todo!("StackIterator.getLastError")
}
#[cfg(debug_assertions)]
fn get_module_for_address(_di: &mut SelfInfo, _addr: usize) -> Result<*mut core::ffi::c_void, Error> {
    todo!("SelfInfo.getModuleForAddress")
}
#[cfg(debug_assertions)]
fn get_symbol_at_address(_module: *mut core::ffi::c_void, _addr: usize) -> Result<SymbolInfo, Error> {
    todo!("Module.getSymbolAtAddress")
}
#[cfg(debug_assertions)]
fn get_module_name_for_address(_di: &mut SelfInfo, _addr: usize) -> Option<Box<[u8]>> {
    todo!("SelfInfo.getModuleNameForAddress")
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/btjs.zig (260 lines)
//   confidence: low
//   todos:      19
//   notes:      heavy std.debug.* (SelfInfo/StackIterator/tty) usage with no crate-map equivalent — stubbed behind #[cfg(debug_assertions)]; release builds compile only the static "disabled" string. Phase B must pick an unwinder backend.
// ──────────────────────────────────────────────────────────────────────────
