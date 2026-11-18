use core::fmt::Write;

use bun_engine_bytecode::{CodeFlags, CodeKind};
use bun_engine_macros::{FieldOffsets, Trace};
use bun_engine_number::NumberText;
use bun_engine_text::{CodeUnit, PropertyName, StringBuilder, StringRef, Text, names};

use crate::heap::Survivors;
use crate::{
    CodeBlock, FunctionExecutable, Gc, JsCallee, JsCell, JsFunction, JsObject, LineColumn, Message,
    SourceProviderRef, VisitedFrame, Vm, display_name,
};

/// A frame of a stack trace that has been captured. Nothing here allocates in the heap or runs a script.
#[derive(Clone, Copy, Trace, FieldOffsets)]
#[repr(C)]
pub struct StackFrame {
    /// Of WebAssembly code, `WasmFrame::names`.
    pub callee: Option<Gc<JsCell>>,
    pub code_block: Option<Gc<CodeBlock>>,
    /// Of WebAssembly code, the index of the function.
    pub bytecode_offset: u32,
    /// Of a function that waits in an `await`.
    pub is_async: bool,
    pub is_wasm: bool,
}

pub struct WasmNames {
    /// From the name section, or else a hash of the module.
    pub module: StringRef,
    pub function: Option<StringRef>,
}

impl WasmNames {
    /// What tools call the function, which has that index.
    pub fn qualified(&self, index: u32) -> StringRef {
        let module = &self.module;
        match &self.function {
            Some(name) => format_args!("{module}.wasm-function[{name}]").into_string(),
            None => format_args!("{module}.wasm-function[{index}]").into_string(),
        }
    }
}

impl From<&VisitedFrame<'_>> for StackFrame {
    #[inline(always)]
    fn from(frame: &VisitedFrame<'_>) -> StackFrame {
        match frame.wasm {
            None => StackFrame {
                callee: frame.callee.map(Gc::cell),
                code_block: frame.code_block,
                bytecode_offset: frame.bytecode_offset,
                is_async: false,
                is_wasm: false,
            },
            Some(wasm) => StackFrame {
                callee: wasm.names,
                code_block: None,
                bytecode_offset: wasm.function_index,
                is_async: false,
                is_wasm: true,
            },
        }
    }
}

impl StackFrame {
    pub fn line_column(&self) -> Option<LineColumn> {
        Some(self.code_block?.line_column(self.bytecode_offset))
    }

    pub fn is_constructor(&self) -> bool {
        (self.code_block).is_some_and(|it| it.body().kind() == CodeKind::Construct)
    }

    pub fn is_builtin(&self) -> bool {
        (self.code_block).is_some_and(|it| it.body().flags().contains(CodeFlags::BUILTIN))
    }

    /// `None` for a stub between JavaScript and WebAssembly.
    pub fn wasm_names(&self, vm: &Vm) -> Option<WasmNames> {
        let names = self.callee.filter(|_| self.is_wasm)?;
        Some((vm.hooks().wasm_names)(names, self.bytecode_offset))
    }

    pub fn function_name(&self, vm: &Vm) -> StringRef {
        if self.is_wasm {
            return match self.wasm_names(vm) {
                None => StringRef::from_literal("wasm-stub"),
                Some(names) => names.function.unwrap_or_else(|| {
                    StringRef::from_text(NumberText::from(self.bytecode_offset).text())
                }),
            };
        }
        match self.code_block.map(|it| it.body().kind()) {
            Some(CodeKind::Eval) => return static_text(names::evalCode),
            Some(CodeKind::Module) => return static_text(names::moduleCode),
            Some(CodeKind::Script) => return static_text(names::globalCode),
            _ => {}
        }
        let callee = self.callee.filter(|it| !it.is::<JsCallee>());
        let name = match callee.and_then(|callee| callee.as_object()) {
            Some(callee) => name_if_suspending(callee).unwrap_or_else(|| display_name(&callee)),
            None => (self.code_block)
                .and_then(|it| it.executable().downcast::<FunctionExecutable>())
                .map_or_default(|it| it.display_name()),
        };
        if !self.is_async || name.is_empty() {
            return name;
        }
        StringRef::try_concat(&[Text::from_ascii("async "), name.text()]).unwrap_or(name)
    }

    /// The text that the position of the frame is in.
    pub fn source_provider(&self) -> Option<SourceProviderRef> {
        if let Some(code_block) = self.code_block {
            return Some(code_block.source_provider());
        }
        let function = self.callee.filter(|_| self.is_async)?;
        let executable = function.downcast::<JsFunction>()?.script_executable()?;
        Some(executable.provider().clone())
    }

