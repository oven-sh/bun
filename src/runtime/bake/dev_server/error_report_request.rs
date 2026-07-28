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
use bun_core::{String as BunString, strings};
use bun_io::Write as _;
use bun_jsc::{
    JSErrorCode, JSRuntimeType, ZigException, ZigStackFrame, ZigStackFrameCode,
    ZigStackFramePosition, ZigStackTrace,
};
use bun_paths::path_buffer_pool;
use bun_uws::{self as uws, AnyResponse, Request};
use bun_uws_sys::body_reader_mixin::{BodyReaderHandler, BodyResponse};

use super::source_map_store::{self, GetResult, Key as SourceMapKey};
use super::{CLIENT_PREFIX, DevServer};
use crate::server::StaticRoute;
use crate::server::static_route::InitFromBytesOptions;
use bun_core::fmt::parse_hex_to_int;

pub(crate) struct ErrorReportRequest {
    // BACKREF: heap-allocated request; DevServer owns the server lifecycle and
    // outlives every in-flight request (BackRef invariant).
    dev: bun_ptr::BackRef<DevServer>,
    // BodyReaderMixin is a generic helper that stores the buffered body and
    // dispatches to the two callbacks below.
    body: uws::BodyReaderMixin<ErrorReportRequest>,
}

bun_core::intrusive_field!(ErrorReportRequest, body: uws::BodyReaderMixin<ErrorReportRequest>);
impl BodyReaderHandler for ErrorReportRequest {
    unsafe fn on_body(this: *mut Self, body: &[u8], resp: AnyResponse) -> bun_uws_sys::Result<()> {
        // SAFETY: caller (BodyReaderMixin) passes the original heap-allocated
        // pointer with full-allocation provenance and no live borrows.
        unsafe { ErrorReportRequest::run_with_body(this, body, resp) }.map_err(Into::into)
    }

    unsafe fn on_error(this: *mut Self) {
        // Caller passes the original heap-allocated pointer; finalize
        // consumes it via heap::take exactly once.
        ErrorReportRequest::finalize(this)
    }
}

impl ErrorReportRequest {
    pub(crate) fn run<R: BodyResponse>(dev: &mut DevServer, _req: &mut Request, resp: &mut R) {
        // Use the caller's `&mut DevServer` directly (matches
        // `UnrefSourceMapRequest::run`) — no need to re-derive it through the
        // freshly-allocated ctx's `BackRef` under `unsafe`.
        dev.server
            .as_mut()
            .expect("server bound")
            .on_pending_request();
        let ctx = bun_core::heap::into_raw(Box::new(ErrorReportRequest {
            dev: bun_ptr::BackRef::new_mut(dev),
            body: uws::BodyReaderMixin::init(),
        }));
        uws::BodyReaderMixin::<ErrorReportRequest>::read_body(ctx, resp);
    }

    /// `ctx` must be the pointer returned by `heap::alloc` in `run`; called
    /// exactly once (success path here, or via `on_error` on abort/error).
    pub(crate) fn finalize(ctx: *mut ErrorReportRequest) {
        // SAFETY: `ctx` is the original Box allocation produced by `run`; no
        // live borrow of `*ctx` exists (BodyReaderHandler hands us the raw
        // pointer, never `&mut self`). Only reachable via `on_body`/`on_error`,
        // both of which uphold this contract.
        unsafe {
            (*ctx)
                .dev
                .get_mut()
                .server
                .as_mut()
                .unwrap()
                .on_static_request_complete();
            drop(bun_core::heap::take(ctx));
        }
    }

