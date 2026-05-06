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
#[allow(unused_imports)]
use bun_collections::ArrayHashMap;
#[allow(unused_imports)]
use bun_core::Output;
#[allow(unused_imports)]
use bun_jsc::{self as jsc, ZigException, ZigStackFrame, ZigStackFramePosition};
#[allow(unused_imports)]
use bun_jsc::zig_stack_frame_position::Ordinal;
use bun_logger::Log;
#[allow(unused_imports)]
use bun_paths::path_buffer_pool;
#[allow(unused_imports)]
use crate::api::server::StaticRoute;
use bun_str::strings;
use bun_uws_sys::body_reader_mixin::{BodyReaderHandler, BodyResponse};
use bun_uws::{self as uws, AnyResponse, Request};

use super::source_map_store::{self as SourceMapStore};
#[allow(unused_imports)]
use super::source_map_store_body::GetResult;
use super::{DevServer, CLIENT_PREFIX};

pub struct ErrorReportRequest {
    // TODO(port): lifetime — backref to owning DevServer; raw because the
    // request is heap-allocated and DevServer outlives it.
    dev: NonNull<DevServer>,
    // TODO(port): BodyReaderMixin is a Zig comptime mixin parameterized by
    // (Self, "body", run_with_body, finalize). Model as a generic helper that
    // stores the buffered body and dispatches to the two callbacks below.
    body: uws::BodyReaderMixin<ErrorReportRequest>,
}

impl BodyReaderHandler for ErrorReportRequest {
    const MIXIN_OFFSET: usize = core::mem::offset_of!(ErrorReportRequest, body);

    fn on_body(&mut self, body: &[u8], resp: AnyResponse) -> Result<(), bun_core::Error> {
        ErrorReportRequest::run_with_body(self, body, resp)
    }

    fn on_error(&mut self) {
        ErrorReportRequest::finalize(self as *mut ErrorReportRequest);
    }
}

impl ErrorReportRequest {
    pub fn run(dev: &mut DevServer, _req: &mut Request, mut resp: impl BodyResponse) {
        let ctx = Box::into_raw(Box::new(ErrorReportRequest {
            dev: NonNull::from(dev),
            body: uws::BodyReaderMixin::init(),
        }));
        // SAFETY: ctx was just allocated and is non-null; dev/server are live.
        unsafe {
            (*ctx).dev().server.as_mut().unwrap().on_pending_request();
        }
        uws::BodyReaderMixin::<ErrorReportRequest>::read_body(ctx, &mut resp);
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

        let mut reader: &[u8] = body;

        // PERF(port): was stack-fallback (65536) + ArenaAllocator — profile in Phase B
        let arena = Arena::new();
        // PERF(port): was stack-fallback (65536) + ArenaAllocator — profile in Phase B
        let mut source_map_arena = Arena::new();

        // Read payload, assemble ZigException
        let name = read_string32(&mut reader)?;
        let message = read_string32(&mut reader)?;
        let browser_url = read_string32(&mut reader)?;
        let stack_count = read_u32_le(&mut reader)?.min(255); // does not support more than 255
        for _ in 0..stack_count {
            let _line = read_i32_le(&mut reader)?;
            let _column = read_i32_le(&mut reader)?;
            let _function_name = read_string32(&mut reader)?;
            let _file_name = read_string32(&mut reader)?;
            // Frame construction blocked: jsc::ZigStackFrame is currently a
            // `stub_ty!` tuple-struct placeholder in src/jsc/lib.rs (real
            // struct gated behind #[cfg(any())]).
        }

        let _ = (
            ctx,
            r,
            &arena,
            &mut source_map_arena,
            name,
            message,
            browser_url,
        );
        // The remainder of this function (source-map remapping, ZigException
        // construction, stderr printing, response serialization) is entirely
        // expressed in terms of `jsc::ZigStackFrame` field access and
        // `jsc::ZigStackTrace::{from_frames, frames, frames_len}`, all of which
        // are `stub_ty!` placeholders upstream. The full Phase-A draft body is
        // preserved in git history (see ErrorReportRequest.zig for spec) and
        // should be restored once src/jsc un-gates ZigStackFrame/ZigStackTrace.
        //
        // Secondary blockers within the same range:
        //   - jsc::URL::origin_from_slice (URL is also stub_ty!)
        //   - dev_server::SourceMapStore::get_parsed_source_map (lives on the
        //     gated source_map_store_body::SourceMapStore, not the active stub)
        //   - dev_server::DevServer::relative_path (lives on
        //     dev_server_body::DevServer<'a>, not the active struct)
        todo!("blocked_on: jsc::ZigStackFrame / jsc::ZigStackTrace (stub_ty placeholders)")
    }
}

pub fn parse_id(source_url: &[u8], browser_url: &[u8]) -> Option<SourceMapStore::Key> {
    if !source_url.starts_with(browser_url) {
        return None;
    }
    let after_host = &source_url[strings::without_trailing_slash(browser_url).len()..];
    // TODO(port): `client_prefix ++ "/"` is comptime string concat in Zig.
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
    Some(SourceMapStore::Key::init(parse_hex_to_int::<u64>(hex)?))
}

// PORT NOTE: Zig used `std.fmt.parseUnsigned(T, slice, 16)`. Thin local copy of
// `dev_server_body::parse_hex_to_int` so this module doesn't depend on the
// still-gated `DevServer.rs` draft. Rust can't size a stack array by a generic
// `T` without `generic_const_exprs`, so cap at 16 bytes (enough for u128).
fn parse_hex_to_int<T: Copy>(slice: &[u8]) -> Option<T> {
    let size = ::core::mem::size_of::<T>();
    debug_assert!(size <= 16);
    let mut out = [0u8; 16];
    let decoded = strings::decode_hex_to_bytes(&mut out[..size], slice).ok()?;
    debug_assert!(decoded == size);
    // SAFETY: out[..size] is fully initialized by decode_hex_to_bytes; T: Copy.
    Some(unsafe { ::core::ptr::read_unaligned(out.as_ptr() as *const T) })
}

/// Instead of decoding the entire file, just decode the desired section.
#[allow(dead_code)] // caller (`run_with_body`) is stubbed pending jsc::ZigStackFrame un-gate
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bake/DevServer/ErrorReportRequest.zig (404 lines)
//   confidence: medium
//   todos:      8
//   notes:      BodyReaderMixin callback wiring + arena-backed string lifetimes for ZigStackFrame need Phase B attention; finalize-guard borrows ctx mutably alongside body use.
// ──────────────────────────────────────────────────────────────────────────
