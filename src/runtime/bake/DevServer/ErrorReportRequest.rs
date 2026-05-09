//! Fetched when a client-side error happens. This performs two actions
//! - Logs the remapped stack trace to the console.
//! - Replies with the remapped stack trace.
//! Payload:
//! - `u32`: Responding message ID (echoed back)
//! - `u32`: Length of message
//! - `[n]u8`: Message
//! - `u32`: Length of error name
//! - `[n]u8`: Error name
//! - `u32`: Number of stack frames. For each
//!   - `u32`: Line number (0 for unavailable)
//!   - `u32`: Column number (0 for unavailable)
//!   - `u32`: Length of file name (0 for unavailable)
//!   - `[n]u8`: File name
//!   - `u32`: Length of function name (0 for unavailable)
//!   - `[n]u8`: Function name

use bun_alloc::ArenaVecExt as _;

use bun_alloc::Arena; // bumpalo::Bump re-export
use bun_collections::ArrayHashMap;
use bun_core::{Ordinal, Output};
use bun_jsc::{
    JSErrorCode, JSRuntimeType, ZigException, ZigStackFrame, ZigStackFrameCode,
    ZigStackFramePosition, ZigStackTrace,
};
use bun_logger::Log;
use bun_paths::path_buffer_pool;
use bun_str::{strings, String as BunString};
use bun_uws::{self as uws, AnyResponse, Request};
use bun_uws_sys::body_reader_mixin::{BodyReaderHandler, BodyResponse};

use super::source_map_store::{self, GetResult, Key as SourceMapKey};
use super::{DevServer, CLIENT_PREFIX};
use crate::server::static_route::InitFromBytesOptions;
use crate::server::StaticRoute;

pub struct ErrorReportRequest {
    // BACKREF: heap-allocated request; DevServer owns the server lifecycle and
    // outlives every in-flight request (BackRef invariant).
    dev: bun_ptr::BackRef<DevServer>,
    // PORT NOTE: BodyReaderMixin is a Zig comptime mixin parameterized by
    // (Self, "body", run_with_body, finalize). Modeled as a generic helper that
    // stores the buffered body and dispatches to the two callbacks below.
    body: uws::BodyReaderMixin<ErrorReportRequest>,
}

impl BodyReaderHandler for ErrorReportRequest {
    const MIXIN_OFFSET: usize = core::mem::offset_of!(ErrorReportRequest, body);

    unsafe fn on_body(this: *mut Self, body: &[u8], resp: AnyResponse) -> Result<(), bun_core::Error> {
        // SAFETY: caller (BodyReaderMixin) passes the original heap-allocated
        // pointer with full-allocation provenance and no live borrows.
        unsafe { ErrorReportRequest::run_with_body(this, body, resp) }
    }

    unsafe fn on_error(this: *mut Self) {
        // Caller passes the original heap-allocated pointer; finalize
        // consumes it via heap::take exactly once.
        ErrorReportRequest::finalize(this)
    }
}

impl ErrorReportRequest {
    pub fn run<R: BodyResponse>(dev: &mut DevServer, _req: &mut Request, resp: &mut R) {
        let ctx = bun_core::heap::into_raw(Box::new(ErrorReportRequest {
            dev: bun_ptr::BackRef::new_mut(dev),
            body: uws::BodyReaderMixin::init(),
        }));
        // SAFETY: ctx was just allocated and is non-null; BackRef exclusivity —
        // JS-thread only, sole `&mut DevServer` in scope.
        unsafe {
            (*ctx).dev.get_mut().server.as_mut().unwrap().on_pending_request();
        }
        uws::BodyReaderMixin::<ErrorReportRequest>::read_body(ctx, resp);
    }

    /// `ctx` must be the pointer returned by `heap::alloc` in `run`; called
    /// exactly once (success path here, or via `on_error` on abort/error).
    pub fn finalize(ctx: *mut ErrorReportRequest) {
        // SAFETY: `ctx` is the original Box allocation produced by `run`; no
        // live borrow of `*ctx` exists (BodyReaderHandler hands us the raw
        // pointer, never `&mut self`). Only reachable via `on_body`/`on_error`,
        // both of which uphold this contract.
        unsafe {
            (*ctx).dev.get_mut().server.as_mut().unwrap().on_static_request_complete();
            drop(bun_core::heap::take(ctx));
        }
    }