    /// SAFETY: `ctx` must be the pointer returned by `heap::alloc` in `run`,
    /// with no live `&`/`&mut` into the allocation. On `Ok(())` return this
    /// consumes `ctx` via `finalize`; on `Err` the caller (BodyReaderMixin)
    /// retains ownership and will call `on_error`.
    pub(crate) unsafe fn run_with_body(
        ctx: *mut ErrorReportRequest,
        body: &[u8],
        r: AnyResponse,
    ) -> crate::Result<()> {
        // .finalize has to be called last, but only in the non-error path.
        // On error return, BodyReaderMixin calls `on_error` → `finalize`, so
        // here we simply call `finalize` directly at the success tail.

        let mut reader = bun_io::FixedBufferStream::new(body);

        let arena = Arena::new();

        // BackRef::get() is safe under the back-reference invariant (DevServer
        // outlives this request). No `&mut *ctx` is formed for the body of this
        // fn — `finalize(ctx)` at the tail consumes the original Box pointer.
        // SAFETY: `ctx` is the live heap allocation from `run` (caller contract).
        let dev: &DevServer = unsafe { &*ctx }.dev.get();

        // Read payload, assemble ZigException
        let name = sanitize_for_terminal(read_string32(&mut reader)?, &arena);
        let message = sanitize_for_terminal(read_string32(&mut reader)?, &arena);
        let browser_url = sanitize_for_terminal(read_string32(&mut reader)?, &arena);
        let stack_count = reader.read_int_le::<u32>()?.min(255); // does not support more than 255
        let mut frames: Vec<ZigStackFrame> = Vec::with_capacity(stack_count as usize);
        for _ in 0..stack_count {
            let line = reader.read_int_le::<i32>()?;
            let column = reader.read_int_le::<i32>()?;
            let function_name = sanitize_for_terminal(read_string32(&mut reader)?, &arena);
            let file_name = sanitize_for_terminal(read_string32(&mut reader)?, &arena);
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

        let browser_url_origin = bun_url::origin_from_slice(browser_url).unwrap_or(browser_url);

        // All files that DevServer could provide a source map fit the pattern:
        // `/_bun/client/<label>-{u64}.js`
        // Where the u64 is a unique identifier pointing into sourcemaps.
        //
        // HMR chunks use this too, but currently do not host their JS code.
        let mut parsed_source_maps: ArrayHashMap<SourceMapKey, Option<GetResult<'_>>> =
            ArrayHashMap::new();
        bun_core::handle_oom(parsed_source_maps.ensure_total_capacity(4));
        // Note: `defer for (parsed_source_maps.values()) |*v| v.deinit()` deleted —
        // `GetResult` drops its owned `mappings` automatically.

        let mut runtime_lines: Option<[&[u8]; 5]> = None;
        let mut first_line_of_interest: usize = 0;
        let mut top_frame_position = ZigStackFramePosition::INVALID;
        let mut region_of_interest_line: u32 = 0;
        for frame in frames.iter_mut() {
            // Every `source_url` here is `Tag::ZigString` (built via
            // `String::init(&[u8])`), so `byte_slice()` is the right view.
            let source_url: &[u8] = frame.source_url.byte_slice();
            // The browser code strips "http://localhost:3000" when the string
            // has /_bun/client. It's done because JS can refer to `location`
            let Some(id) = parse_id(source_url, browser_url_origin) else {
                continue;
            };

            // Get and cache the parsed source map
            let gop = bun_core::handle_oom(parsed_source_maps.get_or_put(id));
            if !gop.found_existing {
                match dev.source_maps.get_parsed_source_map(id) {
                    None => {
                        bun_core::debug_warn!(
                            "Failed to find mapping for {}, {}",
                            bstr::BStr::new(source_url),
                            id.get()
                        );
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
            let remapped = result
                .mappings
                .find(frame.position.line, frame.position.column);
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
                            region_of_interest_line = (target_line - first_line_of_interest) as u32;
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
                // Pointer-identity check on the borrowed RUNTIME_NAME slice.
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

            // Move all frames up.
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
            // `print_externally_remapped_zig_exception` takes a runtime
            // `allow_ansi_color` flag.
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

        _ = out.write_int_le::<u32>(exception.stack.frames_len as u32);
        for frame in exception.stack.frames() {
            _ = out.write_int_le::<i32>(frame.position.line.one_based());
            _ = out.write_int_le::<i32>(frame.position.column.one_based());

            let function_name: &[u8] = frame.function_name.byte_slice();
            _ = out.write_int_le::<u32>(function_name.len() as u32);
            out.extend_from_slice(function_name);

            let src_to_write: &[u8] = frame.source_url.byte_slice();
            if strings::has_prefix_comptime(src_to_write, b"/") {
                let mut relative_path_buf = path_buffer_pool::get();
                let file = dev.relative_path(&mut relative_path_buf, src_to_write);
                _ = out.write_int_le::<u32>(file.len() as u32);
                out.extend_from_slice(file);
            } else {
                _ = out.write_int_le::<u32>(src_to_write.len() as u32);
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
            _ = out.write_int_le::<u32>(region_of_interest_line);
            _ = out.write_int_le::<u32>((first_line_of_interest + 1) as u32);
            _ = out.write_int_le::<u32>(top_frame_position.column.one_based() as u32);

            for line in adjusted_lines.iter() {
                _ = out.write_int_le::<u32>(line.len() as u32);
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
        // `should_finalize_self = true;` — see Note at fn top.
        // `ctx` is the original heap-allocated pointer (caller contract); the
        // only borrow derived from it (`dev`) points into a separate DevServer
        // allocation, so freeing `*ctx` does not invalidate any live reference.
        ErrorReportRequest::finalize(ctx);
        Ok(())
    }
}

pub(crate) fn parse_id(source_url: &[u8], browser_url: &[u8]) -> Option<source_map_store::Key> {
    if !source_url.starts_with(browser_url) {
        return None;
    }
    let after_host = &source_url[strings::without_trailing_slash(browser_url).len()..];
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
    Some(source_map_store::Key::init(parse_hex_to_int::<u64>(hex)?))
}

/// Instead of decoding the entire file, just decode the desired section.
fn extract_json_encoded_source_code<'a, const N: usize>(
    contents: &'a [u8],
    target_line: u32,
    arena: &'a Arena,
) -> crate::Result<Option<[&'a [u8]; N]>> {
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

        // Decode JSON escapes straight to UTF-8.
        if has_extra_escapes {
            let mut bytes: bun_alloc::ArenaVec<'a, u8> =
                bun_alloc::ArenaVec::with_capacity_in(encoded_line.len(), arena);
            super::js_escape::decode_js_escape_sequences(encoded_line, &mut bytes)?;
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

/// `DevServer.readString32` — local zero-copy variant over the body slice
/// reader (the canonical allocating version lives in the gated `DevServer.rs`
/// draft and is not yet re-exported from `super`).
#[inline]
fn read_string32<'a>(r: &mut bun_io::FixedBufferStream<&'a [u8]>) -> crate::Result<&'a [u8]> {
    let len = r.read_int_le::<u32>()? as usize;
    let buf: &'a [u8] = r.buffer;
    let end = r
        .pos
        .checked_add(len)
        .filter(|&e| e <= buf.len())
        .ok_or(crate::Error::EndOfStream)?;
    let s = &buf[r.pos..end];
    r.pos = end;
    Ok(s)
}

/// The report body is attacker-controlled: `/_bun/report_error` accepts a
/// CORS "simple request" POST from any origin, and these strings are printed
/// to the developer's terminal. Replace C0 control bytes (except `\t`/`\n`)
/// and DEL so the payload cannot inject ANSI/OSC escape sequences (cursor
/// movement, OSC 52 clipboard writes, hyperlinks). UTF-8-encoded C1 controls
/// (U+0080..=U+009F, i.e. `0xC2 0x80..=0x9F`) are also replaced: xterm-family
/// terminals decode them back to C1, so `0xC2 0x9B` would otherwise act as CSI.
pub(crate) fn sanitize_for_terminal<'a>(s: &'a [u8], arena: &'a Arena) -> &'a [u8] {
    let valid_utf8 = strings::is_valid_utf8(s);
    fn is_disallowed(prev: u8, b: u8, valid_utf8: bool) -> bool {
        // In well-formed UTF-8, lone 0x80..=0x9F bytes are continuation bytes
        // of legitimate multi-byte characters and must not be blanked; only
        // the encoded C1 form (a 0xC2 lead byte followed by 0x80..=0x9F)
        // reaches the terminal as a control. The report body is raw bytes and
        // is never validated elsewhere, so when it is not valid UTF-8 that
        // assumption does not hold and every non-ASCII byte is blanked.
        (b < 0x20 && b != b'\t' && b != b'\n')
            || b == 0x7f
            || (prev == 0xc2 && (0x80..=0x9f).contains(&b))
            || (!valid_utf8 && b >= 0x80)
    }
    let mut prev = 0u8;
    if !s.iter().any(|&b| {
        let bad = is_disallowed(prev, b, valid_utf8);
        prev = b;
        bad
    }) {
        return s;
    }
    let copy = arena.alloc_slice_copy(s);
    let mut prev = 0u8;
    for i in 0..copy.len() {
        let cur = copy[i];
        if is_disallowed(prev, cur, valid_utf8) {
            copy[i] = b' ';
            // For an encoded C1 control, blank the 0xC2 lead byte too so the
            // output stays valid UTF-8 instead of leaving a dangling lead byte.
            if prev == 0xc2 && i > 0 {
                copy[i - 1] = b' ';
            }
        }
        prev = cur;
    }
    copy
}
