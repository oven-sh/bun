//! One command buffer ([`Frame`]) and the passes encoded into it.
//!
//! Metal requires `endEncoding` on every encoder before another is made on
//! the same command buffer and before the encoder is released. Each pass owns
//! its encoder through [`Ending`], whose `Drop` sends it, so that holds
//! whichever way a pass goes away: the closure returned, the closure failed,
//! the frame started another pass, committed, or was dropped mid-pass.

use core::ops::Deref;

use super::{
    Buffer, ComputePipeline, CullMode, DepthStencil, Gpu, IndexType, MAX_BUFFER_SLOTS,
    MAX_INLINE_BYTES, MAX_SAMPLER_SLOTS, MAX_TEXTURE_SLOTS, PrimitiveType, RenderPipeline, Sampler,
    Storage, Texture, TextureUsage, Winding, check_max, check_range, check_slot, format_name,
    ns_label,
};
use crate::error::{Error, Result};
use crate::geometry::{ClearColor, Range, ScissorRect, Size3, Viewport};
use crate::objc::metal::{
    CAMetalDrawable, LoadAction, MTLBlitCommandEncoder, MTLCommandBuffer, MTLCommandEncoder,
    MTLComputeCommandEncoder, MTLRenderCommandEncoder, MTLRenderPassDescriptor, StoreAction,
    command_buffer_status,
};
use crate::objc::{AutoreleasePool, NsStr};
use crate::view::MetalSurface;

/// Sends `endEncoding` when dropped.
struct Ending<E: Deref<Target = MTLCommandEncoder>>(E);

impl<E: Deref<Target = MTLCommandEncoder>> Drop for Ending<E> {
    fn drop(&mut self) {
        self.0.end_encoding();
    }
}

impl<E: Deref<Target = MTLCommandEncoder>> Deref for Ending<E> {
    type Target = E;
    fn deref(&self) -> &E {
        &self.0
    }
}

/// Where a render pass draws.
#[derive(Clone, Copy)]
pub enum PassTarget<'a> {
    /// A `MetalView`'s drawable, as [`crate::View::render_target`] gives it
    /// during a frame; the frame presents the drawable on commit.
    View(&'a MetalSurface),
    /// An offscreen texture created with render-target usage. `clear: None`
    /// keeps the texture's contents; likewise `clear_depth` for `depth`.
    Texture {
        color: &'a Texture,
        clear: Option<ClearColor>,
        depth: Option<&'a Texture>,
        clear_depth: Option<f64>,
    },
}

/// Where a [`Frame`] is in its life.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FrameState {
    /// No pass is being encoded; one may begin, or the frame may commit.
    Open,
    InRenderPass,
    InComputePass,
    InBlitPass,
    /// Handed to the GPU; nothing more can be encoded.
    Committed,
}

impl FrameState {
    pub const fn name(self) -> &'static str {
        match self {
            FrameState::Open => "open",
            FrameState::InRenderPass => "in a render pass",
            FrameState::InComputePass => "in a compute pass",
            FrameState::InBlitPass => "in a blit pass",
            FrameState::Committed => "committed",
        }
    }
}

enum Encoder {
    Render(RenderPass),
    Compute(ComputePass),
    Blit(BlitPass),
}

/// One `MTLCommandBuffer`. Passes are encoded either through the closure
/// methods ([`render_pass`](Frame::render_pass), …), which end the pass when
/// the closure returns, or through `begin_*` / [`end_pass`](Frame::end_pass)
/// for callers that encode across several calls; beginning a pass or
/// committing ends any pass still open.
pub struct Frame {
    current: Option<Encoder>,
    cb: MTLCommandBuffer,
    drawables: Vec<CAMetalDrawable>,
    committed: bool,
    max_threads_per_threadgroup: Size3,
}

impl Drop for Frame {
    fn drop(&mut self) {
        // The open encoder must end before the command buffer is released.
        self.current = None;
    }
}

impl Frame {
    pub(super) fn new(gpu: &Gpu) -> Result<Frame> {
        let _pool = AutoreleasePool::new();
        let cb = gpu
            .queue()
            .command_buffer()
            .ok_or_else(|| Error::GpuExecution {
                message: "the command queue has too many uncommitted command buffers".into(),
            })?;
        Ok(Frame {
            current: None,
            cb,
            drawables: Vec::new(),
            committed: false,
            max_threads_per_threadgroup: gpu.max_threads_per_threadgroup(),
        })
    }

