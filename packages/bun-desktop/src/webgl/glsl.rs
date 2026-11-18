//! The OpenGL ES Shading Language, 1.00 and 3.00, with the restrictions of WebGL. The driver only gets text that is made here from a valid tree.

mod builtins;
mod declarations;
mod expressions;
mod fold;
mod lexer;
mod link;
mod parser;
mod preprocessor;
mod print;
mod tree;

pub use link::{Active, Linked, Request, link};
pub use print::translate;
pub use tree::Shader;

/// Of expressions, statements, calls and macros.
const MAX_DEPTH: usize = 256;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Stage {
    Vertex,
    Fragment,
}

pub type Extensions = u32;

struct Extension {
    name: &'static str,
    bit: Extensions,
    /// Whether 1.00 and 3.00 have it.
    versions: [bool; 2],
    /// What OpenGL ES needs for it.
    native: &'static str,
}

macro_rules! extensions {
    ($($bit:literal $constant:ident $name:literal $es1:literal $es3:literal $native:literal)*) => {
        $(pub const $constant: Extensions = 1 << $bit;)*
        const EXTENSIONS: &[Extension] = &[$(Extension { name: $name, bit: $constant, versions: [$es1, $es3], native: $native }),*];
    };
}

extensions! {
    0 DERIVATIVES "GL_OES_standard_derivatives" true false ""
    1 TEXTURE_LOD "GL_EXT_shader_texture_lod" true false ""
    2 FRAG_DEPTH "GL_EXT_frag_depth" true false ""
    3 DRAW_BUFFERS "GL_EXT_draw_buffers" true false ""
    4 MULTI_DRAW "GL_ANGLE_multi_draw" true true ""
    5 DUAL_SOURCE "GL_EXT_blend_func_extended" true true "GL_EXT_blend_func_extended"
    6 CLIP_CULL "GL_ANGLE_clip_cull_distance" false true "GL_EXT_clip_cull_distance"
    7 CONSERVATIVE_DEPTH "GL_EXT_conservative_depth" false true "GL_EXT_conservative_depth"
    8 NOPERSPECTIVE "GL_NV_shader_noperspective_interpolation" false true "GL_NV_shader_noperspective_interpolation"
    9 SAMPLE_VARIABLES "GL_OES_sample_variables" false true "GL_OES_sample_variables"
    10 INTERPOLATION "GL_OES_shader_multisample_interpolation" false true "GL_OES_shader_multisample_interpolation"
}

/// Pairs are for the vertex and the fragment stage.
#[derive(Clone, Default)]
pub struct Limits {
    pub vertex_attributes: u32,
    pub uniform_vectors: [u32; 2],
    pub texture_units: [u32; 2],
    pub combined_texture_units: u32,
    pub draw_buffers: u32,
    pub dual_source_draw_buffers: u32,
    pub varying_vectors: u32,
    pub stage_vectors: [u32; 2],
    /// The smallest and the largest.
    pub texel_offsets: [i32; 2],
    /// To clip, to cull, and together.
    pub distances: [u32; 3],
    pub samples: u32,
    pub uniform_blocks: [u32; 2],
    pub combined_uniform_blocks: u32,
    pub uniform_block_size: u32,
    pub separate_feedback_attributes: u32,
    pub interleaved_feedback_components: u32,
}

pub struct Options<'a> {
    pub is_webgl2: bool,
    /// Those that the page has enabled.
    pub extensions: Extensions,
    pub limits: &'a Limits,
}

pub struct Error {
    line: u32,
    text: String,
}

type Result<T> = std::result::Result<T, Error>;

impl Error {
    fn new(line: u32, token: &str, message: &str) -> Error {
        Error {
            line,
            text: format!("'{}' : {message}", &token[..token.floor_char_boundary(64)]),
        }
    }

    fn moved(self, lines: u32) -> Error {
        Error {
            line: self.line.wrapping_add(lines),
            ..self
        }
    }
}

/// The error is for the log.
pub fn compile(
    stage: Stage,
    source: &str,
    options: &Options,
) -> std::result::Result<Shader, String> {
    let (text, joints) = lexer::splice(source);
    let mut names = lexer::Names::new();
    lexer::tokenize(
        &text,
        &joints,
        longest_identifier(options.is_webgl2),
        &mut names,
    )
    .and_then(|tokens| {
        preprocessor::run(&tokens, &mut names, options.is_webgl2, options.extensions)
    })
    .and_then(|output| parser::parse(stage, &output, &names, options))
    .map_err(|it| format!("ERROR: 0:{}: {}\n", it.line, it.text))
}

pub fn longest_identifier(is_webgl2: bool) -> usize {
    if is_webgl2 { 1024 } else { 256 }
}

#[cfg(test)]
mod tests;
