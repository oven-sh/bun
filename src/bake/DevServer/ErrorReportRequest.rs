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

use core::ptr::NonNull;

use bun_alloc::Arena; // bumpalo::Bump re-export
use bun_collections::ArrayHashMap;
use bun_core::Output;
use bun_jsc::{self as jsc, ZigException, ZigStackFrame, ZigStackFramePosition};
use bun_logger::Log;
use bun_paths::path_buffer_pool;
use bun_runtime::api::server::StaticRoute;
use bun_str::strings;
use bun_uws::{self as uws, AnyResponse, Request};

use super::source_map_store::{self as SourceMapStore};
use super::{client_prefix, read_string32, DevServer};

pub struct ErrorReportRequest {
    // TODO(port): lifetime — backref to owning DevServer; raw because the
    // request is heap-allocated and DevServer outlives it.
    dev: NonNull<DevServer>,
    // TODO(port): BodyReaderMixin is a Zig comptime mixin parameterized by
    // (Self, "body", run_with_body, finalize). Model as a generic helper that
    // stores the buffered body and dispatches to the two callbacks below.
    body: uws::BodyReaderMixin<ErrorReportRequest>,
}

impl ErrorReportRequest {
    pub fn run(dev: &mut DevServer, _req: &mut Request, resp: impl uws::Response) {
        let ctx = Box::into_raw(Box::new(ErrorReportRequest {
            dev: NonNull::from(dev),
            body: uws::BodyReaderMixin::init(),
        }));
        // SAFETY: ctx was just allocated and is non-null; dev/server are live.
        unsafe {
            (*ctx).dev().server.as_mut().unwrap().on_pending_request();
            (*ctx).body.read_body(resp);
        }
    }

    pub fn finalize(ctx: *mut ErrorReportRequest) {
        // SAFETY: ctx was allocated via Box::into_raw in `run` and is finalized
        // exactly once (either here on success path or by BodyReaderMixin on
        // error/abort).
        unsafe {
            (*ctx).dev().server.as_mut().unwrap().on_static_request_complete();
            drop(Box::from_raw(ctx));
        }
    }

    #[inline]
    fn dev(&mut self) -> &mut DevServer {
        // SAFETY: DevServer outlives every ErrorReportRequest it spawns.
        unsafe { self.dev.as_mut() }
    }