    /// SAFETY: `ctx` must be the pointer returned by `heap::alloc` in `run`,
    /// with no live `&`/`&mut` into the allocation. On `Ok(())` return this
    /// consumes `ctx` via `finalize`; on `Err` the caller (BodyReaderMixin)
    /// retains ownership and will call `on_error`.
    pub unsafe fn run_with_body(
        ctx: *mut ErrorReportRequest,
        body: &[u8],
        r: AnyResponse,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set

        // .finalize has to be called last, but only in the non-error path.
        // PORT NOTE: Zig used `defer if (should_finalize_self) ctx.finalize()`
        // with `should_finalize_self` flipped to true only at the very end.
        // On error return, BodyReaderMixin calls `on_error` → `finalize`, so
        // here we simply call `finalize` directly at the success tail.

        let mut reader: &[u8] = body;

        // PERF(port): was stack-fallback (65536) + ArenaAllocator — profile in Phase B
        let arena = Arena::new();
        // PERF(port): was stack-fallback (65536) + ArenaAllocator — profile in Phase B
        // The Zig used a separate per-source-map arena that was reset between
        // parses; the Rust `source_map_store::get_parsed_source_map` (the
        // canonical impl on `DevServer.source_maps`) takes `&self` and
        // allocates VLQ scratch + result mappings into the global mimalloc
        // heap, so no per-map reset arena is threaded here.

        // BackRef::get() is safe under the back-reference invariant (DevServer
        // outlives this request). No `&mut *ctx` is formed for the body of this
        // fn — `finalize(ctx)` at the tail consumes the original Box pointer.
        // SAFETY: `ctx` is the live heap allocation from `run` (caller contract).
        let dev: &DevServer = unsafe { &*ctx }.dev.get();

        // Read payload, assemble ZigException
        let name = read_string32(&mut reader)?;
        let message = read_string32(&mut reader)?;
        let browser_url = read_string32(&mut reader)?;
        let stack_count = read_u32_le(&mut reader)?.min(255); // does not support more than 255
        let mut frames: Vec<ZigStackFrame> = Vec::with_capacity(stack_count as usize);
        for _ in 0..stack_count {
            let line = read_i32_le(&mut reader)?;
            let column = read_i32_le(&mut reader)?;
            let function_name = read_string32(&mut reader)?;
            let file_name = read_string32(&mut reader)?;
            frames.push(ZigStackFrame {
                function_name: BunString::init(function_name),
                source_url: BunString::init(file_name),
                position: if line > 0 {
                    ZigStackFramePosition {
                        line: Ordinal::from_one_based(line),
                        column: if column < 1 {
                            Ordinal::INVALID
                        } else {
                            Ordinal::from_one_based(column)
                        },
                        line_start_byte: 0,
                    }
                } else {
                    ZigStackFramePosition {
                        line: Ordinal::INVALID,
                        column: Ordinal::INVALID,
                        line_start_byte: 0,
                    }
                },
                code_type: ZigStackFrameCode::NONE,
                is_async: false,
                remapped: false,
                jsc_stack_frame_index: -1,
            });
        }

        const RUNTIME_NAME: &[u8] = b"Bun HMR Runtime";

        let browser_url_origin =
            bun_url::origin_from_slice(browser_url).unwrap_or(browser_url);

        // All files that DevServer could provide a source map fit the pattern:
        // `/_bun/client/<label>-{u64}.js`
        // Where the u64 is a unique identifier pointing into sourcemaps.
        //
        // HMR chunks use this too, but currently do not host their JS code.
        let mut parsed_source_maps: ArrayHashMap<SourceMapKey, Option<GetResult<'_>>> =
            ArrayHashMap::new();
        bun_core::handle_oom(parsed_source_maps.ensure_total_capacity(4));
        // PORT NOTE: `defer for (parsed_source_maps.values()) |*v| v.deinit()` deleted —
        // `GetResult` drops its owned `mappings` automatically.

        let mut runtime_lines: Option<[&[u8]; 5]> = None;
        let mut first_line_of_interest: usize = 0;
        let mut top_frame_position = ZigStackFramePosition::INVALID;
        let mut region_of_interest_line: u32 = 0;
        for frame in frames.iter_mut() {
            // PORT NOTE: Zig read `frame.source_url.value.ZigString.slice()` —
            // every `source_url` here is `Tag::ZigString` (built via
            // `String::init(&[u8])`), so `byte_slice()` is the equivalent view.
            let source_url: &[u8] = frame.source_url.byte_slice();
            // The browser code strips "http://localhost:3000" when the string
            // has /_bun/client. It's done because JS can refer to `location`
            let Some(id) = parse_id(source_url, browser_url_origin) else {
                continue;
            };

            // Get and cache the parsed source map
            let gop = bun_core::handle_oom(parsed_source_maps.get_or_put(id));
            if !gop.found_existing {
                // PERF(port): Zig reset a per-map arena here; the Rust port
                // allocates VLQ/result into the global heap and frees on Drop.
                match dev.source_maps.get_parsed_source_map(id) {
                    None => {
                        Output::debug_warn(format_args!(
                            "Failed to find mapping for {}, {}",
                            bstr::BStr::new(source_url),
                            id.get()
                        ));
                        *gop.value_ptr = None;
                        continue;
                    }
                    Some(psm) => {
                        *gop.value_ptr = Some(psm);
                    }
                }
            }
            let Some(result) = &*gop.value_ptr else {
                continue;
            };

            // When before the first generated line, remap to the HMR runtime.
            //
            // Reminder that the HMR runtime is *not* sourcemapped. And appears
            // first in the bundle. This means that the mappings usually looks like
            // this:
            //
            // AAAA;;;;;;;;;;;ICGA,qCAA4B;
            // ^              ^ generated_mappings[1], actual code
            // ^
            // ^ generated_mappings[0], we always start it with this
            //
            // So we can know if the frame is inside the HMR runtime if
            // `frame.position.line < generated_mappings[1].lines`.
            let generated_mappings = result.mappings.generated();
            if generated_mappings.len() <= 1
                || frame.position.line.zero_based() < generated_mappings[1].lines.zero_based()
            {
                frame.source_url = BunString::init(RUNTIME_NAME); // matches value in source map
                frame.position = ZigStackFramePosition::INVALID;
                continue;
            }

            // Remap the frame
            let remapped = result.mappings.find(frame.position.line, frame.position.column);
            if let Some(remapped_position) = &remapped {
                frame.position = ZigStackFramePosition {
                    line: Ordinal::from_zero_based(remapped_position.original_line()),
                    column: Ordinal::from_zero_based(remapped_position.original_column()),
                    line_start_byte: 0,
                };
                let index = remapped_position.source_index;
                if index >= 1 && (index as usize - 1) < result.file_paths.len() {
                    let abs_path: &[u8] = &result.file_paths[index as usize - 1];
                    frame.source_url = BunString::init(abs_path);
                    let mut relative_path_buf = path_buffer_pool::get();
                    let rel_path = dev.relative_path(&mut relative_path_buf, abs_path);
                    if strings::eql(frame.function_name.byte_slice(), rel_path) {
                        frame.function_name = BunString::EMPTY;
                    }
                    frame.remapped = true;

                    if runtime_lines.is_none() {
                        let file = &result.entry_files[index as usize - 1];
                        if let Some(source_map) = file.get() {
                            let json_encoded_source_code = source_map.quoted_contents();
                            // First line of interest is two above the target line.
                            let target_line = frame.position.line.zero_based() as usize;
                            first_line_of_interest = target_line.saturating_sub(2);
                            region_of_interest_line =
                                (target_line - first_line_of_interest) as u32;
                            runtime_lines = extract_json_encoded_source_code::<5>(
                                json_encoded_source_code,
                                first_line_of_interest as u32,
                                &arena,
                            )?;
                            top_frame_position = frame.position;
                        }
                    }
                } else if index == 0 {
                    // Should be picked up by above but just in case.
                    frame.source_url = BunString::init(RUNTIME_NAME);
                    frame.position = ZigStackFramePosition::INVALID;
                }
            }
        }

        // Stack traces can often end with random runtime frames that are not relevant.
        'trim_runtime_frames: {
            // Ensure that trimming will not remove ALL frames.
            let mut all_runtime = true;
            for frame in frames.iter() {
                // PORT NOTE: Zig compared `slice().ptr == runtime_name` —
                // pointer-identity on the borrowed RUNTIME_NAME slice.
                let is_runtime = frame.position.is_invalid()
                    && frame.source_url.byte_slice().as_ptr() == RUNTIME_NAME.as_ptr();
                if !is_runtime {
                    all_runtime = false;
                    break;
                }
            }
            if all_runtime {
                break 'trim_runtime_frames;
            }

            // Move all frames up
            // PORT NOTE: reshaped — Zig copied items down then truncated; Rust
            // `Vec::retain` does the same in-place compaction with the same
            // relative order.
            frames.retain(|frame| {
                !(frame.position.is_invalid()
                    && frame.source_url.byte_slice().as_ptr() == RUNTIME_NAME.as_ptr())
            });
        }

