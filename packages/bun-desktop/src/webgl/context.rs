//! The state of a context, and the functions that only set some of it.

use std::rc::Rc;
use std::sync::Arc;
use std::sync::atomic::Ordering;

use super::Link;
use super::buffers::{Buffer, Range, VertexArray};
use super::decoder::{
    Answer, Error, NO_MEMORY, Result, bad_enum, check_enum, check_state, check_value,
};
use super::draw::Plan;
use super::formats::Features;
use super::framebuffers::{Framebuffer, Renderbuffer};
use super::gl::*;
use super::glsl;
use super::native::{self, Gl, Kind, Name};
use super::objects::{ALLOCATED_HERE, Handle, Objects};
use super::programs::{Executable, Program};
use super::queries::{Query, TransformFeedback};
use super::surface::Surface;
use super::textures::Unit;
use crate::abi_webgl::{Attributes, Unpacking, extensions};

macro_rules! declare_extensions {
    ($($name:ident $interface:ident $versions:literal)*) => {
        #[derive(Clone, Copy, PartialEq)]
        pub enum Extension { $($name),* }
        const VERSIONS: &[(Extension, u8)] = &[$((Extension::$name, $versions)),*];
    };
}

extensions!(declare_extensions);

use Extension::*;

impl Extension {
    pub const fn bit(self) -> u64 {
        1 << self as u64
    }
}

/// What the driver must have if it is for OpenGL ES 3, and for OpenGL 4.1: all of the extensions of one of the alternatives.
const NATIVE: &[(Extension, &str)] = &[
    (ClipControl, "EXT_clip_control"),
    (ColorBufferFloat2, "EXT_color_buffer_float"),
    (ColorBufferHalfFloat, "EXT_color_buffer_half_float"),
    (ConservativeDepth, "EXT_conservative_depth"),
    (DepthClamp, "EXT_depth_clamp"),
    (TimerQuery, "EXT_disjoint_timer_query"),
    (TimerQuery2, "EXT_disjoint_timer_query"),
    (FloatBlend, "EXT_float_blend"),
    (PolygonOffsetClamp, "EXT_polygon_offset_clamp"),
    (RenderSnorm, "EXT_render_snorm"),
    (Bptc, "EXT_texture_compression_bptc"),
    (Rgtc, "EXT_texture_compression_rgtc"),
    (Anisotropic, "EXT_texture_filter_anisotropic"),
    (MirrorClamp, "EXT_texture_mirror_clamp_to_edge"),
    (Norm16, "EXT_texture_norm16"),
    (Noperspective, "NV_shader_noperspective_interpolation"),
    (DrawBuffersIndexed, "OES_draw_buffers_indexed"),
    (SampleVariables, "OES_sample_variables"),
    (Interpolation, "OES_shader_multisample_interpolation"),
    (FloatLinear, "OES_texture_float_linear"),
    (DualSource, "EXT_blend_func_extended"),
    (ClipCull, "EXT_clip_cull_distance"),
    (ColorBufferFloat, "EXT_color_buffer_float"),
    (Astc, "KHR_texture_compression_astc_ldr"),
    (
        S3tc,
        "EXT_texture_compression_s3tc|EXT_texture_compression_dxt1 ANGLE_texture_compression_dxt3 ANGLE_texture_compression_dxt5",
    ),
    (S3tcSrgb, "EXT_texture_compression_s3tc_srgb"),
    (PolygonMode, "NV_polygon_mode"),
    (ProvokingVertex, "EXT_provoking_vertex"),
    (SharedExponent, "QCOM_render_shared_exponent"),
    (StencilTexturing, "OES_texture_stencil8"),
];

const IMPLIED: &[(Extension, Extension)] = &[
    (TextureFloat, ColorBufferFloat),
    (TextureHalfFloat, ColorBufferHalfFloat),
    (TextureFloat, FloatBlend),
    (ColorBufferFloat, FloatBlend),
    (ColorBufferFloat2, FloatBlend),
    (MultiDraw, InstancedArrays),
];

const OF_SHADERS: &[(Extension, glsl::Extensions)] = &[
    (Derivatives, glsl::DERIVATIVES),
    (TextureLod, glsl::TEXTURE_LOD),
    (FragDepth, glsl::FRAG_DEPTH),
    (DrawBuffers, glsl::DRAW_BUFFERS),
    (MultiDraw, glsl::MULTI_DRAW),
    (DualSource, glsl::DUAL_SOURCE),
    (ClipCull, glsl::CLIP_CULL),
    (ConservativeDepth, glsl::CONSERVATIVE_DEPTH),
    (Noperspective, glsl::NOPERSPECTIVE),
    (SampleVariables, glsl::SAMPLE_VARIABLES),
    (Interpolation, glsl::INTERPOLATION),
];

