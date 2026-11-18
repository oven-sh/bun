//! WebGL: the page writes commands, which are words. The library checks and runs them on another thread.
//!
//! `webgl.bind.ts` reads the tables of this file.
//!
//! A command is its index in [`commands`] and a word for each argument. Bytes are their number and the bytes, padded to a word. An object is
//! the id that the page has given it, or 0.

use core::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize};

use crate::abi::Slice;

/// `send` only has arguments, `bind` makes the context refer to an object, `draw` may change the drawing buffer, and `ask` has an answer, or else the
/// value after it. `other` is what the API does not have in this form: lists come after the semicolon.
macro_rules! commands {
    ($with:ident) => { $with! {
        other {
            BindAttribLocation bind_attrib_location(program, index; name)
            BufferData buffer_data(target, usage, size; bytes)
            BufferSubData buffer_sub_data(target, offset; bytes)
            ClearBuffer clear_buffer(buffer, index, scalar; values)
            ClientWaitSync client_wait_sync(sync, flags, waits)
            CompileShader compile_shader(shader)
            CompressedTexImage compressed_tex_image(upload, is_from_buffer, size, offset; bytes)
            Create create(kind, id, argument)
            Delete delete(kind, id)
            DrawBuffers draw_buffers(; buffers)
            DrawingBufferStorage drawing_buffer_storage(format, width, height)
            EnableExtension enable_extension(extension)
            EndTask end_task()
            Fail fail(error; message)
            Flush flush()
            GetActiveUniforms get_active_uniforms(program, name; indices)
            GetAttribLocation get_attrib_location(program; name)
            GetBufferSubData get_buffer_sub_data(target, offset, size)
            GetError get_error()
            GetFragDataLocation get_frag_data_location(program; name)
            GetProgramParameter get_program_parameter(program, name)
            GetQueryParameter get_query_parameter(query, name)
            GetShaderParameter get_shader_parameter(shader, name)
            GetSyncParameter get_sync_parameter(sync, name)
            GetUniformBlockIndex get_uniform_block_index(program; name)
            GetUniformIndices get_uniform_indices(program; names)
            GetUniformLocation get_uniform_location(program; name)
            InvalidateFramebuffer invalidate_framebuffer(target, x, y, width, height; attachments)
            Is is(kind, id)
            LinkProgram link_program(program)
            ListReferenced list_referenced()
            MultiDraw multi_draw(mode, has_elements, kind; starts, counts, instances)
            PixelStorei pixel_storei(name, value)
            Present present(canvas)
            ReadBack read_back(discards, is_straight)
            ReadPixels read_pixels(x, y, width, height, format, kind, view, available)
            ReadPixelsToBuffer read_pixels_to_buffer(x, y, width, height, format, kind, offset)
            Release release(id)
            SetColorSpaces set_color_spaces(is_drawing_buffer_wide, is_unpack_wide)
            ShaderSource shader_source(shader; source)
            TakeMessages take_messages()
            TexImage tex_image(upload, view; bytes)
            TexImageFromBuffer tex_image_from_buffer(upload, offset)
            TexImageFromData tex_image_from_data(upload, flags, width, height; bytes)
            TexImageFromSource tex_image_from_source(upload, flags)
            TransformFeedbackVaryings transform_feedback_varyings(program, mode; names)
            Uniform uniform(location, shape; values)
            VertexAttrib vertex_attrib(index, scalar, x, y, z, w)
            WaitSync wait_sync(sync, flags, is_timeout_ignored)
        }
        send WebGLRenderingContextBase {
            ActiveTexture active_texture(texture: u32)
            BlendColor blend_color(red: f32, green: f32, blue: f32, alpha: f32)
            BlendEquation blend_equation(mode: u32)
            BlendEquationSeparate blend_equation_separate(color: u32, alpha: u32)
            BlendFunc blend_func(source: u32, destination: u32)
            BlendFuncSeparate blend_func_separate(source: u32, destination: u32, source_alpha: u32, destination_alpha: u32)
            ClearColor clear_color(red: f32, green: f32, blue: f32, alpha: f32)
            ClearDepth clear_depth(depth: f32)
            ClearStencil clear_stencil(stencil: u32)
            ColorMask color_mask(red: bool, green: bool, blue: bool, alpha: bool)
            CopyTexImage2D copy_tex_image_2d(target: u32, level: u32, format: u32, x: u32, y: u32, width: u32, height: u32, border: u32)
            CopyTexSubImage2D copy_tex_sub_image_2d(target: u32, level: u32, to_x: u32, to_y: u32, x: u32, y: u32, width: u32, height: u32)
            CullFace cull_face(mode: u32)
            DepthFunc depth_func(func: u32)
            DepthMask depth_mask(flag: bool)
            DepthRange depth_range(near: f32, far: f32)
            DetachShader detach_shader(program: &WebGLProgram, shader: &WebGLShader)
            Disable disable(capability: u32)
            DisableVertexAttribArray disable_vertex_attrib_array(index: u32)
            Enable enable(capability: u32)
            EnableVertexAttribArray enable_vertex_attrib_array(index: u32)
            FrontFace front_face(mode: u32)
            GenerateMipmap generate_mipmap(target: u32)
            Hint hint(target: u32, mode: u32)
            LineWidth line_width(width: f32)
            PolygonOffset polygon_offset(factor: f32, units: f32)
            RenderbufferStorage renderbuffer_storage(target: u32, format: u32, width: u32, height: u32)
            SampleCoverage sample_coverage(value: f32, inverts: bool)
            Scissor scissor(x: u32, y: u32, width: u32, height: u32)
            StencilFunc stencil_func(func: u32, reference: u32, mask: u32)
            StencilFuncSeparate stencil_func_separate(face: u32, func: u32, reference: u32, mask: u32)
            StencilMask stencil_mask(mask: u32)
            StencilMaskSeparate stencil_mask_separate(face: u32, mask: u32)
            StencilOp stencil_op(fail: u32, depth_fail: u32, pass: u32)
            StencilOpSeparate stencil_op_separate(face: u32, fail: u32, depth_fail: u32, pass: u32)
            TexParameterf tex_parameterf(target: u32, name: u32, value: f32)
            TexParameteri tex_parameteri(target: u32, name: u32, value: u32)
            ValidateProgram validate_program(program: &WebGLProgram)
            VertexAttribPointer vertex_attrib_pointer(index: u32, size: u32, kind: u32, is_normalized: bool, stride: u32, offset: i64)
            Viewport viewport(x: u32, y: u32, width: u32, height: u32)
        }
        bind WebGLRenderingContextBase {
            AttachShader attach_shader(program: &WebGLProgram, shader: &WebGLShader)
            BindBuffer bind_buffer(target: u32, buffer: Option<&WebGLBuffer>)
            BindFramebuffer bind_framebuffer(target: u32, framebuffer: Option<&WebGLFramebuffer>)
            BindRenderbuffer bind_renderbuffer(target: u32, renderbuffer: Option<&WebGLRenderbuffer>)
            BindTexture bind_texture(target: u32, texture: Option<&WebGLTexture>)
            FramebufferRenderbuffer framebuffer_renderbuffer(target: u32, attachment: u32, kind: u32, renderbuffer: Option<&WebGLRenderbuffer>)
            FramebufferTexture2D framebuffer_texture_2d(target: u32, attachment: u32, face: u32, texture: Option<&WebGLTexture>, level: u32)
            UseProgram use_program(program: Option<&WebGLProgram>)
        }
        draw WebGLRenderingContextBase {
            Clear clear(mask: u32)
            DrawArrays draw_arrays(mode: u32, first: u32, count: u32)
            DrawElements draw_elements(mode: u32, count: u32, kind: u32, offset: i64)
        }
        ask WebGLRenderingContextBase {
            CheckFramebufferStatus check_framebuffer_status(target: u32) -> 0x8CDD
            GetActiveAttrib get_active_attrib(program: &WebGLProgram, index: u32) -> null
            GetActiveUniform get_active_uniform(program: &WebGLProgram, index: u32) -> null
            GetAttachedShaders get_attached_shaders(program: &WebGLProgram) -> null
            GetBufferParameter get_buffer_parameter(target: u32, name: u32) -> null
            GetFramebufferAttachmentParameter get_framebuffer_attachment_parameter(target: u32, attachment: u32, name: u32) -> null
            GetParameter get_parameter(name: u32) -> null
            GetProgramInfoLog get_program_info_log(program: &WebGLProgram) -> null
            GetRenderbufferParameter get_renderbuffer_parameter(target: u32, name: u32) -> null
            GetShaderInfoLog get_shader_info_log(shader: &WebGLShader) -> null
            GetShaderPrecisionFormat get_shader_precision_format(shader: u32, precision: u32) -> null
            GetShaderSource get_shader_source(shader: &WebGLShader) -> null
            GetTexParameter get_tex_parameter(target: u32, name: u32) -> null
            GetUniform get_uniform(program: &WebGLProgram, location: &WebGLUniformLocation) -> null
            GetVertexAttrib get_vertex_attrib(index: u32, name: u32) -> null
            GetVertexAttribOffset get_vertex_attrib_offset(index: u32, name: u32) -> 0
            IsEnabled is_enabled(capability: u32) -> false
        }
        send WebGL2RenderingContextBase {
            BeginTransformFeedback begin_transform_feedback(mode: u32)
            CopyBufferSubData copy_buffer_sub_data(from: u32, to: u32, from_offset: i64, to_offset: i64, size: i64)
            CopyTexSubImage3D copy_tex_sub_image_3d(target: u32, level: u32, to_x: u32, to_y: u32, to_z: u32, x: u32, y: u32, width: u32, height: u32)
            EndQuery end_query(target: u32)
            EndTransformFeedback end_transform_feedback()
            PauseTransformFeedback pause_transform_feedback()
            ReadBuffer read_buffer(source: u32)
            RenderbufferStorageMultisample renderbuffer_storage_multisample(target: u32, samples: u32, format: u32, width: u32, height: u32)
            ResumeTransformFeedback resume_transform_feedback()
            SamplerParameterf sampler_parameterf(sampler: &WebGLSampler, name: u32, value: f32)
            SamplerParameteri sampler_parameteri(sampler: &WebGLSampler, name: u32, value: u32)
            TexStorage2D tex_storage_2d(target: u32, levels: u32, format: u32, width: u32, height: u32)
            TexStorage3D tex_storage_3d(target: u32, levels: u32, format: u32, width: u32, height: u32, depth: u32)
            UniformBlockBinding uniform_block_binding(program: &WebGLProgram, index: u32, binding: u32)
            VertexAttribDivisor vertex_attrib_divisor(index: u32, divisor: u32)
            VertexAttribIPointer vertex_attrib_i_pointer(index: u32, size: u32, kind: u32, stride: u32, offset: i64)
        }
        bind WebGL2RenderingContextBase {
            BeginQuery begin_query(target: u32, query: &WebGLQuery)
            BindBufferBase bind_buffer_base(target: u32, index: u32, buffer: Option<&WebGLBuffer>)
            BindBufferRange bind_buffer_range(target: u32, index: u32, buffer: Option<&WebGLBuffer>, offset: i64, size: i64)
            BindSampler bind_sampler(unit: u32, sampler: Option<&WebGLSampler>)
            BindTransformFeedback bind_transform_feedback(target: u32, feedback: Option<&WebGLTransformFeedback>)
            BindVertexArray bind_vertex_array(array: Option<&WebGLVertexArrayObject>)
            FramebufferTextureLayer framebuffer_texture_layer(target: u32, attachment: u32, texture: Option<&WebGLTexture>, level: u32, layer: u32)
        }
        draw WebGL2RenderingContextBase {
            BlitFramebuffer blit_framebuffer(x0: u32, y0: u32, x1: u32, y1: u32, to_x0: u32, to_y0: u32, to_x1: u32, to_y1: u32, mask: u32, filter: u32)
            ClearBufferfi clear_bufferfi(buffer: u32, index: u32, depth: f32, stencil: u32)
            DrawArraysInstanced draw_arrays_instanced(mode: u32, first: u32, count: u32, instances: u32)
            DrawElementsInstanced draw_elements_instanced(mode: u32, count: u32, kind: u32, offset: i64, instances: u32)
            DrawRangeElements draw_range_elements(mode: u32, start: u32, end: u32, count: u32, kind: u32, offset: i64)
        }
        ask WebGL2RenderingContextBase {
            GetActiveUniformBlockName get_active_uniform_block_name(program: &WebGLProgram, index: u32) -> null
            GetActiveUniformBlockParameter get_active_uniform_block_parameter(program: &WebGLProgram, index: u32, name: u32) -> null
            GetIndexedParameter get_indexed_parameter(target: u32, index: u32) -> null
            GetInternalformatParameter get_internalformat_parameter(target: u32, format: u32, name: u32) -> null
            GetQuery get_query(target: u32, name: u32) -> null
            GetSamplerParameter get_sampler_parameter(sampler: &WebGLSampler, name: u32) -> null
            GetTransformFeedbackVarying get_transform_feedback_varying(program: &WebGLProgram, index: u32) -> null
        }
        send GlClipControl { ClipControl clip_control(origin: u32, depth: u32) }
        send GlTimerQuery2 { QueryCounter query_counter(query: &WebGLQuery, target: u32) }
        send GlPolygonOffsetClamp { PolygonOffsetClamp polygon_offset_clamp(factor: f32, units: f32, clamp: f32) }
        send GlDrawBuffersIndexed {
            Enablei enablei(target: u32, index: u32)
            Disablei disablei(target: u32, index: u32)
            BlendEquationi blend_equationi(index: u32, mode: u32)
            BlendEquationSeparatei blend_equation_separatei(index: u32, color: u32, alpha: u32)
            BlendFunci blend_funci(index: u32, source: u32, destination: u32)
            BlendFuncSeparatei blend_func_separatei(index: u32, source: u32, destination: u32, source_alpha: u32, destination_alpha: u32)
            ColorMaski color_maski(index: u32, red: bool, green: bool, blue: bool, alpha: bool)
        }
        ask GlDebugShaders { GetTranslatedShaderSource get_translated_shader_source(shader: &WebGLShader) -> empty }
        send GlPolygonMode { PolygonMode polygon_mode(face: u32, mode: u32) }
        send GlProvokingVertex { ProvokingVertex provoking_vertex(mode: u32) }
    }};
}
pub(crate) use commands;

