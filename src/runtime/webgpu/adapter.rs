use core::cell::Cell;
use core::ffi::c_void;
use core::sync::atomic::{AtomicBool, Ordering};
use std::rc::Rc;

use bun_jsc::bindgen::{JsHeap, JsScope};
use bun_jsc::{DOMExceptionCode, JSGlobalObject, JSPromise, JSValue, JsClass as _, JsResult};
use bun_ptr::{JsCell, RefPtr};

use super::device::{DeviceState, GPUDevice};
use super::instance::Instance;
use super::{
    GPUSupportedFeatures, WGSLLanguageFeatures, WebEnum as _, bytes_of_view, dom_exception,
    new_object, optional_to_sys, string_of_view, string_view, sys, to_sys_bool,
};
use crate::generated_bindgen::webgpu::{
    GPUDeviceDescriptor, GPUFeatureName, GPURequestAdapterOptions, GPUTextureFormat,
};

// ───────────────────────────── GPU ─────────────────────────────

pub(crate) struct GPU {
    /// Made when it is first needed: it loads nothing, but it is not free.
    instance: JsCell<Option<RefPtr<Instance>>>,
}

pub(crate) fn create_gpu(heap: &JsHeap<'_>) -> JSValue {
    let gpu = GPU {
        instance: JsCell::new(None),
    };
    new_object(heap, gpu)
}

static USES_NULL_BACKEND: AtomicBool = AtomicBool::new(false);

/// For tests: from here on adapters are of Dawn's Null backend, which validates every call, runs nothing on a GPU and
/// needs none.
pub(crate) fn use_null_backend_for_testing(use_it: bool) {
    USES_NULL_BACKEND.store(use_it, Ordering::Relaxed);
}

/// One backend for each OS, as `scripts/build/deps/dawn.ts` compiles them.
fn backend_type() -> sys::WGPUBackendType {
    if USES_NULL_BACKEND.load(Ordering::Relaxed) {
        sys::WGPUBackendType::Null
    } else if cfg!(target_os = "macos") {
        sys::WGPUBackendType::Metal
    } else if cfg!(windows) {
        sys::WGPUBackendType::D3D12
    } else {
        sys::WGPUBackendType::Vulkan
    }
}

/// What WGSL calls each language feature that it has. `webgpu.h` has numbers alone.
const WGSL_LANGUAGE_FEATURES: &[(sys::WGPUWGSLLanguageFeatureName, &str)] = {
    use sys::WGPUWGSLLanguageFeatureName as Name;
    &[
        (
            Name::ReadonlyAndReadwriteStorageTextures,
            "readonly_and_readwrite_storage_textures",
        ),
        (
            Name::Packed4x8IntegerDotProduct,
            "packed_4x8_integer_dot_product",
        ),
        (
            Name::UnrestrictedPointerParameters,
            "unrestricted_pointer_parameters",
        ),
        (Name::PointerCompositeAccess, "pointer_composite_access"),
        (
            Name::UniformBufferStandardLayout,
            "uniform_buffer_standard_layout",
        ),
        (Name::SubgroupId, "subgroup_id"),
        (Name::TextureAndSamplerLet, "texture_and_sampler_let"),
        (Name::SubgroupUniformity, "subgroup_uniformity"),
        (Name::TextureFormatsTier1, "texture_formats_tier1"),
        (Name::LinearIndexing, "linear_indexing"),
        (Name::ImmediateAddressSpace, "immediate_address_space"),
        (Name::BufferView, "buffer_view"),
        (Name::SwizzleAssignment, "swizzle_assignment"),
        (Name::FragmentDepth, "fragment_depth"),
    ]
};

/// From here on the numbers are Dawn's own, for what is not in WGSL.
const FIRST_LANGUAGE_FEATURE_OF_DAWN: u32 = 0x0005_0000;

const _: () = {
    let all = sys::WGPUWGSLLanguageFeatureName::ALL;
    let (mut of_wgsl, mut i) = (0, 0);
    while i < all.len() {
        if all[i].1.0 < FIRST_LANGUAGE_FEATURE_OF_DAWN {
            of_wgsl += 1;
        }
        i += 1;
    }
    assert!(
        of_wgsl == WGSL_LANGUAGE_FEATURES.len(),
        "webgpu.h has a language feature of WGSL that WGSL_LANGUAGE_FEATURES has no name for"
    );
};