    pub fn source_url(&self, vm: &Vm) -> StringRef {
        if self.is_wasm {
            let mut url = StringBuilder::new();
            if let Some(names) = self.wasm_names(vm).filter(|it| !it.module.is_empty()) {
                url.push_text(names.module.text());
                url.push_latin1(b':');
            }
            let _ = write!(url, "wasm-function[{}]", self.bytecode_offset);
            return url.finish().unwrap_or_default();
        }
        match self.source_provider() {
            Some(provider) => provider.url().cloned().unwrap_or_default(),
            None => static_text(names::nativeCode),
        }
    }

    /// Without credentials, query and fragment.
    pub fn source_url_for_report(&self, vm: &Vm) -> StringRef {
        strip_url(self.source_url(vm))
    }

    pub fn write(&self, vm: &Vm, out: &mut StringBuilder) {
        let url = self.source_url_for_report(vm);
        out.push_text(self.function_name(vm).text());
        out.push_latin1(b'@');
        out.push_text(truncate_data_url(url.text()));
        if !url.is_empty()
            && let Some(LineColumn { line, column }) = self.line_column()
        {
            for number in [line, column] {
                out.push_latin1(b':');
                out.push_text(NumberText::from(number).text());
            }
        }
    }

    pub(super) fn has_survived(&self, survivors: &Survivors) -> bool {
        self.callee.is_none_or(|it| survivors.contains(it))
            && self.code_block.is_none_or(|it| survivors.contains(it))
    }
}

/// Such a function goes by what the source calls it.
fn name_if_suspending(callee: Gc<JsObject>) -> Option<StringRef> {
    let executable = callee.downcast::<JsFunction>()?.script_executable()?;
    (executable.can_suspend() && !executable.name().is_empty()).then(|| executable.name().clone())
}

fn static_text(name: PropertyName<'static>) -> StringRef {
    StringRef::retain(name.string())
}

/// With the colon. `None` for a path.
fn scheme_length(url: Text<'_>) -> Option<usize> {
    let is_in_scheme = |&unit: &u16| {
        unit.is_ascii_alphabetic() || unit.is_ascii_digit() || b"+-.".iter().any(|&it| unit.is(it))
    };
    let length = url.code_units().take_while(is_in_scheme).count();
    (url.get(0)?.is_ascii_alphabetic() && url.get(length)?.is(b':')).then_some(length + 1)
}

fn strip_url(url: StringRef) -> StringRef {
    let text = url.text();
    let Some(scheme) = scheme_length(text) else {
        return url;
    };
    let first_of = |a: u8, b: u8| {
        let before_a = text.find_unit(a.into(), scheme).unwrap_or(text.len());
        let b = text.slice(0..before_a).find_unit(b.into(), scheme);
        b.unwrap_or(before_a)
    };
    let end = first_of(b'#', b'?');
    let mut credentials = 0..0;
    if text.slice_from(scheme).starts_with(Text::from_ascii("//")) {
        let authority = scheme + 2;
        let path = text.slice(0..end).find_unit(b'/'.into(), authority);
        if let Some(at) = text.rfind_unit(b'@'.into(), path.unwrap_or(end))
            && at >= authority
        {
            credentials = authority..at + 1;
        }
    }
    if credentials.is_empty() && end == text.len() {
        return url;
    }
    let (before, after) = (0..credentials.start, credentials.end..end);
    StringRef::try_concat(&[text.slice(before), text.slice(after)]).unwrap_or_default()
}

/// Such a URL is the whole script.
fn truncate_data_url(url: Text<'_>) -> Text<'_> {
    const LONGEST: usize = 1024;
    const SCHEME: Text<'static> = Text::from_ascii("data:");
    if url.len() <= LONGEST || !url.slice(0..SCHEME.len()).eq_ignore_ascii_case(SCHEME) {
        return url;
    }
    let cut_escape = (url.rfind_unit(b'%'.into(), LONGEST)).filter(|&at| LONGEST - at < 3);
    url.slice(0..cut_escape.unwrap_or(LONGEST))
}

/// One line for each frame.
pub fn stack_trace_text(vm: &Vm, frames: &[StackFrame]) -> StringRef {
    const USUAL_LENGTH: usize = 64;
    let mut text = StringBuilder::with_capacity(frames.len().min(1024) * USUAL_LENGTH);
    for (index, frame) in frames.iter().enumerate() {
        if index != 0 {
            text.push_latin1(b'\n');
        }
        frame.write(vm, &mut text);
    }
    text.finish().unwrap_or_default()
}
