use crate::ir::generated::{BlockFrequency, FunctionKind};
use crate::ir::{FunctionId, FunctionKey, TypeTable, VariableKey};
use crate::lower::{FileLowering, FunctionLowering, commonjs, condition, control, function, scope};
use crate::modules::ModuleRef;

// What is written in a file, and what is made for it, names the record of the file, which has the path and the positions.
fn declare_body(file: &mut FileLowering<'_, '_, '_, '_>, key: FunctionKey) {
    file.declare_function(key, |file| {
        function::create_header(file, key, FunctionKind::Module, 0)
    });
}

/// The module that ES modules request in place of a CommonJS file.
pub(super) fn declare_face_body(file: &mut FileLowering<'_, '_, '_, '_>) {
    if file
        .inputs
        .modules
        .face(ModuleRef::File(file.file))
        .is_some()
    {
        declare_body(file, FunctionKey::FaceBody(file.file));
    }
}

/// The module that throws for a name that the ES graph below the file imports and no CommonJS file of it has stored.
pub(super) fn declare_check_body(file: &mut FileLowering<'_, '_, '_, '_>) {
    if !file
        .inputs
        .modules
        .commonjs()
        .checked_copies(file.file)
        .is_empty()
    {
        declare_body(file, FunctionKey::CheckBody(file.file));
    }
}

fn finish_body(mut lowering: FunctionLowering<'_, '_, '_, '_, '_>) {
    let undefined = lowering.builder.undefined();
    control::emit_return(&mut lowering, undefined, None);
    lowering.finish();
}

// An ES importer holds what the file had under a name when the file was first linked into an ES graph.
pub(crate) fn lower_face_body(file: &mut FileLowering<'_, '_, '_, '_>, function: FunctionId) {
    let modules = file.inputs.modules;
    let own_file = file.file;
    let mut lowering = FunctionLowering::begin(file, function);
    let module = lowering
        .file
        .fragment
        .declare_module(ModuleRef::File(own_file));
    let face = lowering
        .file
        .fragment
        .declare_module(ModuleRef::Face(own_file));
    lowering.builder.evaluate_module(module, face, true);
    // Behind the file, so that the files run in the order of its text.
    for owner in modules.faces_behind(own_file) {
        let owner = lowering
            .file
            .fragment
            .declare_module(ModuleRef::Face(owner));
        lowering.builder.evaluate_module(owner, face, true);
    }
    for &export in modules.commonjs().copies(own_file) {
        let copied = *modules.synthetic_export(export);
        // Only the object says which names it has: the run time takes the copies of a face that captures, behind its body.
        if matches!(copied.module, ModuleRef::File(owner) if modules.commonjs().face_captures(owner))
        {
            continue;
        }
        let value = commonjs::read_imported_name(&mut lowering, copied.module, copied.name);
        let Some(value) = value else {
            continue;
        };
        let copy = scope::ensure_variable(lowering.file, VariableKey::Copy(export));
        lowering.builder.put_module_variable(copy, value);
    }
    finish_body(lowering);
}

// Every CommonJS file of the graph has run by now, as under `bun run`, which reports the first missing name behind them.
pub(crate) fn lower_check_body(file: &mut FileLowering<'_, '_, '_, '_>, function: FunctionId) {
    let modules = file.inputs.modules;
    let own_file = file.file;
    let mut lowering = FunctionLowering::begin(file, function);
    for &(export, failure) in modules.commonjs().checked_copies(own_file) {
        // A file that is left out is never linked, and nothing stores the copies of one.
        let importer = ModuleRef::File(modules.failure(failure).importer);
        if modules.is_left_out(importer)
            || modules.is_left_out(modules.synthetic_export(export).module)
        {
            continue;
        }
        let copy = scope::ensure_variable(lowering.file, VariableKey::Copy(export));
        let value = lowering.builder.get_module_variable(copy);
        let split = condition::split_on_type(&mut lowering, value, TypeTable::ABSENT);
        lowering
            .builder
            .set_frequency(split.taken, BlockFrequency::Unlikely);
        lowering.builder.switch_to(split.taken);
        let failure = lowering.file.fragment.declare_module_failure(failure);
        lowering.builder.throw_module_failure(failure, false);
        lowering.builder.unreachable();
        lowering.builder.switch_to(split.not_taken);
    }
    finish_body(lowering);
}