/// With the versions of WebGL that have them.
macro_rules! extensions {
    ($with:ident) => { $with! {
        InstancedArrays ANGLE_instanced_arrays 1 BlendMinmax EXT_blend_minmax 1 ClipControl EXT_clip_control 3 ColorBufferFloat2 EXT_color_buffer_float 2
        ColorBufferHalfFloat EXT_color_buffer_half_float 3 ConservativeDepth EXT_conservative_depth 2 DepthClamp EXT_depth_clamp 3
        TimerQuery EXT_disjoint_timer_query 1 TimerQuery2 EXT_disjoint_timer_query_webgl2 2 FloatBlend EXT_float_blend 3 FragDepth EXT_frag_depth 1
        PolygonOffsetClamp EXT_polygon_offset_clamp 3 RenderSnorm EXT_render_snorm 2 TextureLod EXT_shader_texture_lod 1
        Bptc EXT_texture_compression_bptc 3 Rgtc EXT_texture_compression_rgtc 3 Anisotropic EXT_texture_filter_anisotropic 3
        MirrorClamp EXT_texture_mirror_clamp_to_edge 3 Norm16 EXT_texture_norm16 2 Srgb EXT_sRGB 1 ParallelCompile KHR_parallel_shader_compile 3
        Noperspective NV_shader_noperspective_interpolation 2 DrawBuffersIndexed OES_draw_buffers_indexed 2 ElementIndexUint OES_element_index_uint 1
        RenderMipmap OES_fbo_render_mipmap 1 SampleVariables OES_sample_variables 2 Interpolation OES_shader_multisample_interpolation 2
        Derivatives OES_standard_derivatives 1 TextureFloat OES_texture_float 1 FloatLinear OES_texture_float_linear 3
        TextureHalfFloat OES_texture_half_float 1 HalfFloatLinear OES_texture_half_float_linear 1 VertexArrayObject OES_vertex_array_object 1
        DualSource WEBGL_blend_func_extended 3 ClipCull WEBGL_clip_cull_distance 2 ColorBufferFloat WEBGL_color_buffer_float 1
        Astc WEBGL_compressed_texture_astc 3 Etc WEBGL_compressed_texture_etc 3 Etc1 WEBGL_compressed_texture_etc1 3 S3tc WEBGL_compressed_texture_s3tc 3
        S3tcSrgb WEBGL_compressed_texture_s3tc_srgb 3 RendererInfo WEBGL_debug_renderer_info 3 DebugShaders WEBGL_debug_shaders 3
        DepthTexture WEBGL_depth_texture 1 DrawBuffers WEBGL_draw_buffers 1 LoseContext WEBGL_lose_context 3 MultiDraw WEBGL_multi_draw 3
        PolygonMode WEBGL_polygon_mode 3 ProvokingVertex WEBGL_provoking_vertex 2 SharedExponent WEBGL_render_shared_exponent 2
        StencilTexturing WEBGL_stencil_texturing 2
    }};
}
pub(crate) use extensions;

