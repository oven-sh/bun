//! Buffers, textures, samplers and depth/stencil state.

use std::rc::Rc;

use super::{
    BUFFER_OFFSET_ALIGNMENT, Gpu, LastUse, MAX_TEXTURE_SIZE, PixelFormat, Storage, TextureUsage,
    check_max, check_range, command_buffer_error, ns_label,
};
use crate::error::{Error, Result};
use crate::geometry::{Range, Region};
use crate::objc::metal::{
    CompareFunction, MTLBuffer, MTLCommandQueue, MTLDepthStencilDescriptor, MTLDepthStencilState,
    MTLResource, MTLSamplerDescriptor, MTLSamplerState, MTLTexture, MTLTextureDescriptor,
    SamplerAddressMode, SamplerMinMagFilter, SamplerMipFilter, command_buffer_status,
};
use crate::objc::{AutoreleasePool, NsStr};

/// Encodes a `synchronizeResource:` for a managed resource on its own command
/// buffer and blocks until it has run, so the CPU copy holds the GPU's writes.
fn synchronize_blocking(queue: &MTLCommandQueue, resource: &MTLResource) -> Result<()> {
    let cb = queue.command_buffer().ok_or_else(|| Error::GpuExecution {
        message: "the command queue could not make a command buffer".into(),
    })?;
    let blit = cb
        .blit_command_encoder()
        .ok_or_else(|| Error::GpuExecution {
            message: "could not start a blit pass".into(),
        })?;
    blit.synchronize_resource(resource);
    blit.end_encoding();
    cb.commit();
    cb.wait_until_completed();
    if cb.status() == command_buffer_status::ERROR {
        return Err(command_buffer_error(&cb));
    }
    Ok(())
}

// ─────────────────────────────── buffers ────────────────────────────────────

/// A `MTLBuffer` that knows its length and storage mode. CPU access
/// ([`write`](Buffer::write), [`read`](Buffer::read)) first waits for the
/// last committed frame that used the buffer, so it never overlaps the GPU's.
pub struct Buffer {
    raw: MTLBuffer,
    /// For the blit that makes a managed buffer's GPU writes CPU-visible.
    queue: MTLCommandQueue,
    len: usize,
    allocated_size: usize,
    storage: Storage,
    last_use: Rc<LastUse>,
}

impl Gpu {
    /// A zero-filled buffer of `len` bytes.
    pub fn buffer_with_len(&self, len: usize, storage: Storage) -> Result<Buffer> {
        self.check_buffer_len(len)?;
        let _pool = AutoreleasePool::new();
        let raw = self
            .device()
            .new_buffer_with_length(len, storage.options())
            .ok_or_else(|| Error::GpuExecution {
                message: format!("the device could not allocate a {len}-byte buffer"),
            })?;
        Ok(self.wrap_buffer(raw, len, storage))
    }

    /// A buffer holding a copy of `bytes`. `Storage::Private` goes through a
    /// shared staging buffer and a blit the queue orders before later work.
    pub fn buffer_from_bytes(&self, bytes: &[u8], storage: Storage) -> Result<Buffer> {
        self.check_buffer_len(bytes.len())?;
        let _pool = AutoreleasePool::new();
        if storage == Storage::Private {
            let staging = self.buffer_from_bytes(bytes, Storage::Shared)?;
            let private = self.buffer_with_len(bytes.len(), Storage::Private)?;
            let mut frame = self.frame()?;
            frame.blit(|blit| blit.copy_buffer(&staging, 0, &private, 0, bytes.len()))?;
            frame.commit()?;
            return Ok(private);
        }
        let raw = self
            .device()
            .new_buffer_with_bytes(bytes, storage.options())
            .ok_or_else(|| Error::GpuExecution {
                message: format!(
                    "the device could not allocate a {}-byte buffer",
                    bytes.len()
                ),
            })?;
        Ok(self.wrap_buffer(raw, bytes.len(), storage))
    }

    fn wrap_buffer(&self, raw: MTLBuffer, len: usize, storage: Storage) -> Buffer {
        Buffer {
            allocated_size: raw.allocated_size(),
            raw,
            queue: self.queue().clone(),
            len,
            storage,
            last_use: LastUse::new(),
        }
    }

    fn check_buffer_len(&self, len: usize) -> Result<()> {
        if len == 0 {
            return Err(Error::ZeroSize("buffer length"));
        }
        check_range("buffer length", self.max_buffer_len(), 0, len)
    }
}

