//! `navigator.gpu`: WebGPU, declared in `webgpu.bind.ts`, over the C API of Dawn (`bun_webgpu_sys`).
//!
//! Dawn is used from the JS thread alone. Every callback it is given is `AllowProcessEvents`, so it runs inside
//! `wgpuInstanceProcessEvents`, which [`Instance`] calls from the event loop while a promise waits for one.

use core::borrow::Borrow;
use core::ffi::c_void;

use bun_core::EncodedSlice;
use bun_jsc::bindgen::{self, JsHeap, JsLocal};
use bun_jsc::{DOMExceptionCode, EncodedSliceJsc as _, JSGlobalObject, JSValue, JsClass};
use bun_webgpu_sys as sys;

mod adapter;
mod bind_group;
mod buffer;
mod command_encoder;
mod device;
mod error;
mod instance;
mod pass_encoder;
mod pipeline;
mod queue;
mod set_like;
mod shader_module;
mod texture;

pub(crate) use adapter::{
    GPU, GPUAdapter, GPUAdapterInfo, GPUSupportedLimits, create_gpu, use_null_backend_for_testing,
};
pub(crate) use bind_group::{GPUBindGroup, GPUBindGroupLayout, GPUPipelineLayout};
pub(crate) use buffer::GPUBuffer;
pub(crate) use command_encoder::{GPUCommandBuffer, GPUCommandEncoder};
pub(crate) use device::{GPUDevice, GPUDeviceLostInfo};
pub(crate) use error::{GPUError, GPUPipelineError, GPUUncapturedErrorEvent};
pub(crate) use instance::Instance;
pub(crate) use pass_encoder::{
    GPUComputePassEncoder, GPURenderBundle, GPURenderBundleEncoder, GPURenderPassEncoder,
};
pub(crate) use pipeline::{GPUComputePipeline, GPURenderPipeline};
pub(crate) use queue::{GPUQueue, is_device_lost_for_testing};
pub(crate) use set_like::{GPUSupportedFeatures, WGSLLanguageFeatures};
pub(crate) use shader_module::{GPUCompilationInfo, GPUCompilationMessage, GPUShaderModule};
pub(crate) use texture::{GPUQuerySet, GPUSampler, GPUTexture, GPUTextureView};

// ───────────────────────────── strings ─────────────────────────────

/// Dawn reads it during the call that it is passed to.
#[inline]
fn string_view(bytes: &[u8]) -> sys::WGPUStringView {
    sys::WGPUStringView {
        data: bytes.as_ptr().cast(),
        length: bytes.len(),
    }
}

/// No string at all, where an empty one means something else.
const NO_STRING: sys::WGPUStringView = sys::WGPUStringView {
    data: core::ptr::null(),
    length: sys::WGPU_STRLEN,
};

#[inline]
fn optional_string_view(bytes: Option<&[u8]>) -> sys::WGPUStringView {
    bytes.map_or(NO_STRING, string_view)
}

/// # Safety
/// Dawn made `view`, and has not freed what it points at.
unsafe fn bytes_of_view<'a>(view: sys::WGPUStringView) -> &'a [u8] {
    if view.data.is_null() {
        return &[];
    }
    if view.length == sys::WGPU_STRLEN {
        // SAFETY: a view of this length ends with a NUL.
        return unsafe { core::ffi::CStr::from_ptr(view.data) }.to_bytes();
    }
    // SAFETY: fn contract.
    unsafe { core::slice::from_raw_parts(view.data.cast(), view.length) }
}

/// # Safety
/// As [`bytes_of_view`].
unsafe fn string_of_view(view: sys::WGPUStringView) -> bun_core::String {
    // SAFETY: forwarded.
    bun_core::String::clone_utf8(unsafe { bytes_of_view(view) })
}

// ───────────────────────────── enumerations ─────────────────────────────

/// `rgba8unorm-srgb` is `RGBA8UnormSrgb`, and `2d-array` is `2DArray`.
const fn is_same_name(web: &str, dawn: &str) -> bool {
    let (web, dawn) = (web.as_bytes(), dawn.as_bytes());
    let (mut i, mut j) = (0, 0);
    loop {
        while i < web.len() && web[i] == b'-' {
            i += 1;
        }
        while j < dawn.len() && dawn[j] == b'_' {
            j += 1;
        }
        if i == web.len() || j == dawn.len() {
            return i == web.len() && j == dawn.len();
        }
        if web[i] != dawn[j].to_ascii_lowercase() {
            return false;
        }
        i += 1;
        j += 1;
    }
}

