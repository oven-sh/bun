use bun_jsc::{self as jsc, CallFrame, JSFunction, JSGlobalObject, JSValue, JsResult, ZigString};
use bun_str::ZigStringSlice;
use crate::webcore::Blob;

// ──────────────────────────────────────────────────────────────────────────
// Hash algorithm abstraction
//
// Zig's `hashWrap` uses `@hasDecl` / `std.meta.ArgsTuple` / `@TypeOf` to
// reflect on each `std.hash.*` type's inconsistent interface (1-arg vs
// 2-arg, seed-first vs bytes-first, `hash` vs `hashWithSeed`). Per
// PORTING.md §Comptime reflection, that collapses to a trait: every hasher
// presents a uniform `hash(seed, input) -> Output` and the per-type impl
// absorbs the signature differences.
// ──────────────────────────────────────────────────────────────────────────

pub trait HashOutput: Copy {
    fn to_js(self, global: &JSGlobalObject) -> JSValue;
}

impl HashOutput for u32 {
    #[inline]
    fn to_js(self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number(self)
    }
}

impl HashOutput for u64 {
    #[inline]
    fn to_js(self, global: &JSGlobalObject) -> JSValue {
        JSValue::from_uint64_no_truncate(global, self)
    }
}

pub trait HashAlgorithm {
    type Output: HashOutput;
    /// `seed` is always passed as u64 from JS; impls truncate to their native
    /// seed width (matches Zig's `@truncate(seed)`). Hashers that take no
    /// seed (Adler32) ignore it — matches the Zig 1-arg branch.
    fn hash(seed: u64, input: &[u8]) -> Self::Output;
}

// ──────────────────────────────────────────────────────────────────────────
// Hasher impls — one unit struct per algorithm.
// TODO(port): the underlying hash functions reference Zig's `std.hash.*`.
// Phase B must wire these to Rust equivalents (or FFI to the existing
// implementations) that produce **bit-identical** output.
// ──────────────────────────────────────────────────────────────────────────

pub struct Wyhash;
impl HashAlgorithm for Wyhash {
    type Output = u64;
    fn hash(seed: u64, input: &[u8]) -> u64 {
        bun_wyhash::Wyhash::hash(seed, input)
    }
}

pub struct Adler32;
impl HashAlgorithm for Adler32 {
    type Output = u32;
    fn hash(_seed: u64, input: &[u8]) -> u32 {
        // Zig: std.hash.Adler32.hash(input) — single-arg, seed ignored.
        // TODO(port): std.hash.Adler32 equivalent
        bun_hash::adler32(input)
    }
}

/// Use hardware-accelerated CRC32 from zlib
pub struct Crc32;
impl HashAlgorithm for Crc32 {
    type Output = u32;
    fn hash(seed: u64, input: &[u8]) -> u32 {
        // zlib takes a 32-bit length, so chunk large inputs to avoid truncation.
        let mut crc: bun_zlib::uLong = seed as u32 as bun_zlib::uLong;
        let mut offset: usize = 0;
        while offset < input.len() {
            let remaining = input.len() - offset;
            let max_len: usize = u32::MAX as usize;
            let chunk_len: u32 = if remaining > max_len {
                max_len as u32
            } else {
                remaining as u32
            };
            // SAFETY: offset < input.len() and chunk_len <= remaining, so the
            // pointer range [ptr+offset, ptr+offset+chunk_len) is in-bounds.
            crc = unsafe { bun_zlib::crc32(crc, input.as_ptr().add(offset), chunk_len) };
            offset += chunk_len as usize;
        }
        u32::try_from(crc).unwrap()
    }
}

pub struct CityHash32;
impl HashAlgorithm for CityHash32 {
    type Output = u32;
    fn hash(seed: u64, input: &[u8]) -> u32 {
        // Zig: std.hash.CityHash32.hashWithSeed(str, seed) — bytes-first.
        // TODO(port): std.hash.CityHash32 equivalent
        bun_hash::city_hash32_with_seed(input, seed as u32)
    }
}