pub const MAX_ATTRIBUTES: usize = 16;
pub const MAX_COLORS: usize = 8;

pub struct Limits {
    pub shaders: glsl::Limits,
    pub texture_size: u32,
    pub cube_size: u32,
    pub volume_size: u32,
    pub layers: u32,
    pub renderbuffer_size: u32,
    pub uniform_bindings: u32,
    pub uniform_alignment: u32,
}

impl Limits {
    fn new(gl: &Gl, supported: u64) -> Limits {
        let get = |name, most| gl.integer(name).min(most);
        let of = |extension: Extension, name, most| {
            if supported & extension.bit() != 0 {
                get(name, most)
            } else {
                0
            }
        };
        let shaders = glsl::Limits {
            vertex_attributes: get(MAX_VERTEX_ATTRIBS, MAX_ATTRIBUTES as u32),
            uniform_vectors: [MAX_VERTEX_UNIFORM_VECTORS, MAX_FRAGMENT_UNIFORM_VECTORS]
                .map(|it| get(it, 1024)),
            texture_units: [MAX_VERTEX_TEXTURE_IMAGE_UNITS, MAX_TEXTURE_IMAGE_UNITS]
                .map(|it| get(it, 32)),
            combined_texture_units: get(MAX_COMBINED_TEXTURE_IMAGE_UNITS, 65).saturating_sub(1),
            draw_buffers: get(
                MAX_DRAW_BUFFERS,
                get(MAX_COLOR_ATTACHMENTS, MAX_COLORS as u32),
            ),
            dual_source_draw_buffers: of(DualSource, MAX_DUAL_SOURCE_DRAW_BUFFERS_WEBGL, 1),
            varying_vectors: get(MAX_VARYING_VECTORS, 32),
            stage_vectors: [MAX_VERTEX_OUTPUT_COMPONENTS, MAX_FRAGMENT_INPUT_COMPONENTS]
                .map(|it| get(it, 128) / 4),
            texel_offsets: [MIN_PROGRAM_TEXEL_OFFSET, MAX_PROGRAM_TEXEL_OFFSET]
                .map(|it| gl.integers(it)[0]),
            distances: [
                MAX_CLIP_DISTANCES_WEBGL,
                MAX_CULL_DISTANCES_WEBGL,
                MAX_COMBINED_CLIP_AND_CULL_DISTANCES_WEBGL,
            ]
            .map(|it| of(ClipCull, it, 8)),
            samples: get(MAX_SAMPLES, 32),
            uniform_blocks: [MAX_VERTEX_UNIFORM_BLOCKS, MAX_FRAGMENT_UNIFORM_BLOCKS]
                .map(|it| get(it, 16)),
            combined_uniform_blocks: get(MAX_COMBINED_UNIFORM_BLOCKS, 32),
            uniform_block_size: get(MAX_UNIFORM_BLOCK_SIZE, 1 << 16),
            separate_feedback_attributes: get(MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS, 4),
            interleaved_feedback_components: get(
                MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS,
                128,
            ),
        };
        Limits {
            shaders,
            texture_size: get(MAX_TEXTURE_SIZE, 1 << 14),
            cube_size: get(MAX_CUBE_MAP_TEXTURE_SIZE, 1 << 14),
            volume_size: get(MAX_3D_TEXTURE_SIZE, 1 << 11),
            layers: get(MAX_ARRAY_TEXTURE_LAYERS, 1 << 11),
            renderbuffer_size: get(MAX_RENDERBUFFER_SIZE, 1 << 14),
            uniform_bindings: get(MAX_UNIFORM_BUFFER_BINDINGS, 72),
            uniform_alignment: gl.integer(UNIFORM_BUFFER_OFFSET_ALIGNMENT).max(1),
        }
    }
}

/// What has to be looked at again before drawing.
pub mod dirty {
    pub const FRAMEBUFFER: u8 = 1;
    pub const OUTPUTS: u8 = 2;
    pub const TEXTURES: u8 = 4;
    pub const VERTICES: u8 = 8;
    pub const BLOCKS: u8 = 16;
    pub const IMAGES: u8 = FRAMEBUFFER | OUTPUTS | TEXTURES;
    pub const BUFFERS: u8 = VERTICES | BLOCKS;
    pub const ALL: u8 = IMAGES | BUFFERS;
}