    pub fn set_label(&self, label: NsStr<'_>) {
        self.cb.set_label(ns_label(label).as_ref());
    }

    pub fn state(&self) -> FrameState {
        if self.committed {
            return FrameState::Committed;
        }
        match self.current {
            None => FrameState::Open,
            Some(Encoder::Render(_)) => FrameState::InRenderPass,
            Some(Encoder::Compute(_)) => FrameState::InComputePass,
            Some(Encoder::Blit(_)) => FrameState::InBlitPass,
        }
    }

    pub fn is_committed(&self) -> bool {
        self.committed
    }

    fn wrong_state(&self, expected: &'static str) -> Error {
        Error::FrameState {
            expected,
            actual: self.state().name(),
        }
    }

    /// Ends any open pass; errors once committed.
    fn make_open(&mut self) -> Result<()> {
        if self.committed {
            return Err(self.wrong_state(FrameState::Open.name()));
        }
        self.current = None;
        Ok(())
    }

    // ── closure style ──

    /// Encodes one render pass: `f` runs with the encoder, which ends when `f`
    /// returns either way.
    pub fn render_pass<R>(
        &mut self,
        target: &PassTarget<'_>,
        f: impl FnOnce(&mut RenderPass) -> Result<R>,
    ) -> Result<R> {
        let out = f(self.begin_render_pass(target)?);
        self.current = None;
        out
    }

    pub fn compute_pass<R>(&mut self, f: impl FnOnce(&mut ComputePass) -> Result<R>) -> Result<R> {
        let out = f(self.begin_compute_pass()?);
        self.current = None;
        out
    }

    pub fn blit<R>(&mut self, f: impl FnOnce(&mut BlitPass) -> Result<R>) -> Result<R> {
        let out = f(self.begin_blit_pass()?);
        self.current = None;
        out
    }

    // ── begin / current / end style ──

    pub fn begin_render_pass(&mut self, target: &PassTarget<'_>) -> Result<&mut RenderPass> {
        self.make_open()?;
        let _pool = AutoreleasePool::new();
        let (pass, drawable) = RenderPass::begin(&self.cb, target)?;
        if let Some(drawable) = drawable {
            if !self.drawables.contains(&drawable) {
                self.drawables.push(drawable);
            }
        }
        self.current = Some(Encoder::Render(pass));
        self.current_render_pass()
    }

    pub fn begin_compute_pass(&mut self) -> Result<&mut ComputePass> {
        self.make_open()?;
        let _pool = AutoreleasePool::new();
        let enc = self
            .cb
            .compute_command_encoder()
            .ok_or_else(|| Error::GpuExecution {
                message: "could not start a compute pass".into(),
            })?;
        self.current = Some(Encoder::Compute(ComputePass {
            enc: Ending(enc),
            pipeline_max_threads: None,
            device_max: self.max_threads_per_threadgroup,
        }));
        self.current_compute_pass()
    }

    pub fn begin_blit_pass(&mut self) -> Result<&mut BlitPass> {
        self.make_open()?;
        let _pool = AutoreleasePool::new();
        let enc = self
            .cb
            .blit_command_encoder()
            .ok_or_else(|| Error::GpuExecution {
                message: "could not start a blit pass".into(),
            })?;
        self.current = Some(Encoder::Blit(BlitPass { enc: Ending(enc) }));
        self.current_blit_pass()
    }

    /// The open render pass, or `Error::FrameState`.
    pub fn current_render_pass(&mut self) -> Result<&mut RenderPass> {
        let wrong = self.wrong_state(FrameState::InRenderPass.name());
        match self.current {
            Some(Encoder::Render(ref mut pass)) if !self.committed => Ok(pass),
            _ => Err(wrong),
        }
    }

    pub fn current_compute_pass(&mut self) -> Result<&mut ComputePass> {
        let wrong = self.wrong_state(FrameState::InComputePass.name());
        match self.current {
            Some(Encoder::Compute(ref mut pass)) if !self.committed => Ok(pass),
            _ => Err(wrong),
        }
    }

