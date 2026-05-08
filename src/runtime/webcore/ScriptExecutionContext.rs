/// LAYERING: the `Identifier` newtype + `global_object()`/`bun_vm()` accessors
/// were moved DOWN into `bun_jsc` so that
/// [`JSGlobalObject::script_execution_context_identifier`][gid] can return the
/// concrete type without `bun_jsc → bun_runtime` (a cycle). Re-exported here so
/// `bun_runtime::webcore::script_execution_context::Identifier` keeps resolving.
///
/// [gid]: bun_jsc::JSGlobalObject::script_execution_context_identifier
pub use bun_jsc::js_global_object::ScriptExecutionContextIdentifier as Identifier;

use crate::jsc::virtual_machine::VirtualMachine;

/// Runtime-tier convenience: typed `&VirtualMachine` view of [`Identifier::bun_vm`]
/// (the bun_jsc method returns `*mut VirtualMachine` to avoid lifetime claims).
pub trait IdentifierExt {
    fn bun_vm_ref(self) -> Option<&'static VirtualMachine>;
    fn valid(self) -> bool;
}
impl IdentifierExt for Identifier {
    fn bun_vm_ref(self) -> Option<&'static VirtualMachine> {
        // SAFETY: the VM outlives all ScriptExecutionContexts it owns; pointer is
        // non-null when `global_object()` is `Some`.
        self.bun_vm().map(|p| unsafe { &*p })
    }
    fn valid(self) -> bool {
        self.global_object().is_some()
    }
}

// ported from: src/runtime/webcore/ScriptExecutionContext.zig
