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
mod named_entries;
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
mod validate;
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
pub use self::layouts::{DefinedObjectType, DefinedObjectTypes, ObjectTypeKey};
pub use self::module::{LeftOutDeclarations, LibraryFunctions, collect_library_functions};

pub(crate) use self::context::{FileLowering, FunctionLowering};
pub(crate) use self::convert::FamilyFacts;
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
    let roots = module::declare_module_roots(&mut lowering);
    while let Some(function) = lowering.take_next_function() {
        lowering.queries.note_idle();
        if lowering.queries.is_discarded() {
            return None;
        }
        lower_function(&mut lowering, function);
    }
    layouts::define_remaining_layouts(&mut lowering);
    let module = module::finish_module(&mut lowering, roots);
    function_types::define_signatures(&mut lowering);
    Some(lowering.finish(module))
}

fn lower_function(file: &mut FileLowering<'_, '_, '_, '_>, function: FunctionId) {
    match file.function_key(function) {
        FunctionKey::ModuleBody(_) => module::lower_module_body(file, function),
        FunctionKey::WrappedModuleBody(_) => commonjs::lower_wrapped_body(file, function),
        FunctionKey::FaceBody(_) => module::lower_face_body(file, function),
        FunctionKey::CheckBody(_) => module::lower_check_body(file, function),
        FunctionKey::Source(source) => lower_source_body(file, function, source.function),
        FunctionKey::Signature(_) | FunctionKey::ClassSignature(_) => {
            unreachable!("a signature has no body")
        }
        FunctionKey::ImplicitConstructor(class) => {
            class::lower_implicit_constructor(file, function, class.class);
        }
        FunctionKey::InstanceInitializer(class) => {
            class::lower_instance_initializer(file, function, class.class);
        }
        FunctionKey::StaticInitializer(class) => {
            class::lower_static_initializer(file, function, class.class);
        }
        FunctionKey::AccessorGetter { member, .. } => {
            class::lower_accessor_function(file, function, member, MethodKind::Getter);
        }
        FunctionKey::AccessorSetter { member, .. } => {
            class::lower_accessor_function(file, function, member, MethodKind::Setter);
        }
        FunctionKey::PrivateNameTest { member, .. } => {
            class::lower_private_name_test(file, function, member);
        }
    }
}

fn lower_source_body(file: &mut FileLowering<'_, '_, '_, '_>, function: FunctionId, source: FnId) {
    let written = FunctionRef {
        file: file.file,
        function: source,
    };
    if file.inputs.library_functions.is_left_out(written) {
        function::lower_left_out_function(file, function);
        return;
    }
    if file
        .inputs
        .modules
        .inner_module(file.file, source)
        .is_some()
    {
        commonjs::lower_inner_module_body(file, function, source);
        return;
    }
    match file.hir.runtime_function_kind(source) {
        FnKind::Constructor => class::lower_constructor(file, function, source),
        _ => function::lower_source_function(file, function, source),
    }
}
