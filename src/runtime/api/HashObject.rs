use crate::webcore::Blob;
use bun_core::ZigStringSlice;
use bun_jsc::{
    self as jsc, CallFrame, JSFunction, JSGlobalObject, JSValue, JsResult, Local, Scope,
};

// ──────────────────────────────────────────────────────────────────────────
// Hash algorithm abstraction
//
// The underlying hashers have inconsistent interfaces (1-arg vs 2-arg,
// seed-first vs bytes-first, seeded vs unseeded). A trait unifies them:
// every hasher presents a uniform `hash(seed, input) -> Output` and the
// per-type impl absorbs the signature differences.
// ──────────────────────────────────────────────────────────────────────────

pub(crate) trait HashOutput: Copy {
    fn to_js(self, global: &JSGlobalObject) -> JSValue;
}

impl HashOutput for u32 {
    #[inline]
    fn to_js(self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number(f64::from(self))
    }
}

impl HashOutput for u64 {
    #[inline]
    fn to_js(self, global: &JSGlobalObject) -> JSValue {
        JSValue::from_uint64_no_truncate(global, self)
    }
}

pub(crate) trait HashAlgorithm {
    type Output: HashOutput;
    /// `seed` is always passed as u64 from JS; impls truncate to their native
    /// seed width. Hashers that take no seed (Adler32) ignore it.
    fn hash(seed: u64, input: &[u8]) -> Self::Output;
}

// ──────────────────────────────────────────────────────────────────────────
// Hasher impls — one unit struct per algorithm.
// Each must produce output **bit-identical** to previous Bun releases
// (pinned by the vector suite in test/js/bun/util/hash.test.js).
// ──────────────────────────────────────────────────────────────────────────

pub(crate) struct Wyhash;
impl HashAlgorithm for Wyhash {
    type Output = u64;
    fn hash(seed: u64, input: &[u8]) -> u64 {
        bun_wyhash::Wyhash::hash(seed, input)
    }
}

pub(crate) struct Adler32;
impl HashAlgorithm for Adler32 {
    type Output = u32;
    fn hash(_seed: u64, input: &[u8]) -> u32 {
        // Single-arg, seed ignored.
        bun_hash::Adler32::hash(input)
    }
}

/// Use hardware-accelerated CRC32 from zlib
pub(crate) struct Crc32;
impl HashAlgorithm for Crc32 {
    type Output = u32;
    fn hash(seed: u64, input: &[u8]) -> u32 {
        bun_zlib::crc32_bytes(seed as u32, input)
    }
}

pub(crate) struct CityHash32;
impl HashAlgorithm for CityHash32 {
    type Output = u32;
    fn hash(_seed: u64, input: &[u8]) -> u32 {
        // Single-arg, seed ignored (the JS seed is never read; CityHash32
        // has no seeded variant here).
        bun_hash::CityHash32::hash(input)
    }
}

pub(crate) struct CityHash64;
impl HashAlgorithm for CityHash64 {
    type Output = u64;
    fn hash(seed: u64, input: &[u8]) -> u64 {
        bun_hash::CityHash64::hash_with_seed(input, seed)
    }
}

pub(crate) struct XxHash32;
impl HashAlgorithm for XxHash32 {
    type Output = u32;
    fn hash(seed: u64, input: &[u8]) -> u32 {
        // sidestep .hash taking in anytype breaking ArgTuple
        // downstream by forcing a type signature on the input
        bun_hash::XxHash32::hash(seed as u32, input)
    }
}

pub(crate) struct XxHash64;
impl HashAlgorithm for XxHash64 {
    type Output = u64;
    fn hash(seed: u64, input: &[u8]) -> u64 {
        // sidestep .hash taking in anytype breaking ArgTuple
        // downstream by forcing a type signature on the input
        bun_hash::XxHash64::hash(seed, input)
    }
}

