//! The JS-independent half of WebGPU: the wgpu instance, id handles, errors, and name tables.

// The proof that `wgpu_core::global::Global` is `Sync` is deeper than the default of 128.
#![recursion_limit = "256"]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Once, OnceLock};
use std::time::{Duration, Instant};

use bun_threading::Guarded;

pub use wgpu_core as wgc;
pub use wgpu_types as wgt;

#[cfg(target_vendor = "apple")]
mod apple;
pub mod names;

use wgc::global::Global;
use wgc::id;

/// The process's wgpu instance. Creating it loads the GPU API, so it happens on first use.
pub fn instance() -> &'static Global {
    static INSTANCE: OnceLock<Global> = OnceLock::new();
    INSTANCE.get_or_init(|| {
        let mut desc = wgt::InstanceDescriptor::new_without_display_handle();
        desc.backends = wgt::Backends::PRIMARY;
        // Without its frameworks the Metal backend cannot run: no backend, no adapters.
        #[cfg(target_vendor = "apple")]
        if !apple::load() {
            desc.backends = wgt::Backends::empty();
        }
        // The GPU API's own debug layers; wgpu-core's WebGPU validation does not need them.
        desc.flags = wgt::InstanceFlags::empty();
        Global::new("bun", desc, None)
    })
}

/// Runs a shader or pipeline compile on a thread with a stack sized for `source_len`. `None` if the thread could not be created. naga's WGSL lowering, its validator and its SPIR-V writer recurse once per nesting level of the shader, with no depth limit, and its parser does not, so its own recursion limits never fire: a chain of unary operators costs about 0.6 KB of stack per byte of source in a release build, and about 9 KB in a debug build, which overflows the JS thread's stack for an ordinary generated shader.
pub fn compile<R: Send>(source_len: usize, f: impl FnOnce() -> R + Send) -> Option<R> {
    // The worst construct measured with naga 30.0.1 is `!!!!...` (one byte of source per level), with margin.
    const PER_SOURCE_BYTE: usize = if cfg!(debug_assertions) {
        32 * 1024
    } else {
        6 * 1024
    };
    const BASE: usize = 8 * 1024 * 1024;
    let stack = BASE.saturating_add(source_len.saturating_mul(PER_SOURCE_BYTE));
    std::thread::scope(|scope| {
        std::thread::Builder::new()
            .name(String::from("bun-webgpu-compile"))
            .stack_size(stack)
            .spawn_scoped(scope, f)
            .ok()?
            .join()
            .ok()
    })
}

/// A wgpu-core id that is unregistered when the value drops. wgpu-core panics on an id it no longer knows.
pub trait OwnedId {
    type Id: Copy;
    fn id(&self) -> Self::Id;
}

