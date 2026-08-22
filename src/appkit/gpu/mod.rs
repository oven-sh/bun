//! Metal behind a typed, bounds-checked API: one device and its command
//! queue ([`Gpu`]), buffers and textures, shader libraries and pipelines,
//! and one command buffer per [`Frame`]. Every check Metal would otherwise
//! answer with an assertion (an index past a bind-slot limit, a byte range
//! outside a buffer, a draw with no pipeline) is made here first and comes
//! back as an [`Error`].

use std::cell::{Cell, OnceCell, RefCell};
use std::rc::Rc;

use crate::Named;
use crate::error::{Error, Result};
use crate::named_enum;
use crate::objc::foundation::NSString;
use crate::objc::metal::{
    MTLCommandBuffer, MTLCommandQueue, MTLDevice, ResourceOptions, StorageMode,
    command_buffer_status, gpu_family,
};
use crate::objc::{self, AutoreleasePool, NsStr};

mod frame;
mod pipeline;
mod resources;

pub use crate::geometry::{ClearColor, Origin3, Region, ScissorRect, Size3, Viewport};
pub use crate::objc::metal::{
    BlendFactor, BlendOperation, ColorWriteMask, CompareFunction, CullMode, FunctionType,
    IndexType, PixelFormat, PrimitiveType, SamplerAddressMode, SamplerMinMagFilter,
    SamplerMipFilter, TextureUsage, VertexFormat, VertexStepFunction, Winding,
};
pub use frame::{
    BlitPass, ComputePass, Frame, FrameState, GpuStatus, Load, PassTarget, RenderPass,
};
pub use pipeline::{
    Blend, ComputePipeline, Function, Library, RenderPipeline, RenderPipelineDesc, VertexAttribute,
    VertexBufferLayout, VertexLayout,
};
pub use resources::{Buffer, DepthStencil, Sampler, SamplerDesc, Texture, TextureDesc};

named_enum! {
    /// Where a buffer or texture lives (`MTLStorageMode` without `memoryless`).
    pub enum Storage {
        /// One allocation the CPU and GPU both address; coherent at command buffer boundaries.
        Shared = "shared",
        /// A CPU copy and a GPU copy; [`Buffer::read`] and [`Texture::read_pixels`]
        /// pull the GPU's writes across before reading (non-Apple GPUs).
        Managed = "managed",
        /// GPU memory the CPU never touches.
        Private = "private",
    }
}

impl Storage {
    pub(crate) const fn mode(self) -> StorageMode {
        match self {
            Storage::Shared => StorageMode::Shared,
            Storage::Managed => StorageMode::Managed,
            Storage::Private => StorageMode::Private,
        }
    }

    pub(crate) fn options(self) -> ResourceOptions {
        ResourceOptions::from(self.mode())
    }

    /// Whether the CPU can read and write the contents directly.
    pub const fn cpu_accessible(self) -> bool {
        !matches!(self, Storage::Private)
    }
}

/// The largest width or height a 2D texture may have on any Mac GPU
/// (`MTLGPUFamilyMac2` and every Apple family that runs macOS).
pub const MAX_TEXTURE_SIZE: usize = 16384;
/// Buffer bind slots per shader stage (`setVertexBuffer:offset:atIndex:` index limit).
pub const MAX_BUFFER_SLOTS: usize = 31;
/// Texture bind slots per shader stage.
pub const MAX_TEXTURE_SLOTS: usize = 128;
/// Sampler bind slots per shader stage.
pub const MAX_SAMPLER_SLOTS: usize = 16;
/// Colour attachments per render pass.
pub const MAX_COLOR_ATTACHMENTS: usize = 8;
/// The most a `set…Bytes` call copies inline.
pub const MAX_INLINE_BYTES: usize = crate::objc::metal::MAX_INLINE_BYTES;
/// Frames that may be open (created, not yet committed or dropped) at once.
/// `-[MTLCommandQueue commandBuffer]` blocks the thread for good once 64 are
/// outstanding, so [`Gpu::frame`] refuses well before that.
pub const MAX_OPEN_FRAMES: usize = 32;
/// Buffer bind offsets (`set…Buffer:offset:`) must be multiples of this.
pub const BUFFER_OFFSET_ALIGNMENT: usize = 4;