#[derive(Clone, Copy)]
pub struct Stencil {
    pub reference: i32,
    pub value_mask: u32,
    pub write_mask: u32,
}

/// For a draw buffer.
#[derive(Clone, Copy)]
pub struct Blending {
    pub is_enabled: bool,
    pub equations: [u32; 2],
    pub factors: [u32; 4],
    pub mask: [bool; 4],
}

#[derive(Clone, Copy)]
pub struct Packing {
    pub alignment: u32,
    pub row_length: u32,
    pub skip: [u32; 2],
}

pub struct Context {
    pub gl: &'static Gl,
    pub link: Arc<Link>,
    pub attributes: Attributes,
    pub features: Features,
    pub limits: Limits,
    pub can_read_upside_down: Option<u32>,
    pub objects: Objects,
    pub answer: Vec<u32>,
    errors: Vec<u32>,
    messages: Vec<String>,
    messages_left: u32,
    /// The number of the task of the page.
    pub task: u64,
    pub dirty: u8,
    pub plan: Plan,
    /// Changes when an image is defined.
    pub generation: u64,
    /// By their place in `CAPABILITIES`.
    capabilities: u32,
    pub blending: [Blending; MAX_COLORS],
    pub depth_mask: bool,
    pub stencil: [Stencil; 2],
    pub mipmap_hint: u32,
    pub line_width: f32,
    /// Drivers limit it.
    pub viewport_origin: [i32; 2],
    pub polygon_mode: u32,
    pub unpacking: Unpacking,
    pub native_unpacking: Unpacking,
    pub packing: Packing,
    pub flips: bool,
    pub premultiplies: bool,
    pub converts_colors: bool,
    /// For the drawing buffer and for what is uploaded.
    pub is_wide: [bool; 2],
    /// By their place in `buffers::TARGETS`.
    pub buffers: [Option<Rc<Buffer>>; 7],
    pub uniform_buffers: Vec<Option<Range>>,
    pub vertex_array: Rc<VertexArray>,
    pub default_vertex_array: Rc<VertexArray>,
    /// The scalar, and the bits.
    pub generic_attributes: [(u32, [u32; 4]); MAX_ATTRIBUTES],
    pub active_unit: usize,
    pub native_unit: usize,
    /// The last one is for the library.
    pub units: Vec<Unit>,
    pub program: Option<Rc<Program>>,
    /// That of the program, if it is linked.
    pub executable: Option<Rc<Executable>>,
    /// How many uniform locations there have been.
    pub locations: u32,
    pub renderbuffer: Option<Rc<Renderbuffer>>,
    /// To draw to and to read from.
    pub framebuffers: [Rc<Framebuffer>; 2],
    pub scratch_framebuffer: Name,
    pub surface: Surface,
    pub queries: [Option<Rc<Query>>; 3],
    pub feedback: Rc<TransformFeedback>,
    pub default_feedback: Rc<TransformFeedback>,
    pub active_feedback: Vec<Rc<TransformFeedback>>,
}

const CAPABILITIES: [u32; 11] = [
    CULL_FACE,
    DEPTH_TEST,
    DITHER,
    POLYGON_OFFSET_FILL,
    SAMPLE_ALPHA_TO_COVERAGE,
    SAMPLE_COVERAGE,
    SCISSOR_TEST,
    STENCIL_TEST,
    RASTERIZER_DISCARD,
    DEPTH_CLAMP_EXT,
    POLYGON_OFFSET_LINE_WEBGL,
];

fn faces(face: u32) -> Result<std::ops::Range<usize>> {
    match face {
        FRONT => Ok(0..1),
        BACK => Ok(1..2),
        FRONT_AND_BACK => Ok(0..2),
        _ => bad_enum("unknown face"),
    }
}

pub fn check_comparison(function: u32) -> Result {
    check_enum((NEVER..=ALWAYS).contains(&function), "unknown function")
}

