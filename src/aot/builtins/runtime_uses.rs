use super::table::{
    self, BuiltinFlags, BuiltinId, BuiltinKind, BuiltinName, Origin, Platforms, Prototype,
    RuntimeFunction, RuntimeFunctionRole, RuntimeModule,
};
use crate::ir::WellKnownSymbol;
use bun_collections::DynamicBitSet;
use bun_core::UnwrapOrOom as _;
use bun_sema::util::SharedSort;
use std::sync::OnceLock;

#[cfg(test)]
mod tests;

#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct RuntimeUses {
    pub modules: Box<[RuntimeModule]>,
    pub modules_read_whole: Box<[RuntimeModule]>,
    pub exports_read: Box<[(RuntimeModule, &'static str)]>,
    pub functions: Box<[RuntimeFunction]>,
    pub lets_in_what_nobody_names: bool,
    pub asks: AsksOfText,
}

#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct AsksOfText {
    pub members_read: Vec<BuiltinName>,
    pub reads_by_unknown_key: bool,
    pub syntax: SyntaxWithHelpers,
    pub may_hand_values_to_natives: bool,
}

impl AsksOfText {
    fn asks_operands(&self) -> bool {
        self.may_hand_values_to_natives
            || self.reads_by_unknown_key
            || !self.members_read.is_empty()
            || !self.syntax.is_empty()
    }

    pub fn add(&mut self, other: &AsksOfText) {
        self.members_read.extend_from_slice(&other.members_read);
        self.reads_by_unknown_key |= other.reads_by_unknown_key;
        self.syntax |= other.syntax;
        self.may_hand_values_to_natives |= other.may_hand_values_to_natives;
    }
}

