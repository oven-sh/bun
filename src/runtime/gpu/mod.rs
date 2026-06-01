pub mod GPU;
pub mod GPUAdapter;
pub mod GPUBindGroup;
pub mod GPUBindGroupLayout;
pub mod GPUBuffer;
pub mod GPUCommandBuffer;
pub mod GPUCommandEncoder;
pub mod GPUComputePassEncoder;
pub mod GPUComputePipeline;
pub mod GPUDevice;
pub mod GPUPipelineLayout;
pub mod GPUQueue;
pub mod GPUShaderModule;
pub mod inner;

// The codegen expects `crate::gpu::gpu::TypeName`, so re-export structs here.
pub mod gpu {
    pub use super::GPU::GPU;
    pub use super::GPUAdapter::GPUAdapter;
    pub use super::GPUBindGroup::GPUBindGroup;
    pub use super::GPUBindGroupLayout::GPUBindGroupLayout;
    pub use super::GPUBuffer::GPUBuffer;
    pub use super::GPUCommandBuffer::GPUCommandBuffer;
    pub use super::GPUCommandEncoder::GPUCommandEncoder;
    pub use super::GPUComputePassEncoder::GPUComputePassEncoder;
    pub use super::GPUComputePipeline::GPUComputePipeline;
    pub use super::GPUDevice::GPUDevice;
    pub use super::GPUPipelineLayout::GPUPipelineLayout;
    pub use super::GPUQueue::GPUQueue;
    pub use super::GPUShaderModule::GPUShaderModule;
}