impl Context {
    pub fn new(attributes: Attributes) -> Option<Context> {
        let gl = native::gl();
        let renderer = gl.text(RENDERER);
        if attributes.fail_if_major_performance_caveat
            && ["llvmpipe", "softpipe", "SwiftShader", "Software"]
                .iter()
                .any(|it| renderer.contains(it))
        {
            return None;
        }
        let names = gl.extensions();
        let has = |wanted: &str| {
            wanted.split('|').any(|all| {
                all.split_whitespace().all(|it| {
                    names
                        .iter()
                        .any(|name| name.strip_prefix("GL_") == Some(it))
                })
            })
        };
        let is_native = |extension| {
            NATIVE
                .iter()
                .find(|it| it.0 == extension)
                .is_none_or(|it| has(it.1))
        };
        let extensions = VERSIONS
            .iter()
            .filter(|it| it.1 & (1 << u8::from(attributes.is_webgl2)) != 0 && is_native(it.0))
            .fold(0, |all, it| all | it.0.bit());
        let link = Link::new(extensions);
        let limits = Limits::new(gl, extensions);
        let (vertex_array, feedback) = (
            Rc::new(VertexArray::of(Handle::default())),
            Rc::new(TransformFeedback::of(Handle::default())),
        );
        let surface = Surface::new();
        gl.bind_vertex_array(vertex_array.name.0);
        gl.bind_transform_feedback(TRANSFORM_FEEDBACK, feedback.name.0);
        if attributes.is_webgl2 {
            const PRIMITIVE_RESTART_FIXED_INDEX: u32 = 0x8D69;
            gl.enable(PRIMITIVE_RESTART_FIXED_INDEX);
        }
        let mut context = Context {
            gl,
            link,
            attributes,
            features: Features {
                is_webgl2: attributes.is_webgl2,
                enabled: 0,
            },
            can_read_upside_down: [
                ("ANGLE_pack_reverse_row_order", 0x93A4),
                ("MESA_pack_invert", 0x8758),
            ]
            .into_iter()
            .find(|it| has(it.0))
            .map(|it| it.1),
            objects: Objects::default(),
            answer: Vec::new(),
            errors: Vec::new(),
            messages: Vec::new(),
            messages_left: 32,
            task: 0,
            dirty: dirty::ALL,
            plan: Plan::default(),
            generation: 1,
            capabilities: 1 << 2,
            blending: [Blending {
                is_enabled: false,
                equations: [FUNC_ADD; 2],
                factors: [ONE, ZERO, ONE, ZERO],
                mask: [true; 4],
            }; MAX_COLORS],
            depth_mask: true,
            stencil: [Stencil {
                reference: 0,
                value_mask: !0,
                write_mask: !0,
            }; 2],
            mipmap_hint: DONT_CARE,
            line_width: 1.,
            viewport_origin: [0; 2],
            polygon_mode: FILL_WEBGL,
            unpacking: Unpacking::default(),
            native_unpacking: Unpacking::default(),
            packing: Packing {
                alignment: 4,
                row_length: 0,
                skip: [0; 2],
            },
            flips: false,
            premultiplies: false,
            converts_colors: true,
            is_wide: [false; 2],
            buffers: Default::default(),
            uniform_buffers: vec![None; limits.uniform_bindings as usize],
            default_vertex_array: vertex_array.clone(),
            vertex_array,
            generic_attributes: [(0, [0, 0, 0, 1f32.to_bits()]); MAX_ATTRIBUTES],
            active_unit: 0,
            native_unit: 0,
            units: (0..=limits.shaders.combined_texture_units)
                .map(|_| Unit::default())
                .collect(),
            program: None,
            executable: None,
            locations: 1,
            renderbuffer: None,
            active_feedback: Vec::new(),
            framebuffers: [surface.framebuffer.clone(), surface.framebuffer.clone()],
            scratch_framebuffer: Name::new(Kind::Framebuffer),
            surface,
            queries: Default::default(),
            default_feedback: feedback.clone(),
            feedback,
            limits,
        };
        context.collect_errors();
        context.errors.clear();
        Some(context)
    }

    pub fn is_webgl2(&self) -> bool {
        self.features.is_webgl2
    }

    pub fn has(&self, extension: Extension) -> bool {
        self.features.has(extension)
    }

    pub fn require(&self, extension: Extension) -> Result {
        check_state(self.has(extension), "getExtension was not called for it")
    }

    pub fn enable_extension(&mut self, index: u32) {
        let bit = 1u64.checked_shl(index).unwrap_or(0);
        let implied = IMPLIED
            .iter()
            .filter(|it| it.0.bit() == bit)
            .fold(bit, |all, it| all | it.1.bit());
        self.features.enabled |= implied & self.link.progress.extensions;
        self.images_changed();
    }

    pub fn shader_extensions(&self) -> glsl::Extensions {
        OF_SHADERS
            .iter()
            .filter(|it| self.has(it.0))
            .fold(0, |all, it| all | it.1)
    }

    pub fn images_changed(&mut self) {
        self.generation += 1;
        self.dirty |= dirty::IMAGES;
    }

    fn note(&mut self, error: u32) {
        if !self.errors.contains(&error) && self.errors.len() < 8 {
            self.errors.push(error);
        }
    }

