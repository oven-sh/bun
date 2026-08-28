//! Test-only bridge exposing `bun_collections::DynamicBitSet::copy_into` to
//! `bun:internal-for-testing` (see `src/js/internal-for-testing.ts`).
//!
//! `DynamicBitSet` has no JS-visible surface. The one caller that copies
//! between sets of different lengths (`PackageInstaller::
//! fix_cached_lockfile_package_slices`, which grows `successfully_installed`
//! when `lockfile.packages` grows mid-install) is not reachable from the CLI
//! deterministically, so a JS test drives the copy directly here. Under ASAN
//! a `copy_into` that reads past the shorter source set aborts the process.
//!
//! Lives in `bun_runtime` (not `bun_collections`) because it needs the JSC
//! types. Registered via `$newRustFunction("collections/bit_set.rs",
//! "TestingAPIs.copyIntoProbe", 3)` — the path is only the codegen key; the
//! implementation is this Rust function (see `dispatch_js2native.rs`).

use bun_collections::DynamicBitSet;
use bun_core::UnwrapOrOom;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

/// `copyIntoProbe(srcLength, dstLength, srcBits)`: builds a source set of
/// `srcLength` bits with `srcBits` set, a destination set of `dstLength` bits
/// with every bit set, copies the source into the destination and returns the
/// indices that are set in the destination afterwards, ascending.
pub(crate) fn copy_into_probe(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let src_length = frame.argument(0).to_u32() as usize;
    let dst_length = frame.argument(1).to_u32() as usize;
    let src_bits = frame.argument(2);

    let mut src = DynamicBitSet::init_empty(src_length).unwrap_or_oom();
    let count = src_bits.get_length(global)?;
    for i in 0..count {
        let bit = src_bits.get_index(global, i as u32)?.to_u32() as usize;
        if bit < src_length {
            src.set(bit);
        }
    }

    let mut dst = DynamicBitSet::init_empty(dst_length).unwrap_or_oom();
    dst.unmanaged.set_all(true);
    src.copy_into(&mut dst);

    let mut set_indices: Vec<usize> = Vec::new();
    let mut it = dst.iterator::<true, true>();
    while let Some(i) = it.next() {
        set_indices.push(i);
    }
    JSValue::create_array_from_iter(global, set_indices.into_iter(), |i| {
        Ok(JSValue::js_number_from_uint64(i as u64))
    })
}