/// For an offset or a size.
pub(crate) const NEGATIVE: u32 = u32::MAX;
pub(crate) const TOO_LARGE: u32 = u32::MAX - 1;

macro_rules! numbers {
    ($($(#[$note:meta])* $module:ident { $($name:ident $value:literal)* })*) => {
        $($(#[$note])* pub(crate) mod $module { $(pub(crate) const $name: u32 = $value;)* })*
    };
}

numbers! {
    object { BUFFER 0 FRAMEBUFFER 1 PROGRAM 2 QUERY 3 RENDERBUFFER 4 SAMPLER 5 SHADER 6 SYNC 7 TEXTURE 8 TRANSFORM_FEEDBACK 9 VERTEX_ARRAY 10 }
    scalar { FLOAT 0 INT 1 UINT 2 }
    /// What kind of array has the pixels.
    view { NULL 0 INT8 1 UINT8 2 INT16 3 UINT16 4 INT32 5 UINT32 6 FLOAT32 7 }
    /// About an upload from an image, a canvas or a video.
    source { HAS_SIZE 1 IS_BITMAP 2 IS_STRAIGHT 4 IS_WIDE 8 }
    /// The first word of an answer. There is none after an error.
    answer {
        BOOLEAN 0 INT 1 UINT 2 FLOAT 3 DOUBLE 4 TEXT 5 INT_ARRAY 6 UINT_ARRAY 7 FLOAT_ARRAY 8 BOOLEANS 9 INTS 10 UINTS 11 OBJECT 12 OBJECTS 13
        ACTIVE_INFO 14 PRECISION_FORMAT 15 LOCATION 16
    }
}

/// The arguments of the functions that write to a texture. It is as many words.
#[derive(Clone, Copy)]
#[repr(C)]
pub(crate) struct Upload {
    pub(crate) target: u32,
    pub(crate) level: u32,
    pub(crate) internal_format: u32,
    pub(crate) offset: [u32; 3],
    pub(crate) size: [u32; 3],
    pub(crate) border: u32,
    pub(crate) format: u32,
    pub(crate) kind: u32,
    /// 2 or 3.
    pub(crate) dimensions: u32,
    /// 1 if it replaces a part of an image.
    pub(crate) is_partial: u32,
}

/// What `pixelStorei()` says about the pixels to upload.
#[derive(Clone, Copy)]
#[repr(C)]
pub(crate) struct Unpacking {
    pub(crate) alignment: u32,
    pub(crate) row_length: u32,
    pub(crate) image_height: u32,
    /// Pixels, rows and images.
    pub(crate) skip: [u32; 3],
}

impl Default for Unpacking {
    fn default() -> Unpacking {
        Unpacking {
            alignment: 4,
            row_length: 0,
            image_height: 0,
            skip: [0; 3],
        }
    }
}

#[derive(Clone, Copy)]
#[repr(C)]
pub(crate) struct Attributes {
    pub(crate) is_webgl2: bool,
    pub(crate) alpha: bool,
    pub(crate) depth: bool,
    pub(crate) stencil: bool,
    pub(crate) antialias: bool,
    pub(crate) premultiplied_alpha: bool,
    pub(crate) preserve_drawing_buffer: bool,
    pub(crate) fail_if_major_performance_caveat: bool,
}

/// A context.
#[repr(C)]
pub(crate) struct Progress {
    /// A bit for each.
    pub(crate) extensions: u64,
    /// How many times what was sent has been run.
    pub(crate) done: AtomicU32,
    /// Of its buffers and images.
    pub(crate) bytes: AtomicUsize,
    pub(crate) is_lost: AtomicBool,
    pub(crate) has_messages: AtomicBool,
}

/// Where to write commands. There is none if there is no memory, or if the context is lost.
#[repr(C)]
pub(crate) struct Room {
    pub(crate) start: *mut u32,
    pub(crate) words: usize,
}

#[repr(C)]
pub(crate) struct WebGl {
    /// Null if there is no WebGL.
    pub(crate) open: unsafe extern "C" fn(attributes: *const Attributes) -> *const Progress,
    /// Runs what was written to the last room, later. Returns another.
    pub(crate) send:
        unsafe extern "C" fn(context: *const Progress, used: usize, wanted: usize) -> Room,
    /// The answer to what was sent last. It is valid until something is sent.
    pub(crate) answer: unsafe extern "C" fn(context: *const Progress) -> Slice<u32>,
    /// The answer to what was written to the room from `start` on, if that does not have to be sent. It is valid until something is sent.
    pub(crate) recall:
        unsafe extern "C" fn(context: *const Progress, start: usize, used: usize) -> Slice<u32>,
    /// To be called after `Present` or `ReadBack` was sent: the canvas gets the pixels, and not too many frames are waiting.
    pub(crate) show:
        unsafe extern "C" fn(context: *const Progress, canvas: u32, is_needed_now: bool),
    /// An image or a canvas as it is now, for the next `TexImageFromSource`.
    pub(crate) offer: unsafe extern "C" fn(context: *const Progress, image: u32, size: &[u32; 2]),
    pub(crate) close: unsafe extern "C" fn(context: *const Progress),
    pub(crate) set_unpacking:
        unsafe extern "C" fn(unpacking: *mut Unpacking, is_webgl2: bool, name: u32, value: u32),
    /// How many bytes it reads.
    pub(crate) measure:
        unsafe extern "C" fn(upload: *const Upload, unpacking: *const Unpacking) -> usize,
}