struct Collected {
    modules: DynamicBitSet,
    modules_read_whole: DynamicBitSet,
    exports_read: Vec<(RuntimeModule, &'static str)>,
    functions: DynamicBitSet,
}

struct Collector {
    platform: Platforms,
    visited: DynamicBitSet,
    work_stack: Vec<BuiltinId>,
    collected: Collected,
    has_unknown_module_loader: bool,
    marks_met: Marks,
    lets_in_what_nobody_names: bool,
    finds_language_by_names: bool,
    holds_functions_for_any_host_object: bool,
    asks: AsksOfText,
}

struct Reached {
    modules: Box<[RuntimeModule]>,
    modules_read_whole: Box<[RuntimeModule]>,
    exports_read: Box<[(RuntimeModule, &'static str)]>,
    functions: Box<[u32]>,
    has_unknown_module_loader: bool,
    marks_met: Marks,
}

fn reached_from(
    id: BuiltinId,
    platform: Platforms,
    finds_language_by_names: bool,
) -> &'static Reached {
    type ByEntry = Box<[OnceLock<Box<Reached>>]>;
    const WAYS_TO_ASK: usize = (Platforms::all().bits() as usize + 1) * 2;
    static REACHED: [OnceLock<ByEntry>; WAYS_TO_ASK] = [const { OnceLock::new() }; WAYS_TO_ASK];
    let way = platform.bits() as usize * 2 + usize::from(finds_language_by_names);
    let by_entry =
        REACHED[way].get_or_init(|| (0..BuiltinId::COUNT).map(|_| OnceLock::new()).collect());
    by_entry[id.to_wire() as usize].get_or_init(|| {
        let mut collector = Collector::new(platform);
        collector.finds_language_by_names = finds_language_by_names;
        collector.work_stack.push(id);
        collector.walk_reachable_entries();
        let Collected {
            modules,
            modules_read_whole,
            mut exports_read,
            functions,
        } = collector.collected;

        exports_read.shared_sort_unstable();
        exports_read.dedup();
        let rows = 0..table::runtime_functions().len() as u32;
        Box::new(Reached {
            modules: list_modules(&modules),
            modules_read_whole: list_modules(&modules_read_whole),
            exports_read: exports_read.into(),
            functions: rows.filter(|&row| functions.is_set(row as usize)).collect(),
            has_unknown_module_loader: collector.has_unknown_module_loader,
            marks_met: collector.marks_met,
        })
    })
}

const UNKNOWN_MODULE_LOADERS: BuiltinFlags =
    BuiltinFlags::LOADS_MODULE_BY_NAME.union(BuiltinFlags::RUNS_UNSEEN_CODE);

const EVALUATORS: BuiltinFlags = BuiltinFlags::EVALUATES_TEXT.union(BuiltinFlags::RUNS_UNSEEN_CODE);

const WRITTEN_IN_PLACE_OF: &[(BuiltinId, &[BuiltinId])] = &[
    (
        BuiltinId::Array,
        &[
            BuiltinId::CompilerHelpersCheckedArrayLength,
            BuiltinId::CompilerHelpersArrayOfUndefined,
            BuiltinId::CompilerHelpersArrayFromLength,
            BuiltinId::CompilerHelpersFilledArray,
            BuiltinId::CompilerHelpersMappedFilledArray,
        ],
    ),
    (
        BuiltinId::ArrayFrom,
        &[
            BuiltinId::CompilerHelpersArrayOfUndefined,
            BuiltinId::CompilerHelpersArrayFromLength,
            BuiltinId::CompilerHelpersArrayFromList,
        ],
    ),
];

const DECORATOR_HELPERS: &[BuiltinId] = &[
    BuiltinId::CompilerHelpersApplyAccessorDecorators,
    BuiltinId::CompilerHelpersApplyClassDecorators,
    BuiltinId::CompilerHelpersApplyFieldDecorators,
    BuiltinId::CompilerHelpersApplyMethodDecorators,
    BuiltinId::CompilerHelpersApplyPrivateAccessorDecorators,
    BuiltinId::CompilerHelpersApplyPrivateFieldDecorators,
    BuiltinId::CompilerHelpersApplyPrivateMethodDecorators,
    BuiltinId::CompilerHelpersCreateDecoratorMetadata,
    BuiltinId::CompilerHelpersCreateElement,
    BuiltinId::CompilerHelpersCreatePrivateStorage,
    BuiltinId::CompilerHelpersDecorateClass,
    BuiltinId::CompilerHelpersDecorateMethod,
    BuiltinId::CompilerHelpersDecorateParameter,
    BuiltinId::CompilerHelpersDecorateProperty,
    BuiltinId::CompilerHelpersDefineMetadata,
    BuiltinId::CompilerHelpersRunInitializers,
    BuiltinId::CompilerHelpersRunValueInitializers,
    BuiltinId::CompilerHelpersSetDecoratorMetadata,
];

const ITERATION_HELPERS: &[BuiltinId] = &[
    BuiltinId::CompilerHelpersOpenIterator,
    BuiltinId::CompilerHelpersOpenWrappedIterator,
    BuiltinId::CompilerHelpersStepIterator,
    BuiltinId::CompilerHelpersWayToStepIterator,
    BuiltinId::CompilerHelpersStepIteratorInWay,
    BuiltinId::CompilerHelpersCloseIterator,
    BuiltinId::CompilerHelpersCloseIteratorAfterThrow,
    BuiltinId::CompilerHelpersAppendGenerator,
    BuiltinId::CompilerHelpersAppendIterable,
    BuiltinId::CompilerHelpersTakeFromIterable,
    BuiltinId::CompilerHelpersNextOfStepsOverText,
];

const METHODS_OF_GENERATORS: &[BuiltinId] = &[
    BuiltinId::GeneratorPrototypeNext,
    BuiltinId::GeneratorPrototypeReturn,
    BuiltinId::GeneratorPrototypeThrow,
];

const HELPERS_OF_SYNTAX: &[(SyntaxWithHelpers, &[BuiltinId])] = &[
    (SyntaxWithHelpers::DECORATOR, DECORATOR_HELPERS),
    (
        SyntaxWithHelpers::DISPOSAL,
        &[BuiltinId::CompilerHelpersGetDisposeMethod],
    ),
    (
        SyntaxWithHelpers::ASYNC_DISPOSAL,
        &[BuiltinId::CompilerHelpersGetAsyncDisposeMethod],
    ),
    (SyntaxWithHelpers::ITERATION, ITERATION_HELPERS),
    (SyntaxWithHelpers::GENERATOR, METHODS_OF_GENERATORS),
    (SyntaxWithHelpers::PROMISE, &[BuiltinId::Promise]),
    (
        SyntaxWithHelpers::IMPORT_CALL,
        &[BuiltinId::CompilerHelpersImportRejectedByLoader],
    ),
];

bitflags::bitflags! {
    #[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
    pub struct SyntaxWithHelpers: u8 {
        const DECORATOR = 1 << 0;
        const DISPOSAL = 1 << 1;
        const ITERATION = 1 << 2;
        const GENERATOR = 1 << 3;
        const PROMISE = 1 << 4;
        const IMPORT_CALL = 1 << 5;
        const ASYNC_DISPOSAL = 1 << 6;
    }
}

fn reads_member_under_key_it_is_handed(id: BuiltinId) -> bool {
    table::ENTRIES_READING_UNDER_KEYS_THEY_ARE_HANDED.contains(&id)
}

fn is_called_without_a_name(role: RuntimeFunctionRole) -> bool {
    matches!(
        role,
        RuntimeFunctionRole::CompilerFunction | RuntimeFunctionRole::Model
    )
}

fn is_of_language(id: BuiltinId) -> bool {
    let entry = table::entry(id);
    entry.origin == Origin::Engine || entry.flags.contains(BuiltinFlags::IS_COMPILER_HELPER)
}

fn objects_of_class_of(id: BuiltinId) -> impl Iterator<Item = BuiltinId> {
    table::entry(id).class.into_iter().flat_map(|class| {
        let data = table::class_data(class);
        [data.constructor, data.prototype].into_iter().flatten()
    })
}

fn has_code_of_library(id: BuiltinId) -> bool {
    let entry = table::entry(table::canonical_id(id));
    !(entry.loads().is_empty()
        && entry.calls().is_empty()
        && entry.calls_for_texts().is_empty()
        && entry.calls_where_call_runs_other_code().is_empty()
        && entry.implemented_by().is_empty()
        && entry.guessed_functions().is_empty())
        || objects_of_class_of(id).any(|object| !table::entry(object).calls().is_empty())
}

fn language_entries_with_code() -> &'static [BuiltinId] {
    static ENTRIES: OnceLock<Box<[BuiltinId]>> = OnceLock::new();
    ENTRIES.get_or_init(|| {
        let entries = BuiltinId::ALL.into_iter();
        entries
            .filter(|&id| {
                is_of_language(id)
                    && (has_code_of_library(id)
                        || reads_member_under_key_it_is_handed(id)
                        || id == BuiltinId::SymbolFor)
            })
            .collect()
    })
}

bitflags::bitflags! {
    #[derive(Copy, Clone)]
    struct Marks: u8 {
        const READS_MEMBER_BY_KEY = 1 << 0;
        const LEADS_TO_PRINTER = 1 << 1;
        const MAKES_PROMISE = 1 << 2;
        const MAY_HAND_OUT_ANY_HOST_OBJECT = 1 << 3;
        const HANDS_OUT_MEMBER_BY_KEY = 1 << 4;
    }
}

fn marks_of(id: BuiltinId) -> Marks {
    static MARKS: OnceLock<Box<[Marks]>> = OnceLock::new();
    let marks = MARKS.get_or_init(|| {
        let mut marks: Box<[Marks]> = BuiltinId::ALL
            .into_iter()
            .map(|id| {
                let mut marks = Marks::empty();
                marks.set(
                    Marks::READS_MEMBER_BY_KEY,
                    reads_member_under_key_it_is_handed(id),
                );
                marks
            })
            .collect();
        for &id in table::ENTRIES_THAT_MAKE_PROMISES {
            marks[id.to_wire() as usize] |= Marks::MAKES_PROMISE;
        }
        let leading = table::ENTRIES_LEADING_TO_STARTUP_LOADS.iter().copied();
        for id in leading.chain([BuiltinId::BunInspectCustom]) {
            marks[id.to_wire() as usize] |= Marks::LEADS_TO_PRINTER;
        }
        for &id in table::ENTRIES_THAT_MAY_HAND_OUT_ANY_HOST_OBJECT {
            marks[id.to_wire() as usize] |= Marks::MAY_HAND_OUT_ANY_HOST_OBJECT;
            if table::ANY_HOST_OBJECT_LEADS_TO_STARTUP_LOADS {
                marks[id.to_wire() as usize] |= Marks::LEADS_TO_PRINTER;
            }
        }
        for &id in table::ENTRIES_HANDING_OUT_WHAT_LIES_UNDER_KEYS {
            marks[id.to_wire() as usize] |= Marks::HANDS_OUT_MEMBER_BY_KEY;
        }
        marks
    });
    marks[id.to_wire() as usize]
}

fn holders_that_come_with_first_promise() -> &'static [BuiltinId] {
    static HOLDERS: OnceLock<Box<[BuiltinId]>> = OnceLock::new();
    HOLDERS.get_or_init(|| {
        let makes_promise = |id: BuiltinId| marks_of(id).contains(Marks::MAKES_PROMISE);
        let makers = BuiltinId::ALL.into_iter();
        let makers = makers.filter(|&id| is_of_language(id) && makes_promise(id));
        let holders = makers.filter_map(|id| table::entry(id).holder.map(table::canonical_id));
        let mut holders: Vec<BuiltinId> = holders
            .filter(|&holder| {
                makes_promise(holder) || table::entry(holder).kind == BuiltinKind::Prototype
            })
            .chain(
                table::PROTOTYPES_THAT_COME_WITH_FIRST_PROMISE
                    .iter()
                    .copied(),
            )
            .collect();
        holders.sort_unstable();
        holders.dedup();
        holders.into_boxed_slice()
    })
}