    pub fn run_with_body(
        ctx: &mut ErrorReportRequest,
        body: &[u8],
        r: AnyResponse,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        // .finalize has to be called last, but only in the non-error path.
        let mut should_finalize_self = false;
        let _finalize_guard = scopeguard::guard((), |_| {
            if should_finalize_self {
                ErrorReportRequest::finalize(ctx as *mut ErrorReportRequest);
            }
        });
        // PORT NOTE: reshaped for borrowck — the Zig captures `ctx` in a defer
        // while continuing to use it; Phase B may need to restructure this
        // guard to avoid an aliasing &mut.

        let mut reader: &[u8] = body;

        // PERF(port): was stack-fallback (65536) + ArenaAllocator — profile in Phase B
        let arena = Arena::new();
        // PERF(port): was stack-fallback (65536) + ArenaAllocator — profile in Phase B
        let mut source_map_arena = Arena::new();

        // Read payload, assemble ZigException
        let name = read_string32(&mut reader)?;
        let message = read_string32(&mut reader)?;
        let browser_url = read_string32(&mut reader)?;
        let mut frames: Vec<ZigStackFrame> = Vec::new();
        let stack_count = read_u32_le(&mut reader)?.min(255); // does not support more than 255
        frames.reserve(stack_count as usize);
        for _ in 0..stack_count {
            let line = read_i32_le(&mut reader)?;
            let column = read_i32_le(&mut reader)?;
            let function_name = read_string32(&mut reader)?;
            let file_name = read_string32(&mut reader)?;
            // PERF(port): was assume_capacity
            frames.push(ZigStackFrame {
                function_name: bun_str::String::init(&function_name),
                source_url: bun_str::String::init(&file_name),
                position: if line > 0 {
                    ZigStackFramePosition {
                        line: jsc::Ordinal::from_one_based(line),
                        column: if column < 1 {
                            jsc::Ordinal::INVALID
                        } else {
                            jsc::Ordinal::from_one_based(column)
                        },
                        line_start_byte: 0,
                    }
                } else {
                    ZigStackFramePosition {
                        line: jsc::Ordinal::INVALID,
                        column: jsc::Ordinal::INVALID,
                        line_start_byte: 0,
                    }
                },
                code_type: jsc::ZigStackFrameCode::None,
                is_async: false,
                remapped: false,
            });
            // TODO(port): function_name/file_name Vec<u8> backing storage must
            // outlive the bun_str::String borrows above; in Zig these were
            // arena-owned. Phase B: arena-allocate via `arena.alloc_slice_copy`.
        }

        const RUNTIME_NAME: &[u8] = b"Bun HMR Runtime";

        let browser_url_origin =
            bun_jsc::URL::origin_from_slice(&browser_url).unwrap_or(&browser_url);

        // All files that DevServer could provide a source map fit the pattern:
        // `/_bun/client/<label>-{u64}.js`
        // Where the u64 is a unique identifier pointing into sourcemaps.
        //
        // HMR chunks use this too, but currently do not host their JS code.
        let mut parsed_source_maps: ArrayHashMap<
            SourceMapStore::Key,
            Option<SourceMapStore::GetResult>,
        > = ArrayHashMap::default();
        parsed_source_maps.reserve(4);
        // Drop of GetResult handles cleanup; the Zig `defer for ... v.deinit()`
        // is implicit via Drop on the map's values.

        let mut runtime_lines: Option<[&[u8]; 5]> = None;
        let mut first_line_of_interest: usize = 0;
        // SAFETY: only read after `runtime_lines` is Some, which is the same
        // branch that writes this. Mirrors `= undefined` in Zig.
        let mut top_frame_position: ZigStackFramePosition =
            unsafe { core::mem::zeroed() }; // SAFETY: all-zero is a valid ZigStackFramePosition
        let mut region_of_interest_line: u32 = 0;

        for frame in frames.iter_mut() {
            let source_url = frame.source_url.value.zig_string().slice();
            // The browser code strips "http://localhost:3000" when the string
            // has /_bun/client. It's done because JS can refer to `location`
            let Some(id) = parse_id(source_url, browser_url_origin) else {
                continue;
            };

            // Get and cache the parsed source map
            let gop = parsed_source_maps.get_or_put(id)?;
            if !gop.found_existing {
                let psm = ctx.dev().source_maps.get_parsed_source_map(
                    id,
                    &source_map_arena, // arena for parsing
                    // store results into first arena
                    // TODO(port): Zig passed two allocators (parse-scratch vs
                    // result-storage); Rust API may collapse to one.
                );
                source_map_arena.reset();
                match psm {
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
            let Some(result) = gop.value_ptr.as_ref() else {
                continue;
            };
            let result: &SourceMapStore::GetResult = result;

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
                || frame.position.line.zero_based()
                    < generated_mappings[1].lines.zero_based()
            {
                frame.source_url = bun_str::String::init(RUNTIME_NAME); // matches value in source map
                frame.position = ZigStackFramePosition::INVALID;
                continue;
            }

            // Remap the frame
            let remapped = result
                .mappings
                .find(frame.position.line, frame.position.column);
            if let Some(remapped_position) = &remapped {
                frame.position = ZigStackFramePosition {
                    line: jsc::Ordinal::from_zero_based(remapped_position.original_line()),
                    column: jsc::Ordinal::from_zero_based(remapped_position.original_column()),
                    line_start_byte: 0,
                };
                let index = remapped_position.source_index;
                if index >= 1
                    && usize::try_from(index - 1).unwrap() < result.file_paths.len()
                {
                    let file_idx = usize::try_from(index - 1).unwrap();
                    let abs_path = result.file_paths[file_idx];
                    frame.source_url = bun_str::String::init(abs_path);
                    let relative_path_buf = path_buffer_pool().get();
                    let rel_path = ctx.dev().relative_path(&mut relative_path_buf, abs_path);
                    if frame.function_name.value.zig_string().slice() == rel_path {
                        frame.function_name = bun_str::String::EMPTY;
                    }
                    frame.remapped = true;

                    if runtime_lines.is_none() {
                        let file = result.entry_files.get(file_idx);
                        if let Some(source_map) = file.get() {
                            let json_encoded_source_code = source_map.quoted_contents();
                            // First line of interest is two above the target line.
                            let target_line =
                                usize::try_from(frame.position.line.zero_based()).unwrap();
                            first_line_of_interest = target_line.saturating_sub(2);
                            region_of_interest_line =
                                u32::try_from(target_line - first_line_of_interest).unwrap();
                            runtime_lines = extract_json_encoded_source_code::<5>(
                                json_encoded_source_code,
                                u32::try_from(first_line_of_interest).unwrap(),
                                &arena,
                            )?;
                            top_frame_position = frame.position;
                        }
                    }
                } else if index == 0 {
                    // Should be picked up by above but just in case.
                    frame.source_url = bun_str::String::init(RUNTIME_NAME);
                    frame.position = ZigStackFramePosition::INVALID;
                }
            }
        }

        // Stack traces can often end with random runtime frames that are not relevant.
        'trim_runtime_frames: {
            // Ensure that trimming will not remove ALL frames.
            let mut any_non_runtime = false;
            for frame in frames.iter() {
                if !frame.position.is_invalid()
                    || frame.source_url.value.zig_string().slice().as_ptr()
                        != RUNTIME_NAME.as_ptr()
                {
                    any_non_runtime = true;
                    break;
                }
            }
            if !any_non_runtime {
                break 'trim_runtime_frames;
            }

            // Move all frames up
            let mut i: usize = 0;
            // PORT NOTE: reshaped for borrowck — Zig iterated `frames.items[i..]`
            // while writing back into `frames.items[i]`; use index iteration.
            for j in 0..frames.len() {
                let frame = &frames[j];
                if frame.position.is_invalid()
                    && frame.source_url.value.zig_string().slice().as_ptr()
                        == RUNTIME_NAME.as_ptr()
                {
                    continue; // skip runtime frames
                }
                frames.swap(i, j);
                // TODO(port): Zig copies (`frames.items[i] = frame`) rather than
                // swaps; ZigStackFrame is POD there. If Rust ZigStackFrame is
                // not Copy, swap preserves all values and truncate drops the
                // tail correctly.
                i += 1;
            }
            frames.truncate(i);
        }

        let mut exception = ZigException {
            r#type: jsc::JSErrorCode::Error,
            runtime_type: jsc::JSRuntimeType::Nothing,
            name: bun_str::String::init(&name),
            message: bun_str::String::init(&message),
            stack: jsc::ZigStackTrace::from_frames(&mut frames),
            exception: None,
            remapped: false,
            browser_url: bun_str::String::init(&browser_url),
        };

        let stderr = Output::error_writer_buffered();
        let _flush = scopeguard::guard((), |_| Output::flush());
        if Output::enable_ansi_colors_stderr() {
            let _ = ctx.dev().vm.print_externally_remapped_zig_exception::<_, true>(
                &mut exception,
                None,
                stderr,
                true,
            );
        } else {
            let _ = ctx.dev().vm.print_externally_remapped_zig_exception::<_, false>(
                &mut exception,
                None,
                stderr,
                true,
            );
        }
        // PERF(port): was comptime bool dispatch — profile in Phase B

        let mut out: Vec<u8> = Vec::new();
        // errdefer out.deinit() — implicit via Drop on `?`

        write_u32_le(&mut out, exception.stack.frames_len);
        for frame in exception.stack.frames() {
            write_i32_le(&mut out, frame.position.line.one_based());
            write_i32_le(&mut out, frame.position.column.one_based());

            let function_name = frame.function_name.value.zig_string().slice();
            write_u32_le(&mut out, u32::try_from(function_name.len()).unwrap());
            out.extend_from_slice(function_name);

            let src_to_write = frame.source_url.value.zig_string().slice();
            if src_to_write.starts_with(b"/") {
                let relative_path_buf = path_buffer_pool().get();
                let file = ctx.dev().relative_path(&mut relative_path_buf, src_to_write);
                write_u32_le(&mut out, u32::try_from(file.len()).unwrap());
                out.extend_from_slice(file);
            } else {
                write_u32_le(&mut out, u32::try_from(src_to_write.len()).unwrap());
                out.extend_from_slice(src_to_write);
            }
        }

        if let Some(lines) = &runtime_lines {
            // trim empty lines
            let mut adjusted_lines: &[&[u8]] = &lines[..];
            while !adjusted_lines.is_empty() && adjusted_lines[0].is_empty() {
                adjusted_lines = &adjusted_lines[1..];
                region_of_interest_line = region_of_interest_line.saturating_sub(1);
                first_line_of_interest += 1;
            }
            while !adjusted_lines.is_empty()
                && adjusted_lines[adjusted_lines.len() - 1].is_empty()
            {
                adjusted_lines = &adjusted_lines[..adjusted_lines.len() - 1];
            }

            out.push(u8::try_from(adjusted_lines.len()).unwrap());
            write_u32_le(&mut out, region_of_interest_line);
            write_u32_le(&mut out, u32::try_from(first_line_of_interest + 1).unwrap());
            write_u32_le(
                &mut out,
                u32::try_from(top_frame_position.column.one_based()).unwrap(),
            );

            for line in adjusted_lines {
                write_u32_le(&mut out, u32::try_from(line.len()).unwrap());
                out.extend_from_slice(line);
            }
        } else {
            out.push(0u8);
        }

        StaticRoute::send_blob_then_deinit(
            r,
            &bun_runtime::webcore::Blob::from_vec(out),
            StaticRoute::SendOptions {
                mime_type: &bun_http::MimeType::OTHER,
                server: ctx.dev().server.as_ref().unwrap(),
            },
        );
        should_finalize_self = true;
        Ok(())
    }
}

pub fn parse_id(source_url: &[u8], browser_url: &[u8]) -> Option<SourceMapStore::Key> {
    if !source_url.starts_with(browser_url) {
        return None;
    }
    let after_host = &source_url[strings::without_trailing_slash(browser_url).len()..];
    // TODO(port): `client_prefix ++ "/"` is comptime string concat in Zig.
    if !(after_host.starts_with(client_prefix.as_bytes())
        && after_host.get(client_prefix.len()) == Some(&b'/'))
    {
        return None;
    }
    let after_prefix = &after_host[client_prefix.len() + 1..];
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
    Some(SourceMapStore::Key::init(
        DevServer::parse_hex_to_int::<u64>(hex)?,
    ))
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
    let mut log = Log::init();
    let mut l = bun_interchange::toml::Lexer {
        log: &mut log,
        source: bun_logger::Source::init_empty_file(b""),
        // TODO(port): Zig passed `arena` as allocator here; Rust Lexer may
        // bind the arena differently.
        allocator: arena,
        should_redact_logs: false,
        prev_error_loc: bun_logger::Loc::EMPTY,
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
            let mut bytes: bumpalo::collections::Vec<'a, u8> =
                bumpalo::collections::Vec::with_capacity_in(encoded_line.len(), arena);
            l.decode_escape_sequences(0, encoded_line, false, &mut bytes)?;
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bake/DevServer/ErrorReportRequest.zig (404 lines)
//   confidence: medium
//   todos:      8
//   notes:      BodyReaderMixin callback wiring + arena-backed string lifetimes for ZigStackFrame need Phase B attention; finalize-guard borrows ctx mutably alongside body use.
// ──────────────────────────────────────────────────────────────────────────
