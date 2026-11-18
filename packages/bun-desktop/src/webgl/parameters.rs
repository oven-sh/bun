//! `getParameter()`

use std::rc::Rc;

use super::buffers;
use super::context::{Context, Extension::*};
use super::decoder::{Answer, Result, bad_enum, check_state, check_value};
use super::formats::FORMATS;
use super::framebuffers::{Attachment, DRAW, READ};
use super::gl::*;
use super::objects::{Object, id_of};
use crate::abi_webgl::answer;

/// It is marked if it could not be bound again.
fn lingering<T: Object>(object: Option<&Rc<T>>, is_usable: bool) -> Answer {
    match object {
        Some(it) if it.handle().is_deleted.get() || !is_usable => {
            Answer::List(answer::OBJECT, vec![it.handle().id, 0])
        }
        it => Answer::Object(id_of(it)),
    }
}

impl Context {
    fn bits(&self, attachment: Option<Attachment>, part: u32) -> Answer {
        Answer::Uint(
            attachment
                .and_then(|it| it.format())
                .filter(|_| self.is_complete(DRAW))
                .map_or(0, |it| it.bits[part as usize].into()),
        )
    }

    fn blending_parameter(&self, name: u32, index: usize) -> Option<Answer> {
        let it = &self.blending[index];
        Some(Answer::Uint(match name {
            BLEND_EQUATION_RGB => it.equations[0],
            BLEND_EQUATION_ALPHA => it.equations[1],
            BLEND_SRC_RGB => it.factors[0],
            BLEND_DST_RGB => it.factors[1],
            BLEND_SRC_ALPHA => it.factors[2],
            BLEND_DST_ALPHA => it.factors[3],
            COLOR_WRITEMASK => {
                return Some(Answer::List(
                    answer::BOOLEANS,
                    it.mask.map(u32::from).into(),
                ));
            }
            _ => return None,
        }))
    }