fn has_members_found_by_name_alone(holder: BuiltinId) -> bool {
    is_of_language(holder)
        && table::entry(holder).kind != BuiltinKind::Namespace
        && holders_that_come_with_first_promise()
            .binary_search(&holder)
            .is_err()
}

fn is_found_by_name_alone(id: BuiltinId) -> bool {
    let runs_code = matches!(
        table::entry(table::canonical_id(id)).kind,
        BuiltinKind::Function | BuiltinKind::Method | BuiltinKind::Accessor
    );
    let holder = table::entry(id).holder.map(table::canonical_id);
    runs_code && holder.is_some_and(has_members_found_by_name_alone)
}

fn language_members_with_code() -> &'static [(BuiltinName, BuiltinId)] {
    static MEMBERS: OnceLock<Box<[(BuiltinName, BuiltinId)]>> = OnceLock::new();
    MEMBERS.get_or_init(|| {
        let entries = language_entries_with_code().iter();
        let members = entries.filter(|&&id| is_found_by_name_alone(id));
        let mut members: Vec<(BuiltinName, BuiltinId)> =
            members.map(|&id| (table::entry(id).name, id)).collect();
        members.sort_unstable();
        members.into_boxed_slice()
    })
}

fn finds_what_lets_in_what_nobody_names(name: BuiltinName) -> bool {
    let members = language_members_with_code();
    let first = members.partition_point(|member| member.0 < name);
    let mut named = members[first..]
        .iter()
        .take_while(|member| member.0 == name);
    named.any(|&(_, id)| {
        id == BuiltinId::SymbolFor || marks_of(id).contains(Marks::HANDS_OUT_MEMBER_BY_KEY)
    })
}

