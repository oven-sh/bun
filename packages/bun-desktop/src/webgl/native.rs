//! What draws: the system's OpenGL ES 3, which is loaded when a page first asks for it.

use std::ffi::c_void;

macro_rules! for_functions {
    ($define:ident $name:ident) => {
        $define! {
            $name
            plain {
                active_texture "glActiveTexture" (unit: u32);
                begin_query "glBeginQuery" (target: u32, query: u32);
                begin_transform_feedback "glBeginTransformFeedback" (mode: u32);
                bind_buffer "glBindBuffer" (target: u32, buffer: u32);
                bind_buffer_base "glBindBufferBase" (target: u32, index: u32, buffer: u32);
                bind_buffer_range "glBindBufferRange" (target: u32, index: u32, buffer: u32, offset: usize, size: usize);
                bind_framebuffer "glBindFramebuffer" (target: u32, framebuffer: u32);
                bind_renderbuffer "glBindRenderbuffer" (target: u32, renderbuffer: u32);
                bind_sampler "glBindSampler" (unit: u32, sampler: u32);
                bind_texture "glBindTexture" (target: u32, texture: u32);
                bind_transform_feedback "glBindTransformFeedback" (target: u32, feedback: u32);
                bind_vertex_array "glBindVertexArray" (array: u32);
                blend_color "glBlendColor" (red: f32, green: f32, blue: f32, alpha: f32);
                blend_equation_separate "glBlendEquationSeparate" (color: u32, alpha: u32);
                blend_func_separate "glBlendFuncSeparate" (source: u32, destination: u32, source_alpha: u32, destination_alpha: u32);
                check_framebuffer_status "glCheckFramebufferStatus" (target: u32) -> u32;
                clear "glClear" (mask: u32);
                clear_bufferfi "glClearBufferfi" (buffer: u32, index: i32, depth: f32, stencil: i32);
                clear_bufferfv "glClearBufferfv" (buffer: u32, index: i32, values: &[u32; 4]);
                clear_bufferiv "glClearBufferiv" (buffer: u32, index: i32, values: &[u32; 4]);
                clear_bufferuiv "glClearBufferuiv" (buffer: u32, index: i32, values: &[u32; 4]);
                clear_color "glClearColor" (red: f32, green: f32, blue: f32, alpha: f32);
                clear_depth "glClearDepthf" (depth: f32);
                clear_stencil "glClearStencil" (stencil: i32);
                color_mask "glColorMask" (red: bool, green: bool, blue: bool, alpha: bool);
                copy_buffer_sub_data "glCopyBufferSubData" (from: u32, to: u32, from_offset: usize, to_offset: usize, size: usize);
                cull_face "glCullFace" (mode: u32);
                delete_program "glDeleteProgram" (program: u32);
                depth_func "glDepthFunc" (function: u32);
                depth_mask "glDepthMask" (flag: bool);
                depth_range "glDepthRangef" (near: f32, far: f32);
                disable "glDisable" (capability: u32);
                disable_vertex_attrib_array "glDisableVertexAttribArray" (index: u32);
                enable "glEnable" (capability: u32);
                enable_vertex_attrib_array "glEnableVertexAttribArray" (index: u32);
                end_query "glEndQuery" (target: u32);
                end_transform_feedback "glEndTransformFeedback" ();
                fence_sync "glFenceSync" (condition: u32, flags: u32) -> Sync;
                flush "glFlush" ();
                framebuffer_renderbuffer "glFramebufferRenderbuffer" (target: u32, attachment: u32, kind: u32, renderbuffer: u32);
                framebuffer_texture_2d "glFramebufferTexture2D" (target: u32, attachment: u32, face: u32, texture: u32, level: i32);
                framebuffer_texture_layer "glFramebufferTextureLayer" (target: u32, attachment: u32, texture: u32, level: i32, layer: i32);
                front_face "glFrontFace" (mode: u32);
                generate_mipmap "glGenerateMipmap" (target: u32);
                get_error "glGetError" () -> u32;
                get_query_objectuiv "glGetQueryObjectuiv" (query: u32, name: u32, value: &mut u32);
                get_queryiv "glGetQueryiv" (target: u32, name: u32, value: &mut i32);
                hint "glHint" (target: u32, mode: u32);
                line_width "glLineWidth" (width: f32);
                pause_transform_feedback "glPauseTransformFeedback" ();
                pixel_storei "glPixelStorei" (name: u32, value: u32);
                polygon_offset "glPolygonOffset" (factor: f32, units: f32);
                read_buffer "glReadBuffer" (source: u32);
                renderbuffer_storage_multisample "glRenderbufferStorageMultisample" (target: u32, samples: u32, format: u32, width: u32, height: u32);
                resume_transform_feedback "glResumeTransformFeedback" ();
                sample_coverage "glSampleCoverage" (value: f32, inverts: bool);
                sampler_parameterf "glSamplerParameterf" (sampler: u32, name: u32, value: f32);
                sampler_parameteri "glSamplerParameteri" (sampler: u32, name: u32, value: u32);
                scissor "glScissor" (x: i32, y: i32, width: i32, height: i32);
                stencil_func_separate "glStencilFuncSeparate" (face: u32, function: u32, reference: i32, mask: u32);
                stencil_mask_separate "glStencilMaskSeparate" (face: u32, mask: u32);
                stencil_op_separate "glStencilOpSeparate" (face: u32, fail: u32, depth_fail: u32, pass: u32);
                tex_parameterf "glTexParameterf" (target: u32, name: u32, value: f32);
                tex_parameteri "glTexParameteri" (target: u32, name: u32, value: u32);
                tex_storage_2d "glTexStorage2D" (target: u32, levels: u32, format: u32, width: u32, height: u32);
                tex_storage_3d "glTexStorage3D" (target: u32, levels: u32, format: u32, width: u32, height: u32, depth: u32);
                uniform_block_binding "glUniformBlockBinding" (program: u32, index: u32, binding: u32);
                unmap_buffer "glUnmapBuffer" (target: u32) -> u8;
                use_program "glUseProgram" (program: u32);
                vertex_attrib_4fv "glVertexAttrib4fv" (index: u32, values: &[u32; 4]);
                vertex_attrib_divisor "glVertexAttribDivisor" (index: u32, divisor: u32);
                vertex_attrib_i4iv "glVertexAttribI4iv" (index: u32, values: &[u32; 4]);
                vertex_attrib_i4uiv "glVertexAttribI4uiv" (index: u32, values: &[u32; 4]);
                vertex_attrib_i_pointer "glVertexAttribIPointer" (index: u32, size: u32, kind: u32, stride: u32, offset: usize);
                vertex_attrib_pointer "glVertexAttribPointer" (index: u32, size: u32, kind: u32, is_normalized: bool, stride: u32, offset: usize);
                viewport "glViewport" (x: i32, y: i32, width: i32, height: i32);
            }
            optional {
                blend_equation_separatei "glBlendEquationSeparatei" "OES" (index: u32, color: u32, alpha: u32);
                blend_func_separatei "glBlendFuncSeparatei" "OES" (index: u32, source: u32, destination: u32, source_alpha: u32, destination_alpha: u32);
                clip_control "glClipControl" "EXT" (origin: u32, depth: u32);
                color_maski "glColorMaski" "OES" (index: u32, red: bool, green: bool, blue: bool, alpha: bool);
                disablei "glDisablei" "OES" (target: u32, index: u32);
                enablei "glEnablei" "OES" (target: u32, index: u32);
                get_graphics_reset_status "glGetGraphicsResetStatus" "EXT" () -> u32;
                get_query_objectui64v "glGetQueryObjectui64v" "EXT" (query: u32, name: u32, value: &mut u64);
                invalidate_framebuffer "glInvalidateFramebuffer" "" (target: u32, count: u32, points: &[u32; 10]);
                polygon_mode "glPolygonMode" "NV" (face: u32, mode: u32);
                polygon_offset_clamp "glPolygonOffsetClamp" "EXT" (factor: f32, units: f32, clamp: f32);
                provoking_vertex "glProvokingVertex" "EXT" (mode: u32);
                query_counter "glQueryCounter" "EXT" (query: u32, target: u32);
            }
            raw {
                buffer_data "glBufferData" (u32, usize, *const u8, u32);
                buffer_sub_data "glBufferSubData" (u32, usize, usize, *const u8);
                client_wait_sync "glClientWaitSync" (Sync, u32, u64) -> u32;
                blit_framebuffer "glBlitFramebuffer" (i32, i32, i32, i32, i32, i32, i32, i32, u32, u32);
                copy_tex_sub_image_2d "glCopyTexSubImage2D" (u32, u32, u32, u32, i32, i32, u32, u32);
                copy_tex_sub_image_3d "glCopyTexSubImage3D" (u32, u32, u32, u32, u32, i32, i32, u32, u32);
                compressed_tex_image_2d "glCompressedTexImage2D" (u32, u32, u32, u32, u32, u32, u32, *const u8);
                compressed_tex_image_3d "glCompressedTexImage3D" (u32, u32, u32, u32, u32, u32, u32, u32, *const u8);
                compressed_tex_sub_image_2d "glCompressedTexSubImage2D" (u32, u32, u32, u32, u32, u32, u32, u32, *const u8);
                compressed_tex_sub_image_3d "glCompressedTexSubImage3D" (u32, u32, u32, u32, u32, u32, u32, u32, u32, u32, *const u8);
                delete_sync "glDeleteSync" (Sync);
                draw_arrays_instanced "glDrawArraysInstanced" (u32, u32, u32, u32);
                draw_buffers "glDrawBuffers" (u32, *const u32);
                draw_elements_instanced "glDrawElementsInstanced" (u32, u32, u32, usize, u32);
                map_buffer_range "glMapBufferRange" (u32, usize, usize, u32) -> *const u8;
                read_pixels "glReadPixels" (i32, i32, u32, u32, u32, u32, *mut u8);
                tex_image_2d "glTexImage2D" (u32, u32, u32, u32, u32, u32, u32, u32, *const u8);
                tex_image_3d "glTexImage3D" (u32, u32, u32, u32, u32, u32, u32, u32, u32, *const u8);
                tex_sub_image_2d "glTexSubImage2D" (u32, u32, u32, u32, u32, u32, u32, u32, *const u8);
                tex_sub_image_3d "glTexSubImage3D" (u32, u32, u32, u32, u32, u32, u32, u32, u32, u32, *const u8);
            }
        }
    };
}