    pub fn current_blit_pass(&mut self) -> Result<&mut BlitPass> {
        let wrong = self.wrong_state(FrameState::InBlitPass.name());
        match self.current {
            Some(Encoder::Blit(ref mut pass)) if !self.committed => Ok(pass),
            _ => Err(wrong),
        }
    }

    /// Ends the open pass; `Error::FrameState` if none is open.
    pub fn end_pass(&mut self) -> Result<()> {
        if self.committed || self.current.is_none() {
            return Err(self.wrong_state("in a pass"));
        }
        self.current = None;
        Ok(())
    }

    // ── submission ──

    /// Ends any open pass, schedules every view drawable a pass drew into for
    /// presentation, and hands the buffer to the GPU. Once only.
    pub fn commit(&mut self) -> Result<()> {
        self.make_open()?;
        let _pool = AutoreleasePool::new();
        for drawable in self.drawables.drain(..) {
            self.cb.present_drawable(&drawable);
        }
        self.cb.commit();
        self.committed = true;
        Ok(())
    }

    /// [`commit`](Frame::commit) (if not yet) and block until the GPU is done,
    /// so shared resources it wrote can be read. `Error::GpuExecution` carries
    /// Metal's reason if the buffer failed.
    pub fn commit_and_wait(&mut self) -> Result<()> {
        if !self.committed {
            self.commit()?;
        }
        let _pool = AutoreleasePool::new();
        self.cb.wait_until_completed();
        if self.cb.status() == command_buffer_status::ERROR {
            return Err(Error::GpuExecution {
                message: self.cb.error().map_or_else(
                    || "the command buffer failed without an error".into(),
                    |e| e.localized_description().to_string_lossy(),
                ),
            });
        }
        Ok(())
    }
}

// ───────────────────────────── render pass ──────────────────────────────────

/// A `MTLRenderCommandEncoder` plus what its draws are checked against: the
/// target's formats and size, and whether a pipeline is set.
pub struct RenderPass {
    enc: Ending<MTLRenderCommandEncoder>,
    width: usize,
    height: usize,
    /// Raw `MTLPixelFormat` of colour attachment 0 (`0` = none).
    color_format: usize,
    /// Raw `MTLPixelFormat` of the depth attachment (`0` = none).
    depth_format: usize,
    sample_count: usize,
    pipeline_set: bool,
}

fn inline_bytes_check(bytes: &[u8]) -> Result<()> {
    if bytes.is_empty() {
        return Err(Error::ZeroSize("inline bytes"));
    }
    if bytes.len() > MAX_INLINE_BYTES {
        return Err(Error::InlineBytesTooLarge(bytes.len()));
    }
    Ok(())
}

fn shader_texture_check(texture: &Texture) -> Result<()> {
    if texture.raw().is_framebuffer_only()
        || !(texture.usage().contains(TextureUsage::SHADER_READ)
            || texture.usage().contains(TextureUsage::SHADER_WRITE))
    {
        return Err(Error::Unsupported(
            "texture was created without shader read or write usage and cannot be bound to a shader",
        ));
    }
    Ok(())
}

