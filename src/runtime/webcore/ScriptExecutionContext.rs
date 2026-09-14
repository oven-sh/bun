/// LAYERING: the `Identifier` newtype + `global_object()`/`bun_vm()` accessors
/// were moved DOWN into `bun_jsc` so that
/// [`JSGlobalObject::script_execution_context_identifier`][gid] can return the
/// concrete type without `bun_jsc → bun_runtime` (a cycle). Re-exported here so
/// `bun_runtime::webcore::script_execution_context::Identifier` keeps resolving.
///
/// [gid]: bun_jsc::JSGlobalObject::script_execution_context_identifier
pub use bun_jsc::js_global_object::ScriptExecutionContextIdentifier as Identifier;