impl Buffer {
    pub(crate) fn raw(&self) -> &MTLBuffer {
        &self.raw
    }

    pub fn len(&self) -> usize {
        self.len
    }

    pub fn storage(&self) -> Storage {
        self.storage
    }

    /// Bytes of device memory the buffer occupies (at least `len`).
    pub fn allocated_size(&self) -> usize {
        self.allocated_size
    }

    pub(crate) fn last_use(&self) -> Rc<LastUse> {
        Rc::clone(&self.last_use)
    }

    /// Whether a committed frame that bound the buffer is still running, so
    /// that a [`write`](Buffer::write) or [`read`](Buffer::read) now would block.
    pub fn in_flight(&self) -> bool {
        self.last_use.in_flight()
    }

    /// Copies `bytes` in at `offset`, once the GPU has finished any committed
    /// frame that used the buffer. Not for private storage.
    pub fn write(&self, offset: usize, bytes: &[u8]) -> Result<()> {
        if !self.storage.cpu_accessible() {
            return Err(Error::BufferNotAccessible);
        }
        check_range("buffer write", self.len, offset, bytes.len())?;
        if bytes.is_empty() {
            return Ok(());
        }
        self.last_use.wait();
        self.raw.copy_to_contents(offset, bytes)?;
        if self.storage == Storage::Managed {
            self.raw.did_modify_range(Range {
                location: offset,
                length: bytes.len(),
            });
        }
        Ok(())
    }

    /// Copies `len` bytes out from `offset`, once the GPU has finished any
    /// committed frame that used the buffer; a managed buffer is synchronised
    /// first, so either way this sees what those frames wrote. Not for
    /// private storage.
    pub fn read(&self, offset: usize, len: usize) -> Result<Vec<u8>> {
        if !self.storage.cpu_accessible() {
            return Err(Error::BufferNotAccessible);
        }
        check_range("buffer read", self.len, offset, len)?;
        if len == 0 {
            return Ok(Vec::new());
        }
        self.last_use.wait();
        if self.storage == Storage::Managed {
            let _pool = AutoreleasePool::new();
            synchronize_blocking(&self.queue, &self.raw)?;
        }
        self.raw.copy_from_contents(offset, len)
    }

    /// Shows up in Xcode's GPU capture and Metal's error messages.
    pub fn set_label(&self, label: NsStr<'_>) {
        self.raw.set_label(ns_label(label).as_ref());
    }

    pub(crate) fn check_range(&self, what: &'static str, offset: usize, size: usize) -> Result<()> {
        check_range(what, self.len, offset, size)
    }

    /// A shader bind offset: inside the buffer and 4-byte aligned.
    pub(crate) fn check_bind_offset(&self, what: &'static str, offset: usize) -> Result<()> {
        if offset >= self.len {
            return Err(Error::OutOfBounds {
                what,
                len: self.len,
                offset,
                size: 1,
            });
        }
        if !offset.is_multiple_of(BUFFER_OFFSET_ALIGNMENT) {
            return Err(Error::Unsupported(
                "buffer bind offset must be a multiple of 4",
            ));
        }
        Ok(())
    }
}

// ─────────────────────────────── textures ───────────────────────────────────

/// How to create a [`Texture`]. `storage: None` picks what the format needs:
/// private for depth formats, otherwise the device's CPU-visible texture
/// mode, which is also what `Shared` and `Managed` both mean here.
#[derive(Clone, Debug)]
pub struct TextureDesc<'a> {
    pub width: usize,
    pub height: usize,
    pub format: PixelFormat,
    pub usage: TextureUsage,
    pub storage: Option<Storage>,
    pub mipmapped: bool,
    pub label: Option<NsStr<'a>>,
}

impl TextureDesc<'_> {
    /// Readable by shaders and usable as a render target.
    pub fn new(width: usize, height: usize, format: PixelFormat) -> TextureDesc<'static> {
        TextureDesc {
            width,
            height,
            format,
            usage: TextureUsage::SHADER_READ | TextureUsage::RENDER_TARGET,
            storage: None,
            mipmapped: false,
            label: None,
        }
    }
}

/// A 2D `MTLTexture` with its creation parameters. Like [`Buffer`], CPU
/// access waits for the last committed frame that used it.
pub struct Texture {
    raw: MTLTexture,
    /// For the blit that makes a managed texture's GPU writes CPU-visible.
    queue: MTLCommandQueue,
    width: usize,
    height: usize,
    format: PixelFormat,
    usage: TextureUsage,
    storage: Storage,
    mip_levels: usize,
    allocated_size: usize,
    last_use: Rc<LastUse>,
}