    pub fn record(&mut self, function: &str, Error(error, message): Error) {
        let (first, rest) = function.split_at(1);
        self.complain(
            error,
            &if self.messages_left > 0 {
                format!("{}{rest}: {message}", first.to_lowercase())
            } else {
                String::new()
            },
        );
    }

    fn complain(&mut self, error: u32, message: &str) {
        const NAMES: [&str; 7] = [
            "INVALID_ENUM",
            "INVALID_VALUE",
            "INVALID_OPERATION",
            "",
            "",
            "OUT_OF_MEMORY",
            "INVALID_FRAMEBUFFER_OPERATION",
        ];
        self.note(error);
        let Some(left) = self.messages_left.checked_sub(1) else {
            return;
        };
        self.messages.push(format!(
            "WebGL: {}: {message}",
            NAMES
                .get(error.wrapping_sub(INVALID_ENUM) as usize)
                .unwrap_or(&"")
        ));
        if left == 0 {
            self.messages
                .push("WebGL: further errors of this context are not logged.".into());
        }
        self.messages_left = left;
        self.link
            .progress
            .has_messages
            .store(true, Ordering::Relaxed);
    }

    fn errors_of_driver(&self) -> impl Iterator<Item = u32> + use<> {
        let gl = self.gl;
        std::iter::repeat_with(|| gl.get_error())
            .take(8)
            .take_while(|it| *it != NO_ERROR)
    }

    fn collect_errors(&mut self) {
        self.errors_of_driver().for_each(|it| self.note(it));
    }

    /// What is known about an object must not be more than what the driver has made.
    pub fn allocate(&mut self, allocate: impl FnOnce(&mut Context)) -> Result {
        self.collect_errors();
        allocate(self);
        match self
            .errors_of_driver()
            .max_by_key(|it| *it == OUT_OF_MEMORY)
        {
            None => Ok(()),
            Some(OUT_OF_MEMORY) => Err(NO_MEMORY),
            Some(error) => Err(Error(error, "the driver does not support that")),
        }
    }

    /// The page has found it.
    pub fn fail(&mut self, error: u32, message: &str) {
        self.complain(error, message);
    }

    pub fn get_error(&mut self) -> Answer {
        self.collect_errors();
        Answer::Uint(if self.errors.is_empty() {
            NO_ERROR
        } else {
            self.errors.remove(0)
        })
    }

    pub fn take_messages(&mut self) -> Answer {
        self.link
            .progress
            .has_messages
            .store(false, Ordering::Relaxed);
        Answer::Text(std::mem::take(&mut self.messages).join("\n"))
    }

    pub fn end_task(&mut self) {
        self.task += 1;
        self.flush();
        self.link
            .progress
            .bytes
            .store(ALLOCATED_HERE.get() as usize, Ordering::Relaxed);
    }

    pub fn flush(&mut self) {
        self.gl.flush();
    }

    fn capability(&self, name: u32) -> Result<u32> {
        let exists = match name {
            RASTERIZER_DISCARD => self.is_webgl2(),
            DEPTH_CLAMP_EXT => self.has(DepthClamp),
            POLYGON_OFFSET_LINE_WEBGL => self.has(PolygonMode),
            CLIP_DISTANCE0_WEBGL..=CLIP_DISTANCE7_WEBGL if self.has(ClipCull) => {
                return Ok(1 << (16 + name - CLIP_DISTANCE0_WEBGL));
            }
            _ => true,
        };
        CAPABILITIES
            .iter()
            .position(|it| *it == name && exists)
            .map_or(bad_enum("unknown capability"), |it| Ok(1 << it))
    }

    pub fn is_on(&self, name: u32) -> bool {
        self.capability(name)
            .is_ok_and(|it| self.capabilities & it != 0)
    }

    pub fn is_enabled(&mut self, name: u32) -> Result<Answer> {
        Ok(Answer::Boolean(if name == BLEND {
            self.blending[0].is_enabled
        } else {
            self.capabilities & self.capability(name)? != 0
        }))
    }

    fn set_capability(&mut self, name: u32, is_enabled: bool) -> Result {
        if name == BLEND {
            self.blending
                .iter_mut()
                .for_each(|it| it.is_enabled = is_enabled);
        } else {
            let bit = self.capability(name)?;
            self.capabilities = self.capabilities & !bit | if is_enabled { bit } else { 0 };
        }
        self.dirty |= dirty::OUTPUTS;
        self.gl.set(name, is_enabled);
        Ok(())
    }

    pub fn enable(&mut self, name: u32) -> Result {
        self.set_capability(name, true)
    }