fn names_of_what_promises_can_do() -> &'static [bool] {
    static NAMES: OnceLock<Box<[bool]>> = OnceLock::new();
    NAMES.get_or_init(|| {
        let mut names = vec![false; BuiltinName::COUNT as usize];
        for holder in objects_of_class_of(BuiltinId::Promise) {
            for &member in table::members(holder) {
                let entry = table::entry(member);
                let runs_code = matches!(
                    table::entry(table::canonical_id(member)).kind,
                    BuiltinKind::Constructor | BuiltinKind::Function | BuiltinKind::Method
                );
                names[entry.name.0 as usize] |= runs_code && !table::is_symbol_name(entry.name);
            }
        }
        names.into_boxed_slice()
    })
}

pub fn is_name_under_which_evaluator_hangs(name: BuiltinName) -> bool {
    static NAMES: OnceLock<Box<[bool]>> = OnceLock::new();
    let names = NAMES.get_or_init(|| {
        let mut names = vec![false; BuiltinName::COUNT as usize];
        for id in BuiltinId::ALL {
            let entry = table::entry(id);
            let found = table::entry(table::canonical_id(id));
            names[entry.name.0 as usize] |=
                entry.holder.is_some() && found.flags.intersects(EVALUATORS);
        }
        names.into_boxed_slice()
    });
    names[name.0 as usize]
}

pub fn is_name_of_language_member_with_code(name: BuiltinName) -> bool {
    static NAMES: OnceLock<Box<[bool]>> = OnceLock::new();
    let names = NAMES.get_or_init(|| {
        let mut names = names_of_what_promises_can_do().to_vec();
        for &(name, _) in language_members_with_code() {
            names[name.0 as usize] = true;
        }
        names.into_boxed_slice()
    });
    names[name.0 as usize]
}

fn create_id_set(id_count: u32) -> DynamicBitSet {
    DynamicBitSet::init_empty(id_count as usize).unwrap_or_oom()
}

fn list_modules(set: &DynamicBitSet) -> Box<[RuntimeModule]> {
    let mut set_modules = set.iterator::<true, true>();
    std::iter::from_fn(|| set_modules.next())
        .filter_map(|module| RuntimeModule::from_wire(module as u32))
        .collect()
}

impl Collected {
    fn new() -> Collected {
        Collected {
            modules: create_id_set(RuntimeModule::COUNT),
            modules_read_whole: create_id_set(RuntimeModule::COUNT),
            exports_read: Vec::new(),
            functions: create_id_set(table::runtime_functions().len() as u32),
        }
    }

