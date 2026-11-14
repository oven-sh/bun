use core::mem::take;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Instant;

use bstr::BStr;
use bun_core::current_work;
use bun_core::file_steps::{self, FileStep};
use bun_sema::bind::{Bound, CodeUnit, Decl, ScopeId, ScopeKind};
use bun_sema::check::Checker;
use bun_sema::check::aot::{FunctionRef, Queries, QueryStatistics};
use bun_sema::check::shared_indexes::SharedIndexes;
use bun_sema::erasure::ReplacedText;
use bun_sema::fold::Constant;
use bun_sema::hir::{self, ClassId, ExprId, Flags, FnId, FnKind, MemberKind, PatId, PropKey};
use bun_sema::program::{FileId, FileRole, ReadingTask};
use bun_sema_driver::PartsOfVisit;
use bun_threading::Guarded;
use rustc_hash::{FxHashMap, FxHashSet};

use super::class;
use super::commonjs::SharedState;
use super::context::{ListsOfFile, ScopesOfFile};
use super::fragment::{Fragment, ModuleFragment};
use super::function;
use super::positions::comes_from_elsewhere;
use super::quoted_source::QuotedInPart;
use super::scope::{BindingRef, ScopeAnalysis, holds_registry};
use super::tables::TaskState;
use super::{FileLowering, KnownHelpersLowered, LoweringInputs, SourceKind};
use crate::diagnostics::DiagnosticBuffer;
use crate::ir::generated::{Function, FunctionFlags, FunctionKind};
use crate::ir::{FunctionId, FunctionKey, LayoutId, for_each_mut};
use crate::link::TableIds;
use crate::modules::ModuleKind;
use crate::statistics::logs_stages;

const LEAST_TEXT: usize = 4 << 20;
const TEXT_OF_A_PART: usize = 1 << 20;
const MOST_PARTS: usize = 8;
const TEXT_OF_A_LAYOUT: u32 = 1 << 10;
const VARIABLES_ASKED_ABOUT_AT_A_TIME: usize = 1 << 10;
const ROOTS_ASKED_ABOUT_AT_A_TIME: usize = 16;

const TRUNK: u16 = u16::MAX;
const UNPLACED: u16 = u16::MAX - 1;

pub(super) struct PartsOfFile {
    count: usize,
    of_functions: Vec<u16>,
    of_classes: Vec<u16>,
    roots: Vec<(FnId, u16)>,
    scopes_of_trunk: Vec<ScopeId>,
}

fn can_be_root(kind: FnKind) -> bool {
    matches!(
        kind,
        FnKind::Decl
            | FnKind::Expr
            | FnKind::Arrow
            | FnKind::Method
            | FnKind::Getter
            | FnKind::Setter
    )
}

fn unit_around(bound: &Bound<'_>, scope: ScopeId) -> Option<CodeUnit> {
    let around = bound.scopes[scope.some()?.idx()].parent;
    around.some().map(|around| bound.code_unit(around))
}

fn can_be_constructed_in_part(hir: &hir::File<'_>, class: ClassId) -> bool {
    let is_decorated = |modifiers| class::has_decorators(hir, modifiers);
    !hir[class].flags.contains(Flags::AMBIENT)
        && !is_decorated(hir[class].modifiers)
        && class::runtime_members(hir, class).all(|member| {
            let has_computed_key = matches!(hir.runtime_member_key(member), PropKey::Computed(_));
            let is_field = hir.runtime_member_kind(member) == MemberKind::Property;
            !is_decorated(hir[member].modifiers) && !(is_field && has_computed_key)
        })
}