impl RenderPass {
    fn begin(
        cb: &MTLCommandBuffer,
        target: &PassTarget<'_>,
    ) -> Result<(RenderPass, Option<CAMetalDrawable>)> {
        let (descriptor, drawable, width, height, color_format, depth_format, sample_count) =
            match *target {
                PassTarget::View(view) => {
                    let color = view
                        .descriptor
                        .color_attachments()
                        .object_at(0)
                        .texture()
                        .ok_or(Error::NoDrawable)?;
                    let depth = view.descriptor.depth_attachment().texture();
                    (
                        view.descriptor.clone(),
                        view.drawable.clone(),
                        color.width(),
                        color.height(),
                        color.pixel_format(),
                        depth.map_or(0, |d| d.pixel_format()),
                        color.sample_count().max(1),
                    )
                }
                PassTarget::Texture {
                    color,
                    clear,
                    depth,
                    clear_depth,
                } => {
                    if !color.usage().contains(TextureUsage::RENDER_TARGET) {
                        return Err(Error::Unsupported(
                            "color texture was created without render-target usage",
                        ));
                    }
                    if color.format().is_depth() {
                        return Err(Error::Unsupported(
                            "a depth-format texture cannot be a color target",
                        ));
                    }
                    let descriptor = MTLRenderPassDescriptor::render_pass_descriptor();
                    let ca = descriptor.color_attachments().object_at(0);
                    ca.set_texture(Some(color.raw()));
                    ca.set_store_action(StoreAction::Store);
                    match clear {
                        Some(c) => {
                            ca.set_load_action(LoadAction::Clear);
                            ca.set_clear_color(c);
                        }
                        None => ca.set_load_action(LoadAction::Load),
                    }
                    let mut depth_format = 0;
                    if let Some(depth) = depth {
                        if !depth.format().is_depth() {
                            return Err(Error::Unsupported(
                                "depth texture does not have a depth pixel format",
                            ));
                        }
                        if !depth.usage().contains(TextureUsage::RENDER_TARGET) {
                            return Err(Error::Unsupported(
                                "depth texture was created without render-target usage",
                            ));
                        }
                        if depth.width() != color.width() || depth.height() != color.height() {
                            return Err(Error::Unsupported(
                                "depth texture size differs from the color texture size",
                            ));
                        }
                        let da = descriptor.depth_attachment();
                        da.set_texture(Some(depth.raw()));
                        da.set_store_action(StoreAction::Store);
                        match clear_depth {
                            Some(d) => {
                                da.set_load_action(LoadAction::Clear);
                                da.set_clear_depth(d);
                            }
                            None => da.set_load_action(LoadAction::Load),
                        }
                        depth_format = depth.format() as usize;
                    }
                    (
                        descriptor,
                        None,
                        color.width(),
                        color.height(),
                        color.format() as usize,
                        depth_format,
                        1,
                    )
                }
            };
        let enc = cb
            .render_command_encoder(&descriptor)
            .ok_or_else(|| Error::GpuExecution {
                message: "could not start a render pass with this target".into(),
            })?;
        Ok((
            RenderPass {
                enc: Ending(enc),
                width,
                height,
                color_format,
                depth_format,
                sample_count,
                pipeline_set: false,
            },
            drawable,
        ))
    }

    /// Render target size in pixels.
    pub fn width(&self) -> usize {
        self.width
    }

    pub fn height(&self) -> usize {
        self.height
    }

    pub fn set_label(&self, label: NsStr<'_>) {
        self.enc.set_label(ns_label(label).as_ref());
    }

    pub fn push_debug_group(&self, name: NsStr<'_>) {
        if let Some(name) = ns_label(name) {
            self.enc.push_debug_group(&name);
        }
    }

    pub fn pop_debug_group(&self) {
        self.enc.pop_debug_group();
    }

    /// `Error::Pipeline` if the pipeline was built for other attachment
    /// formats or another sample count than this pass has.
    pub fn set_pipeline(&mut self, pipeline: &RenderPipeline) -> Result<()> {
        let mismatch = |message: String| Err(Error::Pipeline { message });
        let wanted_color = pipeline.color_formats();
        if wanted_color.len() > 1 {
            return mismatch(format!(
                "pipeline has {} color attachments but the pass has 1",
                wanted_color.len()
            ));
        }
        let wanted = wanted_color.first().map_or(0, |f| *f as usize);
        if wanted != self.color_format {
            return mismatch(format!(
                "pipeline color format {} does not match the render target's {}",
                format_name(wanted),
                format_name(self.color_format)
            ));
        }
        let wanted_depth = pipeline.depth_format().map_or(0, |f| f as usize);
        if wanted_depth != self.depth_format {
            return mismatch(format!(
                "pipeline depth format {} does not match the render target's {}",
                format_name(wanted_depth),
                format_name(self.depth_format)
            ));
        }
        if pipeline.sample_count() != self.sample_count {
            return mismatch(format!(
                "pipeline sample count {} does not match the render target's {}",
                pipeline.sample_count(),
                self.sample_count
            ));
        }
        self.enc.set_render_pipeline_state(pipeline.raw());
        self.pipeline_set = true;
        Ok(())
    }