impl GPU {
    fn instance(&self, global: &JSGlobalObject) -> Option<RefPtr<Instance>> {
        if self.instance.get().is_none() {
            self.instance.set(Instance::create(global));
        }
        self.instance.get().clone()
    }

    pub(crate) fn request_adapter<'a>(
        &self,
        cx: &mut JsScope<'a>,
        options: &GPURequestAdapterOptions<'a>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let no_adapter = || Ok(JSPromise::resolved_promise_value(global, JSValue::NULL));
        let feature_level = match options.feature_level {
            b"core" => sys::WGPUFeatureLevel::Core,
            b"compatibility" => sys::WGPUFeatureLevel::Compatibility,
            _ => return no_adapter(),
        };
        let Some(instance) = self.instance(global) else {
            return no_adapter();
        };
        let Some(handle) = instance.handle() else {
            return no_adapter();
        };
        let options = sys::WGPURequestAdapterOptions {
            featureLevel: feature_level,
            powerPreference: optional_to_sys!(options.power_preference, WGPUPowerPreference),
            forceFallbackAdapter: to_sys_bool(options.force_fallback_adapter),
            backendType: backend_type(),
            ..sys::WGPURequestAdapterOptions::INIT
        };
        let (promise, userdata) = instance.new_promise(global, ());
        let callback = sys::WGPURequestAdapterCallbackInfo {
            nextInChain: core::ptr::null_mut(),
            mode: sys::WGPUCallbackMode::AllowProcessEvents,
            callback: Some(on_adapter),
            userdata1: userdata,
            userdata2: core::ptr::null_mut(),
        };
        // SAFETY: a live instance, and options that outlive the call.
        unsafe { sys::wgpuInstanceRequestAdapter(handle, &raw const options, callback) };
        Ok(promise)
    }

    /// There is no canvas. A program that draws to a texture may still ask what format to prefer.
    pub(crate) fn get_preferred_canvas_format(&self) -> GPUTextureFormat {
        GPUTextureFormat::Bgra8unorm
    }

    pub(crate) fn get_wgsl_language_features(&self, heap: &JsHeap<'_>) -> JSValue {
        // SAFETY: making Dawn's instance runs no JavaScript.
        let instance = self.instance(unsafe { heap.global() });
        let mut names = Vec::new();
        if let Some(handle) = instance.as_ref().and_then(|instance| instance.handle()) {
            for (feature, name) in WGSL_LANGUAGE_FEATURES {
                // SAFETY: a live instance.
                if unsafe { sys::wgpuInstanceHasWGSLLanguageFeature(handle, *feature) } != 0 {
                    names.push(bun_core::String::static_(name));
                }
            }
        }
        new_object(heap, WGSLLanguageFeatures::new(names))
    }
}

unsafe extern "C" fn on_adapter(
    status: sys::WGPURequestAdapterStatus,
    adapter: sys::WGPUAdapter,
    _message: sys::WGPUStringView,
    userdata1: *mut c_void,
    _userdata2: *mut c_void,
) {
    // SAFETY: `request_adapter` passed what `new_promise` gave it.
    let (settle, ()) = unsafe { Instance::finish::<()>(userdata1) };
    let adapter = (!adapter.is_null()).then(|| GPUAdapter {
        handle: adapter,
        instance: settle.instance().clone(),
        is_consumed: Rc::new(Cell::new(false)),
    });
    settle.with(|global| match adapter {
        Some(adapter) if status == sys::WGPURequestAdapterStatus::Success => {
            Ok(adapter.to_js(global))
        }
        _ => Ok(JSValue::NULL),
    });
}

// ───────────────────────────── GPUSupportedFeatures ─────────────────────────────