        let mut exception = ZigException {
            r#type: JSErrorCode::Error,
            runtime_type: JSRuntimeType::NOTHING,
            name: BunString::init(name),
            message: BunString::init(message),
            stack: ZigStackTrace::from_frames(&mut frames),
            exception: core::ptr::null_mut(),
            remapped: false,
            browser_url: BunString::init(browser_url),
            errno: 0,
            syscall: BunString::EMPTY,
            system_code: BunString::EMPTY,
            path: BunString::EMPTY,
            fd: -1,
        };

        {
            let stderr = Output::error_writer_buffered();
            let _flush = Output::flush_guard();
            // PERF(port): was comptime bool dispatch — `print_externally_remapped_zig_exception`
            // takes runtime `allow_ansi_color`, so no `inline else` split needed.
            let ansi_colors = Output::enable_ansi_colors_stderr();
            // `dev.vm` is `*const` (shared-ref provenance from `Options.vm`);
            // `vm_mut()` recovers `&mut VirtualMachine` via the per-thread
            // singleton (`VirtualMachine::get() -> *mut`), which carries
            // mutable provenance. Single JS thread — no aliasing `&mut`.
            let vm = dev.vm_mut();
            let _ = vm.print_externally_remapped_zig_exception(
                &mut exception,
                None,
                stderr,
                true,
                ansi_colors,
            );
        }

