//! What reports call cells.

use bun_engine_bytecode::CodeKind;
use bun_engine_text::{StringRef, names};
use bun_engine_vm::{
    AsciiLiteral, CellKind, CellType, CodeBlock, Gc, InternalMethod, JsCell, JsFunction, JsObject,
    PropertySlot, ascii_literal,
};

use crate::profiling::AnyRealm;

/// That of its class, or of the kind that it is among the instances.
pub fn class_name(cell: &JsCell) -> AsciiLiteral {
    if let Some(code_block) = cell.downcast::<CodeBlock>() {
        return match code_block.body().kind() {
            CodeKind::Script => ascii_literal!("ProgramCodeBlock"),
            CodeKind::Module => ascii_literal!("ModuleProgramCodeBlock"),
            CodeKind::Eval => ascii_literal!("EvalCodeBlock"),
            CodeKind::Call | CodeKind::Construct => ascii_literal!("FunctionCodeBlock"),
        };
    }
    if let Some(function) = cell.downcast::<JsFunction>()
        && let Some(executable) = function.script_executable()
    {
        match (
            executable.info().is_async(),
            executable.info().is_generator(),
        ) {
            (true, true) => return ascii_literal!("JSAsyncGeneratorFunction"),
            (true, false) => return ascii_literal!("AsyncFunction"),
            (false, true) => return ascii_literal!("GeneratorFunction"),
            (false, false) => {}
        }
    }
    if cell.cell_type() == CellType::WithScope {
        return ascii_literal!("WithScope");
    }
    cell.class().name_literal()
}

/// One whose class says nothing about it.
pub(super) fn as_plain_object(cell: Gc<JsCell>) -> Option<Gc<JsObject>> {
    (cell.as_object()).filter(|object| object.class().name() == JsObject::CLASS.name())
}

/// For a plain object, the name of its constructor. What has a `constructor` of its own is a prototype, no instance.
pub(super) fn class_or_constructor_name(realms: &mut AnyRealm<'_>, cell: Gc<JsCell>) -> StringRef {
    if let Some(object) = as_plain_object(cell)
        && let Some(cx) = realms.realm_of(&object)
    {
        let mut slot = PropertySlot::new(object.into(), InternalMethod::Inquiry);
        match object.ordinary_get_own_property_slot(cx, names::constructor, &mut slot) {
            Ok(true) => {}
            Ok(false) => return object.calculated_class_name(cx),
            Err(thrown) => cx.discard_unless_termination(thrown),
        }
    }
    StringRef::from_literal(class_name(&cell).as_str())
}
