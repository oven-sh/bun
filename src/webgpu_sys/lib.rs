//! The C API of Dawn's `webgpu.h`. A build with `--webgpu=on` compiles Dawn (`scripts/build/deps/dawn.ts`) and generates
//! these declarations from the header that Dawn generates (`src/codegen/generate-webgpu-sys.ts`). In any other build
//! nothing depends on this crate, and it is empty.

#![no_std]
#![allow(non_camel_case_types, non_snake_case, non_upper_case_globals)]
#![allow(clippy::all, clippy::pedantic)]

#[cfg(bun_webgpu_sys_generated)]
include!(concat!(env!("BUN_CODEGEN_DIR"), "/webgpu_sys.rs"));
