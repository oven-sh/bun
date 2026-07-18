//! §8 Step 7.6 — extension traits for group-A `bun_jsc` types whose bodies
//! need group-B `VirtualMachine`/`EventLoop` (moved here so `bun_jsc` stays a
//! pure FFI layer with no back-edge on `bun_runtime`).

#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]

use core::ffi::c_void;

use crate::js_global_object::{ScriptExecutionContextIdentifier, ThreadKind};
use crate::{
    CallFrame, FetchHeaders, JSGlobalObject, JSPromise, JSType, JSValue, JsError, JsResult,
};

use crate::vm::virtual_machine::VirtualMachine;

// ─── JSGlobalObjectExt ──────────────────────────────────────────────────────
pub trait JSGlobalObjectExt {
    fn bun_vm_ptr(&self) -> *mut VirtualMachine;
    fn bun_vm_ref(&self) -> &'static VirtualMachine;
    fn bun_vm(&self) -> &'static VirtualMachine;
    fn try_bun_vm(&self) -> (*mut VirtualMachine, ThreadKind);
    fn bun_vm_concurrently(&self) -> *mut VirtualMachine;
    fn report_active_exception_as_unhandled(&self, err: JsError);
}

impl JSGlobalObjectExt for JSGlobalObject {
    #[inline]
    fn bun_vm_ptr(&self) -> *mut VirtualMachine {
        debug_assert!(
            self.bun_vm_unsafe() == VirtualMachine::get_mut_ptr().cast::<c_void>(),
            "bun_vm_ptr called off the JS thread; use bun_vm_concurrently",
        );
        VirtualMachine::get_mut_ptr()
    }

    #[inline]
    fn bun_vm_ref(&self) -> &'static VirtualMachine {
        self.bun_vm()
    }

    #[inline]
    fn bun_vm(&self) -> &'static VirtualMachine {
        #[cfg(debug_assertions)]
        {
            if let Some(vm_) = VirtualMachine::get_or_null() {
                debug_assert!(self.bun_vm_unsafe() == vm_.cast::<c_void>());
            } else {
                panic!("This thread lacks a Bun VM");
            }
        }
        VirtualMachine::get()
    }

    fn try_bun_vm(&self) -> (*mut VirtualMachine, ThreadKind) {
        let vm_ptr = self.bun_vm_unsafe().cast::<VirtualMachine>();
        if let Some(vm_) = VirtualMachine::get_or_null() {
            #[cfg(debug_assertions)]
            {
                debug_assert!(self.bun_vm_unsafe() == vm_.cast::<c_void>());
            }
            let _ = vm_;
        } else {
            return (vm_ptr, ThreadKind::Other);
        }
        (vm_ptr, ThreadKind::Main)
    }

    #[inline]
    fn bun_vm_concurrently(&self) -> *mut VirtualMachine {
        self.bun_vm_unsafe().cast::<VirtualMachine>()
    }

    fn report_active_exception_as_unhandled(&self, err: JsError) {
        let exception = self.take_exception(err);
        if !exception.is_termination_exception() {
            let _ = self
                .bun_vm()
                .as_mut()
                .uncaught_exception(self, exception, false);
        }
    }
}

// ─── JsResultExt (cut from `bun_jsc/lib.rs` at Step 6.1) ────────────────────
pub trait JsResultExt {
    fn report_unhandled(self, global: &JSGlobalObject);
}

impl<T> JsResultExt for JsResult<T> {
    #[inline]
    fn report_unhandled(self, global: &JSGlobalObject) {
        if let Err(e) = self {
            if e != JsError::Terminated {
                global.report_active_exception_as_unhandled(e);
            }
        }
    }
}

// ─── ScriptExecutionContextIdentifierExt ────────────────────────────────────
pub trait ScriptExecutionContextIdentifierExt {
    fn bun_vm(self) -> Option<*mut VirtualMachine>;
}

impl ScriptExecutionContextIdentifierExt for ScriptExecutionContextIdentifier {
    fn bun_vm(self) -> Option<*mut VirtualMachine> {
        Some(self.global_object()?.bun_vm_concurrently())
    }
}