    pub fn set_vertex_buffer(
        &mut self,
        index: usize,
        buffer: &Buffer,
        offset: usize,
    ) -> Result<()> {
        check_slot("vertex buffer index", index, MAX_BUFFER_SLOTS)?;
        buffer.check_range("vertex buffer offset", offset, 0)?;
        self.enc
            .set_vertex_buffer(Some(buffer.raw()), offset, index);
        Ok(())
    }

    /// Up to 4096 bytes copied into the command stream; for more use a buffer.
    pub fn set_vertex_bytes(&mut self, index: usize, bytes: &[u8]) -> Result<()> {
        check_slot("vertex buffer index", index, MAX_BUFFER_SLOTS)?;
        inline_bytes_check(bytes)?;
        self.enc.set_vertex_bytes(index, bytes);
        Ok(())
    }

    pub fn set_vertex_texture(&mut self, index: usize, texture: &Texture) -> Result<()> {
        check_slot("vertex texture index", index, MAX_TEXTURE_SLOTS)?;
        shader_texture_check(texture)?;
        self.enc.set_vertex_texture(Some(texture.raw()), index);
        Ok(())
    }

    pub fn set_vertex_sampler(&mut self, index: usize, sampler: &Sampler) -> Result<()> {
        check_slot("vertex sampler index", index, MAX_SAMPLER_SLOTS)?;
        self.enc
            .set_vertex_sampler_state(Some(sampler.raw()), index);
        Ok(())
    }

    pub fn set_fragment_buffer(
        &mut self,
        index: usize,
        buffer: &Buffer,
        offset: usize,
    ) -> Result<()> {
        check_slot("fragment buffer index", index, MAX_BUFFER_SLOTS)?;
        buffer.check_range("fragment buffer offset", offset, 0)?;
        self.enc
            .set_fragment_buffer(Some(buffer.raw()), offset, index);
        Ok(())
    }

    pub fn set_fragment_bytes(&mut self, index: usize, bytes: &[u8]) -> Result<()> {
        check_slot("fragment buffer index", index, MAX_BUFFER_SLOTS)?;
        inline_bytes_check(bytes)?;
        self.enc.set_fragment_bytes(index, bytes);
        Ok(())
    }

    pub fn set_fragment_texture(&mut self, index: usize, texture: &Texture) -> Result<()> {
        check_slot("fragment texture index", index, MAX_TEXTURE_SLOTS)?;
        shader_texture_check(texture)?;
        self.enc.set_fragment_texture(Some(texture.raw()), index);
        Ok(())
    }

    pub fn set_fragment_sampler(&mut self, index: usize, sampler: &Sampler) -> Result<()> {
        check_slot("fragment sampler index", index, MAX_SAMPLER_SLOTS)?;
        self.enc
            .set_fragment_sampler_state(Some(sampler.raw()), index);
        Ok(())
    }

    /// `Error::Unsupported` when the pass has no depth attachment.
    pub fn set_depth_stencil(&mut self, state: &DepthStencil) -> Result<()> {
        if self.depth_format == 0 {
            return Err(Error::Unsupported(
                "the render pass has no depth attachment",
            ));
        }
        self.enc.set_depth_stencil_state(Some(state.raw()));
        Ok(())
    }

    pub fn set_cull(&mut self, mode: CullMode) {
        self.enc.set_cull_mode(mode);
    }

    pub fn set_winding(&mut self, winding: Winding) {
        self.enc.set_front_facing_winding(winding);
    }

    pub fn set_viewport(&mut self, viewport: Viewport) {
        self.enc.set_viewport(viewport);
    }

    /// Must lie inside the render target.
    pub fn set_scissor(&mut self, rect: ScissorRect) -> Result<()> {
        check_range("scissor rect x", self.width, rect.x, rect.w)?;
        check_range("scissor rect y", self.height, rect.y, rect.h)?;
        self.enc.set_scissor_rect(rect);
        Ok(())
    }

    fn need_pipeline(&self) -> Result<()> {
        if self.pipeline_set {
            Ok(())
        } else {
            Err(Error::NoPipeline)
        }
    }