macro_rules! owned_id {
    ($(#[$meta:meta])* $name:ident, $id:ty, $drop:ident) => {
        $(#[$meta])*
        pub struct $name($id);

        impl $name {
            /// Takes ownership of `id`: it is released when the value drops.
            pub fn new(id: $id) -> Self {
                Self(id)
            }
            #[inline]
            pub fn id(&self) -> $id {
                self.0
            }
        }

        impl OwnedId for $name {
            type Id = $id;
            #[inline]
            fn id(&self) -> $id {
                self.0
            }
        }

        impl Drop for $name {
            fn drop(&mut self) {
                instance().$drop(self.0);
            }
        }
    };
}

owned_id!(Adapter, id::AdapterId, adapter_drop);
owned_id!(Buffer, id::BufferId, buffer_drop);
owned_id!(Texture, id::TextureId, texture_drop);
owned_id!(TextureView, id::TextureViewId, texture_view_drop);
owned_id!(Sampler, id::SamplerId, sampler_drop);
owned_id!(
    BindGroupLayout,
    id::BindGroupLayoutId,
    bind_group_layout_drop
);
owned_id!(PipelineLayout, id::PipelineLayoutId, pipeline_layout_drop);
owned_id!(BindGroup, id::BindGroupId, bind_group_drop);
owned_id!(ShaderModule, id::ShaderModuleId, shader_module_drop);
owned_id!(
    ComputePipeline,
    id::ComputePipelineId,
    compute_pipeline_drop
);
owned_id!(RenderPipeline, id::RenderPipelineId, render_pipeline_drop);
owned_id!(CommandEncoder, id::CommandEncoderId, command_encoder_drop);
owned_id!(CommandBuffer, id::CommandBufferId, command_buffer_drop);
owned_id!(RenderBundle, id::RenderBundleId, render_bundle_drop);
owned_id!(QuerySet, id::QuerySetId, query_set_drop);
owned_id!(
    ComputePassEncoder,
    id::ComputePassEncoderId,
    compute_pass_drop
);
owned_id!(RenderPassEncoder, id::RenderPassEncoderId, render_pass_drop);
owned_id!(
    RenderBundleEncoder,
    id::RenderBundleEncoderId,
    render_bundle_encoder_drop
);

/// A device that exists, for [`wait_for_idle_at_exit`].
struct LiveDevice {
    id: id::DeviceId,
    queue: id::QueueId,
    /// [`release_device`] is waiting for its queue on its own thread.
    releasing: bool,
}

static DEVICES: Guarded<Vec<LiveDevice>> = Guarded::new(Vec::new());
static IDLE_AT_EXIT: AtomicBool = AtomicBool::new(false);
static EXITING: AtomicBool = AtomicBool::new(false);

/// How long an exit waits for the GPU to go idle. A shader that does not end has to lose.
const EXIT_WAIT: Duration = Duration::from_secs(10);

/// How long an exit waits for a release that is already in progress. That release has its own wait, which cannot be cut short.
const RELEASE_WAIT: Duration = Duration::from_secs(1);

/// Waits for the GPU to go idle, then releases every device. Runs on its own thread: wgpu-core's locks read thread-local data, which the exiting thread no longer has.
fn drain_devices() {
    let release_deadline = Instant::now() + RELEASE_WAIT;
    while DEVICES.lock().iter().any(|device| device.releasing) {
        if Instant::now() >= release_deadline {
            break;
        }
        std::thread::sleep(Duration::from_millis(1));
    }
    let deadline = Instant::now() + EXIT_WAIT;
    loop {
        let busy = DEVICES.lock().iter().any(|device| {
            !device.releasing
                && matches!(
                    instance().device_poll(device.id, wgt::PollType::Poll),
                    Ok(status) if !status.is_queue_empty()
                )
        });
        if !busy || Instant::now() >= deadline {
            break;
        }
        std::thread::sleep(Duration::from_millis(1));
    }
    // Every poller is a no-op from here, so nothing else reaches the ids below.
    EXITING.store(true, Ordering::Release);
    for device in core::mem::take(&mut *DEVICES.lock()) {
        if !device.releasing {
            instance().queue_drop(device.queue);
            instance().device_drop(device.id);
        }
    }
    IDLE_AT_EXIT.store(true, Ordering::Release);
}

/// `exit()` unloads the GPU driver while its own threads still run or compile a submission, which crashes inside the driver.
extern "C" fn wait_for_idle_at_exit() {
    if DEVICES.lock().is_empty() {
        return;
    }
    let spawned = std::thread::Builder::new()
        .name(String::from("bun-webgpu-exit"))
        .spawn(drain_devices);
    if spawned.is_err() {
        return;
    }
    let deadline = Instant::now() + RELEASE_WAIT + EXIT_WAIT + Duration::from_secs(1);
    while !IDLE_AT_EXIT.load(Ordering::Acquire) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(1));
    }
}

/// wgpu-core's `Queue::drop` blocks until the GPU has finished the queue's work.
fn release_device(device: id::DeviceId, queue: id::QueueId) {
    let global = instance();
    global.queue_drop(queue);
    let mut devices = DEVICES.lock();
    devices.retain(|live| live.id != device);
    drop(devices);
    global.device_drop(device);
}

/// A device and its queue. wgpu-core keeps the device alive while its resources exist.
pub struct Device {
    device: id::DeviceId,
    queue: id::QueueId,
    /// Held by [`poll`](Self::poll) on the pool thread and by [`exclusive`](Self::exclusive) on the JS thread.
    poll_lock: Guarded<()>,
}