impl Gpu {
    pub fn texture(&self, desc: &TextureDesc<'_>) -> Result<Texture> {
        if desc.width == 0 {
            return Err(Error::ZeroSize("texture width"));
        }
        if desc.height == 0 {
            return Err(Error::ZeroSize("texture height"));
        }
        check_max("texture width", desc.width, MAX_TEXTURE_SIZE)?;
        check_max("texture height", desc.height, MAX_TEXTURE_SIZE)?;
        if desc.format == PixelFormat::Invalid {
            return Err(Error::Unsupported("a texture needs a pixel format"));
        }
        let storage = match desc.storage {
            Some(Storage::Shared) | Some(Storage::Managed) => self.texture_cpu_storage(),
            Some(Storage::Private) => Storage::Private,
            None if desc.format.is_depth() => Storage::Private,
            None => self.texture_cpu_storage(),
        };
        let _pool = AutoreleasePool::new();
        let d =
            MTLTextureDescriptor::texture_2d(desc.format, desc.width, desc.height, desc.mipmapped);
        d.set_usage(desc.usage);
        d.set_storage_mode(storage.mode());
        let raw = self
            .device()
            .new_texture_with_descriptor(&d)
            .ok_or_else(|| Error::GpuExecution {
                message: format!(
                    "the device could not create a {}x{} {} texture",
                    desc.width,
                    desc.height,
                    crate::Named::name(desc.format)
                ),
            })?;
        if let Some(label) = desc.label {
            raw.set_label(ns_label(label).as_ref());
        }
        Ok(Texture {
            mip_levels: raw.mipmap_level_count(),
            allocated_size: raw.allocated_size(),
            raw,
            queue: self.queue().clone(),
            width: desc.width,
            height: desc.height,
            format: desc.format,
            usage: desc.usage,
            storage,
            last_use: LastUse::new(),
        })
    }
}

impl Texture {
    pub(crate) fn raw(&self) -> &MTLTexture {
        &self.raw
    }

    pub fn width(&self) -> usize {
        self.width
    }

    pub fn height(&self) -> usize {
        self.height
    }

    pub fn format(&self) -> PixelFormat {
        self.format
    }

    pub fn usage(&self) -> TextureUsage {
        self.usage
    }

    pub fn storage(&self) -> Storage {
        self.storage
    }

    pub fn mip_levels(&self) -> usize {
        self.mip_levels
    }

    /// Bytes of device memory the texture and its mip levels occupy.
    pub fn allocated_size(&self) -> usize {
        self.allocated_size
    }

    pub(crate) fn last_use(&self) -> Rc<LastUse> {
        Rc::clone(&self.last_use)
    }

    /// Whether a committed frame that used the texture is still running.
    pub fn in_flight(&self) -> bool {
        self.last_use.in_flight()
    }

    pub fn bytes_per_pixel(&self) -> usize {
        self.format.bytes_per_texel()
    }

    /// Bytes in one tightly packed row of level 0.
    pub fn bytes_per_row(&self) -> usize {
        self.width * self.format.bytes_per_texel()
    }

    pub fn set_label(&self, label: NsStr<'_>) {
        self.raw.set_label(ns_label(label).as_ref());
    }

    fn check_cpu_access(&self) -> Result<()> {
        if self.storage.cpu_accessible() && !self.raw.is_framebuffer_only() {
            Ok(())
        } else {
            Err(Error::TextureNotReadable)
        }
    }

    /// Replaces all of level 0 with `bytes`, laid out `bytes_per_row` apart
    /// (`0` = tightly packed; otherwise at least one packed row and a whole
    /// number of texels), once the GPU has finished any committed frame that
    /// used the texture.
    pub fn replace(&self, bytes: &[u8], bytes_per_row: usize) -> Result<()> {
        self.check_cpu_access()?;
        let packed = self.bytes_per_row();
        let bytes_per_row = if bytes_per_row == 0 {
            packed
        } else {
            bytes_per_row
        };
        if bytes_per_row < packed {
            return Err(Error::OutOfBounds {
                what: "bytes per row",
                len: bytes_per_row,
                offset: 0,
                size: packed,
            });
        }
        if !bytes_per_row.is_multiple_of(self.format.bytes_per_texel()) {
            return Err(Error::Unsupported(
                "bytes per row must be a multiple of the format's bytes per pixel",
            ));
        }
        self.last_use.wait();
        self.raw.replace_region(
            Region::new_2d(0, 0, self.width, self.height),
            0,
            bytes,
            bytes_per_row,
        )
    }

