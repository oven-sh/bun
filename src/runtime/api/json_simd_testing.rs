//! `bun:internal-for-testing` — drive `bun_parsers::json_simd` directly.

use bun_ast::ToJSError;
use bun_js_parser_jsc::ExprJsc;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsError, JsResult, LogJsc, StringJsc};
use bun_parsers::json;
use bun_parsers::json_simd::SimdJSON;

pub fn js_parse(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    super::with_text_format_source(
        global,
        frame,
        b"input.json",
        false,
        true,
        |arena, log, source| {
            let parse_result = match SimdJSON::parse(source, log, arena) {
                Ok(v) => v,
                Err(_) => {
                    return Err(global.throw_value(log.to_js(global, "Failed to parse JSON")?));
                }
            };

            match parse_result.to_js(global) {
                Ok(v) => Ok(v),
                Err(ToJSError::OutOfMemory) => Err(JsError::OutOfMemory),
                Err(ToJSError::JSError) => Err(JsError::Thrown),
                Err(ToJSError::JSTerminated) => Err(JsError::Terminated),
                Err(_) => unreachable!(),
            }
        },
    )
}

/// Stage-1 only: returns a regular Array of structural-index integers. For
/// debugging the SIMD scanner.
pub fn js_index(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    use bun_highway as hwy;
    let input = frame.argument(0).to_slice(global)?;
    let bytes = input.slice();
    let mut indices = vec![0u32; bytes.len() + 64 + 4];
    let (rc, count, _flags) = hwy::json_index(bytes, &mut indices);
    if rc != hwy::JsonIndexError::Ok && rc != hwy::JsonIndexError::Empty {
        return Err(global.throw(format_args!("json_index error: {:?}", rc)));
    }
    let n = count as usize;
    let arr = bun_jsc::JSValue::create_empty_array(global, n)?;
    for (i, &idx) in indices[..n].iter().enumerate() {
        arr.put_index(global, i as u32, JSValue::js_number(idx as f64))?;
    }
    Ok(arr)
}

/// Benchmark: parse `input` `iters` times entirely inside Rust, returning
/// `{ simdNs, scalarNs, bytes, iters }`. The Expr→JSValue conversion is NOT
/// included; only the parser hot path is measured.
pub fn js_bench(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let input = frame.argument(0).to_slice(global)?;
    let iters = frame.argument(1).coerce_to_i32(global)?.max(1) as u32;
    let bytes = input.slice();

    let arena = bun_alloc::Arena::new();
    let mut alloc_guard = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _scope = alloc_guard.enter();
    let source = bun_ast::Source::init_path_string(b"bench.json", bytes);

    // Warm-up + correctness check.
    {
        let mut log = bun_ast::Log::init();
        if SimdJSON::parse(&source, &mut log, &arena).is_err() {
            return Err(global.throw_value(log.to_js(global, "SIMD parse failed")?));
        }
    }

    // arg[2] = 0 simd-only, 1 scalar-only, else both (default).
    let which = if frame.arguments_count() > 2 {
        frame.argument(2).coerce_to_i32(global)? as i32
    } else {
        2
    };

    let mut bufs = bun_parsers::json_simd::SimdJSONBuffers::default();
    let simd_ns = if which == 1 {
        0
    } else {
        time_iters(iters, || {
            let mut log = bun_ast::Log::init();
            let arena = bun_alloc::Arena::new();
            let mut g = bun_ast::ASTMemoryAllocator::borrowing(&arena);
            let _s = g.enter();
            let _ = std::hint::black_box(SimdJSON::parse_into(
                &mut bufs, &source, &mut log, &arena, true,
            ));
        })
    };

    let scalar_ns = if which == 0 {
        0
    } else {
        time_iters(iters, || {
            let mut log = bun_ast::Log::init();
            let arena = bun_alloc::Arena::new();
            let mut g = bun_ast::ASTMemoryAllocator::borrowing(&arena);
            let _s = g.enter();
            let _ = std::hint::black_box(json::parse_utf8_scalar(&source, &mut log, &arena));
        })
    };

    let result = bun_jsc::JSValue::create_empty_object(global, 4);
    result.put(global, b"bytes", JSValue::js_number(bytes.len() as f64));
    result.put(global, b"iters", JSValue::js_number(iters as f64));
    result.put(global, b"simdNs", JSValue::js_number(simd_ns as f64));
    result.put(global, b"scalarNs", JSValue::js_number(scalar_ns as f64));
    Ok(result)
}

fn time_iters(iters: u32, mut f: impl FnMut()) -> u64 {
    // Warmup: first iteration on a fresh allocation pattern is consistently
    // slow (cold caches / page faults).
    for _ in 0..3 {
        f();
    }
    let start = std::time::Instant::now();
    for _ in 0..iters {
        f();
    }
    start.elapsed().as_nanos() as u64
}