/// # Safety
/// `get` fills in what it is given, for `wgpuSupportedFeaturesFreeMembers` to free.
pub(super) unsafe fn supported_features(
    get: impl FnOnce(*mut sys::WGPUSupportedFeatures),
) -> GPUSupportedFeatures {
    let mut features = sys::WGPUSupportedFeatures::INIT;
    get(&raw mut features);
    let list = if features.featureCount == 0 {
        &[][..]
    } else {
        // SAFETY: fn contract.
        unsafe { core::slice::from_raw_parts(features.features, features.featureCount) }
    };
    // Dawn has features of its own, which have no name here.
    let names = list
        .iter()
        .filter_map(|&feature| GPUFeatureName::from_sys(feature))
        .map(|feature| bun_core::String::static_(GPUFeatureName::SPELLINGS[feature as usize]))
        .collect();
    // SAFETY: fn contract.
    unsafe { sys::wgpuSupportedFeaturesFreeMembers(features) };
    GPUSupportedFeatures::new(names)
}

// ───────────────────────────── GPUSupportedLimits ─────────────────────────────

pub(crate) struct GPUSupportedLimits {
    limits: sys::WGPULimits,
    compatibility: sys::WGPUCompatibilityModeLimits,
}

enum LimitError {
    Unknown,
    TooLarge,
    TooSmall,
}

macro_rules! limits {
    ($($getter:ident, $name:literal, $part:ident.$field:ident: $Type:ty $(, at_least $least:literal)?;)*) => {
        impl GPUSupportedLimits {
            $(pub(crate) fn $getter(&self) -> $Type {
                self.$part.$field $(.max($least))?
            })*

            fn set(&mut self, name: &bun_core::String, value: u64) -> Result<(), LimitError> {
                $(if name.eq_ascii($name.as_bytes()) {
                    $(if value < $least {
                        return Err(LimitError::TooSmall);
                    })?
                    // The largest number of the type is how `webgpu.h` says that a limit is undefined.
                    self.$part.$field = <$Type>::try_from(value)
                        .ok()
                        .filter(|&value| value != <$Type>::MAX)
                        .ok_or(LimitError::TooLarge)?;
                    return Ok(());
                })*
                Err(LimitError::Unknown)
            }
        }
    };
}