/// What `webgpu.h` has for each value of an enumeration of the IDL. One that it lacks does not compile.
const fn values_in_dawn<const N: usize>(web: [&str; N], dawn: &[(&str, u32)]) -> [u32; N] {
    let mut values = [0; N];
    let mut i = 0;
    while i < N {
        let mut j = 0;
        while !is_same_name(web[i], dawn[j].0) {
            j += 1;
            assert!(j < dawn.len(), "webgpu.h has no such value");
        }
        values[i] = dawn[j].1;
        i += 1;
    }
    values
}

/// An enumeration of the IDL that `webgpu.h` has under the same names.
trait WebEnum: Copy + 'static {
    type Sys: Copy;
    /// What `webgpu.h` has for each of `ALL`.
    const IN_DAWN: &'static [u32];
    fn to_sys(self) -> Self::Sys;
    /// `None` for what the IDL does not have: `Undefined`, or a value of Dawn's own.
    fn from_sys(value: Self::Sys) -> Option<Self>;
}

macro_rules! web_enums {
    ($($Web:ident => $Sys:ident,)*) => {$(
        impl WebEnum for crate::generated_bindgen::webgpu::$Web {
            type Sys = sys::$Sys;
            const IN_DAWN: &'static [u32] = {
                const COUNT: usize = sys::$Sys::ALL.len();
                const NAMES: [(&str, u32); COUNT] = {
                    let mut names = [("", 0); COUNT];
                    let mut i = 0;
                    while i < COUNT {
                        names[i] = (sys::$Sys::ALL[i].0, sys::$Sys::ALL[i].1.0);
                        i += 1;
                    }
                    names
                };
                &values_in_dawn(Self::SPELLINGS, &NAMES)
            };
            #[inline]
            fn to_sys(self) -> sys::$Sys {
                sys::$Sys(Self::IN_DAWN[self as usize])
            }
            fn from_sys(value: sys::$Sys) -> Option<Self> {
                let index = Self::IN_DAWN.iter().position(|&candidate| candidate == value.0)?;
                Some(Self::ALL[index])
            }
        }
        // Evaluated whether or not anything converts one.
        const _: () = assert!(!<crate::generated_bindgen::webgpu::$Web as WebEnum>::IN_DAWN.is_empty());
    )*};
}

web_enums! {
    GPUAddressMode => WGPUAddressMode,
    GPUBlendFactor => WGPUBlendFactor,
    GPUBlendOperation => WGPUBlendOperation,
    GPUBufferBindingType => WGPUBufferBindingType,
    GPUCompareFunction => WGPUCompareFunction,
    GPUCompilationMessageType => WGPUCompilationMessageType,
    GPUCullMode => WGPUCullMode,
    GPUErrorFilter => WGPUErrorFilter,
    GPUFeatureName => WGPUFeatureName,
    GPUFilterMode => WGPUFilterMode,
    GPUFrontFace => WGPUFrontFace,
    GPUIndexFormat => WGPUIndexFormat,
    GPULoadOp => WGPULoadOp,
    GPUMipmapFilterMode => WGPUMipmapFilterMode,
    GPUPowerPreference => WGPUPowerPreference,
    GPUPrimitiveTopology => WGPUPrimitiveTopology,
    GPUQueryType => WGPUQueryType,
    GPUSamplerBindingType => WGPUSamplerBindingType,
    GPUStencilOperation => WGPUStencilOperation,
    GPUStorageTextureAccess => WGPUStorageTextureAccess,
    GPUStoreOp => WGPUStoreOp,
    GPUTextureAspect => WGPUTextureAspect,
    GPUTextureDimension => WGPUTextureDimension,
    GPUTextureFormat => WGPUTextureFormat,
    GPUTextureSampleType => WGPUTextureSampleType,
    GPUTextureViewDimension => WGPUTextureViewDimension,
    GPUVertexFormat => WGPUVertexFormat,
    GPUVertexStepMode => WGPUVertexStepMode,
}

