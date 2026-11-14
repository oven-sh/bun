use core::cell::OnceCell;
use std::rc::Rc;

use bun_core::String;
use bun_dawn_sys::{self as dawn, AllLimits, FeatureName, OwnedAdapter};
use bun_jsc::bindgen::{JsHeap, JsPayload as _, JsScope, JsWrapper, Result, SetLike};
use bun_jsc::compiled_program::is_write_execute_memory_denied;
use bun_jsc::{DOMExceptionCode, JSValue, JsClass as _, Strong};

use super::device::{GPUDevice, check_stack};
use super::idl;
use super::instance::{Deferred, Instance};

#[derive(Default)]
pub(crate) struct GPU {
    instance: OnceCell<Rc<Instance>>,
}

impl GPU {
    fn instance(&self) -> &Rc<Instance> {
        self.instance.get_or_init(Instance::new)
    }

    pub(crate) fn request_adapter<'a>(
        &self,
        cx: &mut JsScope<'a>,
        options: &idl::GPURequestAdapterOptions<'a>,
    ) -> Result<'a, JSValue> {
        check_stack(&cx.heap)?;
        let feature_level = match options.feature_level {
            b"core" => Some(dawn::FeatureLevel::Core),
            b"compatibility" => Some(dawn::FeatureLevel::Compatibility),
            _ => None,
        };
        let instance = self.instance();
        let adapter = feature_level.and_then(|feature_level| {
            instance.dawn()?.request_adapter(
                feature_level,
                (options.power_preference).map_or(dawn::PowerPreference::Undefined, Into::into),
                options.force_fallback_adapter,
            )
        });
        // A driver that runs on the CPU turns shaders into machine code, and crashes where that cannot run.
        let adapter = adapter.filter(|dawn| {
            !is_write_execute_memory_denied()
                || !GPUAdapterInfo::read(&|info| dawn.get_info(info)).is_fallback_adapter
        });
        let adapter = adapter.map(|dawn| GPUAdapter {
            dawn,
            instance: Rc::clone(instance),
        });

        let (deferred, promise) = Deferred::new(instance, cx);
        deferred.complete(move |global, promise| {
            let adapter = adapter.map_or(JSValue::NULL, |adapter| adapter.to_js(global));
            promise.resolve(global, adapter)
        });
        Ok(promise)
    }

    pub(crate) fn get_preferred_canvas_format(&self) -> idl::GPUTextureFormat {
        if cfg!(target_os = "android") {
            idl::GPUTextureFormat::Rgba8unorm
        } else {
            idl::GPUTextureFormat::Bgra8unorm
        }
    }

    pub(crate) fn get_wgsl_language_features<'a>(
        &self,
        heap: &JsHeap<'a>,
    ) -> JsWrapper<'a, WGSLLanguageFeatures> {
        let mut supported = dawn::SupportedWGSLLanguageFeatures::default();
        if let Some(instance) = self.instance().dawn() {
            instance.get_wgsl_language_features(&mut supported);
        }
        let names = supported.features().iter();
        WGSLLanguageFeatures(names.filter_map(|feature| feature.name()).collect()).into_js(heap)
    }
}

pub(crate) struct GPUAdapter {
    dawn: OwnedAdapter,
    instance: Rc<Instance>,
}

/// <https://gpuweb.github.io/gpuweb/#adapter-capability-guarantees>. Dawn passes on what the driver says.
const MIN_OFFSET_ALIGNMENT: u32 = 32;

fn offset_alignments(limits: &mut AllLimits) -> [&mut u32; 2] {
    [
        &mut limits.core.min_uniform_buffer_offset_alignment,
        &mut limits.core.min_storage_buffer_offset_alignment,
    ]
}

