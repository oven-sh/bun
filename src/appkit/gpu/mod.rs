//! Metal behind a typed, bounds-checked API: one device and its command
//! queue ([`Gpu`]), buffers and textures, shader libraries and pipelines,
//! and one command buffer per [`Frame`]. Every check Metal would otherwise
//! answer with an assertion (an index past a bind-slot limit, a byte range
//! outside a buffer, a draw with no pipeline) is made here first and comes
//! back as an [`Error`].

use std::cell::OnceCell;
use std::rc::Rc;

use crate::Named;
use crate::error::{Error, Result};
use crate::named_enum;
use crate::objc::foundation::NSString;
use crate::objc::metal::{MTLCommandQueue, MTLDevice, ResourceOptions, StorageMode};
use crate::objc::{self, AutoreleasePool, NsStr};

mod frame;
mod pipeline;
mod resources;

pub use crate::geometry::{ClearColor, Origin3, Region, ScissorRect, Size3, Viewport};
pub use crate::objc::metal::{
    BlendFactor, BlendOperation, ColorWriteMask, CompareFunction, CullMode, IndexType, PixelFormat,
    PrimitiveType, SamplerAddressMode, SamplerMinMagFilter, SamplerMipFilter, TextureUsage,
    VertexFormat, VertexStepFunction, Winding,
};
pub use frame::{BlitPass, ComputePass, Frame, FrameState, PassTarget, RenderPass};
pub use pipeline::{
    Blend, ComputePipeline, Function, Library, RenderPipeline, RenderPipelineDesc, VertexAttribute,
    VertexLayout,
};
pub use resources::{Buffer, DepthStencil, Sampler, SamplerDesc, Texture, TextureDesc};

named_enum! {
    /// Where a buffer or texture lives (`MTLStorageMode` without `memoryless`).
    pub enum Storage {
        /// One allocation the CPU and GPU both address; coherent at command buffer boundaries.
        Shared = "shared",
        /// A CPU copy and a GPU copy that are synchronised explicitly (discrete GPUs).
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

/// The system default Metal device and one command queue on it.
pub struct Gpu {
    device: MTLDevice,
    queue: MTLCommandQueue,
    name: String,
    unified_memory: bool,
    low_power: bool,
    max_buffer_len: usize,
    max_threads_per_threadgroup: Size3,
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
            low_power: device.is_low_power(),
            max_buffer_len: device.max_buffer_length(),
            max_threads_per_threadgroup: device.max_threads_per_threadgroup(),
            device,
            queue,
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

    /// The CPU-visible storage mode for this device: shared memory where the
    /// GPU has it, a managed (mirrored) copy on discrete GPUs.
    pub fn cpu_storage(&self) -> Storage {
        if self.unified_memory {
            Storage::Shared
        } else {
            Storage::Managed
        }
    }

    /// A new command buffer to encode passes into.
    pub fn frame(&self) -> Result<Frame> {
        Frame::new(self)
    }
}

pub(crate) fn ns_label(label: NsStr<'_>) -> Option<NSString> {
    (!label.is_empty()).then(|| NSString::from_str(label))
}
