use core::ffi::c_void;

use bun_jsc::bindgen::{JsHeap, JsScope};
use bun_jsc::{JSValue, JsClass as _, JsResult};

use super::device::DeviceRef;
use super::instance::Instance;
use super::{
    Bun__WebGPU__freeze, GPUDevice, WebEnum as _, gpu_object, new_object, string_of_view,
    string_view, sys,
};
use crate::generated_bindgen::webgpu::{
    GPUCompilationMessageType, GPUShaderModuleDescriptor, js_GPUCompilationInfo,
};

gpu_object! {
    GPUShaderModule {
        handle: WGPUShaderModule,
        release: wgpuShaderModuleRelease,
        set_label: wgpuShaderModuleSetLabel,
        device: DeviceRef,
    }
}

impl GPUDevice {
    /// `compilationHints` only let an implementation start early on what a pipeline asks for later.
    pub(crate) fn create_shader_module<'a>(
        &self,
        heap: &JsHeap<'a>,
        descriptor: &GPUShaderModuleDescriptor<'a>,
    ) -> JSValue {
        let label = descriptor.label.to_utf8();
        let mut source = sys::WGPUShaderSourceWGSL {
            code: string_view(descriptor.code),
            ..sys::WGPUShaderSourceWGSL::INIT
        };
        let sys_descriptor = sys::WGPUShaderModuleDescriptor {
            nextInChain: (&raw mut source).cast(),
            label: string_view(&label),
        };
        // SAFETY: a live device, and a descriptor that outlives the call with all it points at.
        let handle =
            unsafe { sys::wgpuDeviceCreateShaderModule(self.handle, &raw const sys_descriptor) };
        new_object(
            heap,
            GPUShaderModule::new(handle, &descriptor.label, self.device_ref()),
        )
    }
}

impl GPUShaderModule {
    pub(crate) fn get_compilation_info(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let (promise, userdata) = self
            .device
            .state
            .instance
            .new_promise(cx.global(), self.device.clone());
        let callback = sys::WGPUCompilationInfoCallbackInfo {
            nextInChain: core::ptr::null_mut(),
            mode: sys::WGPUCallbackMode::AllowProcessEvents,
            callback: Some(on_compilation_info),
            userdata1: userdata,
            userdata2: core::ptr::null_mut(),
        };
        // SAFETY: a live shader module.
        unsafe { sys::wgpuShaderModuleGetCompilationInfo(self.handle, callback) };
        Ok(promise)
    }
}

unsafe extern "C" fn on_compilation_info(
    _status: sys::WGPUCompilationInfoRequestStatus,
    info: *const sys::WGPUCompilationInfo,
    userdata1: *mut c_void,
    _userdata2: *mut c_void,
) {
    // SAFETY: `get_compilation_info` passed what `new_promise` gave it.
    let (settle, _device) = unsafe { Instance::finish::<DeviceRef>(userdata1) };
    // SAFETY: Dawn's, until this returns. Null if the request was cancelled.
    let messages = match unsafe { info.as_ref() } {
        // SAFETY: that many messages, which are Dawn's for as long.
        Some(info) if info.messageCount > 0 => unsafe {
            core::slice::from_raw_parts(info.messages, info.messageCount)
        },
        _ => &[],
    };
    settle.with_result(|global| {
        let array = JSValue::create_empty_array(global, messages.len())?;
        for (index, message) in messages.iter().enumerate() {
            // SAFETY: Dawn's, until this returns.
            let message = unsafe { GPUCompilationMessage::of(message) };
            array.put_index(global, index as u32, message.to_js(global))?;
        }
        // SAFETY: an array that nothing else has seen.
        unsafe { Bun__WebGPU__freeze(global.as_mut_ptr(), array) };
        let info = GPUCompilationInfo.to_js(global);
        js_GPUCompilationInfo::messages_set_cached(info, global, array);
        Ok(info)
    });
}

/// Its `messages` are an internal field.
pub(crate) struct GPUCompilationInfo;

pub(crate) struct GPUCompilationMessage {
    message: bun_core::String,
    kind: GPUCompilationMessageType,
    line_num: u64,
    line_pos: u64,
    offset: u64,
    length: u64,
}

impl GPUCompilationMessage {
    /// # Safety
    /// Dawn made `message`, and has not freed what it points at.
    unsafe fn of(message: &sys::WGPUCompilationMessage) -> Self {
        let mut result = Self {
            // SAFETY: fn contract.
            message: unsafe { string_of_view(message.message) },
            kind: GPUCompilationMessageType::from_sys(message.r#type)
                .unwrap_or(GPUCompilationMessageType::Info),
            line_num: message.lineNum,
            line_pos: message.linePos,
            offset: message.offset,
            length: message.length,
        };
        // Those count bytes of UTF-8. JavaScript counts UTF-16 code units, which Dawn gives beside them.
        let mut next = message.nextInChain;
        // SAFETY: fn contract.
        while let Some(chained) = unsafe { next.as_ref() } {
            if chained.sType == sys::WGPUSType::DawnCompilationMessageUtf16 {
                // SAFETY: what the type says it is.
                let utf16 = unsafe { &*next.cast::<sys::WGPUDawnCompilationMessageUtf16>() };
                result.line_pos = utf16.linePos;
                result.offset = utf16.offset;
                result.length = utf16.length;
            }
            next = chained.next;
        }
        result
    }

    pub(crate) fn get_message(&self) -> bun_core::String {
        self.message.clone()
    }
    pub(crate) fn get_type(&self) -> GPUCompilationMessageType {
        self.kind
    }
    pub(crate) fn get_line_num(&self) -> u64 {
        self.line_num
    }
    pub(crate) fn get_line_pos(&self) -> u64 {
        self.line_pos
    }
    pub(crate) fn get_offset(&self) -> u64 {
        self.offset
    }
    pub(crate) fn get_length(&self) -> u64 {
        self.length
    }
}
