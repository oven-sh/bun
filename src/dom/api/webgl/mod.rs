//! WebGL. The UI library does the work.

mod commands;
mod context;
mod data;
mod extensions;
mod objects;
mod stream;

pub(crate) use context::{Context, Contexts, Readback, WebGLContextEvent, present, present_all};
pub(crate) use extensions::Extension;
pub(crate) use objects::{
    Object, WebGLActiveInfo, WebGLShaderPrecisionFormat, WebGLUniformLocation,
};

const INVALID_ENUM: u32 = 0x500;
const INVALID_VALUE: u32 = 0x501;
const INVALID_OPERATION: u32 = 0x502;
const OUT_OF_MEMORY: u32 = 0x505;
