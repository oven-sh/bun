//! The C API of Dawn's `webgpu.h`. The build compiles Dawn (`scripts/build/deps/dawn.ts`) and generates these
//! declarations from the header that Dawn generates (`src/codegen/generate-webgpu-sys.ts`).

#![no_std]
#![allow(non_camel_case_types, non_snake_case, non_upper_case_globals)]
#![allow(clippy::all, clippy::pedantic)]

include!(concat!(env!("BUN_CODEGEN_DIR"), "/webgpu_sys.rs"));