        let mut out: Vec<u8> = Vec::new();

        write_u32_le(&mut out, exception.stack.frames_len as u32);
        for frame in exception.stack.frames() {
            write_i32_le(&mut out, frame.position.line.one_based());
            write_i32_le(&mut out, frame.position.column.one_based());

            let function_name: &[u8] = frame.function_name.byte_slice();
            write_u32_le(&mut out, function_name.len() as u32);
            out.extend_from_slice(function_name);

            let src_to_write: &[u8] = frame.source_url.byte_slice();
            if strings::has_prefix_comptime(src_to_write, b"/") {
                let mut relative_path_buf = path_buffer_pool::get();
                let file = dev.relative_path(&mut relative_path_buf, src_to_write);
                write_u32_le(&mut out, file.len() as u32);
                out.extend_from_slice(file);
            } else {
                write_u32_le(&mut out, src_to_write.len() as u32);
                out.extend_from_slice(src_to_write);
            }
        }

        if let Some(mut lines) = runtime_lines {
            // trim empty lines
            let mut adjusted_lines: &mut [&[u8]] = &mut lines;
            while !adjusted_lines.is_empty() && adjusted_lines[0].is_empty() {
                adjusted_lines = &mut adjusted_lines[1..];
                region_of_interest_line = region_of_interest_line.saturating_sub(1);
                first_line_of_interest += 1;
            }
            while !adjusted_lines.is_empty() && adjusted_lines[adjusted_lines.len() - 1].is_empty()
            {
                let new_len = adjusted_lines.len() - 1;
                adjusted_lines = &mut adjusted_lines[..new_len];
            }

            out.push(adjusted_lines.len() as u8);
            write_u32_le(&mut out, region_of_interest_line);
            write_u32_le(&mut out, (first_line_of_interest + 1) as u32);
            write_u32_le(&mut out, top_frame_position.column.one_based() as u32);

            for line in adjusted_lines.iter() {
                write_u32_le(&mut out, line.len() as u32);
                out.extend_from_slice(line);
            }
        } else {
            out.push(0u8);
        }