// `at_least`: WebGPU has no adapter go lower. Dawn reports what the driver does, which can be lower.
limits! {
    get_max_texture_dimension1_d, "maxTextureDimension1D", limits.maxTextureDimension1D: u32;
    get_max_texture_dimension2_d, "maxTextureDimension2D", limits.maxTextureDimension2D: u32;
    get_max_texture_dimension3_d, "maxTextureDimension3D", limits.maxTextureDimension3D: u32;
    get_max_texture_array_layers, "maxTextureArrayLayers", limits.maxTextureArrayLayers: u32;
    get_max_bind_groups, "maxBindGroups", limits.maxBindGroups: u32;
    get_max_bind_groups_plus_vertex_buffers, "maxBindGroupsPlusVertexBuffers", limits.maxBindGroupsPlusVertexBuffers: u32;
    get_max_immediate_size, "maxImmediateSize", limits.maxImmediateSize: u32;
    get_max_bindings_per_bind_group, "maxBindingsPerBindGroup", limits.maxBindingsPerBindGroup: u32;
    get_max_dynamic_uniform_buffers_per_pipeline_layout, "maxDynamicUniformBuffersPerPipelineLayout", limits.maxDynamicUniformBuffersPerPipelineLayout: u32;
    get_max_dynamic_storage_buffers_per_pipeline_layout, "maxDynamicStorageBuffersPerPipelineLayout", limits.maxDynamicStorageBuffersPerPipelineLayout: u32;
    get_max_sampled_textures_per_shader_stage, "maxSampledTexturesPerShaderStage", limits.maxSampledTexturesPerShaderStage: u32;
    get_max_samplers_per_shader_stage, "maxSamplersPerShaderStage", limits.maxSamplersPerShaderStage: u32;
    get_max_storage_buffers_per_shader_stage, "maxStorageBuffersPerShaderStage", limits.maxStorageBuffersPerShaderStage: u32;
    get_max_storage_buffers_in_vertex_stage, "maxStorageBuffersInVertexStage", compatibility.maxStorageBuffersInVertexStage: u32;
    get_max_storage_buffers_in_fragment_stage, "maxStorageBuffersInFragmentStage", compatibility.maxStorageBuffersInFragmentStage: u32;
    get_max_storage_textures_per_shader_stage, "maxStorageTexturesPerShaderStage", limits.maxStorageTexturesPerShaderStage: u32;
    get_max_storage_textures_in_vertex_stage, "maxStorageTexturesInVertexStage", compatibility.maxStorageTexturesInVertexStage: u32;
    get_max_storage_textures_in_fragment_stage, "maxStorageTexturesInFragmentStage", compatibility.maxStorageTexturesInFragmentStage: u32;
    get_max_uniform_buffers_per_shader_stage, "maxUniformBuffersPerShaderStage", limits.maxUniformBuffersPerShaderStage: u32;
    get_max_uniform_buffer_binding_size, "maxUniformBufferBindingSize", limits.maxUniformBufferBindingSize: u64;
    get_max_storage_buffer_binding_size, "maxStorageBufferBindingSize", limits.maxStorageBufferBindingSize: u64;
    get_min_uniform_buffer_offset_alignment, "minUniformBufferOffsetAlignment", limits.minUniformBufferOffsetAlignment: u32, at_least 32;
    get_min_storage_buffer_offset_alignment, "minStorageBufferOffsetAlignment", limits.minStorageBufferOffsetAlignment: u32, at_least 32;
    get_max_vertex_buffers, "maxVertexBuffers", limits.maxVertexBuffers: u32;
    get_max_buffer_size, "maxBufferSize", limits.maxBufferSize: u64;
    get_max_vertex_attributes, "maxVertexAttributes", limits.maxVertexAttributes: u32;
    get_max_vertex_buffer_array_stride, "maxVertexBufferArrayStride", limits.maxVertexBufferArrayStride: u32;
    get_max_inter_stage_shader_variables, "maxInterStageShaderVariables", limits.maxInterStageShaderVariables: u32;
    get_max_color_attachments, "maxColorAttachments", limits.maxColorAttachments: u32;
    get_max_color_attachment_bytes_per_sample, "maxColorAttachmentBytesPerSample", limits.maxColorAttachmentBytesPerSample: u32;
    get_max_compute_workgroup_storage_size, "maxComputeWorkgroupStorageSize", limits.maxComputeWorkgroupStorageSize: u32;
    get_max_compute_invocations_per_workgroup, "maxComputeInvocationsPerWorkgroup", limits.maxComputeInvocationsPerWorkgroup: u32;
    get_max_compute_workgroup_size_x, "maxComputeWorkgroupSizeX", limits.maxComputeWorkgroupSizeX: u32;
    get_max_compute_workgroup_size_y, "maxComputeWorkgroupSizeY", limits.maxComputeWorkgroupSizeY: u32;
    get_max_compute_workgroup_size_z, "maxComputeWorkgroupSizeZ", limits.maxComputeWorkgroupSizeZ: u32;
    get_max_compute_workgroups_per_dimension, "maxComputeWorkgroupsPerDimension", limits.maxComputeWorkgroupsPerDimension: u32;
}

impl GPUSupportedLimits {
    /// Every limit is undefined, which asks Dawn for its default.
    fn undefined() -> Self {
        Self {
            limits: sys::WGPULimits::INIT,
            compatibility: sys::WGPUCompatibilityModeLimits::INIT,
        }
    }

    /// Lends Dawn both structs as the one chain that it reads or fills in.
    fn with_chain<R>(&mut self, f: impl FnOnce(*mut sys::WGPULimits) -> R) -> R {
        self.limits.nextInChain = (&raw mut self.compatibility).cast();
        let result = f(&raw mut self.limits);
        self.limits.nextInChain = core::ptr::null_mut();
        result
    }

    /// What `get`, `wgpuAdapterGetLimits` or `wgpuDeviceGetLimits`, fills in.
    pub(super) fn of(get: impl FnOnce(*mut sys::WGPULimits) -> sys::WGPUStatus) -> Self {
        let mut limits = Self::undefined();
        limits.with_chain(get);
        limits
    }
}