    /// `count` vertices from `start`, `instances` times. Zero counts draw nothing.
    pub fn draw(
        &mut self,
        primitive: PrimitiveType,
        start: usize,
        count: usize,
        instances: usize,
    ) -> Result<()> {
        self.need_pipeline()?;
        if count == 0 || instances == 0 {
            return Ok(());
        }
        if instances == 1 {
            self.enc.draw_primitives(primitive, start, count);
        } else {
            self.enc
                .draw_primitives_instanced(primitive, start, count, instances);
        }
        Ok(())
    }

    /// `index_count` indexes of `index_type` read from `indexes` at byte `offset`.
    pub fn draw_indexed(
        &mut self,
        primitive: PrimitiveType,
        index_count: usize,
        index_type: IndexType,
        indexes: &Buffer,
        offset: usize,
        instances: usize,
    ) -> Result<()> {
        self.need_pipeline()?;
        if !offset.is_multiple_of(index_type.bytes()) {
            return Err(Error::Unsupported(
                "index buffer offset must be a multiple of the index size",
            ));
        }
        let size = index_count.saturating_mul(index_type.bytes());
        indexes.check_range("index buffer read", offset, size)?;
        if index_count == 0 || instances == 0 {
            return Ok(());
        }
        if instances == 1 {
            self.enc.draw_indexed_primitives(
                primitive,
                index_count,
                index_type,
                indexes.raw(),
                offset,
            );
        } else {
            self.enc.draw_indexed_primitives_instanced(
                primitive,
                index_count,
                index_type,
                indexes.raw(),
                offset,
                instances,
            );
        }
        Ok(())
    }
}

// ───────────────────────────── compute pass ─────────────────────────────────

/// A `MTLComputeCommandEncoder`.
pub struct ComputePass {
    enc: Ending<MTLComputeCommandEncoder>,
    /// `maxTotalThreadsPerThreadgroup` of the pipeline set, if any.
    pipeline_max_threads: Option<usize>,
    device_max: Size3,
}

impl ComputePass {
    pub fn set_label(&self, label: NsStr<'_>) {
        self.enc.set_label(ns_label(label).as_ref());
    }

    pub fn push_debug_group(&self, name: NsStr<'_>) {
        if let Some(name) = ns_label(name) {
            self.enc.push_debug_group(&name);
        }
    }

    pub fn pop_debug_group(&self) {
        self.enc.pop_debug_group();
    }

    pub fn set_pipeline(&mut self, pipeline: &ComputePipeline) {
        self.enc.set_compute_pipeline_state(pipeline.raw());
        self.pipeline_max_threads = Some(pipeline.max_threads_per_threadgroup());
    }

    pub fn set_buffer(&mut self, index: usize, buffer: &Buffer, offset: usize) -> Result<()> {
        check_slot("compute buffer index", index, MAX_BUFFER_SLOTS)?;
        buffer.check_range("compute buffer offset", offset, 0)?;
        self.enc.set_buffer(Some(buffer.raw()), offset, index);
        Ok(())
    }

    pub fn set_bytes(&mut self, index: usize, bytes: &[u8]) -> Result<()> {
        check_slot("compute buffer index", index, MAX_BUFFER_SLOTS)?;
        inline_bytes_check(bytes)?;
        self.enc.set_bytes(index, bytes);
        Ok(())
    }

    pub fn set_texture(&mut self, index: usize, texture: &Texture) -> Result<()> {
        check_slot("compute texture index", index, MAX_TEXTURE_SLOTS)?;
        shader_texture_check(texture)?;
        self.enc.set_texture(Some(texture.raw()), index);
        Ok(())
    }

    pub fn set_sampler(&mut self, index: usize, sampler: &Sampler) -> Result<()> {
        check_slot("compute sampler index", index, MAX_SAMPLER_SLOTS)?;
        self.enc.set_sampler_state(Some(sampler.raw()), index);
        Ok(())
    }

    fn check_group(&self, group: Size3) -> Result<()> {
        let max = self.pipeline_max_threads.ok_or(Error::NoPipeline)?;
        if group.w == 0 || group.h == 0 || group.d == 0 {
            return Err(Error::ZeroSize("threads per threadgroup"));
        }
        check_max("threadgroup width", group.w, self.device_max.w)?;
        check_max("threadgroup height", group.h, self.device_max.h)?;
        check_max("threadgroup depth", group.d, self.device_max.d)?;
        let total = group
            .w
            .checked_mul(group.h)
            .and_then(|t| t.checked_mul(group.d))
            .unwrap_or(usize::MAX);
        check_max("threads per threadgroup", total, max)
    }