// ─── JSValueExt ─────────────────────────────────────────────────────────────
pub trait JSValueExt {
    fn to_fmt<'a, 'b>(
        self,
        formatter: &'a mut crate::vm::console_object::Formatter<'b>,
    ) -> crate::vm::console_object::formatter::ZigFormatter<'a, 'b>;
}

impl JSValueExt for JSValue {
    fn to_fmt<'a, 'b>(
        self,
        formatter: &'a mut crate::vm::console_object::Formatter<'b>,
    ) -> crate::vm::console_object::formatter::ZigFormatter<'a, 'b> {
        formatter.remaining_values = bun_core::ptr::RawSlice::EMPTY;
        formatter.stack_check.update();
        crate::vm::console_object::formatter::ZigFormatter::new(formatter, self)
    }
}

// ─── JSPromiseExt ───────────────────────────────────────────────────────────
pub trait JSPromiseExt {
    fn reject_task(&self, global: &JSGlobalObject, value: JSValue);
    fn resolve_task(&self, global: &JSGlobalObject, value: JSValue);
}

impl JSPromiseExt for JSPromise {
    fn reject_task(&self, global: &JSGlobalObject, value: JSValue) {
        let vm = global.bun_vm();
        let scope = vm.event_loop().enter();
        self.reject(global, value);
        drop(scope);
    }
    fn resolve_task(&self, global: &JSGlobalObject, value: JSValue) {
        let vm = global.bun_vm();
        let scope = vm.event_loop().enter();
        self.resolve(global, value);
        drop(scope);
    }
}

// ─── JSPromiseStrongExt ─────────────────────────────────────────────────────
pub trait JSPromiseStrongExt {
    fn reject_task(
        &mut self,
        global: &JSGlobalObject,
        val: JSValue,
    ) -> Result<(), crate::JsTerminated>;
    fn resolve_task(
        &mut self,
        global: &JSGlobalObject,
        val: JSValue,
    ) -> Result<(), crate::JsTerminated>;
}

impl JSPromiseStrongExt for crate::JSPromiseStrong {
    fn reject_task(
        &mut self,
        global: &JSGlobalObject,
        val: JSValue,
    ) -> Result<(), crate::JsTerminated> {
        let _guard = VirtualMachine::get().enter_event_loop_scope();
        self.reject(global, Ok(val))
    }
    fn resolve_task(
        &mut self,
        global: &JSGlobalObject,
        val: JSValue,
    ) -> Result<(), crate::JsTerminated> {
        let _guard = VirtualMachine::get().enter_event_loop_scope();
        self.resolve(global, val)
    }
}

// ─── FetchHeadersExt ────────────────────────────────────────────────────────
unsafe extern "C" {
    fn WebCore__FetchHeaders__toUWSResponse(
        this: *const FetchHeaders,
        is_ssl: bool,
        response: *mut c_void,
    );
}

pub trait FetchHeadersExt {
    fn to_uws_response(&self, kind: bun_uws::ResponseKind, response: *mut c_void);
}

impl FetchHeadersExt for FetchHeaders {
    fn to_uws_response(&self, kind: bun_uws::ResponseKind, response: *mut c_void) {
        unsafe { WebCore__FetchHeaders__toUWSResponse(self, kind.is_ssl(), response) }
    }
}

// ─── RefExt (cut from `bun_jsc/lib.rs` `impl Ref` at Step 6.1) ──────────────
pub trait RefExt {
    fn r#ref(&mut self, vm: &mut VirtualMachine);
    fn unref(&mut self, vm: &mut VirtualMachine);
}

impl RefExt for bun_jsc::Ref {
    fn unref(&mut self, vm: &mut VirtualMachine) {
        if !self.has {
            return;
        }
        self.has = false;
        vm.active_tasks -= 1;
    }

    fn r#ref(&mut self, vm: &mut VirtualMachine) {
        if self.has {
            return;
        }
        self.has = true;
        vm.active_tasks += 1;
    }
}

// ─── ConsoleFormatter (cut from `bun_jsc/lib.rs` at Step 6.1) ───────────────
pub use crate::vm::console_object::formatter::Tag as FormatTag;
pub use crate::vm::console_object::formatter::Tag as FormatAs;

