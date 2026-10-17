pub use crate::builtins_generated::{
    PRELUDE_FILES as GENERATED_FILES, PRELUDE_FUNCTIONS as FUNCTIONS,
};

pub const DECORATORS: (&str, &str) = ("decorators.ts", include_str!("prelude/decorators.ts"));
pub const HOST_CLASSES: (&str, &str) = ("host-classes.ts", include_str!("prelude/host-classes.ts"));

pub const VALIDATION: (&str, &str) = (
    "validation.ts",
    include_str!("../js/internal/validation.ts"),
);

pub const RUNTIME_HELPERS: (&str, &str) = (
    "bun-wrap.js",
    include_str!(concat!(env!("BUN_CODEGEN_DIR"), "/runtime.out.js")),
);

const fn with_helpers<const N: usize>(
    generated: &[(&'static str, &'static str)],
) -> [(&'static str, &'static str); N] {
    let mut files = [DECORATORS; N];
    files[N - 1] = RUNTIME_HELPERS;
    files[generated.len()] = HOST_CLASSES;
    files[N - 2] = VALIDATION;
    let mut i = 0;
    while i < generated.len() {
        files[i] = generated[i];
        i += 1;
    }
    files
}

pub const FILES: &[(&str, &str)] = &with_helpers::<{ GENERATED_FILES.len() + 4 }>(GENERATED_FILES);

pub fn path_of(root: &[u8], name: &str) -> Vec<u8> {
    let root = root.strip_suffix(b"/").unwrap_or(root);
    [root, b"/.bun-aot-prelude/", name.as_bytes()].concat()
}
