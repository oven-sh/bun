//! The JS-independent half of WebGPU: the wgpu instance, id handles, errors, and name tables.

use std::sync::OnceLock;
use std::time::Duration;

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

/// A device and its queue. wgpu-core keeps the device alive while its resources exist.
pub struct Device {
    device: id::DeviceId,
    queue: id::QueueId,
}

impl Device {
    pub fn new(device: id::DeviceId, queue: id::QueueId) -> Self {
        Self { device, queue }
    }
    #[inline]
    pub fn id(&self) -> id::DeviceId {
        self.device
    }
    #[inline]
    pub fn queue_id(&self) -> id::QueueId {
        self.queue
    }

    /// Blocks until `submission` finishes or `timeout` passes, then fires the ready callbacks.
    pub fn wait(&self, submission: wgc::SubmissionIndex, timeout: Duration) -> WaitOutcome {
        let poll = wgt::PollType::Wait {
            submission_index: Some(submission),
            timeout: Some(timeout),
        };
        match instance().device_poll(self.device, poll) {
            Ok(_) => WaitOutcome::Finished,
            Err(wgc::device::WaitIdleError::Timeout) => WaitOutcome::TimedOut,
            Err(_) => WaitOutcome::Failed,
        }
    }

    /// Fires the callbacks that are ready, without waiting for the GPU.
    pub fn poll(&self) {
        let _ = instance().device_poll(self.device, wgt::PollType::Poll);
    }
}

/// How [`Device::wait`] ended.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum WaitOutcome {
    /// The submission is done and the callbacks that were ready have run.
    Finished,
    TimedOut,
    /// The device is lost or the wait itself failed. Waiting again will not help.
    Failed,
}

impl Drop for Device {
    fn drop(&mut self) {
        let global = instance();
        global.queue_drop(self.queue);
        global.device_drop(self.device);
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