    fn finish(mut self, platform: Platforms) -> RuntimeUses {
        let is_read_whole =
            |module: &RuntimeModule| self.modules_read_whole.is_set(module.to_wire() as usize);
        self.exports_read
            .retain(|(module, _)| !is_read_whole(module));
        self.exports_read.shared_sort_unstable();
        self.exports_read.dedup();
        let rows = table::runtime_functions();
        let mut set_rows = self.functions.iterator::<true, true>();
        let functions = std::iter::from_fn(|| set_rows.next())
            .map(|row| &rows[row])
            .filter(|data| data.platforms.contains(platform))
            .map(|data| data.function);
        RuntimeUses {
            modules: list_modules(&self.modules),
            modules_read_whole: list_modules(&self.modules_read_whole),
            exports_read: self.exports_read.clone().into(),
            functions: functions.collect(),
            lets_in_what_nobody_names: false,
            asks: AsksOfText::default(),
        }
    }
}

impl Collector {
    fn new(platform: Platforms) -> Collector {
        Collector {
            platform,
            visited: create_id_set(BuiltinId::COUNT),
            work_stack: Vec::new(),
            collected: Collected::new(),
            has_unknown_module_loader: false,
            marks_met: Marks::empty(),
            lets_in_what_nobody_names: false,
            finds_language_by_names: false,
            holds_functions_for_any_host_object: false,
            asks: AsksOfText::default(),
        }
    }

    fn add_module(&mut self, module: RuntimeModule) {
        self.collected.modules.set(module.to_wire() as usize);
    }