    /// Level 0 as tightly packed rows, once the GPU has finished any committed
    /// frame that used the texture; a managed texture is synchronised first.
    pub fn read_pixels(&self) -> Result<Vec<u8>> {
        self.check_cpu_access()?;
        let _pool = AutoreleasePool::new();
        self.last_use.wait();
        if self.storage == Storage::Managed {
            synchronize_blocking(&self.queue, &self.raw)?;
        }
        let bytes_per_row = self.bytes_per_row();
        let total = bytes_per_row
            .checked_mul(self.height)
            .ok_or(Error::OutOfBounds {
                what: "texture readback",
                len: usize::MAX,
                offset: 0,
                size: usize::MAX,
            })?;
        let mut out = vec![0u8; total];
        self.raw.get_bytes(
            &mut out,
            bytes_per_row,
            Region::new_2d(0, 0, self.width, self.height),
            0,
        )?;
        Ok(out)
    }
}

// ────────────────────────── samplers, depth/stencil ─────────────────────────

/// How to create a [`Sampler`].
#[derive(Clone, Debug)]
pub struct SamplerDesc<'a> {
    pub min_filter: SamplerMinMagFilter,
    pub mag_filter: SamplerMinMagFilter,
    pub mip_filter: SamplerMipFilter,
    pub address_s: SamplerAddressMode,
    pub address_t: SamplerAddressMode,
    /// 1 to 16.
    pub max_anisotropy: usize,
    /// For sampling depth textures with `sample_compare`.
    pub compare: Option<CompareFunction>,
    pub label: Option<NsStr<'a>>,
}

impl Default for SamplerDesc<'_> {
    fn default() -> Self {
        SamplerDesc {
            min_filter: SamplerMinMagFilter::Nearest,
            mag_filter: SamplerMinMagFilter::Nearest,
            mip_filter: SamplerMipFilter::NotMipmapped,
            address_s: SamplerAddressMode::ClampToEdge,
            address_t: SamplerAddressMode::ClampToEdge,
            max_anisotropy: 1,
            compare: None,
            label: None,
        }
    }
}

/// A `MTLSamplerState`.
pub struct Sampler {
    raw: MTLSamplerState,
}

impl Sampler {
    pub(crate) fn raw(&self) -> &MTLSamplerState {
        &self.raw
    }
}

/// A `MTLDepthStencilState` (depth test only; no stencil in this version).
pub struct DepthStencil {
    raw: MTLDepthStencilState,
}

impl DepthStencil {
    pub(crate) fn raw(&self) -> &MTLDepthStencilState {
        &self.raw
    }
}

impl Gpu {
    pub fn sampler(&self, desc: &SamplerDesc<'_>) -> Result<Sampler> {
        check_max("max anisotropy", desc.max_anisotropy, 16)?;
        let _pool = AutoreleasePool::new();
        let d = MTLSamplerDescriptor::new();
        d.set_min_filter(desc.min_filter);
        d.set_mag_filter(desc.mag_filter);
        d.set_mip_filter(desc.mip_filter);
        d.set_s_address_mode(desc.address_s);
        d.set_t_address_mode(desc.address_t);
        d.set_max_anisotropy(desc.max_anisotropy.max(1));
        if let Some(compare) = desc.compare {
            d.set_compare_function(compare);
        }
        if let Some(label) = desc.label {
            d.set_label(ns_label(label).as_ref());
        }
        let raw = self
            .device()
            .new_sampler_state(&d)
            .ok_or_else(|| Error::GpuExecution {
                message: "the device could not create this sampler".into(),
            })?;
        Ok(Sampler { raw })
    }

    /// Fragments pass when `compare(fragment depth, stored depth)` holds;
    /// `write` stores the fragment's depth when it passes.
    pub fn depth_stencil(&self, compare: CompareFunction, write: bool) -> Result<DepthStencil> {
        let _pool = AutoreleasePool::new();
        let d = MTLDepthStencilDescriptor::new();
        d.set_depth_compare_function(compare);
        d.set_depth_write_enabled(write);
        let raw = self
            .device()
            .new_depth_stencil_state(&d)
            .ok_or_else(|| Error::GpuExecution {
                message: "the device could not create this depth/stencil state".into(),
            })?;
        Ok(DepthStencil { raw })
    }
}