impl GPUAdapter {
    pub(crate) fn request_device<'a>(
        &self,
        cx: &mut JsScope<'a>,
        descriptor: &idl::GPUDeviceDescriptor,
    ) -> Result<'a, JSValue> {
        check_stack(&cx.heap)?;
        let required_features: Vec<FeatureName> = (descriptor.required_features.iter())
            .map(|&feature| feature.into())
            .collect();
        let mut features = required_features.iter();
        if let Some(missing) =
            features.find(|&&feature| !bool::from(self.dawn.has_feature(feature)))
        {
            return Err(cx.heap.type_error(format_args!(
                "The adapter does not support the feature \"{}\"",
                missing.name().unwrap_or_default()
            )));
        }

        let mut required_limits = AllLimits::default();
        for (name, value) in &descriptor.required_limits {
            if let Some(value) = *value {
                set_limit(&cx.heap, &mut required_limits, name, value)?;
            }
        }
        for &mut alignment in offset_alignments(&mut required_limits) {
            if alignment < MIN_OFFSET_ALIGNMENT {
                return Err(cx.heap.dom_exception(
                    DOMExceptionCode::OperationError,
                    format_args!("The adapter does not support an offset alignment of {alignment}"),
                ));
            }
        }

        let device = GPUDevice::request(
            cx,
            &self.instance,
            &self.dawn,
            descriptor,
            &required_features,
            required_limits,
        )
        .map(|device| Strong::create(device, cx.global()));

        let (deferred, promise) = Deferred::new(&self.instance, cx);
        deferred.complete(move |global, promise| match device {
            Ok(device) => promise.resolve(global, device.get()),
            Err(message) => {
                let error = global.create_dom_exception_instance(
                    DOMExceptionCode::OperationError,
                    format_args!("{}", bun_core::fmt::s(&message)),
                );
                promise.reject(global, Ok(error))
            }
        });
        Ok(promise)
    }

    pub(crate) fn get_features<'a>(
        &self,
        heap: &JsHeap<'a>,
    ) -> JsWrapper<'a, GPUSupportedFeatures> {
        GPUSupportedFeatures::read(|features| self.dawn.get_features(features)).into_js(heap)
    }

    pub(crate) fn get_limits<'a>(&self, heap: &JsHeap<'a>) -> JsWrapper<'a, GPUSupportedLimits> {
        let mut limits = self.dawn.all_limits();
        for alignment in offset_alignments(&mut limits) {
            *alignment = MIN_OFFSET_ALIGNMENT.max(*alignment);
        }
        GPUSupportedLimits(limits).into_js(heap)
    }

    pub(crate) fn get_info<'a>(&self, heap: &JsHeap<'a>) -> JsWrapper<'a, GPUAdapterInfo> {
        GPUAdapterInfo::read(&|info| self.dawn.get_info(info)).into_js(heap)
    }
}

pub(crate) struct GPUSupportedFeatures(Vec<&'static str>);

impl GPUSupportedFeatures {
    pub(super) fn read(get_features: impl FnOnce(&mut dawn::SupportedFeatures)) -> Self {
        let mut supported = dawn::SupportedFeatures::default();
        get_features(&mut supported);
        let names = supported.features().iter();
        Self(names.filter_map(|feature| feature.name()).collect())
    }
}

impl SetLike for GPUSupportedFeatures {
    fn set_values(&self) -> &[&'static str] {
        &self.0
    }
}

pub(crate) struct WGSLLanguageFeatures(Vec<&'static str>);

impl SetLike for WGSLLanguageFeatures {
    fn set_values(&self) -> &[&'static str] {
        &self.0
    }
}

pub(crate) struct GPUSupportedLimits(pub(super) AllLimits);

macro_rules! limits {
    ($($name:literal $getter:ident $group:ident.$field:ident: $type:ty,)*) => {
        impl GPUSupportedLimits {
            $(pub(crate) fn $getter(&self) -> $type {
                self.0.$group.$field
            })*
        }

        fn set_limit<'a>(
            heap: &JsHeap<'a>,
            limits: &mut AllLimits,
            name: &[u8],
            value: u64,
        ) -> Result<'a, ()> {
            let problem = match name {
                // The maximum means that the limit is not required.
                $($name => match <$type>::try_from(value) {
                    Ok(value) if value < <$type>::MAX => {
                        limits.$group.$field = value;
                        return Ok(());
                    }
                    _ => "is out of range",
                },)*
                _ => "does not exist",
            };
            Err(heap.dom_exception(
                DOMExceptionCode::OperationError,
                format_args!("The limit {} {problem}", bun_core::fmt::quote(name)),
            ))
        }
    };
}