// ───────────────────────────── GPUAdapterInfo ─────────────────────────────

pub(crate) struct GPUAdapterInfo {
    vendor: bun_core::String,
    architecture: bun_core::String,
    device: bun_core::String,
    description: bun_core::String,
    subgroup_min_size: u32,
    subgroup_max_size: u32,
    is_fallback_adapter: bool,
}

impl GPUAdapterInfo {
    /// # Safety
    /// `get` fills in what it is given, for `wgpuAdapterInfoFreeMembers` to free.
    pub(super) unsafe fn of(
        get: impl FnOnce(*mut sys::WGPUAdapterInfo) -> sys::WGPUStatus,
    ) -> Self {
        let mut info = sys::WGPUAdapterInfo::INIT;
        get(&raw mut info);
        // SAFETY: fn contract.
        unsafe {
            // What Dawn calls the device is its name, for people. WebGPU's is an identifier, like the one of PCI.
            let (name, driver) = (bytes_of_view(info.device), bytes_of_view(info.description));
            let description = match (name, driver) {
                (name, b"") => name.to_vec(),
                (b"", driver) => driver.to_vec(),
                (name, driver) => [name, b" (", driver, b")"].concat(),
            };
            let device = match info.deviceID {
                0 => bun_core::String::EMPTY,
                id => bun_core::String::clone_utf8(format!("0x{id:04x}").as_bytes()),
            };
            let result = Self {
                vendor: string_of_view(info.vendor),
                architecture: string_of_view(info.architecture),
                device,
                description: bun_core::String::clone_utf8(&description),
                subgroup_min_size: info.subgroupMinSize,
                subgroup_max_size: info.subgroupMaxSize,
                is_fallback_adapter: info.adapterType == sys::WGPUAdapterType::CPU,
            };
            sys::wgpuAdapterInfoFreeMembers(info);
            result
        }
    }

