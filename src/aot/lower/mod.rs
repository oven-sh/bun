mod async_function;
mod call;
mod captures;
mod class;
mod commonjs;
mod condition;
mod context;
mod control;
mod convert;
mod counted_places;
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
mod quoted_source;
mod said_types;
mod scope;
mod statement;
mod switch;
mod tables;
mod template;
mod types;
mod typescript;
mod yield_star;

use bun_sema::check::Checker;
use bun_sema::check::aot::{FunctionRef, Queries, QueryStatistics};
use bun_sema::hir::{FnId, FnKind};
use bun_sema::program::{FileId, ReadingTask};

use self::tables::{put_back_task_state, take_task_state};
use crate::diagnostics::DiagnosticBuffer;
use crate::ir::generated::MethodKind;
use crate::ir::{FunctionId, FunctionKey};

pub use self::context::{FileInputs, LoweringInputs, LoweringOptions, SourceKind};
pub use self::fragment::{Fragment, ModuleFragment};
pub use self::layouts::{NamesCreatedOnExports, ObjectTypeKey};
pub use self::module::{
    LeftOutDeclarations, LibraryFunctions, collect_library_functions, lower_file_that_throws,
};
pub use self::said_types::SaidTypes;
pub use self::tables::{SharedTables, TableLengths, UnitTables};

pub(crate) use self::context::{FileLowering, FunctionLowering};
pub(crate) use self::convert::FamilyFacts;
#[cfg(test)]
pub(crate) use self::fragment::FragmentBuilder;
pub(crate) use self::module::{KeptBetweenWays, find_file_that_asks_mock};
pub(crate) use self::tables::TaskState;
pub(crate) use bun_sema::types::TypeId as CheckerTypeId;

pub struct LoweredFile {
    pub fragment: Fragment,
    pub diagnostics: DiagnosticBuffer,
    pub queries: QueryStatistics,
    pub known_helpers: KnownHelpersLowered,
    pub function_sources_reparsed: u64,
    pub written_function_names: Vec<u8>,
}

#[derive(Copy, Clone, Default)]
pub struct KnownHelpersLowered {
    pub functions: u64,
    pub calls: u64,
}

const fn assert_send<T: Send>() {}

const _: () = assert_send::<LoweredFile>();

pub fn lower_file<'s>(
    inputs: &LoweringInputs<'_>,
    checker: &mut Checker<'_, 's>,
    file: FileId,
) -> Option<LoweredFile> {
    let mut task = take_task_state(checker);
    let lowered = checker.with_queries(file, &inputs.query_inputs(), |queries| {
        lower_with_queries(
            inputs,
            queries,
            file,
            &mut task,
            FileLowering::lower_function,
        )
    });
    put_back_task_state(checker, task);
    lowered
}

pub(in crate::lower) fn lower_with_queries<'a, 'c, 'p, 's>(
    inputs: &'a LoweringInputs<'a>,
    queries: &'a mut Queries<'c, 'p, 's>,
    file: FileId,
    task: &'a mut TaskState,
    mut lower_function: impl FnMut(&mut FileLowering<'a, 'c, 'p, 's>, FunctionId),
) -> Option<LoweredFile> {
    let mut lowering = FileLowering::new(inputs, queries, file, task);
    lowering.refuse_invalid_regexp_literals();
    let roots = lowering.declare_module_roots();
    loop {
        lowering.queries.note_idle();
        if lowering.queries.is_discarded() {
            lowering.abandon();
            return None;
        }
        let Some(function) = lowering.take_next_function() else {
            break;
        };
        // SAFETY: between two functions, `lowering`, its queries, the checker and `lower_function` borrow from no module but `file`, whose commit follows.
        unsafe { ReadingTask::repin() };
        lower_function(&mut lowering, function);
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
            FunctionKey::FacadeBody(_) => self.lower_facade_body(function),
            FunctionKey::CheckBody(_) => self.lower_check_body(function),
            FunctionKey::Instantiation(_) => self.lower_instantiation(function),
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
    let modules = file.inputs.modules;
    if modules.inner_module(file.file, source).is_some() {
        file.lower_inner_module_body(function, source);
        return;
    }
    match file.hir.runtime_function_kind(source) {
        FnKind::Constructor => file.lower_constructor(function, source),
        _ => file.lower_source_function(function, source),
    }
}