pub(crate) struct XxHash3;
impl HashAlgorithm for XxHash3 {
    type Output = u64;
    fn hash(seed: u64, input: &[u8]) -> u64 {
        // Runtime-dispatched SIMD xxHash3 (Highway); see
        // src/jsc/bindings/xxhash3.cpp. Output is bit-identical to the xxHash
        // reference, pinned by the vector suite in test/js/bun/util/hash.test.js.
        //
        // The seed is truncated to u32 before widening back to XxHash3's
        // native u64 — preserve that truncation for output stability.
        bun_highway::xxhash3_64(seed as u32 as u64, input)
    }
}

pub(crate) struct Murmur32v2;
impl HashAlgorithm for Murmur32v2 {
    type Output = u32;
    fn hash(seed: u64, input: &[u8]) -> u32 {
        bun_hash::Murmur2_32::hash_with_seed(input, seed as u32)
    }
}

pub(crate) struct Murmur32v3;
impl HashAlgorithm for Murmur32v3 {
    type Output = u32;
    fn hash(seed: u64, input: &[u8]) -> u32 {
        bun_hash::Murmur3_32::hash_with_seed(input, seed as u32)
    }
}

pub(crate) struct Murmur64v2;
impl HashAlgorithm for Murmur64v2 {
    type Output = u64;
    fn hash(seed: u64, input: &[u8]) -> u64 {
        bun_hash::Murmur2_64::hash_with_seed(input, seed)
    }
}

pub(crate) struct Rapidhash;
impl HashAlgorithm for Rapidhash {
    type Output = u64;
    fn hash(seed: u64, input: &[u8]) -> u64 {
        bun_hash::RapidHash::hash(seed, input)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Host functions — one per algorithm, each an explicit monomorphization of
// `hash_wrap`.
// ──────────────────────────────────────────────────────────────────────────

#[bun_jsc::host_fn(scoped)]
pub(crate) fn wyhash<'s>(scope: &mut Scope<'s>, frame: &CallFrame) -> JsResult<Local<'s>> {
    hash_wrap::<Wyhash>(scope, frame)
}

#[bun_jsc::host_fn(scoped)]
pub(crate) fn adler32<'s>(scope: &mut Scope<'s>, frame: &CallFrame) -> JsResult<Local<'s>> {
    hash_wrap::<Adler32>(scope, frame)
}

// phase-d: explicit export name — bare `#[host_fn]` defaults the C symbol to
// the Rust ident (`crc32`), which collides with `node_zlib_binding::crc32`'s
// shim. The shim ident (`__jsc_host_crc32`) is unchanged, so `create()` below
// keeps resolving.
#[bun_jsc::host_fn(export = "Bun__HashObject__crc32", scoped)]
pub(crate) fn crc32<'s>(scope: &mut Scope<'s>, frame: &CallFrame) -> JsResult<Local<'s>> {
    hash_wrap::<Crc32>(scope, frame)
}

#[bun_jsc::host_fn(scoped)]
pub(crate) fn city_hash32<'s>(scope: &mut Scope<'s>, frame: &CallFrame) -> JsResult<Local<'s>> {
    hash_wrap::<CityHash32>(scope, frame)
}

#[bun_jsc::host_fn(scoped)]
pub(crate) fn city_hash64<'s>(scope: &mut Scope<'s>, frame: &CallFrame) -> JsResult<Local<'s>> {
    hash_wrap::<CityHash64>(scope, frame)
}

#[bun_jsc::host_fn(scoped)]
pub(crate) fn xx_hash32<'s>(scope: &mut Scope<'s>, frame: &CallFrame) -> JsResult<Local<'s>> {
    hash_wrap::<XxHash32>(scope, frame)
}

#[bun_jsc::host_fn(scoped)]
pub(crate) fn xx_hash64<'s>(scope: &mut Scope<'s>, frame: &CallFrame) -> JsResult<Local<'s>> {
    hash_wrap::<XxHash64>(scope, frame)
}

#[bun_jsc::host_fn(scoped)]
pub(crate) fn xx_hash3<'s>(scope: &mut Scope<'s>, frame: &CallFrame) -> JsResult<Local<'s>> {
    hash_wrap::<XxHash3>(scope, frame)
}

#[bun_jsc::host_fn(scoped)]
pub(crate) fn murmur32v2<'s>(scope: &mut Scope<'s>, frame: &CallFrame) -> JsResult<Local<'s>> {
    hash_wrap::<Murmur32v2>(scope, frame)
}