    fn add_load(&mut self, module: RuntimeModule, exports_read: Option<&'static [&'static str]>) {
        self.add_module(module);
        let collected = &mut self.collected;
        match exports_read {
            Some(names) => collected
                .exports_read
                .extend(names.iter().map(|&name| (module, name))),
            None => collected.modules_read_whole.set(module.to_wire() as usize),
        }
    }

    fn add_functions(&mut self, functions: &[RuntimeFunction]) {
        let rows = table::runtime_functions();
        for function in functions {
            if let Ok(row) = rows.binary_search_by_key(function, |data| data.function) {
                self.collected.functions.set(row);
            }
        }
    }

    fn add_language(&mut self) {
        for &id in language_entries_with_code() {
            self.add_entry(id);
        }
    }

    fn add_language_members_named(&mut self, name: BuiltinName) {
        if names_of_what_promises_can_do()[name.0 as usize] {
            (self.work_stack).extend_from_slice(holders_that_come_with_first_promise());
        }
        let members = language_members_with_code();
        let first = members.partition_point(|member| member.0 < name);
        let named = members[first..].iter();
        for &(_, id) in named.take_while(|member| member.0 == name) {
            self.add_entry(id);
            for object in objects_of_class_of(id) {
                self.add_functions(table::entry(object).calls());
            }
        }
    }

    fn add_what_is_written_in_place_of(&mut self, id: BuiltinId) {
        let id = table::canonical_id(id);
        let mut written = WRITTEN_IN_PLACE_OF.iter();
        if let Some((_, helpers)) = written.find(|(replaced, _)| *replaced == id) {
            for &helper in *helpers {
                self.add_entry(helper);
            }
        }
    }

    fn add_helpers_of(&mut self, syntax: SyntaxWithHelpers) {
        for (_, helpers) in HELPERS_OF_SYNTAX.iter().filter(|it| syntax.contains(it.0)) {
            for &helper in *helpers {
                self.add_entry(helper);
            }
        }
        if syntax.intersects(SyntaxWithHelpers::ITERATION) {
            for &method in METHODS_OF_GENERATORS {
                self.add_language_members_named(table::entry(method).name);
            }
        }
        if syntax.intersects(SyntaxWithHelpers::DISPOSAL) {
            self.add_language_members_named(table::name_of_symbol(WellKnownSymbol::Dispose));
        }
        if syntax.intersects(SyntaxWithHelpers::ASYNC_DISPOSAL) {
            self.add_language_members_named(table::name_of_symbol(WellKnownSymbol::AsyncDispose));
        }
    }

    fn add_what_unseen_code_finds(&mut self) {
        for load in table::STARTUP_LOADS {
            self.add_load(load.module, load.exports_read);
        }
        for &module in table::STARTUP_MODULES {
            self.add_module(module);
        }
        self.add_functions(table::STARTUP_FUNCTIONS);
        self.add_entry(BuiltinId::UndeclaredNativeCode);
        self.add_language();
        self.add_functions(table::ACCESSOR_FUNCTIONS);
        self.add_functions(table::MODULE_LOADER_FUNCTIONS);
        self.add_functions(table::FUNCTIONS_FOR_ANY_HOST_OBJECT);
        self.add_functions(table::FUNCTIONS_OF_OPEN_REALM);
        let functions = table::runtime_functions().iter();
        for data in functions.filter(|data| is_called_without_a_name(data.role)) {
            self.add_functions(&[data.function]);
        }
    }

    fn visit(&mut self, id: BuiltinId) -> bool {
        let index = id.to_wire() as usize;
        let is_first_visit = !self.visited.is_set(index);
        self.visited.set(index);
        is_first_visit
    }

    fn add_entry(&mut self, id: BuiltinId) {
        self.add_entry_called_with_other_texts(id);
        let id = table::canonical_id(id);
        if !table::exists_on(id, self.platform) {
            return;
        }
        for listed in table::entry(id).calls_for_texts() {
            self.add_functions(listed.calls);
        }
    }

    fn add_entry_called_with_other_texts(&mut self, id: BuiltinId) {
        let id = table::canonical_id(id);
        if !table::exists_on(id, self.platform) {
            return;
        }
        let entry = table::entry(id);
        let marks = marks_of(id);
        if !marks.is_empty() {
            self.marks_met |= marks;
            if marks.contains(Marks::MAKES_PROMISE) {
                (self.work_stack).extend_from_slice(holders_that_come_with_first_promise());
            }
            let may_hand_out_any = marks.contains(Marks::MAY_HAND_OUT_ANY_HOST_OBJECT);
            if may_hand_out_any && !self.holds_functions_for_any_host_object {
                self.holds_functions_for_any_host_object = true;
                self.add_functions(table::FUNCTIONS_FOR_ANY_HOST_OBJECT);
            }
        }
        self.add_functions(entry.calls_where_call_runs_other_code());
        self.add_entry_called_without_other_code(id);
    }

    fn add_entry_called_without_other_code(&mut self, id: BuiltinId) {
        let id = table::canonical_id(id);
        if !table::exists_on(id, self.platform) {
            return;
        }
        let entry = table::entry(id);
        self.has_unknown_module_loader |= entry.flags.intersects(UNKNOWN_MODULE_LOADERS);
        for load in entry.loads() {
            self.add_load(load.module, load.exports_read);
        }
        self.add_functions(entry.calls());
        self.add_functions(entry.implemented_by());
        self.add_functions(entry.guessed_functions());
    }

    fn expose_class_of(&mut self, id: BuiltinId) {
        if let Some(class) = table::entry(id).class {
            let data = table::class_data(class);
            self.work_stack.extend(data.constructor);
            self.work_stack.extend(data.prototype);
        }
    }

    fn add_reachable_entries(&mut self) {
        while let Some(id) = self.work_stack.pop() {
            let id = table::canonical_id(id);
            if !self.visit(id) {
                continue;
            }
            let reached = reached_from(id, self.platform, self.finds_language_by_names);
            let collected = &mut self.collected;
            for module in &reached.modules {
                collected.modules.set(module.to_wire() as usize);
            }
            for module in &reached.modules_read_whole {
                collected.modules_read_whole.set(module.to_wire() as usize);
            }
            collected
                .exports_read
                .extend_from_slice(&reached.exports_read);
            for &row in &reached.functions {
                collected.functions.set(row as usize);
            }
            self.has_unknown_module_loader |= reached.has_unknown_module_loader;
            self.marks_met |= reached.marks_met;
        }
    }

    fn walk_reachable_entries(&mut self) {
        while let Some(id) = self.work_stack.pop() {
            let id = table::canonical_id(id);
            if !self.visit(id) {
                continue;
            }
            self.add_entry(id);
            let entry = table::entry(id);
            if !(self.finds_language_by_names && has_members_found_by_name_alone(id)) {
                self.work_stack.extend_from_slice(table::members(id));
            }
            match entry.prototype {
                Prototype::Builtin(parent)
                    if self.finds_language_by_names && is_of_language(parent) => {}
                Prototype::Builtin(parent) => self.work_stack.push(parent),
                Prototype::Unknown | Prototype::Null => {}
            }
            self.expose_class_of(id);
        }
    }

    fn finish(self) -> RuntimeUses {
        RuntimeUses {
            lets_in_what_nobody_names: self.lets_in_what_nobody_names,
            asks: self.asks,
            ..self.collected.finish(self.platform)
        }
    }
}

