//! `GPUShaderModule`.

use std::borrow::Cow;
use std::rc::Rc;

use bun_jsc::{CallFrame, JSGlobalObject, JSPromise, JSValue, JsCell, JsClass, JsResult};
use bun_webgpu::wgc::naga;
use bun_webgpu::wgc::pipeline::{
    CreateShaderModuleError, ShaderModuleDescriptor, ShaderModuleSource,
};
use bun_webgpu::{GpuError, instance, wgt};

use super::args::Dict;
use super::device::DeviceRef;
use super::js_module;

/// Compiled in place of a source that got no compile thread: invalid WGSL, so the module is invalid.
const NOT_COMPILED: &str = "not compiled";

/// What script is told then. The thread's stack is sized for how deep the source can nest, and a source that asks for too much gets no thread.
const NO_COMPILE_THREAD: &str = "createShaderModule: no thread could be created to compile the shader. Its stack is sized for how deep the source can nest, so the source may nest too deep";

/// One `GPUCompilationMessage`. naga reports UTF-8 byte offsets; the spec wants UTF-16 units.
struct Message {
    text: String,
    line_num: u32,
    line_pos: u32,
    offset: u32,
    length: u32,
}

#[bun_jsc::JsClass]
pub(crate) struct GPUShaderModule {
    raw: Rc<bun_webgpu::ShaderModule>,
    label: JsCell<bun_core::String>,
    messages: Vec<Message>,
    /// The stack a compile of the source needs: the pipeline calls that use this module need it too.
    compile_stack: usize,
}

super::gpu_object!(GPUShaderModule, label);
super::resource!(GPUShaderModule, bun_webgpu::ShaderModule);

fn utf16_len(s: &str) -> u32 {
    s.chars().map(|c| c.len_utf16() as u32).sum()
}

fn message_at(text: String, source: &str, location: Option<naga::SourceLocation>) -> Message {
    let Some(loc) = location else {
        return Message {
            text,
            line_num: 0,
            line_pos: 0,
            offset: 0,
            length: 0,
        };
    };
    let start = (loc.offset as usize).min(source.len());
    let end = (start + loc.length as usize).min(source.len());
    // From the source, not from `loc.line_position`: this does not depend on the unit naga counts columns in.
    let line_start = bun_core::strings::last_index_of_char(&source.as_bytes()[..start], b'\n')
        .map_or(0, |at| at + 1);
    let (Some(before), Some(on_line), Some(span)) = (
        source.get(..start),
        source.get(line_start..start),
        source.get(start..end),
    ) else {
        // naga's offsets always fall on character boundaries; this is the fallback if one does not.
        return Message {
            text,
            line_num: loc.line_number,
            line_pos: loc.line_position,
            offset: loc.offset,
            length: loc.length,
        };
    };
    Message {
        text,
        line_num: loc.line_number,
        line_pos: utf16_len(on_line) + 1,
        offset: utf16_len(before),
        length: utf16_len(span),
    }
}

fn compilation_messages(err: &CreateShaderModuleError, source: &str) -> Vec<Message> {
    match err {
        CreateShaderModuleError::Parsing(e) => {
            vec![message_at(e.to_string(), source, e.inner.location(source))]
        }
        CreateShaderModuleError::Validation(e) => {
            vec![message_at(e.to_string(), source, e.inner.location(source))]
        }
        // Out of memory or a lost device: reported through the error scopes, not a compilation message.
        CreateShaderModuleError::Device(_) | CreateShaderModuleError::Generation => Vec::new(),
        other => vec![message_at(other.to_string(), source, None)],
    }
}

impl GPUShaderModule {
    pub(crate) fn compile_stack(&self) -> usize {
        self.compile_stack
    }

    pub(crate) fn create(
        global: &JSGlobalObject,
        device: &DeviceRef,
        descriptor: JSValue,
    ) -> JsResult<JSValue> {
        let d = Dict::new(global, descriptor, "GPUShaderModuleDescriptor")?;
        let label = d.label()?;
        let Some(code) = d.string("code")? else {
            return Err(global.throw_type_error(format_args!(
                "GPUShaderModuleDescriptor: required member 'code' is missing"
            )));
        };
        let desc = ShaderModuleDescriptor {
            label: super::wgpu_label(&label),
            runtime_checks: wgt::ShaderRuntimeChecks::checked(),
        };
        let device_id = device.id();
        let compile_stack = bun_webgpu::compile_stack(code.as_bytes());
        let compiled = bun_webgpu::compile(compile_stack, || {
            instance().device_create_shader_module(
                device_id,
                &desc,
                ShaderModuleSource::Wgsl(Cow::Borrowed(&code)),
                None,
            )
        });
        let Some((id, err)) = compiled else {
            // wgpu-core hands out an invalid module only from a failed creation. Its error is about the stand-in, not about `code`.
            let (id, _) = instance().device_create_shader_module(
                device_id,
                &desc,
                ShaderModuleSource::Wgsl(Cow::Borrowed(NOT_COMPILED)),
                None,
            );
            device.report(global, GpuError::validation(NO_COMPILE_THREAD))?;
            return Ok(GPUShaderModule {
                raw: Rc::new(bun_webgpu::ShaderModule::new(id)),
                label: JsCell::new(label),
                messages: vec![message_at(String::from(NO_COMPILE_THREAD), &code, None)],
                compile_stack,
            }
            .to_js(global));
        };
        let raw = Rc::new(bun_webgpu::ShaderModule::new(id));
        let messages = err
            .as_ref()
            .map_or_else(Vec::new, |e| compilation_messages(e, &code));
        device.check(global, err)?;
        Ok(GPUShaderModule {
            raw,
            label: JsCell::new(label),
            messages,
            compile_stack,
        }
        .to_js(global))
    }

    pub(crate) fn get_compilation_info(
        &self,
        global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let list = JSValue::create_empty_array(global, self.messages.len())?;
        for (i, m) in self.messages.iter().enumerate() {
            let object = JSValue::create_empty_object(global, 6);
            object.put(
                global,
                b"message".as_slice(),
                bun_jsc::bun_string_jsc::create_utf8_for_js(global, m.text.as_bytes())?,
            );
            object.put(
                global,
                b"lineNum".as_slice(),
                JSValue::js_number_from_uint64(u64::from(m.line_num)),
            );
            object.put(
                global,
                b"linePos".as_slice(),
                JSValue::js_number_from_uint64(u64::from(m.line_pos)),
            );
            object.put(
                global,
                b"offset".as_slice(),
                JSValue::js_number_from_uint64(u64::from(m.offset)),
            );
            object.put(
                global,
                b"length".as_slice(),
                JSValue::js_number_from_uint64(u64::from(m.length)),
            );
            list.put_index(global, i as u32, object)?;
        }
        let info = js_module(global, "createCompilationInfo", &[list])?;
        Ok(JSPromise::resolved_promise_value(global, info))
    }
}