/// `Undefined`, which is 0 in every enumeration of `webgpu.h`, for a member that is absent.
macro_rules! optional_to_sys {
    ($value:expr, $Sys:ident) => {
        $value.map_or(sys::$Sys(0), crate::webgpu::WebEnum::to_sys)
    };
}
use optional_to_sys;

#[inline]
fn to_sys_bool(value: bool) -> sys::WGPUBool {
    sys::WGPUBool::from(value)
}

// ───────────────────────────── objects ─────────────────────────────

/// The struct of an interface that includes `GPUObjectBase` and owns a reference to an object of Dawn's.
macro_rules! gpu_object {
    (
        $(#[$meta:meta])*
        $Name:ident {
            handle: $Handle:ident,
            release: $release:ident,
            set_label: $set_label:ident,
            $($(#[$field_meta:meta])* $field:ident: $Field:ty,)*
        }
    ) => {
        $(#[$meta])*
        #[derive(bun_ptr::CellRefCounted)]
        pub(crate) struct $Name {
            ref_count: core::cell::Cell<u32>,
            pub(super) handle: sys::$Handle,
            label: bun_ptr::JsCell<bun_core::String>,
            $($(#[$field_meta])* pub(super) $field: $Field,)*
        }

        impl Drop for $Name {
            fn drop(&mut self) {
                // SAFETY: the reference that `new` took over.
                unsafe { sys::$release(self.handle) }
            }
        }

        impl $Name {
            /// Takes over the caller's reference to `handle`, which already has the label.
            pub(super) fn new(handle: sys::$Handle, label: &bun_core::String $(, $field: $Field)*) -> Self {
                debug_assert!(!handle.is_null());
                Self {
                    ref_count: core::cell::Cell::new(1),
                    handle,
                    label: bun_ptr::JsCell::new(label.clone()),
                    $($field,)*
                }
            }

            pub(crate) fn get_label(&self) -> bun_core::String {
                self.label.get().clone()
            }

            pub(crate) fn set_label(&self, label: bun_core::String) {
                // SAFETY: a live object, and a view that outlives the call.
                unsafe { sys::$set_label(self.handle, crate::webgpu::string_view(&label.to_utf8())) };
                self.label.set(label);
            }
        }
    };
}
use gpu_object;

/// The JS object of a new `object`.
#[inline]
fn new_object<T: JsClass>(heap: &JsHeap<'_>, object: T) -> JSValue {
    // SAFETY: making the wrapper of a class allocates and runs no JavaScript.
    object.to_js(unsafe { heap.global() })
}

// ───────────────────────────── errors ─────────────────────────────

fn dom_exception(global: &JSGlobalObject, code: DOMExceptionCode, message: &[u8]) -> JSValue {
    EncodedSlice::utf8(message).to_dom_exception_instance(global, code)
}

fn dom_error<'a>(heap: &JsHeap<'a>, code: DOMExceptionCode, message: &str) -> bindgen::Error<'a> {
    // SAFETY: making a `DOMException` allocates and runs no JavaScript.
    let error = dom_exception(unsafe { heap.global() }, code, message.as_bytes());
    bindgen::Error::from_value(JsLocal::new(heap, error))
}

fn operation_error<'a>(heap: &JsHeap<'a>, message: &str) -> bindgen::Error<'a> {
    dom_error(heap, DOMExceptionCode::OperationError, message)
}

// ───────────────────────────── buffer sources ─────────────────────────────

/// `dataOffset` and `size` count elements of a typed array, and bytes of anything else.
fn bytes_per_element(data: JSValue) -> u64 {
    use bun_jsc::JSType;
    match data.js_type() {
        JSType::Int16Array | JSType::Uint16Array | JSType::Float16Array => 2,
        JSType::Int32Array | JSType::Uint32Array | JSType::Float32Array => 4,
        JSType::Float64Array | JSType::BigInt64Array | JSType::BigUint64Array => 8,
        _ => 1,
    }
}

/// The part of `bytes` that `dataOffset` and `size` name, as `GPUQueue.writeBuffer()` defines it.
fn slice_of_data<'a, 'b>(
    heap: &JsHeap<'a>,
    bytes: &'b [u8],
    bytes_per_element: u64,
    offset: u64,
    size: Option<u64>,
) -> bindgen::Result<'a, &'b [u8]> {
    let length = bytes.len() as u64 / bytes_per_element;
    if offset > length {
        return Err(operation_error(heap, "dataOffset is past the end of data"));
    }
    let size = size.unwrap_or(length - offset);
    if size > length - offset {
        return Err(operation_error(
            heap,
            "dataOffset + size is past the end of data",
        ));
    }
    let start = (offset * bytes_per_element) as usize;
    Ok(&bytes[start..start + (size * bytes_per_element) as usize])
}

// ───────────────────────────── colors, origins, extents ─────────────────────────────

use crate::generated_bindgen::webgpu::{GPUColor, GPUExtent3D, GPUOrigin3D};

fn color_to_sys<'a>(
    heap: &JsHeap<'a>,
    color: impl Borrow<GPUColor>,
) -> bindgen::Result<'a, sys::WGPUColor> {
    match color.borrow() {
        GPUColor::Sequence(sequence) => match sequence[..] {
            [r, g, b, a] => Ok(sys::WGPUColor { r, g, b, a }),
            _ => Err(heap.type_error(format_args!("A sequence that is a GPUColor has 4 elements"))),
        },
        GPUColor::Dict(color) => Ok(sys::WGPUColor {
            r: color.r,
            g: color.g,
            b: color.b,
            a: color.a,
        }),
    }
}