pub const ENTRIES_LEADING_TO_HOOK_OF_INSTANCEOF: [BuiltinId; 6] = [
    BuiltinId::SymbolHasInstance,
    BuiltinId::Proxy,
    BuiltinId::ProxyRevocable,
    BuiltinId::ObjectGetOwnPropertySymbols,
    BuiltinId::ObjectGetOwnPropertyDescriptors,
    BuiltinId::ReflectOwnKeys,
];

pub fn is_evaluator(id: BuiltinId) -> bool {
    table::entry(id).flags.intersects(EVALUATORS)
}

pub fn is_unknown_module_loader(id: BuiltinId) -> bool {
    table::entry(id).flags.intersects(UNKNOWN_MODULE_LOADERS)
}

pub fn reaches_unknown_module_loader(
    loaded: &[BuiltinId],
    called: &[BuiltinId],
    exposed: &[BuiltinId],
    platform: Platforms,
) -> bool {
    let is_loader = |&id: &BuiltinId| {
        let id = table::canonical_id(id);
        table::exists_on(id, platform) && table::entry(id).flags.intersects(UNKNOWN_MODULE_LOADERS)
    };
    let reaches_loader = |id: BuiltinId| {
        reached_from(table::canonical_id(id), platform, false).has_unknown_module_loader
    };
    let class_reaches_loader = |&id: &BuiltinId| {
        table::entry(id).class.is_some_and(|class| {
            let data = table::class_data(class);
            let mut ends = data.constructor.into_iter().chain(data.prototype);
            ends.any(reaches_loader)
        })
    };
    loaded.iter().chain(called).any(is_loader)
        || called.iter().any(class_reaches_loader)
        || exposed.iter().any(|&id| reaches_loader(id))
}

#[derive(Copy, Clone, Default)]
pub struct Mentions<'a> {
    pub mentioned: &'a [BuiltinId],
    pub called_with_other_texts: &'a [BuiltinId],
    pub called_without_other_code: &'a [BuiltinId],
    pub exposed: &'a [BuiltinId],
    pub linked_functions: &'a [RuntimeFunction],
    pub members_read: &'a [BuiltinName],
    pub reads_by_unknown_key: bool,
    pub may_call_evaluator: bool,
    pub global_object_may_be_looked_through: bool,
    pub syntax: SyntaxWithHelpers,
    pub may_hand_values_to_natives: bool,
    pub called: &'a [BuiltinId],
    pub is_of_program: bool,
    pub holds_language: bool,
}

impl RuntimeUses {
    pub fn of_mentions(mentions: &Mentions<'_>, platform: Platforms) -> RuntimeUses {
        Collector::of_mentions(mentions, platform)
            .map_or_else(RuntimeUses::default, Collector::finish)
    }

    pub fn of_asks(asks: &AsksOfText, platform: Platforms) -> RuntimeUses {
        let mut members_read = asks.members_read.clone();
        members_read.sort_unstable();
        members_read.dedup();
        let mentions = Mentions {
            members_read: &members_read,
            reads_by_unknown_key: asks.reads_by_unknown_key,
            syntax: asks.syntax,
            ..Mentions::default()
        };
        let mut collector =
            Collector::of_mentions(&mentions, platform).unwrap_or_else(|| Collector::new(platform));
        if asks.asks_operands() {
            collector.add_functions(table::FUNCTIONS_FOUND_ON_ANY_OPERAND);
        }
        collector.finish()
    }
}

impl RuntimeUses {
    pub fn of_native_modules_handed_out(
        modules: &[RuntimeModule],
        platform: Platforms,
    ) -> RuntimeUses {
        let data = modules.iter().map(|&module| table::module_data(module));
        let native = data.filter(|data| !data.flags.contains(table::ModuleFlags::HAS_SOURCE));
        let mut exposed: Vec<BuiltinId> = native.map(|data| data.namespace).collect();
        if exposed.is_empty() {
            return RuntimeUses::default();
        }
        exposed.sort_unstable();
        exposed.dedup();
        let mentions = Mentions {
            mentioned: &exposed,
            exposed: &exposed,
            ..Mentions::default()
        };
        RuntimeUses::of_mentions(&mentions, platform)
    }
}