limits! {
    b"maxTextureDimension1D" get_max_texture_dimension_1d core.max_texture_dimension_1d: u32,
    b"maxTextureDimension2D" get_max_texture_dimension_2d core.max_texture_dimension_2d: u32,
    b"maxTextureDimension3D" get_max_texture_dimension_3d core.max_texture_dimension_3d: u32,
    b"maxTextureArrayLayers" get_max_texture_array_layers core.max_texture_array_layers: u32,
    b"maxBindGroups" get_max_bind_groups core.max_bind_groups: u32,
    b"maxBindGroupsPlusVertexBuffers" get_max_bind_groups_plus_vertex_buffers core.max_bind_groups_plus_vertex_buffers: u32,
    b"maxImmediateSize" get_max_immediate_size core.max_immediate_size: u32,
    b"maxBindingsPerBindGroup" get_max_bindings_per_bind_group core.max_bindings_per_bind_group: u32,
    b"maxDynamicUniformBuffersPerPipelineLayout" get_max_dynamic_uniform_buffers_per_pipeline_layout core.max_dynamic_uniform_buffers_per_pipeline_layout: u32,
    b"maxDynamicStorageBuffersPerPipelineLayout" get_max_dynamic_storage_buffers_per_pipeline_layout core.max_dynamic_storage_buffers_per_pipeline_layout: u32,
    b"maxSampledTexturesPerShaderStage" get_max_sampled_textures_per_shader_stage core.max_sampled_textures_per_shader_stage: u32,
    b"maxSamplersPerShaderStage" get_max_samplers_per_shader_stage core.max_samplers_per_shader_stage: u32,
    b"maxStorageBuffersPerShaderStage" get_max_storage_buffers_per_shader_stage core.max_storage_buffers_per_shader_stage: u32,
    b"maxStorageBuffersInVertexStage" get_max_storage_buffers_in_vertex_stage compatibility.max_storage_buffers_in_vertex_stage: u32,
    b"maxStorageBuffersInFragmentStage" get_max_storage_buffers_in_fragment_stage compatibility.max_storage_buffers_in_fragment_stage: u32,
    b"maxStorageTexturesPerShaderStage" get_max_storage_textures_per_shader_stage core.max_storage_textures_per_shader_stage: u32,
    b"maxStorageTexturesInVertexStage" get_max_storage_textures_in_vertex_stage compatibility.max_storage_textures_in_vertex_stage: u32,
    b"maxStorageTexturesInFragmentStage" get_max_storage_textures_in_fragment_stage compatibility.max_storage_textures_in_fragment_stage: u32,
    b"maxUniformBuffersPerShaderStage" get_max_uniform_buffers_per_shader_stage core.max_uniform_buffers_per_shader_stage: u32,
    b"maxUniformBufferBindingSize" get_max_uniform_buffer_binding_size core.max_uniform_buffer_binding_size: u64,
    b"maxStorageBufferBindingSize" get_max_storage_buffer_binding_size core.max_storage_buffer_binding_size: u64,
    b"minUniformBufferOffsetAlignment" get_min_uniform_buffer_offset_alignment core.min_uniform_buffer_offset_alignment: u32,
    b"minStorageBufferOffsetAlignment" get_min_storage_buffer_offset_alignment core.min_storage_buffer_offset_alignment: u32,
    b"maxVertexBuffers" get_max_vertex_buffers core.max_vertex_buffers: u32,
    b"maxBufferSize" get_max_buffer_size core.max_buffer_size: u64,
    b"maxVertexAttributes" get_max_vertex_attributes core.max_vertex_attributes: u32,
    b"maxVertexBufferArrayStride" get_max_vertex_buffer_array_stride core.max_vertex_buffer_array_stride: u32,
    b"maxInterStageShaderVariables" get_max_inter_stage_shader_variables core.max_inter_stage_shader_variables: u32,
    b"maxColorAttachments" get_max_color_attachments core.max_color_attachments: u32,
    b"maxColorAttachmentBytesPerSample" get_max_color_attachment_bytes_per_sample core.max_color_attachment_bytes_per_sample: u32,
    b"maxComputeWorkgroupStorageSize" get_max_compute_workgroup_storage_size core.max_compute_workgroup_storage_size: u32,
    b"maxComputeInvocationsPerWorkgroup" get_max_compute_invocations_per_workgroup core.max_compute_invocations_per_workgroup: u32,
    b"maxComputeWorkgroupSizeX" get_max_compute_workgroup_size_x core.max_compute_workgroup_size_x: u32,
    b"maxComputeWorkgroupSizeY" get_max_compute_workgroup_size_y core.max_compute_workgroup_size_y: u32,
    b"maxComputeWorkgroupSizeZ" get_max_compute_workgroup_size_z core.max_compute_workgroup_size_z: u32,
    b"maxComputeWorkgroupsPerDimension" get_max_compute_workgroups_per_dimension core.max_compute_workgroups_per_dimension: u32,
}

