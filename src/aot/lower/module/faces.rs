use super::finish_body;
use crate::ir::generated::{BlockFrequency, FunctionKind};
use crate::ir::{FunctionId, FunctionKey, TypeTable, VariableKey};
use crate::lower::{FileLowering, FunctionLowering, function};
use crate::modules::ModuleRef;

// What is written in a file, and what is made for it, names the record of the file, which has the path and the positions.
fn declare_body(file: &mut FileLowering<'_, '_, '_, '_>, key: FunctionKey) {
    file.declare_function(key, |file| {
        function::create_header(file, key, FunctionKind::Module, 0)
    });
}

impl FileLowering<'_, '_, '_, '_> {
    /// The module that ES modules request in place of a CommonJS file.
    pub(super) fn declare_face_body(&mut self) {
        let modules = self.inputs.modules;
        if modules.face(ModuleRef::File(self.file)).is_some() {
            declare_body(self, FunctionKey::FaceBody(self.file));
        }
    }

    /// The module that throws for a name that the ES graph below the file imports and no CommonJS file of it has stored.
    pub(super) fn declare_check_body(&mut self) {
        let commonjs = self.inputs.modules.commonjs();
        if !commonjs.checked_copies(self.file).is_empty() {
            declare_body(self, FunctionKey::CheckBody(self.file));
        }
    }

    // An ES importer holds what the file had under a name when the file was first linked into an ES graph.
    pub(crate) fn lower_face_body(&mut self, function: FunctionId) {
        let modules = self.inputs.modules;
        let own_file = self.file;
        let mut lowering = FunctionLowering::begin(self, function);
        let module = lowering.file.module_id();
        let face = ModuleRef::Face(own_file);
        let face = lowering.file.fragment.declare_module(face);
        lowering.builder.evaluate_module(module, face, true);
        // Behind the self, so that the files run in the order of its text.
        for owner in modules.faces_behind(own_file) {
            let owner = ModuleRef::Face(owner);
            let owner = lowering.file.fragment.declare_module(owner);
            lowering.builder.evaluate_module(owner, face, true);
        }
        for &export in modules.commonjs().copies(own_file) {
            let copied = *modules.synthetic_export(export);
            // Only the object says which names it has: the run time takes the copies of a face that captures, behind its body.
            if matches!(copied.module, ModuleRef::File(owner) if modules.commonjs().face_captures(owner))
            {
                continue;
            }
            let Some(value) = lowering.read_imported_name(copied.module, copied.name) else {
                continue;
            };
            let copy = lowering.file.ensure_variable(VariableKey::Copy(export));
            lowering.builder.put_module_variable(copy, value);
        }
        finish_body(lowering, None);
    }

    // Every CommonJS file of the graph has run by now, as under `bun run`, which reports the first missing name behind them.
    pub(crate) fn lower_check_body(&mut self, function: FunctionId) {
        let modules = self.inputs.modules;
        let own_file = self.file;
        let mut lowering = FunctionLowering::begin(self, function);
        for &(export, failure) in modules.commonjs().checked_copies(own_file) {
            // A self that is left out is never linked, and nothing stores the copies of one.
            let importer = ModuleRef::File(modules.failure(failure).importer);
            if modules.is_left_out(importer)
                || modules.is_left_out(modules.synthetic_export(export).module)
            {
                continue;
            }
            let copy = lowering.file.ensure_variable(VariableKey::Copy(export));
            let value = lowering.builder.get_module_variable(copy);
            let split = lowering.split_on_type(value, TypeTable::ABSENT);
            let unlikely = BlockFrequency::Unlikely;
            lowering.builder.set_frequency(split.taken, unlikely);
            lowering.builder.switch_to(split.taken);
            let failure = lowering.file.fragment.declare_module_failure(failure);
            lowering.builder.throw_module_failure(failure, false);
            lowering.builder.unreachable();
            lowering.builder.switch_to(split.not_taken);
        }
        finish_body(lowering, None);
    }
}