    fn parameter_of_both(&mut self, name: u32) -> Option<Answer> {
        let (gl, limits, framebuffer, version) = (
            self.gl,
            &self.limits,
            &self.framebuffers[DRAW],
            usize::from(self.is_webgl2()),
        );
        let floats = |count| {
            Answer::List(
                answer::FLOAT_ARRAY,
                gl.floats(name)[..count]
                    .iter()
                    .map(|it| it.to_bits())
                    .collect(),
            )
        };
        let integers = |count| {
            Answer::List(
                answer::INT_ARRAY,
                gl.integers(name)[..count]
                    .iter()
                    .map(|it| *it as u32)
                    .collect(),
            )
        };
        let text = |it: &str| Answer::Text(it.into());
        Some(match name {
            ALIASED_LINE_WIDTH_RANGE | DEPTH_RANGE => floats(2),
            ALIASED_POINT_SIZE_RANGE => Answer::List(
                answer::FLOAT_ARRAY,
                [1f32, gl.floats(name)[1]].map(f32::to_bits).into(),
            ),
            BLEND_COLOR | COLOR_CLEAR_VALUE => floats(4),
            MAX_VIEWPORT_DIMS => integers(2),
            SCISSOR_BOX => integers(4),
            VIEWPORT => Answer::List(
                answer::INT_ARRAY,
                self.viewport_origin
                    .iter()
                    .chain(&gl.integers(name)[2..4])
                    .map(|it| *it as u32)
                    .collect(),
            ),
            DEPTH_CLEAR_VALUE
            | POLYGON_OFFSET_FACTOR
            | POLYGON_OFFSET_UNITS
            | SAMPLE_COVERAGE_VALUE => Answer::Float(gl.floats(name)[0]),
            CULL_FACE_MODE
            | DEPTH_FUNC
            | FRONT_FACE
            | SUBPIXEL_BITS
            | STENCIL_FUNC
            | STENCIL_FAIL..=STENCIL_PASS_DEPTH_PASS
            | STENCIL_BACK_FUNC..=STENCIL_BACK_PASS_DEPTH_PASS => Answer::Uint(gl.integer(name)),
            STENCIL_CLEAR_VALUE => Answer::Int(gl.integers(name)[0]),
            SAMPLE_COVERAGE_INVERT => Answer::Boolean(gl.integer(name) != 0),
            ACTIVE_TEXTURE => Answer::Uint(TEXTURE0 + self.active_unit as u32),
            RED_BITS..=ALPHA_BITS => self.bits(framebuffer.color(0), name - RED_BITS),
            DEPTH_BITS => self.bits(framebuffer.depth(), 4),
            STENCIL_BITS => self.bits(framebuffer.stencil(), 5),
            SAMPLES => Answer::Uint(framebuffer.samples()),
            SAMPLE_BUFFERS => Answer::Uint(framebuffer.samples().min(1)),
            ARRAY_BUFFER_BINDING => Answer::Object(id_of(self.buffers[0].as_ref())),
            ELEMENT_ARRAY_BUFFER_BINDING => {
                lingering(self.vertex_array.elements.borrow().as_ref(), true)
            }
            CURRENT_PROGRAM => lingering(self.program.as_ref(), self.executable.is_some()),
            FRAMEBUFFER_BINDING => Answer::Object(framebuffer.handle.id),
            RENDERBUFFER_BINDING => Answer::Object(id_of(self.renderbuffer.as_ref())),
            TEXTURE_BINDING_2D => {
                Answer::Object(id_of(self.units[self.active_unit].textures[0].as_ref()))
            }
            TEXTURE_BINDING_CUBE_MAP => {
                Answer::Object(id_of(self.units[self.active_unit].textures[1].as_ref()))
            }
            COMPRESSED_TEXTURE_FORMATS => Answer::List(
                answer::UINT_ARRAY,
                FORMATS
                    .iter()
                    .filter(|it| it.block.is_some() && self.features.meet(it.exists))
                    .map(|it| it.sized)
                    .collect(),
            ),
            DEPTH_WRITEMASK => Answer::Boolean(self.depth_mask),
            GENERATE_MIPMAP_HINT => Answer::Uint(self.mipmap_hint),
            LINE_WIDTH => Answer::Float(self.line_width),
            MAX_COMBINED_TEXTURE_IMAGE_UNITS => Answer::Uint(limits.shaders.combined_texture_units),
            MAX_CUBE_MAP_TEXTURE_SIZE => Answer::Uint(limits.cube_size),
            MAX_FRAGMENT_UNIFORM_VECTORS => Answer::Uint(limits.shaders.uniform_vectors[1]),
            MAX_RENDERBUFFER_SIZE => Answer::Uint(limits.renderbuffer_size),
            MAX_TEXTURE_IMAGE_UNITS => Answer::Uint(limits.shaders.texture_units[1]),
            MAX_TEXTURE_SIZE => Answer::Uint(limits.texture_size),
            MAX_VARYING_VECTORS => Answer::Uint(limits.shaders.varying_vectors),
            MAX_VERTEX_ATTRIBS => Answer::Uint(limits.shaders.vertex_attributes),
            MAX_VERTEX_TEXTURE_IMAGE_UNITS => Answer::Uint(limits.shaders.texture_units[0]),
            MAX_VERTEX_UNIFORM_VECTORS => Answer::Uint(limits.shaders.uniform_vectors[0]),
            PACK_ALIGNMENT => Answer::Uint(self.packing.alignment),
            UNPACK_ALIGNMENT => Answer::Uint(self.unpacking.alignment),
            UNPACK_FLIP_Y_WEBGL => Answer::Boolean(self.flips),
            UNPACK_PREMULTIPLY_ALPHA_WEBGL => Answer::Boolean(self.premultiplies),
            UNPACK_COLORSPACE_CONVERSION_WEBGL => Answer::Uint(if self.converts_colors {
                BROWSER_DEFAULT_WEBGL
            } else {
                NONE
            }),
            STENCIL_REF => Answer::Int(self.stencil[0].reference),
            STENCIL_BACK_REF => Answer::Int(self.stencil[1].reference),
            STENCIL_VALUE_MASK => Answer::Uint(self.stencil[0].value_mask),
            STENCIL_BACK_VALUE_MASK => Answer::Uint(self.stencil[1].value_mask),
            STENCIL_WRITEMASK => Answer::Uint(self.stencil[0].write_mask),
            STENCIL_BACK_WRITEMASK => Answer::Uint(self.stencil[1].write_mask),
            BLEND => Answer::Boolean(self.blending[0].is_enabled),
            VENDOR => text("WebKit"),
            RENDERER => text("WebKit WebGL"),
            VERSION => text(["WebGL 1.0 (OpenGL ES 2.0)", "WebGL 2.0 (OpenGL ES 3.0)"][version]),
            SHADING_LANGUAGE_VERSION => text(
                [
                    "WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0)",
                    "WebGL GLSL ES 3.00 (OpenGL ES GLSL ES 3.0)",
                ][version],
            ),
            UNMASKED_VENDOR_WEBGL if self.has(RendererInfo) => Answer::Text(gl.text(VENDOR)),
            UNMASKED_RENDERER_WEBGL if self.has(RendererInfo) => Answer::Text(gl.text(RENDERER)),
            FRAGMENT_SHADER_DERIVATIVE_HINT if self.features.is_webgl2_or_has(Derivatives) => {
                Answer::Uint(gl.integer(name))
            }
            VERTEX_ARRAY_BINDING if self.features.is_webgl2_or_has(VertexArrayObject) => {
                Answer::Object(self.vertex_array.handle.id)
            }
            MAX_COLOR_ATTACHMENTS | MAX_DRAW_BUFFERS
                if self.features.is_webgl2_or_has(DrawBuffers) =>
            {
                Answer::Uint(limits.shaders.draw_buffers)
            }
            DRAW_BUFFER0..=DRAW_BUFFER15
                if self.features.is_webgl2_or_has(DrawBuffers)
                    && name - DRAW_BUFFER0 < limits.shaders.draw_buffers =>
            {
                Answer::Uint(framebuffer.draw_buffer(name - DRAW_BUFFER0))
            }
            MAX_TEXTURE_MAX_ANISOTROPY_EXT if self.has(Anisotropic) => {
                Answer::Float(gl.floats(name)[0])
            }
            TIMESTAMP_EXT if self.has(TimerQuery) || self.has(TimerQuery2) => {
                Answer::Double(gl.large_integer(name) as f64)
            }
            GPU_DISJOINT_EXT if self.has(TimerQuery) || self.has(TimerQuery2) => {
                Answer::Boolean(gl.integer(name) != 0)
            }
            CLIP_ORIGIN_EXT | CLIP_DEPTH_MODE_EXT if self.has(ClipControl) => {
                Answer::Uint(gl.integer(name))
            }
            POLYGON_OFFSET_CLAMP_EXT if self.has(PolygonOffsetClamp) => {
                Answer::Float(gl.floats(name)[0])
            }
            POLYGON_MODE_WEBGL if self.has(PolygonMode) => Answer::Uint(self.polygon_mode),
            MAX_DUAL_SOURCE_DRAW_BUFFERS_WEBGL if self.has(DualSource) => {
                Answer::Uint(limits.shaders.dual_source_draw_buffers)
            }
            _ => {
                return self
                    .blending_parameter(name, 0)
                    .or_else(|| self.is_enabled(name).ok());
            }
        })
    }