pub struct CityHash64;
impl HashAlgorithm for CityHash64 {
    type Output = u64;
    fn hash(seed: u64, input: &[u8]) -> u64 {
        // Zig: std.hash.CityHash64.hashWithSeed(str, seed) — bytes-first.
        // TODO(port): std.hash.CityHash64 equivalent
        bun_hash::city_hash64_with_seed(input, seed)
    }
}

pub struct XxHash32;
impl HashAlgorithm for XxHash32 {
    type Output = u32;
    fn hash(seed: u64, input: &[u8]) -> u32 {
        // sidestep .hash taking in anytype breaking ArgTuple
        // downstream by forcing a type signature on the input
        // TODO(port): std.hash.XxHash32 equivalent
        bun_hash::xxhash32(seed as u32, input)
    }
}

pub struct XxHash64;
impl HashAlgorithm for XxHash64 {
    type Output = u64;
    fn hash(seed: u64, input: &[u8]) -> u64 {
        // sidestep .hash taking in anytype breaking ArgTuple
        // downstream by forcing a type signature on the input
        // TODO(port): std.hash.XxHash64 equivalent
        bun_hash::xxhash64(seed, input)
    }
}

pub struct XxHash3;
impl HashAlgorithm for XxHash3 {
    type Output = u64;
    fn hash(seed: u64, input: &[u8]) -> u64 {
        // sidestep .hash taking in anytype breaking ArgTuple
        // downstream by forcing a type signature on the input
        // TODO(port): std.hash.XxHash3 equivalent
        bun_hash::xxhash3(seed as u32, input)
    }
}

pub struct Murmur32v2;
impl HashAlgorithm for Murmur32v2 {
    type Output = u32;
    fn hash(seed: u64, input: &[u8]) -> u32 {
        // Zig: std.hash.murmur.Murmur2_32.hashWithSeed(str, seed)
        // TODO(port): std.hash.murmur.Murmur2_32 equivalent
        bun_hash::murmur2_32_with_seed(input, seed as u32)
    }
}

pub struct Murmur32v3;
impl HashAlgorithm for Murmur32v3 {
    type Output = u32;
    fn hash(seed: u64, input: &[u8]) -> u32 {
        // Zig: std.hash.murmur.Murmur3_32.hashWithSeed(str, seed)
        // TODO(port): std.hash.murmur.Murmur3_32 equivalent
        bun_hash::murmur3_32_with_seed(input, seed as u32)
    }
}

pub struct Murmur64v2;
impl HashAlgorithm for Murmur64v2 {
    type Output = u64;
    fn hash(seed: u64, input: &[u8]) -> u64 {
        // Zig: std.hash.murmur.Murmur2_64.hashWithSeed(str, seed)
        // TODO(port): std.hash.murmur.Murmur2_64 equivalent
        bun_hash::murmur2_64_with_seed(input, seed)
    }
}