    pub fn disable(&mut self, name: u32) -> Result {
        self.set_capability(name, false)
    }

    pub fn indexed_blending(&mut self, index: u32) -> Result<&mut Blending> {
        self.require(DrawBuffersIndexed)?;
        check_value(
            index < self.limits.shaders.draw_buffers,
            "the index is too large",
        )?;
        self.dirty |= dirty::OUTPUTS;
        Ok(&mut self.blending[index as usize])
    }

    pub fn enablei(&mut self, target: u32, index: u32) -> Result {
        check_enum(target == BLEND, "unknown capability")?;
        self.indexed_blending(index)?.is_enabled = true;
        self.gl.enablei(target, index);
        Ok(())
    }

    pub fn disablei(&mut self, target: u32, index: u32) -> Result {
        check_enum(target == BLEND, "unknown capability")?;
        self.indexed_blending(index)?.is_enabled = false;
        self.gl.disablei(target, index);
        Ok(())
    }

    fn clamped(&self, color: [f32; 4]) -> [f32; 4] {
        let is_free =
            self.is_webgl2() || self.has(ColorBufferFloat) || self.has(ColorBufferHalfFloat);
        color.map(|it| {
            if it.is_nan() {
                0.
            } else if is_free {
                it
            } else {
                it.clamp(0., 1.)
            }
        })
    }

    pub fn blend_color(&mut self, red: f32, green: f32, blue: f32, alpha: f32) {
        let [red, green, blue, alpha] = self.clamped([red, green, blue, alpha]);
        self.gl.blend_color(red, green, blue, alpha);
    }

    fn check_equations(&self, equations: [u32; 2]) -> Result {
        let is_valid = |it| {
            matches!(it, FUNC_ADD | FUNC_SUBTRACT | FUNC_REVERSE_SUBTRACT)
                || matches!(it, MIN | MAX) && self.features.is_webgl2_or_has(BlendMinmax)
        };
        check_enum(equations.into_iter().all(is_valid), "unknown mode")
    }

    pub fn blend_equation(&mut self, mode: u32) -> Result {
        self.blend_equation_separate(mode, mode)
    }

    pub fn blend_equation_separate(&mut self, color: u32, alpha: u32) -> Result {
        self.check_equations([color, alpha])?;
        self.blending
            .iter_mut()
            .for_each(|it| it.equations = [color, alpha]);
        self.gl.blend_equation_separate(color, alpha);
        Ok(())
    }

    pub fn blend_equationi(&mut self, index: u32, mode: u32) -> Result {
        self.blend_equation_separatei(index, mode, mode)
    }

    pub fn blend_equation_separatei(&mut self, index: u32, color: u32, alpha: u32) -> Result {
        self.check_equations([color, alpha])?;
        self.indexed_blending(index)?.equations = [color, alpha];
        self.gl.blend_equation_separatei(index, color, alpha);
        Ok(())
    }

    fn check_factors(&self, factors: [u32; 4]) -> Result {
        let is_valid = |(at, it): (usize, u32)| match it {
            ZERO
            | ONE
            | SRC_COLOR..=ONE_MINUS_DST_COLOR
            | CONSTANT_COLOR..=ONE_MINUS_CONSTANT_ALPHA => true,
            SRC_ALPHA_SATURATE => at % 2 == 0 || self.features.is_webgl2_or_has(DualSource),
            SRC1_ALPHA_WEBGL | SRC1_COLOR_WEBGL..=ONE_MINUS_SRC1_ALPHA_WEBGL => {
                self.has(DualSource)
            }
            _ => false,
        };
        check_enum(
            factors.into_iter().enumerate().all(is_valid),
            "unknown factor",
        )?;
        let has = |a, b| factors[..2].iter().any(|it| *it == a || *it == b);
        check_state(
            !has(CONSTANT_COLOR, ONE_MINUS_CONSTANT_COLOR)
                || !has(CONSTANT_ALPHA, ONE_MINUS_CONSTANT_ALPHA),
            "constant color and constant alpha cannot be combined",
        )
    }

    pub fn blend_func(&mut self, source: u32, destination: u32) -> Result {
        self.blend_func_separate(source, destination, source, destination)
    }

    pub fn blend_func_separate(
        &mut self,
        source: u32,
        destination: u32,
        source_alpha: u32,
        destination_alpha: u32,
    ) -> Result {
        let factors = [source, destination, source_alpha, destination_alpha];
        self.check_factors(factors)?;
        self.blending.iter_mut().for_each(|it| it.factors = factors);
        self.dirty |= dirty::OUTPUTS;
        self.gl
            .blend_func_separate(source, destination, source_alpha, destination_alpha);
        Ok(())
    }