pub(crate) fn check_slot(what: &'static str, index: usize, limit: usize) -> Result<()> {
    if index < limit {
        Ok(())
    } else {
        Err(Error::IndexOutOfRange { what, index, limit })
    }
}

pub(crate) fn check_max(what: &'static str, value: usize, max: usize) -> Result<()> {
    if value <= max {
        Ok(())
    } else {
        Err(Error::IndexOutOfRange {
            what,
            index: value,
            limit: max,
        })
    }
}

pub(crate) fn check_range(
    what: &'static str,
    len: usize,
    offset: usize,
    size: usize,
) -> Result<()> {
    match offset.checked_add(size) {
        Some(end) if end <= len => Ok(()),
        _ => Err(Error::OutOfBounds {
            what,
            len,
            offset,
            size,
        }),
    }
}

pub(crate) fn format_name(raw: usize) -> String {
    PixelFormat::from_raw(raw)
        .map_or_else(|| format!("MTLPixelFormat({raw})"), |f| f.name().to_owned())
}

/// The last committed command buffer that used a buffer or texture, kept
/// so CPU reads and writes can wait for the GPU to be done with it. Frames
/// collect the cells of everything they bind and stamp them on commit.
#[derive(Default)]
pub(crate) struct LastUse(RefCell<Option<MTLCommandBuffer>>);

impl LastUse {
    pub(crate) fn new() -> Rc<LastUse> {
        Rc::new(LastUse::default())
    }

    pub(crate) fn stamp(&self, cb: &MTLCommandBuffer) {
        *self.0.borrow_mut() = Some(cb.clone());
    }

    /// Whether the GPU may still be reading or writing the resource.
    pub(crate) fn in_flight(&self) -> bool {
        let mut slot = self.0.borrow_mut();
        let busy = slot
            .as_ref()
            .is_some_and(|cb| cb.status() < command_buffer_status::COMPLETED);
        if !busy {
            *slot = None;
        }
        busy
    }

    /// Blocks until the GPU has finished the last frame that used the resource.
    pub(crate) fn wait(&self) {
        let last = self.0.borrow_mut().take();
        if let Some(cb) = last {
            if cb.status() < command_buffer_status::COMPLETED {
                cb.wait_until_completed();
            }
        }
    }
}

pub(crate) fn command_buffer_error(cb: &MTLCommandBuffer) -> Error {
    Error::GpuExecution {
        message: cb.error().map_or_else(
            || "the command buffer failed without an error".into(),
            |e| e.localized_description().to_string_lossy(),
        ),
    }
}

/// Bookkeeping shared by the [`Gpu`] and every [`Frame`] it made.
#[derive(Default)]
pub(crate) struct Ledger {
    /// Frames created and not yet committed or dropped.
    open_frames: Cell<usize>,
    /// Committed without waiting; checked for failure when the next frame starts.
    unchecked: RefCell<Vec<MTLCommandBuffer>>,
    /// Failures found by that check, until [`Gpu::take_errors`] hands them on.
    failed: RefCell<Vec<Error>>,
}

/// The most failures kept for [`Gpu::take_errors`]; older ones are dropped.
const MAX_KEPT_ERRORS: usize = 16;

impl Ledger {
    pub(crate) fn frame_opened(&self) -> Result<()> {
        let open = self.open_frames.get();
        if open >= MAX_OPEN_FRAMES {
            return Err(Error::InvalidState(
                "too many frames are open at once (32); commit() the frames already created, or let them go, before making more",
            ));
        }
        self.open_frames.set(open + 1);
        Ok(())
    }

    pub(crate) fn frame_closed(&self) {
        self.open_frames
            .set(self.open_frames.get().saturating_sub(1));
    }

    pub(crate) fn committed(&self, cb: &MTLCommandBuffer) {
        self.unchecked.borrow_mut().push(cb.clone());
    }

    /// The caller reports this one's outcome itself.
    pub(crate) fn forget(&self, cb: &MTLCommandBuffer) {
        self.unchecked.borrow_mut().retain(|c| c != cb);
    }

    /// Moves finished command buffers out of `unchecked`, keeping the error of any that failed.
    pub(crate) fn reap(&self) {
        let _pool = AutoreleasePool::new();
        let mut failed = self.failed.borrow_mut();
        self.unchecked.borrow_mut().retain(|cb| match cb.status() {
            command_buffer_status::ERROR => {
                if failed.len() == MAX_KEPT_ERRORS {
                    failed.remove(0);
                }
                failed.push(command_buffer_error(cb));
                false
            }
            command_buffer_status::COMPLETED => false,
            _ => true,
        });
    }
}