fn origin_to_sys<'a>(
    heap: &JsHeap<'a>,
    origin: Option<&GPUOrigin3D>,
) -> bindgen::Result<'a, sys::WGPUOrigin3D> {
    match origin {
        None => Ok(sys::WGPUOrigin3D { x: 0, y: 0, z: 0 }),
        Some(GPUOrigin3D::Sequence(sequence)) => {
            if sequence.len() > 3 {
                return Err(heap.type_error(format_args!(
                    "A sequence that is a GPUOrigin3D has at most 3 elements"
                )));
            }
            let at = |index: usize| sequence.get(index).copied().unwrap_or(0);
            Ok(sys::WGPUOrigin3D {
                x: at(0),
                y: at(1),
                z: at(2),
            })
        }
        Some(GPUOrigin3D::Dict(origin)) => Ok(sys::WGPUOrigin3D {
            x: origin.x,
            y: origin.y,
            z: origin.z,
        }),
    }
}

fn extent_to_sys<'a>(
    heap: &JsHeap<'a>,
    extent: impl Borrow<GPUExtent3D>,
) -> bindgen::Result<'a, sys::WGPUExtent3D> {
    match extent.borrow() {
        GPUExtent3D::Sequence(sequence) => {
            if sequence.is_empty() || sequence.len() > 3 {
                return Err(heap.type_error(format_args!(
                    "A sequence that is a GPUExtent3D has 1 to 3 elements"
                )));
            }
            let at = |index: usize| sequence.get(index).copied().unwrap_or(1);
            Ok(sys::WGPUExtent3D {
                width: at(0),
                height: at(1),
                depthOrArrayLayers: at(2),
            })
        }
        GPUExtent3D::Dict(extent) => Ok(sys::WGPUExtent3D {
            width: extent.width,
            height: extent.height,
            depthOrArrayLayers: extent.depth_or_array_layers,
        }),
    }
}

// ───────────────────────────── WebGPUBindings.cpp ─────────────────────────────

unsafe extern "C" {
    fn Bun__WebGPU__createMappedRange(
        global: *mut JSGlobalObject,
        data: *mut c_void,
        size: usize,
        buffer: *mut c_void,
        id: u64,
        array_buffer: *mut *mut c_void,
    ) -> JSValue;
    fn Bun__WebGPU__createInstance(log: sys::WGPULoggingCallback) -> sys::WGPUInstance;
    fn Bun__WebGPU__isMappedRangeInUse(array_buffer: *mut c_void) -> bool;
    fn Bun__WebGPU__detachMappedRange(global: *mut JSGlobalObject, array_buffer: *mut c_void);
    fn Bun__WebGPU__createSet(
        global: *mut JSGlobalObject,
        values: *const bun_core::String,
        count: usize,
    ) -> JSValue;
    fn Bun__WebGPU__createSetIterator(
        global: *mut JSGlobalObject,
        set: JSValue,
        entries: bool,
    ) -> JSValue;
    fn Bun__WebGPU__freeze(global: *mut JSGlobalObject, array: JSValue);
}