    fn parameter_of_webgl2(&self, name: u32) -> Option<Answer> {
        let (gl, limits) = (self.gl, &self.limits.shaders);
        let buffer = |target| {
            Answer::Object(id_of(
                self.buffers[buffers::TARGETS
                    .iter()
                    .position(|it| *it == target)
                    .unwrap_or(0)]
                .as_ref(),
            ))
        };
        let components = |stage: usize| {
            limits.uniform_blocks[stage] * limits.uniform_block_size / 4
                + limits.uniform_vectors[stage] * 4
        };
        Some(Answer::Uint(match name {
            COPY_READ_BUFFER_BINDING | COPY_WRITE_BUFFER_BINDING => return Some(buffer(name)),
            PIXEL_PACK_BUFFER_BINDING => return Some(buffer(PIXEL_PACK_BUFFER)),
            PIXEL_UNPACK_BUFFER_BINDING => return Some(buffer(PIXEL_UNPACK_BUFFER)),
            TRANSFORM_FEEDBACK_BUFFER_BINDING => return Some(buffer(TRANSFORM_FEEDBACK_BUFFER)),
            UNIFORM_BUFFER_BINDING => return Some(buffer(UNIFORM_BUFFER)),
            READ_FRAMEBUFFER_BINDING => {
                return Some(Answer::Object(self.framebuffers[READ].handle.id));
            }
            SAMPLER_BINDING => {
                return Some(Answer::Object(id_of(
                    self.units[self.active_unit].sampler.as_ref(),
                )));
            }
            TEXTURE_BINDING_3D => {
                return Some(Answer::Object(id_of(
                    self.units[self.active_unit].textures[2].as_ref(),
                )));
            }
            TEXTURE_BINDING_2D_ARRAY => {
                return Some(Answer::Object(id_of(
                    self.units[self.active_unit].textures[3].as_ref(),
                )));
            }
            TRANSFORM_FEEDBACK_BINDING => return Some(Answer::Object(self.feedback.handle.id)),
            TRANSFORM_FEEDBACK_ACTIVE => return Some(Answer::Boolean(self.feedback.is_active())),
            TRANSFORM_FEEDBACK_PAUSED => {
                return Some(Answer::Boolean(
                    self.feedback.is_active() && !self.feedback.is_capturing(),
                ));
            }
            MAX_TEXTURE_LOD_BIAS => return Some(Answer::Float(gl.floats(name)[0])),
            MIN_PROGRAM_TEXEL_OFFSET => return Some(Answer::Int(limits.texel_offsets[0])),
            MIN_FRAGMENT_INTERPOLATION_OFFSET_OES | MAX_FRAGMENT_INTERPOLATION_OFFSET_OES
                if self.has(Interpolation) =>
            {
                return Some(Answer::Float(gl.floats(name)[0]));
            }
            FRAGMENT_INTERPOLATION_OFFSET_BITS_OES if self.has(Interpolation) => gl.integer(name),
            PROVOKING_VERTEX_WEBGL if self.has(ProvokingVertex) => gl.integer(name),
            MAX_CLIP_DISTANCES_WEBGL if self.has(ClipCull) => limits.distances[0],
            MAX_CULL_DISTANCES_WEBGL if self.has(ClipCull) => limits.distances[1],
            MAX_COMBINED_CLIP_AND_CULL_DISTANCES_WEBGL if self.has(ClipCull) => limits.distances[2],
            MAX_ELEMENTS_INDICES | MAX_ELEMENTS_VERTICES => gl.integer(name),
            MAX_3D_TEXTURE_SIZE => self.limits.volume_size,
            MAX_ARRAY_TEXTURE_LAYERS => self.limits.layers,
            MAX_CLIENT_WAIT_TIMEOUT_WEBGL | MAX_SERVER_WAIT_TIMEOUT => 0,
            MAX_COMBINED_VERTEX_UNIFORM_COMPONENTS => components(0),
            MAX_COMBINED_FRAGMENT_UNIFORM_COMPONENTS => components(1),
            MAX_COMBINED_UNIFORM_BLOCKS => limits.combined_uniform_blocks,
            MAX_ELEMENT_INDEX => u32::MAX - 1,
            MAX_VERTEX_OUTPUT_COMPONENTS => limits.stage_vectors[0] * 4,
            MAX_FRAGMENT_INPUT_COMPONENTS => limits.stage_vectors[1] * 4,
            MAX_VERTEX_UNIFORM_BLOCKS => limits.uniform_blocks[0],
            MAX_FRAGMENT_UNIFORM_BLOCKS => limits.uniform_blocks[1],
            MAX_VERTEX_UNIFORM_COMPONENTS => limits.uniform_vectors[0] * 4,
            MAX_FRAGMENT_UNIFORM_COMPONENTS => limits.uniform_vectors[1] * 4,
            MAX_PROGRAM_TEXEL_OFFSET => limits.texel_offsets[1] as u32,
            MAX_SAMPLES => limits.samples,
            MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS => limits.interleaved_feedback_components,
            MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS => limits.separate_feedback_attributes,
            MAX_TRANSFORM_FEEDBACK_SEPARATE_COMPONENTS => 4,
            MAX_UNIFORM_BLOCK_SIZE => limits.uniform_block_size,
            MAX_UNIFORM_BUFFER_BINDINGS => self.limits.uniform_bindings,
            MAX_VARYING_COMPONENTS => limits.varying_vectors * 4,
            UNIFORM_BUFFER_OFFSET_ALIGNMENT => self.limits.uniform_alignment,
            PACK_ROW_LENGTH => self.packing.row_length,
            PACK_SKIP_PIXELS => self.packing.skip[0],
            PACK_SKIP_ROWS => self.packing.skip[1],
            UNPACK_ROW_LENGTH => self.unpacking.row_length,
            UNPACK_IMAGE_HEIGHT => self.unpacking.image_height,
            UNPACK_SKIP_PIXELS => self.unpacking.skip[0],
            UNPACK_SKIP_ROWS => self.unpacking.skip[1],
            UNPACK_SKIP_IMAGES => self.unpacking.skip[2],
            READ_BUFFER => self.framebuffers[READ].read_buffer(),
            _ => return None,
        }))
    }

