use std::collections::hash_map::Entry;
use std::ptr::NonNull;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Once, OnceLock};
use std::time::Instant;

use anyhow::{Context as _, Result, anyhow, ensure};
use objc2::rc::{Retained, autoreleasepool};
use objc2::runtime::ProtocolObject;
use objc2_foundation::NSString;
use objc2_metal::{
    MTLBlendFactor, MTLBuffer, MTLClearColor, MTLCommandBuffer, MTLCommandBufferStatus,
    MTLCommandEncoder, MTLCommandQueue, MTLCreateSystemDefaultDevice, MTLDevice, MTLLibrary,
    MTLLoadAction, MTLPixelFormat, MTLPrimitiveType, MTLRenderCommandEncoder,
    MTLRenderPassDescriptor, MTLRenderPipelineDescriptor, MTLRenderPipelineState,
    MTLResourceOptions, MTLStorageMode, MTLStoreAction, MTLTexture, MTLTextureDescriptor,
    MTLTextureUsage,
};
use rustc_hash::FxHashMap;

use super::core_animation::{Surface, Tree};
use super::{Instance, Pass, SLOTS, Sample, Target as _};
use crate::paint::arena::Chunk;

type Object<T> = Retained<ProtocolObject<T>>;

struct Gpu {
    device: Object<dyn MTLDevice>,
    queue: Object<dyn MTLCommandQueue>,
    pipeline: Object<dyn MTLRenderPipelineState>,
}

// SAFETY: Metal documents these three as safe to use from any thread.
unsafe impl Send for Gpu {}
// SAFETY: as above.
unsafe impl Sync for Gpu {}

static GPU: OnceLock<Gpu> = OnceLock::new();
static HAS_FAILED: AtomicBool = AtomicBool::new(false);

#[derive(Default)]
pub struct Buffers {
    instances: Option<Object<dyn MTLBuffer>>,
    /// The buffer is released before the memory that it wraps.
    chunks: FxHashMap<u64, (Object<dyn MTLBuffer>, Arc<Chunk>)>,
}

impl Gpu {
    fn new() -> Result<Gpu> {
        let device = MTLCreateSystemDefaultDevice().context("there is no device")?;
        ensure!(
            cfg!(target_arch = "aarch64") && device.hasUnifiedMemory(),
            "it has memory of its own"
        );
        let source = NSString::from_str(include_str!("shader.metal"));
        let library = device
            .newLibraryWithSource_options_error(&source, None)
            .map_err(|error| anyhow!("{error}"))?;
        let function = |name: &str| {
            library
                .newFunctionWithName(&NSString::from_str(name))
                .context("a function is missing")
        };
        let descriptor = MTLRenderPipelineDescriptor::new();
        descriptor.setVertexFunction(Some(&*function("place")?));
        descriptor.setFragmentFunction(Some(&*function("paint")?));
        // SAFETY: there is a first attachment.
        let color = unsafe { descriptor.colorAttachments().objectAtIndexedSubscript(0) };
        color.setPixelFormat(MTLPixelFormat::BGRA8Unorm);
        color.setBlendingEnabled(true);
        color.setSourceRGBBlendFactor(MTLBlendFactor::One);
        color.setSourceAlphaBlendFactor(MTLBlendFactor::One);
        color.setDestinationRGBBlendFactor(MTLBlendFactor::OneMinusSourceAlpha);
        color.setDestinationAlphaBlendFactor(MTLBlendFactor::OneMinusSourceAlpha);
        let pipeline = device
            .newRenderPipelineStateWithDescriptor_error(&descriptor)
            .map_err(|error| anyhow!("{error}"))?;
        let queue = device.newCommandQueue().context("there is no queue")?;
        Ok(Gpu {
            device,
            queue,
            pipeline,
        })
    }