    pub fn blend_funci(&mut self, index: u32, source: u32, destination: u32) -> Result {
        self.blend_func_separatei(index, source, destination, source, destination)
    }

    pub fn blend_func_separatei(
        &mut self,
        index: u32,
        source: u32,
        destination: u32,
        source_alpha: u32,
        destination_alpha: u32,
    ) -> Result {
        self.check_factors([source, destination, source_alpha, destination_alpha])?;
        self.indexed_blending(index)?.factors =
            [source, destination, source_alpha, destination_alpha];
        self.gl
            .blend_func_separatei(index, source, destination, source_alpha, destination_alpha);
        Ok(())
    }

    pub fn color_mask(&mut self, red: bool, green: bool, blue: bool, alpha: bool) {
        self.blending
            .iter_mut()
            .for_each(|it| it.mask = [red, green, blue, alpha]);
        self.dirty |= dirty::OUTPUTS;
        self.gl.color_mask(red, green, blue, alpha);
    }

    pub fn color_maski(
        &mut self,
        index: u32,
        red: bool,
        green: bool,
        blue: bool,
        alpha: bool,
    ) -> Result {
        self.indexed_blending(index)?.mask = [red, green, blue, alpha];
        self.gl.color_maski(index, red, green, blue, alpha);
        Ok(())
    }

    /// Nothing that the page has set keeps `write` from writing everywhere.
    pub fn unmasked(&mut self, write: impl FnOnce(&Gl)) {
        let gl = self.gl;
        let obstacles = [SCISSOR_TEST, RASTERIZER_DISCARD].map(|it| self.is_on(it).then_some(it));
        obstacles
            .into_iter()
            .flatten()
            .for_each(|it| gl.disable(it));
        gl.color_mask(true, true, true, true);
        gl.depth_mask(true);
        gl.stencil_mask_separate(FRONT_AND_BACK, !0);
        write(gl);
        obstacles.into_iter().flatten().for_each(|it| gl.enable(it));
        let [red, green, blue, alpha] = self.blending[0].mask;
        gl.color_mask(red, green, blue, alpha);
        for (index, it) in (0..self.limits.shaders.draw_buffers)
            .zip(self.blending)
            .filter(|it| it.1.mask != self.blending[0].mask)
        {
            gl.color_maski(index, it.mask[0], it.mask[1], it.mask[2], it.mask[3]);
        }
        gl.depth_mask(self.depth_mask);
        gl.stencil_mask_separate(FRONT, self.stencil[0].write_mask);
        gl.stencil_mask_separate(BACK, self.stencil[1].write_mask);
    }

    pub fn clear_color(&mut self, red: f32, green: f32, blue: f32, alpha: f32) {
        let [red, green, blue, alpha] = self.clamped([red, green, blue, alpha]);
        self.gl.clear_color(red, green, blue, alpha);
    }

    pub fn clear_depth(&mut self, depth: f32) {
        self.gl.clear_depth(depth.clamp(0., 1.));
    }

    pub fn clear_stencil(&mut self, stencil: i32) {
        self.gl.clear_stencil(stencil);
    }

    pub fn clip_control(&mut self, origin: u32, depth: u32) -> Result {
        check_enum(
            matches!(origin, LOWER_LEFT_EXT | UPPER_LEFT_EXT)
                && matches!(depth, NEGATIVE_ONE_TO_ONE_EXT | ZERO_TO_ONE_EXT),
            "unknown origin or depth",
        )?;
        self.require(ClipControl)
            .map(|()| self.gl.clip_control(origin, depth))
    }

    pub fn cull_face(&mut self, mode: u32) -> Result {
        faces(mode).map(|_| self.gl.cull_face(mode))
    }

    pub fn depth_func(&mut self, function: u32) -> Result {
        check_comparison(function).map(|()| self.gl.depth_func(function))
    }

    pub fn depth_mask(&mut self, flag: bool) {
        self.depth_mask = flag;
        self.gl.depth_mask(flag);
    }

    pub fn depth_range(&mut self, near: f32, far: f32) -> Result {
        check_state(
            near <= far || near.is_nan() || far.is_nan(),
            "near is behind far",
        )
        .map(|()| self.gl.depth_range(near.clamp(0., 1.), far.clamp(0., 1.)))
    }

    pub fn front_face(&mut self, mode: u32) -> Result {
        check_enum(matches!(mode, CW | CCW), "unknown mode").map(|()| self.gl.front_face(mode))
    }