/// Stage-1 + stage-2 (C++ tape only, no Rust Expr build). Direct comparison
/// target for simdjson's DOM parse.
pub fn js_bench_tape(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    use bun_highway as hwy;
    let input = frame.argument(0).to_slice(global)?;
    let iters = frame.argument(1).coerce_to_i32(global)?.max(1) as u32;
    let bytes = input.slice();
    let len = bytes.len();
    let mut indices = vec![0u32; len + 64 + 4];
    let mut tape = vec![0u64; len + len / 2 + 8];
    let mut strbuf = vec![0u8; len + 32];
    let mut tape_len = 0u32;
    let ns = time_iters(iters, || {
        // SAFETY: buffers sized per the kernel's contract.
        let (_rc, out) = unsafe {
            hwy::json_parse(
                bytes.as_ptr(),
                len,
                indices.as_mut_ptr(),
                indices.len(),
                tape.as_mut_ptr(),
                strbuf.as_mut_ptr(),
            )
        };
        tape_len = out.tape_len;
        std::hint::black_box(&tape);
    });
    let result = bun_jsc::JSValue::create_empty_object(global, 3);
    result.put(global, b"ns", JSValue::js_number(ns as f64));
    result.put(global, b"tapeLen", JSValue::js_number(tape_len as f64));
    result.put(global, b"bytes", JSValue::js_number(len as f64));
    Ok(result)
}

/// On-demand cursor: simulate npm.rs's packument reads (iterate every
/// version, read `dist.tarball` + `bin` + `directories.bin` + dependency
/// groups). Times stage-1 + cursor walk; no Expr.
pub fn js_bench_cursor(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    use bun_parsers::json_cursor::JsonDoc;
    let input = frame.argument(0).to_slice(global)?;
    let iters = frame.argument(1).coerce_to_i32(global)?.max(1) as u32;
    let bytes = input.slice();
    let source = bun_ast::Source::init_path_string(b"packument.json", bytes);
    let mut versions_seen = 0u32;
    let mut fields_read = 0u64;
    let ns = time_iters(iters, || {
        let mut log = bun_ast::Log::init();
        let doc = JsonDoc::parse(&source, &mut log).unwrap();
        let root = doc.root();
        versions_seen = 0;
        fields_read = 0;
        // One pass over top-level keys — no repeated skip past `versions`.
        let mut versions = None;
        for (k, v) in root.iter_object() {
            match k {
                b"name" | b"modified" => fields_read += v.as_str().is_some() as u64,
                b"versions" => versions = Some(v),
                _ => {}
            }
        }
        if let Some(versions) = versions {
            for (_ver_key, ver) in versions.iter_object() {
                versions_seen += 1;
                // One pass over keys — what npm.rs would do.
                for (k, v) in ver.iter_object() {
                    match k {
                        b"dist" => {
                            for (dk, dv) in v.iter_object() {
                                if matches!(dk, b"tarball" | b"integrity") {
                                    fields_read += dv.as_str().is_some() as u64;
                                }
                            }
                        }
                        b"bin" | b"directories" => fields_read += 1,
                        b"dependencies" | b"peerDependencies" | b"optionalDependencies" => {
                            for (_, dv) in v.iter_object() {
                                fields_read += dv.as_str().is_some() as u64;
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
        std::hint::black_box((versions_seen, fields_read));
    });
    let result = bun_jsc::JSValue::create_empty_object(global, 4);
    result.put(global, b"ns", JSValue::js_number(ns as f64));
    result.put(
        global,
        b"versions",
        JSValue::js_number(versions_seen as f64),
    );
    result.put(global, b"fields", JSValue::js_number(fields_read as f64));
    result.put(global, b"bytes", JSValue::js_number(bytes.len() as f64));
    Ok(result)
}

/// Cursor `get` correctness: returns the value at `path` (dotted) as a string.
pub fn js_cursor_get(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    use bun_parsers::json_cursor::JsonDoc;
    let input = frame.argument(0).to_slice(global)?;
    let path = frame.argument(1).to_slice(global)?;
    let source = bun_ast::Source::init_path_string(b"input.json", input.slice());
    let mut log = bun_ast::Log::init();
    let doc = match JsonDoc::parse(&source, &mut log) {
        Ok(d) => d,
        Err(_) => return Ok(JSValue::UNDEFINED),
    };
    let mut cur = doc.root();
    for seg in path.slice().split(|&b| b == b'.') {
        match cur.get(seg) {
            Some(c) => cur = c,
            None => return Ok(JSValue::UNDEFINED),
        }
    }
    let bump = bun_alloc::Arena::new();
    match cur.as_str_decoded(&bump) {
        Some(s) => bun_core::String::clone_utf8(s).to_js(global),
        None => Ok(JSValue::NULL),
    }
}

/// Stage-1 throughput in isolation: index `input` `iters` times into a reused
/// buffer. Returns total ns and the structural count.
pub fn js_bench_stage1(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    use bun_highway as hwy;
    let input = frame.argument(0).to_slice(global)?;
    let iters = frame.argument(1).coerce_to_i32(global)?.max(1) as u32;
    let bytes = input.slice();
    let mut indices = vec![0u32; bytes.len() + 64 + 4];
    let mut count = 0u32;
    let ns = time_iters(iters, || {
        let (_rc, c, _f) = hwy::json_index(bytes, &mut indices);
        count = c;
        std::hint::black_box(&indices);
    });
    let result = bun_jsc::JSValue::create_empty_object(global, 3);
    result.put(global, b"ns", JSValue::js_number(ns as f64));
    result.put(global, b"count", JSValue::js_number(count as f64));
    result.put(global, b"bytes", JSValue::js_number(bytes.len() as f64));
    Ok(result)
}