    /// `grid` threads in total, split into threadgroups of `group` (the grid
    /// need not be a multiple). A zero-sized grid dispatches nothing.
    pub fn dispatch_threads(&mut self, grid: Size3, group: Size3) -> Result<()> {
        self.check_group(group)?;
        if grid.w == 0 || grid.h == 0 || grid.d == 0 {
            return Ok(());
        }
        self.enc.dispatch_threads(grid, group);
        Ok(())
    }

    /// `groups` threadgroups of `group` threads each.
    pub fn dispatch_threadgroups(&mut self, groups: Size3, group: Size3) -> Result<()> {
        self.check_group(group)?;
        if groups.w == 0 || groups.h == 0 || groups.d == 0 {
            return Ok(());
        }
        self.enc.dispatch_threadgroups(groups, group);
        Ok(())
    }
}

// ────────────────────────────── blit pass ───────────────────────────────────

/// A `MTLBlitCommandEncoder`.
pub struct BlitPass {
    enc: Ending<MTLBlitCommandEncoder>,
}

impl BlitPass {
    pub fn set_label(&self, label: NsStr<'_>) {
        self.enc.set_label(ns_label(label).as_ref());
    }

    /// `size` bytes from `source` at `source_offset` to `destination` at `destination_offset`.
    pub fn copy_buffer(
        &mut self,
        source: &Buffer,
        source_offset: usize,
        destination: &Buffer,
        destination_offset: usize,
        size: usize,
    ) -> Result<()> {
        source.check_range("blit source", source_offset, size)?;
        destination.check_range("blit destination", destination_offset, size)?;
        if size == 0 {
            return Ok(());
        }
        self.enc.copy_from_buffer(
            source.raw(),
            source_offset,
            destination.raw(),
            destination_offset,
            size,
        );
        Ok(())
    }

    /// Whole-texture copy; sizes and formats must match.
    pub fn copy_texture(&mut self, source: &Texture, destination: &Texture) -> Result<()> {
        if source.width() != destination.width()
            || source.height() != destination.height()
            || source.format() != destination.format()
        {
            return Err(Error::Unsupported(
                "texture copy needs textures of the same size and pixel format",
            ));
        }
        if source.raw().is_framebuffer_only() || destination.raw().is_framebuffer_only() {
            return Err(Error::TextureNotReadable);
        }
        self.enc.copy_from_texture(source.raw(), destination.raw());
        Ok(())
    }

    /// Sets `size` bytes at `offset` to `value`.
    pub fn fill_buffer(
        &mut self,
        buffer: &Buffer,
        offset: usize,
        size: usize,
        value: u8,
    ) -> Result<()> {
        buffer.check_range("blit fill", offset, size)?;
        if size == 0 {
            return Ok(());
        }
        self.enc.fill_buffer(
            buffer.raw(),
            Range {
                location: offset,
                length: size,
            },
            value,
        );
        Ok(())
    }

    /// Fills the smaller levels from level 0. The texture must have been created `mipmapped`.
    pub fn generate_mipmaps(&mut self, texture: &Texture) -> Result<()> {
        if texture.mip_levels() < 2 {
            return Err(Error::Unsupported(
                "texture was created without mipmaps; pass mipmapped when creating it",
            ));
        }
        self.enc.generate_mipmaps(texture.raw());
        Ok(())
    }

    /// Makes the GPU's writes to a managed buffer visible to [`Buffer::read`]
    /// once the frame completes. Nothing to do for other storage modes.
    pub fn synchronize_buffer(&mut self, buffer: &Buffer) {
        if buffer.storage() == Storage::Managed {
            self.enc.synchronize_resource(buffer.raw());
        }
    }

    pub fn synchronize_texture(&mut self, texture: &Texture) {
        if texture.storage() == Storage::Managed {
            self.enc.synchronize_resource(texture.raw());
        }
    }
}