impl Device {
    pub fn new(device: id::DeviceId, queue: id::QueueId) -> Self {
        static AT_EXIT: Once = Once::new();
        AT_EXIT.call_once(|| bun_core::add_exit_callback(wait_for_idle_at_exit));
        DEVICES.lock().push(LiveDevice {
            id: device,
            queue,
            releasing: false,
        });
        Self {
            device,
            queue,
            poll_lock: Guarded::new(()),
        }
    }
    #[inline]
    pub fn id(&self) -> id::DeviceId {
        self.device
    }
    #[inline]
    pub fn queue_id(&self) -> id::QueueId {
        self.queue
    }

    /// Fires the ready callbacks; `false` if the device is lost. Never a timed `Wait`: gfx-rs/wgpu#9958 aborts on it.
    pub fn poll(&self) -> bool {
        if EXITING.load(Ordering::Acquire) {
            return false;
        }
        let _exclusive = self.poll_lock.lock();
        instance()
            .device_poll(self.device, wgt::PollType::Poll)
            .is_ok()
    }

    /// Runs `f` while no [`poll`](Self::poll) runs. A poll on the pool thread maps buffers, and it frees every mapping when it finds the device lost.
    pub fn exclusive<R>(&self, f: impl FnOnce() -> R) -> R {
        let _exclusive = self.poll_lock.lock();
        f()
    }
}

impl Drop for Device {
    fn drop(&mut self) {
        let (device, queue) = (self.device, self.queue);
        if EXITING.load(Ordering::Acquire) {
            return;
        }
        if let Some(live) = DEVICES.lock().iter_mut().find(|live| live.id == device) {
            live.releasing = true;
        }
        // Not here: this is the JS thread, often inside a finalizer, and the wait can be long.
        let spawned = std::thread::Builder::new()
            .name(String::from("bun-webgpu-release"))
            .spawn(move || release_device(device, queue));
        if spawned.is_err() {
            release_device(device, queue);
        }
    }
}

/// The `GPUError` subclasses. src/js/internal/webgpu.ts indexes its class table with the discriminant.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum ErrorKind {
    Validation = 0,
    OutOfMemory = 1,
    Internal = 2,
}

/// `GPUErrorFilter`.
pub fn parse_error_filter(s: &[u8]) -> Option<ErrorKind> {
    match s {
        b"validation" => Some(ErrorKind::Validation),
        b"out-of-memory" => Some(ErrorKind::OutOfMemory),
        b"internal" => Some(ErrorKind::Internal),
        _ => None,
    }
}

/// A wgpu-core error flattened for delivery to JS.
#[derive(Debug)]
pub struct GpuError {
    pub kind: ErrorKind,
    pub message: String,
    /// The device is lost. WebGPU drops operations on a lost device without a report.
    pub device_lost: bool,
}

impl GpuError {
    pub fn validation(message: impl Into<String>) -> Self {
        Self {
            kind: ErrorKind::Validation,
            message: message.into(),
            device_lost: false,
        }
    }

    pub fn from_wgpu(err: &(impl wgt::error::WebGpuError + 'static)) -> Self {
        let (kind, device_lost) = match err.webgpu_error_type() {
            wgt::error::ErrorType::Validation => (ErrorKind::Validation, false),
            wgt::error::ErrorType::OutOfMemory => (ErrorKind::OutOfMemory, false),
            wgt::error::ErrorType::Internal => (ErrorKind::Internal, false),
            wgt::error::ErrorType::DeviceLost => (ErrorKind::Internal, true),
        };
        Self {
            kind,
            message: error_chain(err),
            device_lost,
        }
    }
}

/// `err` and every `source()` below it, one per line, indented by depth.
pub fn error_chain(err: &(dyn core::error::Error + 'static)) -> String {
    use core::fmt::Write;
    let mut out = err.to_string();
    let mut depth = 1usize;
    let mut source = err.source();
    while let Some(e) = source {
        out.push('\n');
        for _ in 0..depth {
            out.push_str("  ");
        }
        let _ = write!(out, "{e}");
        depth += 1;
        source = e.source();
    }
    out
}
