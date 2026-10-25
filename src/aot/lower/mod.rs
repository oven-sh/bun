mod async_function;
mod call;
mod captures;
mod class;
mod commonjs;
mod condition;
mod context;
mod control;
mod convert;
mod data;
mod decorators;
mod dispose;
mod exception;
mod expected_result;
mod expression;
mod fragment;
mod function;
mod function_types;
mod generator;
mod iteration;
mod jsx;
mod known_call;
mod known_function;
mod layouts;
mod member;
mod module;
mod object;
mod operator;
mod parameters;
mod pattern;
mod positions;
mod private_names;
mod scope;
mod statement;
mod switch;
mod template;
mod types;
mod typescript;
mod yield_star;

use bun_sema::check::Checker;
use bun_sema::check::aot::{FunctionRef, Queries, QueryStatistics};
use bun_sema::hir::{FnId, FnKind};
use bun_sema::program::FileId;

use crate::diagnostics::DiagnosticBuffer;
use crate::ir::generated::MethodKind;
use crate::ir::{FunctionId, FunctionKey};
use crate::statistics::Counters;

pub use self::context::{FileInputs, LoweringInputs, LoweringOptions, SourceKind};
pub use self::fragment::{Fragment, ModuleFragment};
#[cfg(test)]
pub(crate) use self::layouts::late_answers;
pub use self::layouts::{DefinedObjectType, DefinedObjectTypes, ObjectTypeKey};
pub use self::module::{LeftOutDeclarations, LibraryFunctions, collect_library_functions};

pub(crate) use self::context::{FileLowering, FunctionLowering};
pub(crate) use self::convert::FamilyFacts;
#[cfg(test)]
pub(crate) use self::fragment::FragmentBuilder;
pub(crate) use bun_sema::types::TypeId as CheckerTypeId;

pub struct LoweredFile {
    pub fragment: Fragment,
    pub diagnostics: DiagnosticBuffer,
    pub counters: Counters,
    pub queries: QueryStatistics,
}

const fn assert_send<T: Send>() {}

const _: () = assert_send::<LoweredFile>();

/// `None`: the checker's task was discarded on the way, so the file is lowered again.
pub fn lower_file<'s>(
    inputs: &LoweringInputs<'_>,
    checker: &mut Checker<'_, 's>,
    file: FileId,
) -> Option<LoweredFile> {
    checker.with_queries(file, inputs.query_inputs(), |queries| {
        lower_with_queries(inputs, queries, file)
    })
}

fn lower_with_queries<'a, 'c, 'p, 's>(
    inputs: &'a LoweringInputs<'a>,
    queries: &'a mut Queries<'c, 'p, 's>,
    file: FileId,
) -> Option<LoweredFile> {
    let mut lowering = FileLowering::new(inputs, queries, file);
    lowering.refuse_chains_past_nesting_limit();
    let roots = lowering.declare_module_roots();
    while let Some(function) = lowering.take_next_function() {
        lowering.queries.note_idle();
        if lowering.queries.is_discarded() {
            return None;
        }
        lowering.lower_function(function);
    }
    lowering.define_remaining_layouts();
    let module = lowering.finish_module(roots);
    lowering.define_signatures();
    Some(lowering.finish(module))
}

impl FileLowering<'_, '_, '_, '_> {
    fn lower_function(&mut self, function: FunctionId) {
        match self.function_key(function) {
            FunctionKey::ModuleBody(_) => self.lower_module_body(function),
            FunctionKey::WrappedModuleBody(_) => self.lower_wrapped_body(function),
            FunctionKey::FaceBody(_) => self.lower_face_body(function),
            FunctionKey::CheckBody(_) => self.lower_check_body(function),
            FunctionKey::Source(source) => lower_source_body(self, function, source.function),
            FunctionKey::Signature(_) | FunctionKey::ClassSignature(_) => {
                unreachable!("a signature has no body")
            }
            FunctionKey::ImplicitConstructor(class) => {
                self.lower_implicit_constructor(function, class.class);
            }
            FunctionKey::InstanceInitializer(class) => {
                self.lower_initializer(function, class.class, false);
            }
            FunctionKey::StaticInitializer(class) => {
                self.lower_initializer(function, class.class, true);
            }
            FunctionKey::AccessorGetter { member, .. } => {
                self.lower_accessor_function(function, member, MethodKind::Getter);
            }
            FunctionKey::AccessorSetter { member, .. } => {
                self.lower_accessor_function(function, member, MethodKind::Setter);
            }
            FunctionKey::PrivateNameTest { member, .. } => {
                self.lower_private_name_test(function, member);
            }
        }
    }
}

fn lower_source_body(file: &mut FileLowering<'_, '_, '_, '_>, function: FunctionId, source: FnId) {
    let written = FunctionRef {
        file: file.file,
        function: source,
    };
    if file.inputs.library_functions.is_left_out(written) {
        file.lower_left_out_function(function);
        return;
    }
    if file
        .inputs
        .modules
        .inner_module(file.file, source)
        .is_some()
    {
        file.lower_inner_module_body(function, source);
        return;
    }
    match file.hir.runtime_function_kind(source) {
        FnKind::Constructor => file.lower_constructor(function, source),
        _ => file.lower_source_function(function, source),
    }
}