        StaticRoute::send_blob_then_deinit(
            r,
            crate::webcore::blob::Any::from_array_list(out),
            InitFromBytesOptions {
                mime_type: Some(&bun_http_types::MimeType::OTHER),
                server: dev.server,
                ..Default::default()
            },
        );
        // `should_finalize_self = true;` — see PORT NOTE at fn top.
        // `ctx` is the original heap-allocated pointer (caller contract); the
        // only borrow derived from it (`dev`) points into a separate DevServer
        // allocation, so freeing `*ctx` does not invalidate any live reference.
        ErrorReportRequest::finalize(ctx);
        Ok(())
    }
}

pub fn parse_id(source_url: &[u8], browser_url: &[u8]) -> Option<source_map_store::Key> {
    if !source_url.starts_with(browser_url) {
        return None;
    }
    let after_host = &source_url[strings::without_trailing_slash(browser_url).len()..];
    // PORT NOTE: `client_prefix ++ "/"` is comptime string concat in Zig.
    if !(after_host.starts_with(CLIENT_PREFIX.as_bytes())
        && after_host.get(CLIENT_PREFIX.len()) == Some(&b'/'))
    {
        return None;
    }
    let after_prefix = &after_host[CLIENT_PREFIX.len() + 1..];
    // Extract the ID
    if !after_prefix.ends_with(b".js") {
        return None;
    }
    const MIN_LEN: usize = b"00000000FFFFFFFF.js".len();
    if after_prefix.len() < MIN_LEN {
        return None;
    }
    let hex = &after_prefix[after_prefix.len() - MIN_LEN..][..core::mem::size_of::<u64>() * 2];
    if hex.len() != core::mem::size_of::<u64>() * 2 {
        return None;
    }
    Some(source_map_store::Key::init(parse_hex_to_int::<u64>(hex)?))
}

// PORT NOTE: Zig used `std.fmt.parseUnsigned(T, slice, 16)`. Thin local copy of
// `dev_server_body::parse_hex_to_int` so this module doesn't depend on the
// body draft. Rust can't size a stack array by a generic `T` without
// `generic_const_exprs`, so cap at 16 bytes (enough for u128).
fn parse_hex_to_int<T: Copy>(slice: &[u8]) -> Option<T> {
    let size = ::core::mem::size_of::<T>();
    debug_assert!(size <= 16);
    let mut out = [0u8; 16];
    let decoded = strings::decode_hex_to_bytes(&mut out[..size], slice).ok()?;
    debug_assert!(decoded == size);
    // SAFETY: out[..size] is fully initialized by decode_hex_to_bytes; T: Copy.
    Some(unsafe { ::core::ptr::read_unaligned(out.as_ptr().cast::<T>()) })
}

