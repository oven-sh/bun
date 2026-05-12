use crate::webcore::Blob;
use bun_core::ZigStringSlice;
use bun_jsc::{self as jsc, CallFrame, JSFunction, JSGlobalObject, JSValue, JsResult};

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
        JSValue::js_number(f64::from(self))
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
        bun_hash::Adler32::hash(input)
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
                u32::MAX
            } else {
                u32::try_from(remaining).expect("int cast")
            };
            // SAFETY: offset < input.len() and chunk_len <= remaining, so the
            // pointer range [ptr+offset, ptr+offset+chunk_len) is in-bounds.
            crc = unsafe { bun_zlib::crc32(crc, input.as_ptr().add(offset), chunk_len) };
            offset += chunk_len as usize;
        }
        u32::try_from(crc).expect("int cast")
    }
}

pub struct CityHash32;
impl HashAlgorithm for CityHash32 {
    type Output = u32;
    fn hash(_seed: u64, input: &[u8]) -> u32 {
        // Zig: std.hash.CityHash32.hash(str) — single-arg, seed ignored
        // (Zig's CityHash32 has no `hashWithSeed`, so hashWrap takes the
        // 1-arg branch and never reads the JS seed).
        bun_hash::CityHash32::hash(input)
    }
}

pub struct CityHash64;
impl HashAlgorithm for CityHash64 {
    type Output = u64;
    fn hash(seed: u64, input: &[u8]) -> u64 {
        // Zig: std.hash.CityHash64.hashWithSeed(str, seed) — bytes-first.
        bun_hash::CityHash64::hash_with_seed(input, seed)
    }
}

pub struct XxHash32;
impl HashAlgorithm for XxHash32 {
    type Output = u32;
    fn hash(seed: u64, input: &[u8]) -> u32 {
        // sidestep .hash taking in anytype breaking ArgTuple
        // downstream by forcing a type signature on the input
        bun_hash::XxHash32::hash(seed as u32, input)
    }
}

pub struct XxHash64;
impl HashAlgorithm for XxHash64 {
    type Output = u64;
    fn hash(seed: u64, input: &[u8]) -> u64 {
        // sidestep .hash taking in anytype breaking ArgTuple
        // downstream by forcing a type signature on the input
        bun_hash::XxHash64::hash(seed, input)
    }
}

pub struct XxHash3;
impl HashAlgorithm for XxHash3 {
    type Output = u64;
    fn hash(seed: u64, input: &[u8]) -> u64 {
        // sidestep .hash taking in anytype breaking ArgTuple
        // downstream by forcing a type signature on the input.
        // Zig wrapper forces a u32 seed (via @truncate) before widening
        // back to XxHash3's native u64 — preserve that truncation.
        bun_hash::XxHash3::hash(seed as u32 as u64, input)
    }
}

pub struct Murmur32v2;
impl HashAlgorithm for Murmur32v2 {
    type Output = u32;
    fn hash(seed: u64, input: &[u8]) -> u32 {
        // Zig: std.hash.murmur.Murmur2_32.hashWithSeed(str, seed)
        bun_hash::Murmur2_32::hash_with_seed(input, seed as u32)
    }
}

pub struct Murmur32v3;
impl HashAlgorithm for Murmur32v3 {
    type Output = u32;
    fn hash(seed: u64, input: &[u8]) -> u32 {
        // Zig: std.hash.murmur.Murmur3_32.hashWithSeed(str, seed)
        bun_hash::Murmur3_32::hash_with_seed(input, seed as u32)
    }
}

pub struct Murmur64v2;
impl HashAlgorithm for Murmur64v2 {
    type Output = u64;
    fn hash(seed: u64, input: &[u8]) -> u64 {
        // Zig: std.hash.murmur.Murmur2_64.hashWithSeed(str, seed)
        bun_hash::Murmur2_64::hash_with_seed(input, seed)
    }
}

pub struct Rapidhash;
impl HashAlgorithm for Rapidhash {
    type Output = u64;
    fn hash(seed: u64, input: &[u8]) -> u64 {
        // Zig: bun.deprecated.RapidHash.hash(seed, input)
        bun_hash::RapidHash::hash(seed, input)
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

// phase-d: explicit export name — bare `#[host_fn]` defaults the C symbol to
// the Rust ident (`crc32`), which collides with `node_zlib_binding::crc32`'s
// shim. The shim ident (`__jsc_host_crc32`) is unchanged, so `create()` below
// keeps resolving.
#[bun_jsc::host_fn(export = "Bun__HashObject__crc32")]
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

fn hash_wrap<H: HashAlgorithm>(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let arguments = frame.arguments_old::<2>();
    // SAFETY: `bun_vm()` never returns null for a Bun-owned global
    // (see JSGlobalObject.zig:620); ArgumentsSlice borrows it for the call.
    let mut args = jsc::ArgumentsSlice::init(global.bun_vm(), arguments.slice());

    let mut input: &[u8] = b"";
    let mut input_slice = ZigStringSlice::empty();
    // Hoisted to outlive the borrow stored in `input` (Zig's stack-value
    // `array_buffer` lived for the whole function; mirror that scope here).
    let array_buffer;
    if let Some(arg) = args.next_eat() {
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
                    array_buffer = match arg.as_array_buffer(global) {
                        Some(ab) => ab,
                        None => {
                            return Err(global.throw_invalid_arguments(format_args!(
                                "ArrayBuffer conversion error"
                            )));
                        }
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

// ported from: src/runtime/api/HashObject.zig