    pub fn get_parameter(&mut self, name: u32) -> Result<Answer> {
        if let IMPLEMENTATION_COLOR_READ_TYPE | IMPLEMENTATION_COLOR_READ_FORMAT = name {
            check_state(self.is_complete(READ), "the framebuffer is not complete")?;
            let format = self.read_source()?.1;
            return Ok(Answer::Uint(
                self.preferred_read(format)[usize::from(name == IMPLEMENTATION_COLOR_READ_TYPE)],
            ));
        }
        let of_webgl2 = if self.is_webgl2() {
            self.parameter_of_webgl2(name)
        } else {
            None
        };
        of_webgl2
            .or_else(|| self.parameter_of_both(name))
            .map_or(bad_enum("unknown pname"), Ok)
    }

    pub fn get_indexed_parameter(&mut self, name: u32, index: u32) -> Result<Answer> {
        let feedback = self.feedback.buffers.borrow();
        let ranges = match name {
            TRANSFORM_FEEDBACK_BUFFER_BINDING
            | TRANSFORM_FEEDBACK_BUFFER_START
            | TRANSFORM_FEEDBACK_BUFFER_SIZE => {
                &feedback[..self.limits.shaders.separate_feedback_attributes as usize]
            }
            UNIFORM_BUFFER_BINDING..=UNIFORM_BUFFER_SIZE => &self.uniform_buffers,
            _ => {
                let Some(()) = self
                    .blending_parameter(name, 0)
                    .filter(|_| self.has(DrawBuffersIndexed))
                    .map(drop)
                else {
                    return bad_enum("unknown pname");
                };
                check_value(
                    index < self.limits.shaders.draw_buffers,
                    "the index is too large",
                )?;
                return Ok(self
                    .blending_parameter(name, index as usize)
                    .unwrap_or(Answer::Null));
            }
        };
        check_value((index as usize) < ranges.len(), "the index is too large")?;
        let range = ranges[index as usize].as_ref();
        Ok(match name {
            TRANSFORM_FEEDBACK_BUFFER_START | UNIFORM_BUFFER_START => {
                Answer::Uint(range.map_or(0, |it| it.offset as u32))
            }
            TRANSFORM_FEEDBACK_BUFFER_SIZE | UNIFORM_BUFFER_SIZE => {
                Answer::Uint(range.map_or(0, |it| it.size as u32))
            }
            _ => Answer::Object(id_of(range.map(|it| &it.buffer))),
        })
    }
}
