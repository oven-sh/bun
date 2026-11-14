//! What `src/codegen/bindgen.ts` generates from this crate's `.bind.ts` files.

include!(concat!(
    env!("BUN_CODEGEN_DIR"),
    "/generated_bindgen_bun_patch_jsc.rs"
));