#[bun_jsc::host_fn(scoped)]
pub(crate) fn murmur32v3<'s>(scope: &mut Scope<'s>, frame: &CallFrame) -> JsResult<Local<'s>> {
    hash_wrap::<Murmur32v3>(scope, frame)
}

#[bun_jsc::host_fn(scoped)]
pub(crate) fn murmur64v2<'s>(scope: &mut Scope<'s>, frame: &CallFrame) -> JsResult<Local<'s>> {
    hash_wrap::<Murmur64v2>(scope, frame)
}

#[bun_jsc::host_fn(scoped)]
pub(crate) fn rapidhash<'s>(scope: &mut Scope<'s>, frame: &CallFrame) -> JsResult<Local<'s>> {
    hash_wrap::<Rapidhash>(scope, frame)
}

// ──────────────────────────────────────────────────────────────────────────

pub(crate) fn create(global: &JSGlobalObject) -> JSValue {
    // `Bun.hash` is itself callable (wyhash); the named algorithms hang off it.
    JSFunction::create(global, "hash", __jsc_host_wyhash, 1, Default::default()).put_host_functions(
        global,
        &[
            ("wyhash", __jsc_host_wyhash, 1),
            ("adler32", __jsc_host_adler32, 1),
            ("crc32", __jsc_host_crc32, 1),
            ("cityHash32", __jsc_host_city_hash32, 1),
            ("cityHash64", __jsc_host_city_hash64, 1),
            ("xxHash32", __jsc_host_xx_hash32, 1),
            ("xxHash64", __jsc_host_xx_hash64, 1),
            ("xxHash3", __jsc_host_xx_hash3, 1),
            ("murmur32v2", __jsc_host_murmur32v2, 1),
            ("murmur32v3", __jsc_host_murmur32v3, 1),
            ("murmur64v2", __jsc_host_murmur64v2, 1),
            ("rapidhash", __jsc_host_rapidhash, 1),
        ],
    )
}

fn hash_wrap<'s, H: HashAlgorithm>(
    scope: &mut Scope<'s>,
    frame: &CallFrame,
) -> JsResult<Local<'s>> {
    let args = frame.scoped_arguments::<2>(scope);
    let global = scope.unscoped_global();

    let mut input: &[u8] = b"";
    let input_slice: ZigStringSlice;
    // Hoisted so `array_buffer` outlives the borrow stored in `input`.
    let array_buffer;
    if let Some(arg) = args.get(0) {
        if let Some(blob) = arg.as_class_ref::<Blob>() {
            // TODO: files
            input = blob.shared_view();
        } else {
            match arg.js_type_loose() {
                jsc::JSType::ArrayBuffer
                | jsc::JSType::Int8Array
                | jsc::JSType::Uint8Array
                | jsc::JSType::Uint8ClampedArray
                | jsc::JSType::Int16Array
                | jsc::JSType::Uint16Array
                | jsc::JSType::Int32Array
                | jsc::JSType::Uint32Array
                | jsc::JSType::Float16Array
                | jsc::JSType::Float32Array
                | jsc::JSType::Float64Array
                | jsc::JSType::BigInt64Array
                | jsc::JSType::BigUint64Array
                | jsc::JSType::DataView => {
                    array_buffer = match arg.array_buffer_bytes(scope) {
                        Some(ab) => ab,
                        None => {
                            return Err(global.throw_invalid_arguments(format_args!(
                                "ArrayBuffer conversion error"
                            )));
                        }
                    };
                    input = &array_buffer;
                }
                _ => {
                    input_slice = arg.to_slice(scope)?;
                    input = input_slice.slice();
                }
            }
        }
    }

    // The per-algorithm hash/hashWithSeed signature differences are absorbed
    // into `HashAlgorithm::hash` per-impl above; here we always read an
    // optional seed and pass it.
    let mut seed: u64 = 0;
    if let Some(arg) = args.get(1) {
        if arg.is_number() || arg.is_big_int() {
            seed = arg.to_uint64_no_truncate();
        }
    }

    let value = H::hash(seed, input);
    Ok(scope.local(value.to_js(global)))
}