#[cfg(any(target_os = "macos", windows))]
mod metal;
mod opengl;

pub use opengl::{Functions, Gl, enter, gl};

pub type Sync = *mut c_void;

#[derive(Clone, Copy)]
pub enum Kind {
    Buffer,
    Framebuffer,
    Query,
    Renderbuffer,
    Sampler,
    Texture,
    TransformFeedback,
    VertexArray,
}

impl Functions {
    pub fn blit(
        &self,
        [x0, y0, x1, y1]: [i32; 4],
        [to_x0, to_y0, to_x1, to_y1]: [i32; 4],
        mask: u32,
        filter: u32,
    ) {
        // SAFETY: it only takes numbers.
        unsafe { (self.blit_framebuffer)(x0, y0, x1, y1, to_x0, to_y0, to_x1, to_y1, mask, filter) }
    }
}

/// The name of an object of the driver.
pub struct Name(pub u32, Kind);

impl Name {
    pub fn new(kind: Kind) -> Name {
        Name(gl().add(kind), kind)
    }
}

impl Drop for Name {
    fn drop(&mut self) {
        gl().remove(self.1, self.0);
    }
}

impl Gl {
    pub fn set(&self, capability: u32, is_enabled: bool) {
        if is_enabled {
            self.enable(capability)
        } else {
            self.disable(capability)
        }
    }

    pub fn integer(&self, name: u32) -> u32 {
        self.integers(name)[0] as u32
    }

    pub fn set_draw_buffers(&self, buffers: &[u32]) {
        // SAFETY: there are so many.
        unsafe { (self.draw_buffers)(buffers.len() as u32, buffers.as_ptr()) };
    }

    pub fn write_buffer(&self, target: u32, offset: usize, bytes: &[u8]) {
        // SAFETY: there are so many.
        unsafe { (self.buffer_sub_data)(target, offset, bytes.len(), bytes.as_ptr()) };
    }
}