pub(crate) struct GPUAdapterInfo {
    vendor: String,
    architecture: String,
    device: String,
    description: String,
    subgroup_min_size: u32,
    subgroup_max_size: u32,
    is_fallback_adapter: bool,
}

/// <https://gpuweb.github.io/gpuweb/#normalized-identifier-string>
fn normalized_identifier(text: &[u8]) -> String {
    let mut identifier = Vec::with_capacity(text.len());
    let mut is_after_separator = false;
    for character in text {
        if !character.is_ascii_alphanumeric() {
            is_after_separator = true;
            continue;
        }
        if core::mem::take(&mut is_after_separator) && !identifier.is_empty() {
            identifier.push(b'-');
        }
        identifier.push(character.to_ascii_lowercase());
    }
    String::clone_utf8(&identifier)
}

impl GPUAdapterInfo {
    pub(super) fn read(get_info: &dyn Fn(&mut dawn::AdapterInfo) -> dawn::Status) -> Self {
        let mut info = dawn::AdapterInfo::default();
        let status = get_info(&mut info);
        debug_assert!(status == dawn::Status::Success);
        Self {
            vendor: normalized_identifier(info.vendor()),
            architecture: normalized_identifier(info.architecture()),
            device: normalized_identifier(info.device()),
            description: String::clone_utf8(info.description()),
            subgroup_min_size: info.subgroup_min_size,
            subgroup_max_size: info.subgroup_max_size,
            is_fallback_adapter: info.adapter_type == dawn::AdapterType::Cpu,
        }
    }

    pub(crate) fn get_vendor(&self) -> String {
        self.vendor.clone()
    }

    pub(crate) fn get_architecture(&self) -> String {
        self.architecture.clone()
    }

    pub(crate) fn get_device(&self) -> String {
        self.device.clone()
    }

    pub(crate) fn get_description(&self) -> String {
        self.description.clone()
    }

    pub(crate) fn get_subgroup_min_size(&self) -> u32 {
        self.subgroup_min_size
    }

    pub(crate) fn get_subgroup_max_size(&self) -> u32 {
        self.subgroup_max_size
    }

    pub(crate) fn get_is_fallback_adapter(&self) -> bool {
        self.is_fallback_adapter
    }
}