fn constructor_of(hir: &hir::File<'_>, class: ClassId) -> Option<FnId> {
    let mut members = class::runtime_members(hir, class);
    let constructor =
        members.find(|&member| hir.runtime_member_kind(member) == MemberKind::Constructor)?;
    Some(hir[constructor].func)
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum Root {
    Function(FnId),
    Class(ClassId),
}

fn find_opened_functions(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    length_of: &dyn Fn(FnId) -> u32,
    divides_small_files: bool,
) -> FxHashSet<FnId> {
    let least = match divides_small_files {
        true => 64,
        false => TEXT_OF_A_PART as u32 / 4,
    };
    let is_tried =
        |function: FnId| !divides_small_files || hir[function].text_start.is_multiple_of(2);
    let mut lengths_inside: FxHashMap<FnId, u32> = FxHashMap::default();
    let mut long: Vec<FnId> = Vec::new();
    for function in (0..hir.fns.len() as u32).map(FnId) {
        let length = length_of(function);
        if length >= least && can_be_root(hir.runtime_function_kind(function)) {
            long.push(function);
        }
        if length != 0
            && let Some(CodeUnit::Function(around)) =
                unit_around(bound, bound.fns[function.idx()].scope)
            && length_of(around) >= least
        {
            *lengths_inside.entry(around).or_default() += length;
        }
    }
    long.sort_unstable_by_key(|&function| bound.fns[function.idx()].scope);
    let mut opened = FxHashSet::default();
    for function in long {
        let is_outermost = match unit_around(bound, bound.fns[function.idx()].scope) {
            Some(CodeUnit::File) => true,
            Some(CodeUnit::Function(around)) => opened.contains(&around),
            Some(CodeUnit::FieldInitializer(_)) | None => false,
        };
        let inside = lengths_inside.get(&function).copied().unwrap_or(0);
        if is_outermost && is_tried(function) && inside >= length_of(function) / 2 {
            opened.insert(function);
        }
    }
    opened
}

impl PartsOfFile {
    fn plan(
        hir: &hir::File<'_>,
        bound: &Bound<'_>,
        divides_small_files: bool,
    ) -> Option<PartsOfFile> {
        let functions = (0..hir.fns.len() as u32).map(FnId);
        let classes = (0..hir.classes.len() as u32).map(ClassId);
        let length_of = |function: FnId| match hir::has_body(&hir[function]) {
            true => {
                let end = function::end_of_function(hir, bound, function);
                end.map_or(0, |end| end.saturating_sub(hir[function].text_start))
            }
            false => 0,
        };
        let opened = find_opened_functions(hir, bound, &length_of, divides_small_files);
        let is_divided = |unit: Option<CodeUnit>| match unit {
            Some(CodeUnit::File) => true,
            Some(CodeUnit::Function(around)) => opened.contains(&around),
            Some(CodeUnit::FieldInitializer(_)) | None => false,
        };
        let mut roots: Vec<(u32, u32, Root)> = Vec::new();
        for function in functions {
            if can_be_root(hir.runtime_function_kind(function))
                && is_divided(unit_around(bound, bound.fns[function.idx()].scope))
                && !opened.contains(&function)
            {
                let length = length_of(function);
                if length != 0 {
                    roots.push((hir[function].text_start, length, Root::Function(function)));
                }
            }
        }
        for class in classes {
            let scope = bound.class_scope[class.idx()];
            if scope.is_some()
                && is_divided(Some(bound.code_unit(scope)))
                && can_be_constructed_in_part(hir, class)
            {
                let of_constructor = constructor_of(hir, class).map_or(0, length_of);
                let length = of_constructor + TEXT_OF_A_LAYOUT;
                roots.push((hir[class].text_start, length, Root::Class(class)));
            }
        }
        let total: u64 = roots.iter().map(|root| u64::from(root.1)).sum();
        let count = match divides_small_files {
            true => roots.len().min(3),
            false => (total as usize / TEXT_OF_A_PART).min(MOST_PARTS),
        };
        if count < 2 {
            return None;
        }
        roots.sort_unstable();
        let mut parts = PartsOfFile {
            count,
            of_functions: vec![UNPLACED; hir.fns.len()],
            of_classes: vec![UNPLACED; hir.classes.len()],
            roots: Vec::with_capacity(roots.len()),
            scopes_of_trunk: Vec::new(),
        };
        for function in opened {
            parts.of_functions[function.idx()] = TRUNK;
        }
        let mut text_before = 0u64;
        for (_, length, root) in roots {
            let part = (text_before * count as u64 / total.max(1)) as u16;
            text_before += u64::from(length);
            match root {
                Root::Function(function) => {
                    parts.of_functions[function.idx()] = part;
                    parts.roots.push((function, part));
                }
                Root::Class(class) => {
                    parts.of_classes[class.idx()] = part;
                    let members = class::runtime_members(hir, class);
                    let built_with_it = members.filter(|&member| {
                        matches!(
                            hir.runtime_member_kind(member),
                            MemberKind::Constructor | MemberKind::StaticBlock
                        )
                    });
                    for function in built_with_it.filter_map(|it| hir[it].func.some()) {
                        parts.of_functions[function.idx()] = part;
                    }
                }
            }
        }
        let mut of_scopes = vec![TRUNK; bound.scopes.len()];
        for (index, scope) in bound.scopes.iter().enumerate() {
            let around = scope
                .parent
                .some()
                .map_or(TRUNK, |around| of_scopes[around.idx()]);
            of_scopes[index] = match scope.kind {
                ScopeKind::Fn(function) => {
                    let of_function = &mut parts.of_functions[function.idx()];
                    if *of_function == UNPLACED {
                        *of_function = around;
                    }
                    *of_function
                }
                ScopeKind::Class(class) => {
                    let of_class = &mut parts.of_classes[class.idx()];
                    if *of_class == UNPLACED {
                        *of_class = around;
                    }
                    around
                }
                ScopeKind::FieldInitializer(member) => match bound.member_class(member) {
                    Some(class) => parts.of_classes[class.idx()],
                    None => around,
                },
                _ => around,
            };
            if of_scopes[index] == TRUNK {
                parts.scopes_of_trunk.push(ScopeId(index as u32));
            }
        }
        for part in parts.of_functions.iter_mut().chain(&mut parts.of_classes) {
            if *part == UNPLACED {
                *part = TRUNK;
            }
        }
        Some(parts)
    }
}

pub(super) struct Request {
    key: FunctionKey,
    name: Option<Box<[u8]>>,
    is_named_by_computed_key: bool,
    is_module_body: bool,
}

pub(super) struct PartState {
    parts: Arc<PartsOfFile>,
    own: u16,
    requests: Vec<Request>,
    requested: FxHashSet<FunctionKey>,
    with_positions: FxHashSet<FnId>,
    evaluated_classes: FxHashSet<ClassId>,
}

impl PartState {
    fn new(parts: Arc<PartsOfFile>, own: u16) -> Box<PartState> {
        Box::new(PartState {
            parts,
            own,
            requests: Vec::new(),
            requested: FxHashSet::default(),
            with_positions: FxHashSet::default(),
            evaluated_classes: FxHashSet::default(),
        })
    }
}

#[derive(Default)]
struct BeginningOfPart {
    requests: Vec<Request>,
    evaluated_classes: FxHashSet<ClassId>,
}

#[derive(Clone)]
pub(super) struct SharedOfFile {
    scopes: ScopesOfFile,
    pub(super) simplified_expressions: Arc<Vec<ExprId>>,
    pub(super) invalid_regexp_literals_left_out: Arc<Vec<ExprId>>,
    pub(super) lists: Arc<ListsOfFile>,
    commonjs: SharedState,
}

pub(super) struct LoweredPart {
    fragment: Fragment,
    diagnostics: DiagnosticBuffer,
    queries: QueryStatistics,
    known_helpers: KnownHelpersLowered,
    written_function_names: Vec<u8>,
    requests: Vec<Request>,
    values_written_in_place: Vec<(ExprId, Constant)>,
    enums_written_as_code: Vec<ReplacedText>,
    quoted_sources: QuotedInPart,
}

const fn assert_send<T: Send>() {}

const _: () = assert_send::<LoweredPart>();

pub(super) enum NotInParts {
    Discarded,
    Shared,
}

pub(super) fn plan_parts(
    inputs: &LoweringInputs<'_>,
    queries: &Queries<'_, '_, '_>,
    file: FileId,
) -> Option<Arc<PartsOfFile>> {
    let (hir, bound) = (queries.hir(), queries.bound());
    let (options, modules) = (inputs.options, inputs.modules);
    let is_large = hir.text.len() >= LEAST_TEXT || options.divides_small_files;
    let kind_of_source = inputs.files[file.idx()]?.source;
    let can_be_divided = is_large
        && hir.is_js
        && queries.role(file) == FileRole::Inferred
        && kind_of_source == SourceKind::Program
        && !bound.has_loop_types_that_depend_on_order
        && !options.counts_executions
        && !modules.has_instances(file)
        && matches!(
            modules.kind(file),
            ModuleKind::SourceText | ModuleKind::CommonJs
        );
    can_be_divided
        .then(|| PartsOfFile::plan(hir, bound, options.divides_small_files).map(Arc::new))?
}

pub(super) fn infer_types_for_all_parts(
    inputs: &LoweringInputs<'_>,
    queries: &mut Queries<'_, '_, '_>,
    parts: &PartsOfFile,
) -> bool {
    let file = queries.file();
    let count = parts.roots.len();
    let is_too_much =
        |functions: usize| functions * 4 > count && !inputs.options.divides_small_files;
    queries.note_functions_inferred();
    let stride = find_stride(count);
    let (mut place, mut asked, mut functions_of_others) = (0, 0, 0);
    while asked < count {
        let (mut functions, mut of_others) = (0, 0);
        for _ in 0..ROOTS_ASKED_ABOUT_AT_A_TIME.min(count - asked) {
            let (function, part) = parts.roots[place];
            place = (place + stride) % count;
            asked += 1;
            queries.function_signature(FunctionRef { file, function });
            for inferred in queries.take_functions_inferred() {
                functions += 1;
                of_others += usize::from(parts.of_functions[inferred.idx()] != part);
            }
        }
        functions_of_others += of_others;
        let is_local = of_others * 4 <= functions;
        if is_local || is_too_much(functions_of_others) || queries.is_discarded() {
            break;
        }
    }
    queries.forget_functions_inferred();
    !is_too_much(functions_of_others)
}

fn find_stride(count: usize) -> usize {
    let is_coprime = |mut a: usize, mut b: usize| {
        while b != 0 {
            (a, b) = (b, a % b);
        }
        a == 1
    };
    let first = count * 5 / 13 + 1;
    (first..)
        .find(|&stride| is_coprime(stride, count))
        .unwrap_or(1)
}

fn find_variables_assigned_by_calls(
    queries: &Queries<'_, '_, '_>,
    parts: &PartsOfFile,
    scopes: &ScopeAnalysis,
) -> Vec<PatId> {
    let (hir, bound) = (queries.hir(), queries.bound());
    let mut given = Vec::new();
    for &scope in &parts.scopes_of_trunk {
        for &binding in scopes.bindings(scope) {
            if let BindingRef::Symbol(symbol) = binding
                && let [Decl::Var(pattern)] = *bound.symbol(symbol).decls
                && bound.is_stable_binding(symbol)
                && comes_from_elsewhere(hir, bound, pattern)
            {
                given.push(pattern);
            }
        }
    }
    given
}

pub(super) fn prepare_parts<'s>(
    inputs: &LoweringInputs<'_>,
    queries: &mut Queries<'_, '_, 's>,
    parts: &PartsOfFile,
    visit: &PartsOfVisit<'_, 's>,
) -> Option<(ScopesOfFile, Arc<SharedIndexes<'s>>)> {
    let file = queries.file();
    let indexes = queries.begin_sharing_indexes();
    queries.share_inferred_types(&indexes);
    let mut scopes: Guarded<Option<ScopesOfFile>> = Guarded::new(None);
    let ask = |checker: &mut Checker<'_, 's>, ask: &mut dyn FnMut(&mut Queries<'_, '_, 's>)| {
        let _step = file_steps::count(FileStep::Lower);
        checker.share_indexes(file, &indexes);
        checker.with_queries(file, &inputs.query_inputs(), |queries| {
            queries.take_over_inferred_types(&indexes);
            ask(queries);
        });
    };
    let were_kept = AtomicBool::new(true);
    let ask_about_each =
        |count: usize, holds: &(dyn Fn(&mut Queries<'_, '_, 's>, usize) -> bool + Sync)| {
            let runs = count.div_ceil(VARIABLES_ASKED_ABOUT_AT_A_TIME);
            let answers: Vec<Guarded<Vec<bool>>> =
                (0..runs).map(|_| Guarded::new(Vec::new())).collect();
            let ask_some = |checker: &mut Checker<'_, 's>, run: usize| {
                let first = run * VARIABLES_ASKED_ABOUT_AT_A_TIME;
                let some = first..(first + VARIABLES_ASKED_ABOUT_AT_A_TIME).min(count);
                ask(checker, &mut |queries| {
                    *answers[run].lock() =
                        some.clone().map(|index| holds(queries, index)).collect();
                });
            };
            if !visit.run(runs, &ask_some, &mut || {}) {
                were_kept.store(false, Ordering::Relaxed);
            }
            let answers = answers.into_iter();
            answers
                .flat_map(|mut some| take(some.get_mut()))
                .collect::<Vec<bool>>()
        };
    let was_kept = visit.run(
        1 + SharedIndexes::COUNT,
        &|checker, number| {
            ask(checker, &mut |queries| match number.checked_sub(1) {
                Some(index) => queries.make_shared_index(index),
                None => {
                    let found = ScopesOfFile::find_asking(inputs, queries, &|_, variables| {
                        ask_about_each(variables.len(), &|queries, index| {
                            holds_registry(queries, variables[index])
                        })
                    });
                    let given = find_variables_assigned_by_calls(queries, parts, &found.analysis);
                    let answers = ask_about_each(given.len(), &|queries, index| {
                        queries.uses_say_list_of_lists(given[index])
                    });
                    indexes.note_lists_of_lists(given.into_iter().zip(answers).collect());
                    *scopes.lock() = Some(found);
                }
            });
        },
        &mut || {},
    );
    if !was_kept || !were_kept.into_inner() {
        return None;
    }
    let scopes = scopes.get_mut().take();
    scopes.map(|scopes| (scopes, indexes))
}

impl<'a, 'c, 'p, 's> FileLowering<'a, 'c, 'p, 's> {
    pub(super) fn begin_trunk(&mut self, parts: &Arc<PartsOfFile>) {
        self.part = Some(PartState::new(Arc::clone(parts), TRUNK));
    }

    pub(super) fn is_of_other_part(&self, function: FnId) -> bool {
        let part = self.part.as_ref();
        part.is_some_and(|part| part.parts.of_functions[function.idx()] != part.own)
    }

    pub(super) fn is_class_of_other_part(&self, class: ClassId) -> bool {
        let part = self.part.as_ref();
        part.is_some_and(|part| part.parts.of_classes[class.idx()] != part.own)
    }

    pub(super) fn is_key_of_other_part(&self, key: FunctionKey) -> bool {
        match key {
            FunctionKey::Source(source) => self.is_of_other_part(source.function),
            FunctionKey::ImplicitConstructor(class)
            | FunctionKey::InstanceInitializer(class)
            | FunctionKey::StaticInitializer(class) => self.is_class_of_other_part(class.class),
            _ => false,
        }
    }

    pub(super) fn request_function(&mut self, key: FunctionKey, header: &Function) {
        let name = header
            .name
            .map(|name| self.fragment.strings.get(name).into());
        if let Some(part) = &mut self.part
            && part.requested.insert(key)
        {
            part.requests.push(Request {
                key,
                name,
                is_named_by_computed_key: header
                    .flags
                    .contains(FunctionFlags::IS_NAMED_BY_COMPUTED_KEY),
                is_module_body: header.kind == FunctionKind::CommonJsModule,
            });
        }
    }

    pub(super) fn request_class(&mut self, class: ClassId) -> LayoutId {
        if let Some(part) = &mut self.part {
            part.evaluated_classes.insert(class);
        }
        self.own_class_layout(class)
    }

    pub(super) fn constructor_of_class_evaluated_elsewhere(
        &mut self,
        class: ClassId,
    ) -> Option<FunctionId> {
        let part = self.part.as_ref()?;
        if !part.evaluated_classes.contains(&class) {
            return None;
        }
        let key = match constructor_of(self.hir, class) {
            Some(function) => FunctionKey::Source(FunctionRef {
                file: self.file,
                function,
            }),
            None => FunctionKey::ImplicitConstructor(self.own_class(class)),
        };
        Some(self.reference_function(key))
    }

    pub(super) fn needs_positions_of_other_part(&mut self, function: FnId) -> bool {
        let part = self.part.as_mut();
        part.is_some_and(|part| part.with_positions.insert(function))
    }

    fn declare_requested(&mut self, request: &Request) {
        let name = request.name.as_ref().map(|name| self.intern_bytes(name));
        let is_under_computed_key = request.is_named_by_computed_key;
        let function = match request.key {
            FunctionKey::Source(source) => source.function,
            FunctionKey::ImplicitConstructor(class) => {
                class::declare_constructor_of_class(self, class.class, name, is_under_computed_key);
                return;
            }
            FunctionKey::InstanceInitializer(class) => {
                class::declare_initializer(self, class.class, false);
                return;
            }
            FunctionKey::StaticInitializer(class) => {
                class::declare_initializer(self, class.class, true);
                return;
            }
            _ => unreachable!("no other function is lowered in another part"),
        };
        if request.is_module_body {
            self.declare_inner_module_body(function);
        } else if self.hir.runtime_function_kind(function) == FnKind::Constructor
            && let Some(class) = self.bound.function_class(function)
        {
            class::declare_constructor_of_class(self, class, name, is_under_computed_key);
        } else if is_under_computed_key {
            function::declare_source_function_with(self, function, &mut |_, header| {
                header.name = name;
                header.flags |= FunctionFlags::IS_NAMED_BY_COMPUTED_KEY;
            });
        } else {
            function::declare_source_function(self, function, name);
        }
    }

    fn share(&self) -> SharedOfFile {
        SharedOfFile {
            scopes: ScopesOfFile {
                analysis: Arc::clone(&self.scopes),
                fields_under_signed_members: self.classes.fields_under_signed_members.clone(),
            },
            simplified_expressions: Arc::clone(&self.simplified_expressions),
            invalid_regexp_literals_left_out: Arc::clone(&self.invalid_regexp_literals_left_out),
            lists: Arc::clone(&self.lists),
            commonjs: SharedState::of(self),
        }
    }

    fn begin_parts(&mut self) -> Vec<BeginningOfPart> {
        let part = self.part.as_mut().expect("the file is lowered in parts");
        let parts = Arc::clone(&part.parts);
        let requests = take(&mut part.requests);
        let requested = take(&mut part.requested);
        let evaluated_classes = take(&mut part.evaluated_classes);
        let mut beginnings: Vec<BeginningOfPart> = Vec::new();
        beginnings.resize_with(parts.count, BeginningOfPart::default);
        for class in evaluated_classes {
            let of_class = parts.of_classes[class.idx()];
            beginnings[of_class as usize]
                .evaluated_classes
                .insert(class);
        }
        for request in requests {
            let of_request = match request.key {
                FunctionKey::Source(source) => parts.of_functions[source.function.idx()],
                FunctionKey::ImplicitConstructor(class)
                | FunctionKey::InstanceInitializer(class)
                | FunctionKey::StaticInitializer(class) => parts.of_classes[class.class.idx()],
                _ => unreachable!("no other function is lowered in another part"),
            };
            beginnings[of_request as usize].requests.push(request);
        }
        for &(function, of_function) in &parts.roots {
            let source = FunctionRef {
                file: self.file,
                function,
            };
            let key = FunctionKey::Source(source);
            let is_inner = unit_around(self.bound, self.bound.fns[function.idx()].scope)
                != Some(CodeUnit::File);
            let symbol = self.bound.symbol_of_declaration(Decl::Fn(function));
            let is_live = self.hir[function].kind == FnKind::Decl
                && !requested.contains(&key)
                && !(is_inner && self.scopes.is_never_named(symbol))
                && !self.decisions().is_dead_function(function)
                && !self.inputs.library_functions.is_left_out(source);
            if is_live {
                beginnings[of_function as usize].requests.push(Request {
                    key,
                    name: None,
                    is_named_by_computed_key: false,
                    is_module_body: false,
                });
            }
        }
        beginnings
    }

    fn finish_part(mut self) -> Option<LoweredPart> {
        if self.resolved_fields.is_used() {
            self.abandon();
            return None;
        }
        self.fragment.is_checked = self.is_checked();
        let queries = self.queries.statistics();
        let requests = self
            .part
            .take()
            .map(|part| part.requests)
            .unwrap_or_default();
        let values_written_in_place = self.values_written_in_place.take();
        let enums_written_as_code = take(&mut self.enums_written_as_code);
        let quoted_sources = self.take_quoted_in_part();
        let written_function_names = self.take_written_function_names();
        let FileLowering {
            task,
            fragment,
            diagnostics,
            known_helpers_lowered,
            ..
        } = self;
        Some(LoweredPart {
            fragment: fragment.finish(ModuleFragment::default(), task),
            diagnostics,
            queries,
            known_helpers: known_helpers_lowered,
            written_function_names,
            requests,
            values_written_in_place,
            enums_written_as_code,
            quoted_sources,
        })
    }

    pub(super) fn lower_parts(
        &mut self,
        visit: &PartsOfVisit<'_, 's>,
        indexes: &Arc<SharedIndexes<'s>>,
    ) -> Result<(), NotInParts> {
        let beginnings = self.begin_parts();
        let shared = self.share();
        let (inputs, file) = (self.inputs, self.file);
        let path = self.queries.files().module(file).file_name();
        let parts = match &self.part {
            Some(part) => Arc::clone(&part.parts),
            None => return Ok(()),
        };
        let lowered: Vec<Guarded<Option<LoweredPart>>> =
            (0..parts.count).map(|_| Guarded::new(None)).collect();
        let is_shared = AtomicBool::new(false);
        let longest = AtomicU64::new(0);
        let began = Instant::now();
        let was_kept = visit.run(
            parts.count,
            &|checker, part| {
                let _step = file_steps::count(FileStep::Lower);
                let _work = current_work::working_on(current_work::Step::Lower, path);
                let began_part = Instant::now();
                let mut task = TaskState::new();
                checker.share_indexes(file, indexes);
                let outcome = checker.with_queries(file, &inputs.query_inputs(), |queries| {
                    queries.take_over_inferred_types(indexes);
                    lower_part(
                        inputs,
                        queries,
                        file,
                        &mut task,
                        &shared,
                        &parts,
                        part,
                        &beginnings[part],
                    )
                });
                match outcome {
                    Ok(part_lowered) => *lowered[part].lock() = Some(part_lowered),
                    Err(NotInParts::Discarded) => {}
                    Err(NotInParts::Shared) => {
                        is_shared.store(true, Ordering::Relaxed);
                    }
                }
                longest.fetch_max(began_part.elapsed().as_millis() as u64, Ordering::Relaxed);
            },
            &mut || self.define_remaining_layouts(),
        );
        self.queries.end_sharing_indexes();
        let lowered_after = began.elapsed();
        if !was_kept {
            self.queries.discard();
            return Err(NotInParts::Discarded);
        }
        if is_shared.into_inner() {
            return Err(NotInParts::Shared);
        }
        self.define_signatures();
        let lowered: Option<Vec<LoweredPart>> = (lowered.into_iter())
            .map(|mut part| part.get_mut().take())
            .collect();
        let Some(mut lowered) = lowered else {
            return Err(NotInParts::Discarded);
        };
        let mut numbered: Vec<(&mut LoweredPart, TableIds)> = Vec::with_capacity(lowered.len());
        for part in &mut lowered {
            let ids = self.fragment.number_part(&part.fragment);
            numbered.push((part, ids));
        }
        for_each_mut(&mut numbered, visit.in_parallel(), &|(part, ids)| {
            part.fragment.remap_code(ids);
        });
        let all_ids: Vec<TableIds> = numbered.into_iter().map(|(_, ids)| ids).collect();
        let mut missing: Vec<Request> = Vec::new();
        for (part, ids) in lowered.into_iter().zip(all_ids) {
            let LoweredPart {
                fragment,
                diagnostics,
                queries,
                known_helpers,
                written_function_names,
                requests,
                values_written_in_place,
                enums_written_as_code,
                quoted_sources,
            } = part;
            self.fragment.absorb(fragment, &ids);
            self.diagnostics.append(diagnostics);
            self.queries.add_statistics_of_part(&queries);
            self.known_helpers_lowered.functions += known_helpers.functions;
            self.known_helpers_lowered.calls += known_helpers.calls;
            self.add_written_function_names(&written_function_names);
            self.values_written_in_place
                .get_mut()
                .extend(values_written_in_place);
            self.enums_written_as_code.extend(enums_written_as_code);
            self.add_quoted_in_part(quoted_sources);
            missing.extend(requests);
        }
        if logs_stages() {
            bun_core::print_errorln!(
                "AOT file in parts: Lower | {} | {} parts | wall {} ms, the longest part {} ms | joined in {} ms",
                BStr::new(path),
                parts.count,
                lowered_after.as_millis(),
                longest.into_inner(),
                (began.elapsed() - lowered_after).as_millis(),
            );
        }
        self.part = None;
        for request in missing {
            if !self.fragment.is_function_defined(request.key) {
                self.forget_header(request.key);
                self.declare_requested(&request);
            }
        }
        Ok(())
    }
}

#[allow(clippy::too_many_arguments, reason = "all of it is what a part is")]
fn lower_part<'a, 'c, 'p, 's>(
    inputs: &'a LoweringInputs<'a>,
    queries: &'a mut Queries<'c, 'p, 's>,
    file: FileId,
    task: &'a mut TaskState,
    shared: &SharedOfFile,
    parts: &Arc<PartsOfFile>,
    part: usize,
    beginning: &BeginningOfPart,
) -> Result<LoweredPart, NotInParts> {
    let scopes = shared.scopes.clone();
    let mut lowering = FileLowering::new_sharing(inputs, queries, file, task, scopes, Some(shared));
    shared.commonjs.clone().give(&mut lowering);
    let mut state = PartState::new(Arc::clone(parts), part as u16);
    state
        .evaluated_classes
        .clone_from(&beginning.evaluated_classes);
    lowering.part = Some(state);
    for request in &beginning.requests {
        lowering.declare_requested(request);
    }
    loop {
        lowering.queries.note_idle();
        if lowering.queries.is_discarded() {
            lowering.abandon();
            return Err(NotInParts::Discarded);
        }
        let Some(function) = lowering.take_next_function() else {
            break;
        };
        // SAFETY: as in `lower_with_queries`.
        unsafe { ReadingTask::repin() };
        lowering.lower_function(function);
    }
    lowering.define_remaining_layouts();
    lowering.define_signatures();
    lowering.finish_part().ok_or(NotInParts::Shared)
}