    pub(crate) fn get_vendor(&self) -> bun_core::String {
        self.vendor.clone()
    }
    pub(crate) fn get_architecture(&self) -> bun_core::String {
        self.architecture.clone()
    }
    pub(crate) fn get_device(&self) -> bun_core::String {
        self.device.clone()
    }
    pub(crate) fn get_description(&self) -> bun_core::String {
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

// ───────────────────────────── GPUAdapter ─────────────────────────────

pub(crate) struct GPUAdapter {
    handle: sys::WGPUAdapter,
    instance: RefPtr<Instance>,
    /// An adapter makes one device. The request that makes it says so.
    is_consumed: Rc<Cell<bool>>,
}

impl Drop for GPUAdapter {
    fn drop(&mut self) {
        // SAFETY: the reference that `on_adapter` was given.
        unsafe { sys::wgpuAdapterRelease(self.handle) }
    }
}

impl GPUAdapter {
    pub(crate) fn get_features(&self, heap: &JsHeap<'_>) -> JSValue {
        // SAFETY: a live adapter.
        let features = unsafe {
            supported_features(|features| sys::wgpuAdapterGetFeatures(self.handle, features))
        };
        new_object(heap, features)
    }

    pub(crate) fn get_limits(&self, heap: &JsHeap<'_>) -> JSValue {
        // SAFETY: a live adapter.
        let limits = GPUSupportedLimits::of(|limits| unsafe {
            sys::wgpuAdapterGetLimits(self.handle, limits)
        });
        new_object(heap, limits)
    }

    pub(crate) fn get_info(&self, heap: &JsHeap<'_>) -> JSValue {
        // SAFETY: a live adapter.
        let info = unsafe { GPUAdapterInfo::of(|info| sys::wgpuAdapterGetInfo(self.handle, info)) };
        new_object(heap, info)
    }

    pub(crate) fn request_device(
        &self,
        cx: &mut JsScope<'_>,
        descriptor: &GPUDeviceDescriptor,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        if self.is_consumed.get() {
            return Err(global.throw_dom_exception(
                DOMExceptionCode::OperationError,
                format_args!("This adapter has already made a device. Request another adapter."),
            ));
        }

        let features: Vec<sys::WGPUFeatureName> = descriptor
            .required_features
            .iter()
            .map(|feature| feature.to_sys())
            .collect();
        for (feature, name) in features.iter().zip(&descriptor.required_features) {
            // SAFETY: a live adapter.
            if unsafe { sys::wgpuAdapterHasFeature(self.handle, *feature) } == 0 {
                return Err(global.throw_type_error(format_args!(
                    "The adapter does not have the feature \"{}\"",
                    GPUFeatureName::SPELLINGS[*name as usize]
                )));
            }
        }

        let mut limits = GPUSupportedLimits::undefined();
        for (name, value) in &descriptor.required_limits {
            let Some(value) = *value else { continue };
            limits.set(name, value).map_err(|error| {
                let problem = match error {
                    LimitError::Unknown => "is not a limit",
                    LimitError::TooLarge => "is more than the adapter has",
                    LimitError::TooSmall => "is less than the adapter has",
                };
                global.throw_dom_exception(
                    DOMExceptionCode::OperationError,
                    format_args!("requiredLimits: \"{name}\" {problem}"),
                )
            })?;
        }

        let state = DeviceState::new(self.instance.clone());
        let label = descriptor.label.to_utf8();
        let queue_label = descriptor.default_queue.label.to_utf8();
        let request = DeviceRequest {
            is_adapter_consumed: Rc::clone(&self.is_consumed),
            state: state.clone(),
            label: descriptor.label.clone(),
            queue_label: descriptor.default_queue.label.clone(),
        };
        let (promise, userdata) = self.instance.new_promise(global, request);
        // Dawn makes the device before the call returns, and this mode has it say so before then too: the next
        // request, which need not wait for this one's promise, finds the adapter consumed if and only if this made one.
        let callback = sys::WGPURequestDeviceCallbackInfo {
            nextInChain: core::ptr::null_mut(),
            mode: sys::WGPUCallbackMode::AllowSpontaneous,
            callback: Some(on_device),
            userdata1: userdata,
            userdata2: core::ptr::null_mut(),
        };
        limits.with_chain(|limits| {
            let descriptor = sys::WGPUDeviceDescriptor {
                label: string_view(&label),
                requiredFeatureCount: features.len(),
                requiredFeatures: features.as_ptr(),
                requiredLimits: limits,
                defaultQueue: sys::WGPUQueueDescriptor {
                    label: string_view(&queue_label),
                    ..sys::WGPUQueueDescriptor::INIT
                },
                deviceLostCallbackInfo: DeviceState::lost_callback(state.clone()),
                uncapturedErrorCallbackInfo: DeviceState::error_callback(&state),
                ..sys::WGPUDeviceDescriptor::INIT
            };
            // SAFETY: a live adapter, and a descriptor that outlives the call with all it points at.
            unsafe { sys::wgpuAdapterRequestDevice(self.handle, &raw const descriptor, callback) };
        });
        Ok(promise)
    }
}

struct DeviceRequest {
    is_adapter_consumed: Rc<Cell<bool>>,
    state: RefPtr<DeviceState>,
    label: bun_core::String,
    queue_label: bun_core::String,
}

unsafe extern "C" fn on_device(
    status: sys::WGPURequestDeviceStatus,
    device: sys::WGPUDevice,
    message: sys::WGPUStringView,
    userdata1: *mut c_void,
    _userdata2: *mut c_void,
) {
    // SAFETY: `request_device` passed what `new_promise` gave it.
    let (settle, request) = unsafe { Instance::finish::<DeviceRequest>(userdata1) };
    let device = (!device.is_null())
        .then(|| GPUDevice::create(device, &request.label, request.state, request.queue_label));
    // SAFETY: Dawn's, until this returns.
    let message = unsafe { super::bytes_of_view(message) };
    settle.with(|global| match device {
        Some(device) if status == sys::WGPURequestDeviceStatus::Success => {
            request.is_adapter_consumed.set(true);
            Ok(device.into_js(global))
        }
        _ => Err(dom_exception(
            global,
            DOMExceptionCode::OperationError,
            message,
        )),
    });
}