pub struct Rapidhash;
impl HashAlgorithm for Rapidhash {
    type Output = u64;
    fn hash(seed: u64, input: &[u8]) -> u64 {
        // Zig: bun.deprecated.RapidHash
        // TODO(port): bun.deprecated.RapidHash equivalent
        bun_hash::rapidhash(seed, input)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Host functions — one per algorithm. Zig expressed these as
// `pub const wyhash = hashWrap(std.hash.Wyhash);` (comptime fn returning a
// JSHostFnZig). Rust spells the monomorphization explicitly.
// ──────────────────────────────────────────────────────────────────────────

#[bun_jsc::host_fn]
pub fn wyhash(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    hash_wrap::<Wyhash>(global, frame)
}

#[bun_jsc::host_fn]
pub fn adler32(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    hash_wrap::<Adler32>(global, frame)
}

#[bun_jsc::host_fn]
pub fn crc32(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    hash_wrap::<Crc32>(global, frame)
}

#[bun_jsc::host_fn]
pub fn city_hash32(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    hash_wrap::<CityHash32>(global, frame)
}

#[bun_jsc::host_fn]
pub fn city_hash64(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    hash_wrap::<CityHash64>(global, frame)
}

#[bun_jsc::host_fn]
pub fn xx_hash32(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    hash_wrap::<XxHash32>(global, frame)
}

#[bun_jsc::host_fn]
pub fn xx_hash64(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    hash_wrap::<XxHash64>(global, frame)
}

#[bun_jsc::host_fn]
pub fn xx_hash3(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    hash_wrap::<XxHash3>(global, frame)
}

#[bun_jsc::host_fn]
pub fn murmur32v2(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    hash_wrap::<Murmur32v2>(global, frame)
}

#[bun_jsc::host_fn]
pub fn murmur32v3(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    hash_wrap::<Murmur32v3>(global, frame)
}

#[bun_jsc::host_fn]
pub fn murmur64v2(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    hash_wrap::<Murmur64v2>(global, frame)
}

#[bun_jsc::host_fn]
pub fn rapidhash(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    hash_wrap::<Rapidhash>(global, frame)
}

// ──────────────────────────────────────────────────────────────────────────

pub fn create(global: &JSGlobalObject) -> JSValue {
    let function = JSFunction::create(global, "hash", wyhash, 1, Default::default());
    // Zig used `inline for` + `@field(HashObject, name)` to look up each fn
    // by string name at comptime. Rust pairs the JS-visible name with the
    // host fn explicitly.
    const FNS: &[(&str, jsc::JSHostFn)] = &[
        ("wyhash", wyhash),
        ("adler32", adler32),
        ("crc32", crc32),
        ("cityHash32", city_hash32),
        ("cityHash64", city_hash64),
        ("xxHash32", xx_hash32),
        ("xxHash64", xx_hash64),
        ("xxHash3", xx_hash3),
        ("murmur32v2", murmur32v2),
        ("murmur32v3", murmur32v3),
        ("murmur64v2", murmur64v2),
        ("rapidhash", rapidhash),
    ];
    for &(name, host_fn) in FNS {
        let value = JSFunction::create(global, name, host_fn, 1, Default::default());
        function.put(global, ZigString::static_(name), value);
    }

    function
}

fn hash_wrap<H: HashAlgorithm>(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let arguments = frame.arguments_old(2);
    let mut args = jsc::ArgumentsSlice::init(global.bun_vm(), arguments.slice());

    let mut input: &[u8] = b"";
    let mut input_slice = ZigStringSlice::empty();
    if let Some(arg) = args.next_eat() {
        if let Some(blob) = arg.as_::<Blob>() {
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
                    let Some(array_buffer) = arg.as_array_buffer(global) else {
                        return global.throw_invalid_arguments("ArrayBuffer conversion error", &[]);
                    };
                    input = array_buffer.byte_slice();
                }
                _ => {
                    input_slice = arg.to_slice(global)?;
                    input = input_slice.slice();
                }
            }
        }
    }

    // std.hash has inconsistent interfaces
    //
    // PORT NOTE: the Zig used `@hasDecl`/`ArgsTuple`/`bun.trait.isNumber` to
    // pick between `hash` vs `hashWithSeed`, 1-arg vs 2-arg, and seed-first
    // vs bytes-first. That dispatch is absorbed into `HashAlgorithm::hash`
    // per-impl above; here we always read an optional seed and pass it.
    let mut seed: u64 = 0;
    if let Some(arg) = args.next_eat() {
        if arg.is_number() || arg.is_big_int() {
            seed = arg.to_uint64_no_truncate();
        }
    }

    let value = H::hash(seed, input);
    Ok(value.to_js(global))
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/HashObject.zig (156 lines)
//   confidence: medium
//   todos:      9
//   notes:      comptime ArgsTuple reflection collapsed into HashAlgorithm trait; std.hash.* backends need bit-identical Rust impls (bun_hash:: placeholders)
// ──────────────────────────────────────────────────────────────────────────