/// Instead of decoding the entire file, just decode the desired section.
fn extract_json_encoded_source_code<'a, const N: usize>(
    contents: &'a [u8],
    target_line: u32,
    arena: &'a Arena,
) -> Result<Option<[&'a [u8]; N]>, bun_core::Error> {
    // TODO(port): narrow error set
    let mut line: usize = 0;
    let mut prev: usize = 0;
    let index_of_first_line: usize = if target_line == 0 {
        0 // no iteration needed
    } else {
        'find: loop {
            match strings::index_of_char_pos(contents, b'\\', prev) {
                Some(i) => {
                    if i >= contents.len() - 2 {
                        return Ok(None);
                    }
                    // Bun's JSON printer will not use a sillier encoding for newline.
                    if contents[i + 1] == b'n' {
                        line += 1;
                        if line == target_line as usize {
                            break 'find i + 2;
                        }
                    }
                    prev = i + 2;
                }
                None => return Ok(None),
            }
        }
    };

    let mut rest = &contents[index_of_first_line..];

    // For decoding JSON escapes, the JS Lexer decoding function has
    // `decodeEscapeSequences`, which only supports decoding to UTF-16.
    // Alternatively, it appears the TOML lexer has copied this exact
    // function but for UTF-8. So the decoder can just use that.
    //
    // This function expects but does not assume the escape sequences
    // given are valid, and does not bubble errors up.
    //
    // PORT NOTE: `Lexer<'a>` borrows `&'a mut Log` and `&'a Source`; allocate
    // both from the caller's arena so their lifetime matches the decoded
    // `ArenaVec<'a, u8>` slices we hand back in `result`.
    let log: &'a mut Log = arena.alloc(Log::init());
    let source: &'a bun_logger::Source =
        arena.alloc(bun_logger::Source::init_empty_file(b""));
    let mut l = bun_interchange::toml::Lexer {
        log,
        source,
        start: 0,
        end: 0,
        current: 0,
        bump: arena,
        code_point: -1,
        identifier: b"",
        number: 0.0,
        prev_error_loc: bun_logger::Loc::EMPTY,
        string_literal_slice: b"",
        string_literal_is_ascii: true,
        line_number: 0,
        token: bun_interchange::toml::lexer::T::t_end_of_file,
        allow_double_bracket: true,
        has_newline_before: false,
        should_redact_logs: false,
    };
    // log dropped at scope exit

    let mut result: [&'a [u8]; N] = [b""; N];
    for decoded_line in result.iter_mut() {
        let mut has_extra_escapes = false;
        prev = 0;
        // Locate the line slice
        let end_of_line: usize = loop {
            match strings::index_of_char_pos(rest, b'\\', prev) {
                Some(i) => {
                    if i >= rest.len() - 1 {
                        return Ok(None);
                    }
                    if rest[i + 1] == b'n' {
                        break i;
                    }
                    has_extra_escapes = true;
                    prev = i + 2;
                }
                None => break rest.len(),
            }
        };
        let encoded_line = &rest[..end_of_line];

        // Decode it
        if has_extra_escapes {
            let mut bytes: bun_alloc::ArenaVec<'a, u8> =
                bun_alloc::ArenaVec::with_capacity_in(encoded_line.len(), arena);
            l.decode_escape_sequences::<false>(0, encoded_line, &mut bytes)?;
            *decoded_line = bytes.into_bump_slice();
        } else {
            *decoded_line = encoded_line;
        }

        if end_of_line + 2 >= rest.len() {
            break;
        }
        rest = &rest[end_of_line + 2..];
    }

    Ok(Some(result))
}

// ─── local I/O helpers ────────────────────────────────────────────────────
// Zig used `std.io.fixedBufferStream(body).reader()` with `readInt(T, .little)`
// and a `writer()` over an ArrayList. These tiny helpers cover exactly the
// methods used here; Phase B may replace with a shared bun_io reader/writer.

/// `DevServer.readString32` — local zero-copy variant over the body slice
/// reader (the canonical allocating version lives in the gated `DevServer.rs`
/// draft and is not yet re-exported from `super`).
#[inline]
fn read_string32<'a>(r: &mut &'a [u8]) -> Result<&'a [u8], bun_core::Error> {
    let len = read_u32_le(r)? as usize;
    if r.len() < len {
        return Err(bun_core::err!("EndOfStream"));
    }
    let (head, tail) = r.split_at(len);
    *r = tail;
    Ok(head)
}

#[inline]
fn read_u32_le(r: &mut &[u8]) -> Result<u32, bun_core::Error> {
    if r.len() < 4 {
        return Err(bun_core::err!("EndOfStream"));
    }
    let (head, tail) = r.split_at(4);
    *r = tail;
    Ok(u32::from_le_bytes([head[0], head[1], head[2], head[3]]))
}

#[inline]
fn read_i32_le(r: &mut &[u8]) -> Result<i32, bun_core::Error> {
    if r.len() < 4 {
        return Err(bun_core::err!("EndOfStream"));
    }
    let (head, tail) = r.split_at(4);
    *r = tail;
    Ok(i32::from_le_bytes([head[0], head[1], head[2], head[3]]))
}

#[inline]
fn write_u32_le(w: &mut Vec<u8>, v: u32) {
    w.extend_from_slice(&v.to_le_bytes());
}

#[inline]
fn write_i32_le(w: &mut Vec<u8>, v: i32) {
    w.extend_from_slice(&v.to_le_bytes());
}

// ported from: src/bake/DevServer/ErrorReportRequest.zig