    pub fn hint(&mut self, target: u32, mode: u32) -> Result {
        check_enum(matches!(mode, DONT_CARE | FASTEST | NICEST), "unknown mode")?;
        match target {
            GENERATE_MIPMAP_HINT => self.mipmap_hint = mode,
            FRAGMENT_SHADER_DERIVATIVE_HINT if self.features.is_webgl2_or_has(Derivatives) => {
                self.gl.hint(target, mode)
            }
            _ => return bad_enum("unknown target"),
        }
        Ok(())
    }

    pub fn line_width(&mut self, width: f32) -> Result {
        check_value(width > 0., "the width has to be positive")?;
        self.line_width = width;
        self.gl
            .line_width(width.min(self.gl.floats(ALIASED_LINE_WIDTH_RANGE)[1]));
        Ok(())
    }

    pub fn polygon_mode(&mut self, face: u32, mode: u32) -> Result {
        check_enum(
            face == FRONT_AND_BACK && matches!(mode, LINE_WEBGL | FILL_WEBGL),
            "unknown face or mode",
        )?;
        self.require(PolygonMode)?;
        self.polygon_mode = mode;
        self.gl.polygon_mode(face, mode);
        Ok(())
    }

    pub fn polygon_offset(&mut self, factor: f32, units: f32) {
        self.gl.polygon_offset(factor, units);
    }

    pub fn polygon_offset_clamp(&mut self, factor: f32, units: f32, clamp: f32) -> Result {
        self.require(PolygonOffsetClamp)
            .map(|()| self.gl.polygon_offset_clamp(factor, units, clamp))
    }

    pub fn provoking_vertex(&mut self, mode: u32) -> Result {
        check_enum(
            matches!(
                mode,
                FIRST_VERTEX_CONVENTION_WEBGL | LAST_VERTEX_CONVENTION_WEBGL
            ),
            "unknown mode",
        )?;
        self.require(ProvokingVertex)
            .map(|()| self.gl.provoking_vertex(mode))
    }

    pub fn sample_coverage(&mut self, value: f32, inverts: bool) {
        self.gl.sample_coverage(value.clamp(0., 1.), inverts);
    }

    pub fn scissor(&mut self, x: i32, y: i32, width: i32, height: i32) -> Result {
        check_value(width >= 0 && height >= 0, "negative size")
            .map(|()| self.gl.scissor(x, y, width, height))
    }

    pub fn stencil_func(&mut self, function: u32, reference: i32, mask: u32) -> Result {
        self.stencil_func_separate(FRONT_AND_BACK, function, reference, mask)
    }

    pub fn stencil_func_separate(
        &mut self,
        face: u32,
        function: u32,
        reference: i32,
        mask: u32,
    ) -> Result {
        check_comparison(function)?;
        self.stencil[faces(face)?]
            .iter_mut()
            .for_each(|it| (it.reference, it.value_mask) = (reference, mask));
        self.dirty |= dirty::OUTPUTS;
        self.gl
            .stencil_func_separate(face, function, reference, mask);
        Ok(())
    }

    pub fn stencil_mask(&mut self, mask: u32) -> Result {
        self.stencil_mask_separate(FRONT_AND_BACK, mask)
    }

    pub fn stencil_mask_separate(&mut self, face: u32, mask: u32) -> Result {
        self.stencil[faces(face)?]
            .iter_mut()
            .for_each(|it| it.write_mask = mask);
        self.dirty |= dirty::OUTPUTS;
        self.gl.stencil_mask_separate(face, mask);
        Ok(())
    }

    pub fn stencil_op(&mut self, fail: u32, depth_fail: u32, pass: u32) -> Result {
        self.stencil_op_separate(FRONT_AND_BACK, fail, depth_fail, pass)
    }

    pub fn stencil_op_separate(
        &mut self,
        face: u32,
        fail: u32,
        depth_fail: u32,
        pass: u32,
    ) -> Result {
        let is_valid = |it| {
            matches!(
                it,
                ZERO | KEEP | REPLACE | INCR | DECR | INVERT | INCR_WRAP | DECR_WRAP
            )
        };
        check_enum(
            [fail, depth_fail, pass].into_iter().all(is_valid),
            "unknown operation",
        )?;
        faces(face).map(|_| self.gl.stencil_op_separate(face, fail, depth_fail, pass))
    }

    pub fn viewport(&mut self, x: i32, y: i32, width: i32, height: i32) -> Result {
        check_value(width >= 0 && height >= 0, "negative size")?;
        self.viewport_origin = [x, y];
        self.gl.viewport(x, y, width, height);
        Ok(())
    }
}
