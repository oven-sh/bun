//! One command buffer ([`Frame`]) and the passes encoded into it.
//!
//! Metal requires `endEncoding` on every encoder before another is made on
//! the same command buffer and before the encoder is released. Each pass owns
//! its encoder through [`Ending`], whose `Drop` sends it, so that holds
//! whichever way a pass goes away: the closure returned, the closure failed,
//! the frame started another pass, committed, or was dropped mid-pass.

use core::ops::Deref;
use std::rc::Rc;

use super::{
    BUFFER_OFFSET_ALIGNMENT, Buffer, ComputePipeline, CullMode, DepthStencil, Gpu, IndexType,
    LastUse, Ledger, MAX_BUFFER_SLOTS, MAX_INLINE_BYTES, MAX_SAMPLER_SLOTS, MAX_TEXTURE_SLOTS,
    PrimitiveType, RenderPipeline, Sampler, Storage, Texture, TextureUsage, Winding, check_max,
    check_range, check_slot, command_buffer_error, format_name, ns_label,
};
use crate::error::{Error, Result};
use crate::geometry::{ClearColor, Range, ScissorRect, Size3, Viewport};
use crate::objc::metal::{
    CAMetalDrawable, LoadAction, MTLBlitCommandEncoder, MTLCommandBuffer, MTLCommandEncoder,
    MTLComputeCommandEncoder, MTLRenderCommandEncoder, MTLRenderPassDescriptor, MTLTexture,
    StoreAction, command_buffer_status,
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

/// What a render pass does with an attachment's existing contents.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Load<T> {
    /// Keep them (`MTLLoadActionLoad`).
    Keep,
    /// Replace them with this value first (`MTLLoadActionClear`).
    Clear(T),
}

/// Where a render pass draws.
#[derive(Clone, Copy)]
pub enum PassTarget<'a> {
    /// A `MetalView`'s drawable, as [`crate::View::render_target`] gives it
    /// during a frame; the frame presents the drawable on commit. `None`
    /// clears to the view's own colour (depth 1.0) on the first pass into
    /// the view this frame and keeps what earlier passes drew after that.
    /// The view's depth texture is attached when the surface has one.
    View {
        surface: &'a MetalSurface,
        clear: Option<Load<ClearColor>>,
        clear_depth: Option<Load<f64>>,
    },
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

/// How far the GPU has got with a committed [`Frame`].
#[derive(Debug)]
pub enum GpuStatus {
    NotCommitted,
    /// Committed and not finished yet.
    Running,
    Completed,
    /// The GPU gave up on the command buffer; the error is `Error::GpuExecution`.
    Failed(Error),
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
    /// Colour textures of the view surfaces drawn into so far, so a second
    /// pass into the same view loads instead of clearing.
    view_targets: Vec<MTLTexture>,
    /// Every buffer and texture a pass referenced; stamped with `cb` on commit.
    uses: Vec<Rc<LastUse>>,
    committed: bool,
    max_threads_per_threadgroup: Size3,
    ledger: Rc<Ledger>,
}

impl Drop for Frame {
    fn drop(&mut self) {
        // The open encoder must end before the command buffer is released.
        self.current = None;
        if !self.committed {
            self.ledger.frame_closed();
        }
    }
}