pub trait ConsoleFormatter {
    fn global_this(&self) -> &JSGlobalObject;
    fn print_as<W: core::fmt::Write, const ENABLE_ANSI_COLORS: bool>(
        &mut self,
        tag: FormatTag,
        writer: &mut W,
        value: JSValue,
        cell: JSType,
    ) -> JsResult<()>;
    fn indent_inc(&mut self);
    fn indent_dec(&mut self);
    #[inline]
    fn indented(&mut self) -> IndentScope<'_, Self> {
        IndentScope::new(self)
    }
    fn write_indent<W: core::fmt::Write>(&self, writer: &mut W) -> core::fmt::Result;
    fn reset_line(&mut self);
    fn print_comma<W: core::fmt::Write, const ENABLE_ANSI_COLORS: bool>(
        &mut self,
        writer: &mut W,
    ) -> core::fmt::Result;
}

pub struct IndentScope<'a, F: ConsoleFormatter + ?Sized>(&'a mut F);

impl<'a, F: ConsoleFormatter + ?Sized> IndentScope<'a, F> {
    #[inline]
    pub fn new(f: &'a mut F) -> Self {
        f.indent_inc();
        Self(f)
    }
}
impl<F: ConsoleFormatter + ?Sized> core::ops::Deref for IndentScope<'_, F> {
    type Target = F;
    #[inline]
    fn deref(&self) -> &F {
        self.0
    }
}
impl<F: ConsoleFormatter + ?Sized> core::ops::DerefMut for IndentScope<'_, F> {
    #[inline]
    fn deref_mut(&mut self) -> &mut F {
        self.0
    }
}
impl<F: ConsoleFormatter + ?Sized> Drop for IndentScope<'_, F> {
    #[inline]
    fn drop(&mut self) {
        self.0.indent_dec();
    }
}

impl<'a> ConsoleFormatter for crate::vm::console_object::Formatter<'a> {
    #[inline]
    fn global_this(&self) -> &JSGlobalObject {
        self.global_this
    }
    #[inline]
    fn indent_inc(&mut self) {
        self.indent += 1;
    }
    #[inline]
    fn indent_dec(&mut self) {
        self.indent = self.indent.saturating_sub(1);
    }
    #[inline]
    fn reset_line(&mut self) {
        crate::vm::console_object::Formatter::reset_line(self)
    }
    fn write_indent<W: core::fmt::Write>(&self, writer: &mut W) -> core::fmt::Result {
        let mut sink = bun_core::io::FmtAdapter::new(writer);
        crate::vm::console_object::Formatter::write_indent(self, &mut sink)
            .map_err(|_| core::fmt::Error)
    }
    fn print_comma<W: core::fmt::Write, const ENABLE_ANSI_COLORS: bool>(
        &mut self,
        writer: &mut W,
    ) -> core::fmt::Result {
        let mut sink = bun_core::io::FmtAdapter::new(writer);
        crate::vm::console_object::Formatter::print_comma::<ENABLE_ANSI_COLORS>(self, &mut sink)
            .map_err(|_| core::fmt::Error)
    }
    fn print_as<W: core::fmt::Write, const ENABLE_ANSI_COLORS: bool>(
        &mut self,
        tag: FormatTag,
        writer: &mut W,
        value: JSValue,
        cell: JSType,
    ) -> JsResult<()> {
        let mut sink = bun_core::io::FmtAdapter::new(writer);
        let result = crate::vm::console_object::formatter::TagResult {
            tag: tag.into(),
            cell,
        };
        let global = self.global_this;
        self.format::<ENABLE_ANSI_COLORS>(result, &mut sink, value, global)
    }
}

// ─── verify_error_to_js (cut from `bun_jsc::system_error` at Step 6.2) ──────
pub fn verify_error_to_js(
    err: &bun_uws::us_bun_verify_error_t,
    global: &JSGlobalObject,
) -> JsResult<JSValue> {
    let code: &[u8] = err.code_bytes();
    let reason: &[u8] = err.reason_bytes();

    let fallback = bun_jsc::SystemError {
        code: bun_core::String::clone_utf8(code),
        message: bun_core::String::clone_utf8(reason),
        ..Default::default()
    };

    Ok(fallback.to_error_instance(global))
}

// ─── create_counters_object (errata: moved from `bun_jsc::counters`) ────────
pub fn create_counters_object(global: &JSGlobalObject, _f: &CallFrame) -> JsResult<JSValue> {
    global.bun_vm().counters.to_js(global)
}