impl Collector {
    fn of_mentions(mentions: &Mentions<'_>, platform: Platforms) -> Option<Collector> {
        let Mentions {
            mentioned,
            called_with_other_texts,
            called_without_other_code,
            exposed,
            linked_functions,
            members_read,
            reads_by_unknown_key,
            may_call_evaluator,
            global_object_may_be_looked_through,
            syntax,
            may_hand_values_to_natives,
            called,
            is_of_program,
            holds_language,
        } = *mentions;
        let is_held = |id: &BuiltinId| holds_language && is_of_language(table::canonical_id(*id));
        let names_nothing = mentioned.iter().all(is_held)
            && exposed.is_empty()
            && linked_functions.is_empty()
            && members_read.is_empty()
            && syntax.is_empty()
            && !reads_by_unknown_key
            && !may_call_evaluator
            && !global_object_may_be_looked_through
            && !may_hand_values_to_natives;
        if names_nothing {
            return None;
        }
        let mut collector = Collector::new(platform);
        collector.finds_language_by_names = true;
        collector.holds_functions_for_any_host_object = holds_language;
        for &id in mentioned.iter().filter(|id| !is_held(id)) {
            if called_without_other_code.binary_search(&id).is_ok() {
                collector.add_entry_called_without_other_code(id);
            } else {
                match called_with_other_texts.binary_search(&id) {
                    Ok(_) => collector.add_entry_called_with_other_texts(id),
                    Err(_) => collector.add_entry(id),
                }
                collector.expose_class_of(id);
            }
            collector.add_what_is_written_in_place_of(id);
        }
        if !is_of_program {
            for &name in members_read {
                collector.add_language_members_named(name);
            }
            collector.add_helpers_of(syntax);
        }
        collector.add_functions(linked_functions);
        collector.work_stack.extend_from_slice(exposed);
        collector.add_reachable_entries();
        let mut called = called.iter().map(|&id| table::canonical_id(id));
        let holder_of_registry = table::entry(BuiltinId::SymbolFor).holder;
        let mut handed_on = exposed.iter().map(|&id| table::canonical_id(id));
        let holds_what_hands_out = |id: &BuiltinId| {
            let id = table::canonical_id(*id);
            let mut members = table::members(id).iter();
            table::entry(id).kind == BuiltinKind::Namespace
                && members.any(|&member| {
                    marks_of(table::canonical_id(member)).contains(Marks::HANDS_OUT_MEMBER_BY_KEY)
                })
        };
        let mut names_read = members_read.iter();
        let lets_in_what_nobody_names = may_call_evaluator
            || global_object_may_be_looked_through
            || reads_by_unknown_key
            || mentioned.iter().any(holds_what_hands_out)
            || names_read.any(|&name| finds_what_lets_in_what_nobody_names(name))
            || handed_on.any(|id| Some(id) == holder_of_registry)
            || called.any(|id| {
                table::entry(id).flags.intersects(EVALUATORS) || id == BuiltinId::SymbolFor
            });
        let finds_code_without_names = (collector.marks_met)
            .intersects(Marks::LEADS_TO_PRINTER | Marks::HANDS_OUT_MEMBER_BY_KEY);
        collector.lets_in_what_nobody_names =
            is_of_program && (lets_in_what_nobody_names || finds_code_without_names);
        let reads_by_unknown_key =
            reads_by_unknown_key || collector.marks_met.contains(Marks::READS_MEMBER_BY_KEY);
        if collector.lets_in_what_nobody_names {
            return Some(collector);
        }
        if is_of_program {
            collector.asks = AsksOfText {
                members_read: match reads_by_unknown_key {
                    true => Vec::new(),
                    false => members_read.to_vec(),
                },
                reads_by_unknown_key,
                syntax,
                may_hand_values_to_natives: may_hand_values_to_natives
                    || !exposed.is_empty()
                    || collector.collected.functions.count() > 0
                    || collector.collected.modules.count() > 0,
            };
        } else if reads_by_unknown_key {
            collector.add_language();
        }
        Some(collector)
    }
}

impl RuntimeUses {
    pub fn is_empty(&self) -> bool {
        self.modules.is_empty()
            && self.modules_read_whole.is_empty()
            && self.exports_read.is_empty()
            && self.functions.is_empty()
    }

    pub fn has_module_of_host(&self) -> bool {
        let has_source = |module: &RuntimeModule| {
            (table::module_data(*module).flags).contains(table::ModuleFlags::HAS_SOURCE)
        };
        self.modules.iter().any(has_source)
    }

    pub fn of_unseen_code(platform: Platforms) -> RuntimeUses {
        let mut collector = Collector::new(platform);
        collector.add_what_unseen_code_finds();
        collector.finish()
    }
}