impl Frame {
    pub(super) fn new(gpu: &Gpu) -> Result<Frame> {
        gpu.ledger().frame_opened()?;
        let _pool = AutoreleasePool::new();
        let Some(cb) = gpu.queue().command_buffer() else {
            gpu.ledger().frame_closed();
            return Err(Error::GpuExecution {
                message: "the command queue could not make a command buffer".into(),
            });
        };
        Ok(Frame {
            current: None,
            cb,
            drawables: Vec::new(),
            view_targets: Vec::new(),
            uses: Vec::new(),
            committed: false,
            max_threads_per_threadgroup: gpu.max_threads_per_threadgroup(),
            ledger: Rc::clone(gpu.ledger()),
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

    /// Non-blocking.
    pub fn gpu_status(&self) -> GpuStatus {
        if !self.committed {
            return GpuStatus::NotCommitted;
        }
        let _pool = AutoreleasePool::new();
        match self.cb.status() {
            command_buffer_status::COMPLETED => GpuStatus::Completed,
            command_buffer_status::ERROR => GpuStatus::Failed(command_buffer_error(&self.cb)),
            _ => GpuStatus::Running,
        }
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
        if let Some(encoder) = self.current.take() {
            let mut uses = match encoder {
                Encoder::Render(pass) => pass.uses,
                Encoder::Compute(pass) => pass.uses,
                Encoder::Blit(pass) => pass.uses,
            };
            self.uses.append(&mut uses);
        }
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
        self.make_open()?;
        out
    }

    pub fn compute_pass<R>(&mut self, f: impl FnOnce(&mut ComputePass) -> Result<R>) -> Result<R> {
        let out = f(self.begin_compute_pass()?);
        self.make_open()?;
        out
    }

    pub fn blit<R>(&mut self, f: impl FnOnce(&mut BlitPass) -> Result<R>) -> Result<R> {
        let out = f(self.begin_blit_pass()?);
        self.make_open()?;
        out
    }

    // ── begin / current / end style ──

    pub fn begin_render_pass(&mut self, target: &PassTarget<'_>) -> Result<&mut RenderPass> {
        self.make_open()?;
        let _pool = AutoreleasePool::new();
        let first_pass = match *target {
            PassTarget::View { surface, .. } => !self.view_targets.contains(&surface.color),
            PassTarget::Texture { .. } => true,
        };
        let pass = RenderPass::begin(&self.cb, target, first_pass)?;
        match *target {
            PassTarget::View { surface, .. } => {
                if first_pass {
                    self.view_targets.push(surface.color.clone());
                }
                if let Some(drawable) = &surface.drawable {
                    if !self.drawables.contains(drawable) {
                        self.drawables.push(drawable.clone());
                    }
                }
            }
            PassTarget::Texture { color, depth, .. } => {
                self.uses.push(color.last_use());
                if let Some(depth) = depth {
                    self.uses.push(depth.last_use());
                }
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
            uses: Vec::new(),
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
        self.current = Some(Encoder::Blit(BlitPass {
            enc: Ending(enc),
            uses: Vec::new(),
        }));
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
        self.make_open()
    }

    // ── submission ──

    fn submit(&mut self) -> Result<()> {
        self.make_open()?;
        let _pool = AutoreleasePool::new();
        for drawable in self.drawables.drain(..) {
            self.cb.present_drawable(&drawable);
        }
        self.cb.commit();
        self.committed = true;
        self.ledger.frame_closed();
        for used in self.uses.drain(..) {
            used.stamp(&self.cb);
        }
        self.view_targets.clear();
        Ok(())
    }

    /// Ends any open pass, schedules every view drawable a pass drew into for
    /// presentation, and hands the buffer to the GPU. Once only. A failure
    /// on the GPU later shows up in [`gpu_status`](Frame::gpu_status).
    pub fn commit(&mut self) -> Result<()> {
        self.submit()
    }

    /// After [`commit`](Frame::commit): also report a GPU failure of this
    /// buffer through [`Gpu::take_errors`], for frames nobody keeps to ask.
    /// [`unwatch`](Frame::unwatch) takes it back once the outcome was read.
    pub fn watch(&self) {
        if self.committed {
            self.ledger.committed(&self.cb);
        }
    }

    pub fn unwatch(&self) {
        self.ledger.forget(&self.cb);
    }

    /// [`commit`](Frame::commit) (if not yet) and block until the GPU is done,
    /// so shared resources it wrote can be read. `Error::GpuExecution` carries
    /// Metal's reason if the buffer failed.
    pub fn commit_and_wait(&mut self) -> Result<()> {
        if self.committed {
            self.ledger.forget(&self.cb);
        } else {
            self.submit()?;
        }
        let _pool = AutoreleasePool::new();
        self.cb.wait_until_completed();
        match self.gpu_status() {
            GpuStatus::Failed(err) => Err(err),
            _ => Ok(()),
        }
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
    /// Raw `MTLPixelFormat` of the depth attachment (`0` = none). The stencil
    /// attachment is the same texture whenever this format has stencil bits.
    depth_format: usize,
    sample_count: usize,
    pipeline_set: bool,
    uses: Vec<Rc<LastUse>>,
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

/// The last of a pass's `uses`, so binding one buffer for many draws does not grow the list.
fn note_use(uses: &mut Vec<Rc<LastUse>>, used: Rc<LastUse>) {
    if !uses.last().is_some_and(|last| Rc::ptr_eq(last, &used)) {
        uses.push(used);
    }
}

impl RenderPass {
    fn begin(
        cb: &MTLCommandBuffer,
        target: &PassTarget<'_>,
        first_pass: bool,
    ) -> Result<RenderPass> {
        let (descriptor, width, height, color_format, depth_format, sample_count) = match *target {
            PassTarget::View {
                surface,
                clear,
                clear_depth,
            } => {
                let descriptor = &surface.descriptor;
                let ca = descriptor.color_attachments().object_at(0);
                match clear {
                    Some(Load::Clear(color)) => {
                        ca.set_load_action(LoadAction::Clear);
                        ca.set_clear_color(color);
                    }
                    Some(Load::Keep) => ca.set_load_action(LoadAction::Load),
                    None if first_pass => {}
                    None => ca.set_load_action(LoadAction::Load),
                }
                let mut depth_format = 0;
                if let Some(depth) = &surface.depth {
                    depth_format = depth.pixel_format();
                    let da = descriptor.depth_attachment();
                    let load = match clear_depth {
                        Some(Load::Clear(value)) => {
                            da.set_clear_depth(value);
                            LoadAction::Clear
                        }
                        Some(Load::Keep) => LoadAction::Load,
                        None if first_pass => LoadAction::Clear,
                        None => LoadAction::Load,
                    };
                    da.set_load_action(load);
                    da.set_store_action(StoreAction::Store);
                    if descriptor.stencil_attachment().texture().is_some() {
                        let sa = descriptor.stencil_attachment();
                        sa.set_load_action(load);
                        sa.set_store_action(StoreAction::Store);
                    }
                }
                (
                    descriptor.clone(),
                    surface.color.width(),
                    surface.color.height(),
                    surface.color.pixel_format(),
                    depth_format,
                    surface.color.sample_count().max(1),
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
                    let load = match clear_depth {
                        Some(_) => LoadAction::Clear,
                        None => LoadAction::Load,
                    };
                    let da = descriptor.depth_attachment();
                    da.set_texture(Some(depth.raw()));
                    da.set_store_action(StoreAction::Store);
                    da.set_load_action(load);
                    if let Some(d) = clear_depth {
                        da.set_clear_depth(d);
                    }
                    if depth.format().has_stencil() {
                        let sa = descriptor.stencil_attachment();
                        sa.set_texture(Some(depth.raw()));
                        sa.set_store_action(StoreAction::Store);
                        sa.set_load_action(load);
                        sa.set_clear_stencil(0);
                    }
                    depth_format = depth.format() as usize;
                }
                (
                    descriptor,
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
        Ok(RenderPass {
            enc: Ending(enc),
            width,
            height,
            color_format,
            depth_format,
            sample_count,
            pipeline_set: false,
            uses: Vec::new(),
        })
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
        // The stencil attachment follows the depth one on both sides, so
        // this comparison covers it.
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
        buffer.check_bind_offset("vertex buffer offset", offset)?;
        self.enc
            .set_vertex_buffer(Some(buffer.raw()), offset, index);
        note_use(&mut self.uses, buffer.last_use());
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
        note_use(&mut self.uses, texture.last_use());
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
        buffer.check_bind_offset("fragment buffer offset", offset)?;
        self.enc
            .set_fragment_buffer(Some(buffer.raw()), offset, index);
        note_use(&mut self.uses, buffer.last_use());
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
        note_use(&mut self.uses, texture.last_use());
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
                "the render pass has no depth attachment; give the pass a depth texture (or depthFormat for a view) first",
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
        if !offset.is_multiple_of(BUFFER_OFFSET_ALIGNMENT.max(index_type.bytes())) {
            return Err(Error::Unsupported(
                "index buffer offset must be a multiple of 4 and of the index size",
            ));
        }
        let size = index_count.saturating_mul(index_type.bytes());
        indexes.check_range("index buffer read", offset, size)?;
        if index_count == 0 || instances == 0 {
            return Ok(());
        }
        note_use(&mut self.uses, indexes.last_use());
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
    uses: Vec<Rc<LastUse>>,
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
        buffer.check_bind_offset("compute buffer offset", offset)?;
        self.enc.set_buffer(Some(buffer.raw()), offset, index);
        note_use(&mut self.uses, buffer.last_use());
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
        note_use(&mut self.uses, texture.last_use());
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
    uses: Vec<Rc<LastUse>>,
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
        note_use(&mut self.uses, source.last_use());
        note_use(&mut self.uses, destination.last_use());
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
        note_use(&mut self.uses, source.last_use());
        note_use(&mut self.uses, destination.last_use());
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
        note_use(&mut self.uses, buffer.last_use());
        Ok(())
    }

    /// Fills the smaller levels from level 0. The texture must have been
    /// created `mipmapped` with a filterable colour format.
    pub fn generate_mipmaps(&mut self, texture: &Texture) -> Result<()> {
        if texture.mip_levels() < 2 {
            return Err(Error::Unsupported(
                "texture was created without mipmaps; pass mipmapped when creating it",
            ));
        }
        if !texture.format().is_filterable_color() {
            return Err(Error::Unsupported(
                "mipmaps can only be generated for filterable color formats, not integer or depth ones",
            ));
        }
        self.enc.generate_mipmaps(texture.raw());
        note_use(&mut self.uses, texture.last_use());
        Ok(())
    }

    /// Makes the GPU's writes to a managed buffer visible to the CPU once the
    /// frame completes. [`Buffer::read`] does this for itself; nothing to do
    /// for other storage modes.
    pub fn synchronize_buffer(&mut self, buffer: &Buffer) {
        if buffer.storage() == Storage::Managed {
            self.enc.synchronize_resource(buffer.raw());
            note_use(&mut self.uses, buffer.last_use());
        }
    }

    pub fn synchronize_texture(&mut self, texture: &Texture) {
        if texture.storage() == Storage::Managed {
            self.enc.synchronize_resource(texture.raw());
            note_use(&mut self.uses, texture.last_use());
        }
    }
}