    fn texture<'a>(
        &self,
        Surface { surface, texture }: &'a Surface,
    ) -> Option<&'a ProtocolObject<dyn MTLTexture>> {
        let create = || {
            let (format, width, height) = (
                MTLPixelFormat::BGRA8Unorm,
                surface.width(),
                surface.height(),
            );
            // SAFETY: the format and the size of the surface.
            let descriptor = unsafe {
                MTLTextureDescriptor::texture2DDescriptorWithPixelFormat_width_height_mipmapped(
                    format, width, height, false,
                )
            };
            descriptor.setUsage(MTLTextureUsage::RenderTarget);
            descriptor.setStorageMode(MTLStorageMode::Shared);
            self.device
                .newTextureWithDescriptor_iosurface_plane(&descriptor, surface, 0)
        };
        texture.get_or_init(create).as_deref()
    }

    fn draw(
        &self,
        buffers: &mut Buffers,
        instances: &[Instance],
        passes: &[Pass<Surface>],
    ) -> Result<()> {
        let (length, shared) = (
            size_of_val(instances).max(1),
            MTLResourceOptions::StorageModeShared,
        );
        buffers
            .chunks
            .retain(|_, (_, chunk)| Arc::strong_count(chunk) > 1);
        if buffers
            .instances
            .as_ref()
            .is_none_or(|buffer| buffer.length() < length)
        {
            buffers.instances = self
                .device
                .newBufferWithLength_options(length.next_power_of_two().max(1 << 16), shared);
        }
        let all = buffers
            .instances
            .as_deref()
            .context("there is no memory for the instances")?;
        // SAFETY: it is long enough, and the last draw has completed.
        unsafe {
            std::ptr::copy_nonoverlapping(
                instances.as_ptr(),
                all.contents().as_ptr().cast(),
                instances.len(),
            )
        };
        let commands = self
            .queue
            .commandBuffer()
            .context("there is no command buffer")?;
        for chunk in passes
            .iter()
            .flat_map(|pass| &pass.batches)
            .flat_map(|batch| &batch.slots)
        {
            if let Entry::Vacant(entry) = buffers.chunks.entry(chunk.id) {
                let start = NonNull::new(chunk.start.cast()).context("there is no memory")?;
                // SAFETY: whole pages of one mapping, which outlives the buffer.
                let buffer = unsafe {
                    self.device
                        .newBufferWithBytesNoCopy_length_options_deallocator(
                            start, chunk.len, shared, None,
                        )
                };
                entry.insert((
                    buffer.context("the memory cannot be shared")?,
                    chunk.clone(),
                ));
            }
        }
        for pass in passes {
            let descriptor = MTLRenderPassDescriptor::new();
            // SAFETY: there is a first attachment.
            let color = unsafe { descriptor.colorAttachments().objectAtIndexedSubscript(0) };
            color.setTexture(Some(
                self.texture(pass.surface)
                    .context("the surface cannot be drawn on")?,
            ));
            color.setLoadAction(MTLLoadAction::Clear);
            color.setClearColor(MTLClearColor {
                red: 0.,
                green: 0.,
                blue: 0.,
                alpha: 0.,
            });
            color.setStoreAction(MTLStoreAction::Store);
            let encoder = commands
                .renderCommandEncoderWithDescriptor(&descriptor)
                .context("there is no encoder")?;
            encoder.setRenderPipelineState(&self.pipeline);
            let cell = [
                pass.rect.left as f32,
                pass.rect.top as f32,
                pass.rect.width() as f32,
                pass.rect.height() as f32,
            ];
            // SAFETY: the arguments that the shader declares. The instances only point into their blocks.
            unsafe {
                encoder.setVertexBytes_length_atIndex(
                    NonNull::from(&cell).cast(),
                    size_of_val(&cell),
                    1,
                );
                encoder.setFragmentBytes_length_atIndex(
                    NonNull::from(&cell).cast(),
                    size_of_val(&cell),
                    1,
                );
                for batch in pass
                    .batches
                    .iter()
                    .filter(|batch| !batch.instances.is_empty())
                {
                    let offset = batch.instances.start * size_of::<Instance>();
                    encoder.setVertexBuffer_offset_atIndex(Some(all), offset, 0);
                    encoder.setFragmentBuffer_offset_atIndex(Some(all), offset, 0);
                    for slot in 0..SLOTS {
                        let buffer = batch
                            .slots
                            .get(slot)
                            .map_or(all, |chunk| &buffers.chunks[&chunk.id].0);
                        encoder.setFragmentBuffer_offset_atIndex(Some(buffer), 0, 2 + slot);
                    }
                    let (strip, count) = (MTLPrimitiveType::TriangleStrip, batch.instances.len());
                    encoder
                        .drawPrimitives_vertexStart_vertexCount_instanceCount(strip, 0, 4, count);
                }
            }
            encoder.endEncoding();
        }
        commands.commit();
        commands.waitUntilCompleted();
        ensure!(
            commands.status() == MTLCommandBufferStatus::Completed,
            "{:?}",
            commands.error()
        );
        Ok(())
    }

    fn draws_what_the_cpu_paints(&self) -> Result<()> {
        let surface = Surface::new(Sample::WIDTH, Sample::HEIGHT).context("there is no surface")?;
        let sample = Sample::new();
        let (instances, pass) = sample.pass(&surface);
        self.draw(&mut Buffers::default(), &instances, &[pass])?;
        let difference = sample.difference(&Tree::lock(&surface, false));
        Tree::unlock(&surface, false);
        ensure!(difference <= 6, "its pixels are off by {difference}");
        Ok(())
    }
}

fn get_ready() {
    static START: Once = Once::new();
    let start = || {
        let time = Instant::now();
        match autoreleasepool(|_| {
            Gpu::new().and_then(|gpu| gpu.draws_what_the_cpu_paints().map(|()| gpu))
        }) {
            Ok(gpu) => {
                log::info!("{} is ready after {:?}", gpu.device.name(), time.elapsed());
                GPU.set(gpu).ok();
            }
            Err(error) => log::warn!("the GPU is not used: {error:#}"),
        }
    };
    START.call_once(|| drop(std::thread::Builder::new().name("GPU".into()).spawn(start)));
}

/// The first frames do not wait for it.
pub fn is_ready() -> bool {
    get_ready();
    GPU.get().is_some() && !HAS_FAILED.load(Ordering::Relaxed)
}

pub fn draw(buffers: &mut Buffers, instances: &[Instance], passes: &[Pass<Surface>]) -> bool {
    let Some(gpu) = GPU.get() else { return false };
    let result = autoreleasepool(|_| gpu.draw(buffers, instances, passes));
    if let Err(error) = &result {
        log::error!("the GPU is no longer used: {error:#}");
        HAS_FAILED.store(true, Ordering::Relaxed);
    }
    result.is_ok()
}
