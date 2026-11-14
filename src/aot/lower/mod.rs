mod appended_pieces;
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
mod definitions_of_getters;
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
mod parts;
mod pattern;
mod positions;
mod private_names;
mod quoted_source;
mod said_types;
mod scope;
mod self_tail_calls;
mod statement;
mod super_calls;
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
use bun_sema_driver::PartsOfVisit;

use self::parts::{NotInParts, infer_types_for_all_parts, plan_parts, prepare_parts};
use self::tables::{put_back_task_state, take_task_state};
use crate::diagnostics::DiagnosticBuffer;
use crate::ir::generated::MethodKind;
use crate::ir::{FunctionId, FunctionKey};

pub use self::context::{FileInputs, LoweringInputs, LoweringOptions, SourceKind};
pub use self::fragment::{Fragment, ModuleFragment, NameOfHeir};
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
    parts: Option<&PartsOfVisit<'_, 's>>,
) -> Option<LoweredFile> {
    let mut task = take_task_state(checker);
    let lowered = checker.with_queries(file, &inputs.query_inputs(), |queries| {
        let in_parts =
            parts.and_then(|parts| lower_in_parts(inputs, queries, file, &mut task, parts));
        match in_parts {
            Some(Ok(lowered)) => return Some(lowered),
            Some(Err(NotInParts::Discarded)) => return None,
            Some(Err(NotInParts::Shared)) | None => {}
        }
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
    lowering.define_missing_factories();
    lowering.define_remaining_layouts();
    let module = lowering.finish_module(roots);
    lowering.define_signatures();
    Some(lowering.finish(module))
}

/// `None`: the file is lowered as a whole.
fn lower_in_parts<'s>(
    inputs: &LoweringInputs<'_>,
    queries: &mut Queries<'_, '_, 's>,
    file: FileId,
    task: &mut TaskState,
    visit: &PartsOfVisit<'_, 's>,
) -> Option<Result<LoweredFile, NotInParts>> {
    if visit.has_given_up() {
        return None;
    }
    let parts = plan_parts(inputs, queries, file)?;
    if !infer_types_for_all_parts(inputs, queries, &parts) {
        return None;
    }
    let Some((scopes, indexes)) = prepare_parts(inputs, queries, &parts, visit) else {
        queries.end_sharing_indexes();
        queries.discard();
        return Some(Err(NotInParts::Discarded));
    };
    let mut lowering = FileLowering::new_sharing(inputs, queries, file, task, scopes, None);
    lowering.begin_trunk(&parts);
    lowering.refuse_invalid_regexp_literals();
    let roots = lowering.declare_module_roots();
    if !lowering.lower_queued_functions() {
        lowering.queries.end_sharing_indexes();
        lowering.abandon();
        return Some(Err(NotInParts::Discarded));
    }
    if let Err(reason) = lowering.lower_parts(visit, &indexes) {
        lowering.abandon();
        return Some(Err(reason));
    }
    if !lowering.lower_queued_functions() {
        lowering.abandon();
        return Some(Err(NotInParts::Discarded));
    }
    lowering.define_missing_factories();
    let module = lowering.finish_module(roots);
    lowering.define_signatures();
    Some(Ok(lowering.finish(module)))
}

impl FileLowering<'_, '_, '_, '_> {
    /// Returns false if the visit was discarded.
    fn lower_queued_functions(&mut self) -> bool {
        loop {
            self.queries.note_idle();
            if self.queries.is_discarded() {
                return false;
            }
            let Some(function) = self.take_next_function() else {
                return true;
            };
            // SAFETY: as in `lower_with_queries`.
            unsafe { ReadingTask::repin() };
            self.lower_function(function);
        }
    }

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
            FunctionKey::ModuleRequest { call, .. } => self.lower_module_request(function, call),
            FunctionKey::CopiedGetter { helper, getter, .. } => {
                self.lower_copied_getter(function, helper, getter);
            }
            FunctionKey::PrototypeMaker(_) => self.lower_prototype_maker(function),
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
