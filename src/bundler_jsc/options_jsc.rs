//! Bridge for `CompileTarget`.
//! Keeps `src/bundler/` free of `JSValue`/`JSGlobalObject` references.

use bun_options_types::compile_target::CompileTarget;

use crate::{JSGlobalObject, JsResult};

pub fn compile_target_from_slice(
    global: &JSGlobalObject,
    slice_with_bun_prefix: &[u8],
) -> JsResult<CompileTarget> {
    let slice = &slice_with_bun_prefix[b"bun-".len()..];
    let Ok(target_parsed) = CompileTarget::try_from(slice) else {
        return Err(global.throw_invalid_arguments(format_args!(
            "Unknown compile target: {}",
            bstr::BStr::new(slice_with_bun_prefix)
        )));
    };
    if !target_parsed.is_supported() {
        return Err(global.throw_invalid_arguments(format_args!(
            "Unsupported compile target: {}",
            bstr::BStr::new(slice_with_bun_prefix)
        )));
    }

    Ok(target_parsed)
}