/// The system default Metal device and one command queue on it.
pub struct Gpu {
    device: MTLDevice,
    queue: MTLCommandQueue,
    name: String,
    unified_memory: bool,
    apple_family: bool,
    low_power: bool,
    max_buffer_len: usize,
    max_threads_per_threadgroup: Size3,
    ledger: Rc<Ledger>,
}

thread_local! {
    static SHARED: OnceCell<Option<Rc<Gpu>>> = const { OnceCell::new() };
}

impl Gpu {
    /// The process-wide device, probed once. `Error::NoGpu` when Metal has no
    /// device here (a VM, a sandbox); `Error::Load` when the frameworks are missing.
    pub fn shared() -> Result<Rc<Gpu>> {
        objc::metal()?;
        SHARED
            .with(|cell| {
                cell.get_or_init(|| Gpu::probe().map(Rc::new))
                    .as_ref()
                    .map(Rc::clone)
            })
            .ok_or(Error::NoGpu)
    }

    fn probe() -> Option<Gpu> {
        let _pool = AutoreleasePool::new();
        let device = objc::system_default_device()?;
        let queue = device.new_command_queue()?;
        queue.set_label(Some(&NSString::from("Bun.AppKit")));
        Some(Gpu {
            name: device.name().to_string_lossy(),
            unified_memory: device.has_unified_memory(),
            apple_family: device.supports_family(gpu_family::APPLE1),
            low_power: device.is_low_power(),
            max_buffer_len: device.max_buffer_length(),
            max_threads_per_threadgroup: device.max_threads_per_threadgroup(),
            device,
            queue,
            ledger: Rc::new(Ledger::default()),
        })
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    /// Apple Silicon and Intel integrated GPUs: `Storage::Shared` costs nothing extra.
    pub fn has_unified_memory(&self) -> bool {
        self.unified_memory
    }

    pub fn is_low_power(&self) -> bool {
        self.low_power
    }

    /// The largest buffer the device will allocate, in bytes.
    pub fn max_buffer_len(&self) -> usize {
        self.max_buffer_len
    }

    /// Per-dimension limits on a compute threadgroup.
    pub fn max_threads_per_threadgroup(&self) -> Size3 {
        self.max_threads_per_threadgroup
    }

    pub(crate) fn device(&self) -> &MTLDevice {
        &self.device
    }

    pub(crate) fn queue(&self) -> &MTLCommandQueue {
        &self.queue
    }

    pub(crate) fn ledger(&self) -> &Rc<Ledger> {
        &self.ledger
    }

    /// The CPU-visible buffer storage mode for this device: shared memory
    /// where CPU and GPU have one, a managed (mirrored) copy on discrete GPUs.
    pub fn cpu_storage(&self) -> Storage {
        if self.unified_memory {
            Storage::Shared
        } else {
            Storage::Managed
        }
    }

    /// The CPU-visible texture storage mode: only Apple-family GPUs take
    /// shared textures; Intel and AMD ones (integrated or not) need managed.
    pub fn texture_cpu_storage(&self) -> Storage {
        if self.apple_family {
            Storage::Shared
        } else {
            Storage::Managed
        }
    }

    /// A new command buffer to encode passes into. `Error::Unsupported` once
    /// [`MAX_OPEN_FRAMES`] are open.
    pub fn frame(&self) -> Result<Frame> {
        self.ledger.reap();
        Frame::new(self)
    }

    /// Frames open right now: created and neither committed nor dropped.
    pub fn open_frames(&self) -> usize {
        self.ledger.open_frames.get()
    }

    /// `Error::GpuExecution` for each frame committed with [`Frame::commit`]
    /// that the GPU has since failed to run, oldest first, once each.
    pub fn take_errors(&self) -> Vec<Error> {
        self.ledger.reap();
        core::mem::take(&mut *self.ledger.failed.borrow_mut())
    }
}

pub(crate) fn ns_label(label: NsStr<'_>) -> Option<NSString> {
    (!label.is_empty()).then(|| NSString::from_str(label))
}
