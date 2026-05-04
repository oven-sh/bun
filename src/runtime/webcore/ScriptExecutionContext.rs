use bun_jsc::{JSGlobalObject, VirtualMachine};

// TODO(port): move to runtime_sys
unsafe extern "C" {
    fn ScriptExecutionContextIdentifier__getGlobalObject(id: u32) -> *mut JSGlobalObject;
}

/// Safe handle to a JavaScript execution environment that may have exited.
/// Obtain with `global_object.script_execution_context_identifier()`
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
pub struct Identifier(u32);

impl Identifier {
    /// Returns `None` if the context referred to by `self` no longer exists
    // TODO(port): lifetime — returned ref is valid only while the context lives; not tied to `self`
    pub fn global_object(self) -> Option<&'static JSGlobalObject> {
        // SAFETY: FFI call returns a valid pointer or null; JSGlobalObject is owned by the VM
        unsafe { ScriptExecutionContextIdentifier__getGlobalObject(self.0).as_ref() }
    }

    /// Returns `None` if the context referred to by `self` no longer exists
    pub fn bun_vm(self) -> Option<&'static VirtualMachine> {
        // concurrently because we expect these identifiers are mostly used by off-thread tasks
        self.global_object()?.bun_vm_concurrently()
    }

    pub fn valid(self) -> bool {
        self.global_object().is_some()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/ScriptExecutionContext.zig (24 lines)
//   confidence: high
//   todos:      2
//   notes:      `enum(u32) { _ }` ported as transparent newtype; returned &JSGlobalObject lifetime needs Phase B review
// ──────────────────────────────────────────────────────────────────────────
