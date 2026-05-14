use std::sync::Arc;

/// Shared state owned by GPUDevice and borrowed (via Arc) by GPUQueue, GPUBuffer, etc.
pub struct GpuDeviceInner {
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    pub adapter_info: wgpu::AdapterInfo,
}

impl GpuDeviceInner {
    pub fn new(
        device: wgpu::Device,
        queue: wgpu::Queue,
        adapter_info: wgpu::AdapterInfo,
    ) -> Arc<Self> {
        device.on_uncaptured_error(std::sync::Arc::new(|error: wgpu::Error| {
            eprintln!("WebGPU uncaptured error: {}", error);
        }));
        Arc::new(Self {
            device,
            queue,
            adapter_info,
        })
    }
}
