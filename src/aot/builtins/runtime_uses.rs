use super::table::{
    self, BuiltinFlags, BuiltinId, BuiltinName, Origin, Platforms, Prototype, RuntimeFunction,
    RuntimeFunctionRole, RuntimeModule,
};
use bun_collections::DynamicBitSet;
use bun_core::UnwrapOrOom as _;
use bun_sema::util::SharedSort;
use std::sync::OnceLock;

#[cfg(test)]
mod tests;

#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct RuntimeUses {
    pub modules: Box<[RuntimeModule]>,
    /// Those of `modules` off which native code may read any export.
    pub modules_read_whole: Box<[RuntimeModule]>,
    /// What native code reads off the others. A module that is in neither list is only evaluated.
    pub exports_read: Box<[(RuntimeModule, &'static str)]>,
    pub functions: Box<[RuntimeFunction]>,
}

struct Collected {
    modules: DynamicBitSet,
    modules_read_whole: DynamicBitSet,
    exports_read: Vec<(RuntimeModule, &'static str)>,
    functions: DynamicBitSet,
    has_startup_loads: bool,
}

struct Collector {
    platform: Platforms,
    visited: DynamicBitSet,
    work_stack: Vec<BuiltinId>,
    certain: Collected,
    /// What native code does for some operands alone, and what an object of the host leads to that has got out of sight.
    guessed: Collected,
    is_guessing: bool,
    has_unknown_module_loader: bool,
    /// Whether an entry brings along what native code runs only for a program that names such an entry.
    follows_names: bool,
    is_of_program: bool,
}

const UNKNOWN_MODULE_LOADERS: BuiltinFlags =
    BuiltinFlags::LOADS_MODULE_BY_NAME.union(BuiltinFlags::RUNS_UNSEEN_CODE);

const EVALUATORS: BuiltinFlags = BuiltinFlags::EVALUATES_TEXT.union(BuiltinFlags::RUNS_UNSEEN_CODE);

// In place of a call of the first, lowering may write a call of one of the others.
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
        ],
    ),
];

// The compiler calls its own functions where it sees fit, and a model stands for native code.
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

// The constructor and the prototype object of the class of an entry.
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
        && entry.implemented_by().is_empty()
        && entry.guessed_functions().is_empty())
        || objects_of_class_of(id).any(|object| !table::entry(object).calls().is_empty())
}

struct NamedEntries {
    /// The members of the objects of the language behind which Bun's own code stands, by their names.
    members: Box<[(BuiltinName, BuiltinId)]>,
    of_language_with_code: Box<[BuiltinId]>,
    /// Native code loads the start-up modules for a method that it finds under one of a few symbols. A program has such a method where
    /// it gets at the symbol, by `Symbol.for`, or at an object of the host that has one: these.
    lead_to_startup_loads: Box<[bool]>,
}

fn named_entries() -> &'static NamedEntries {
    static ENTRIES: OnceLock<NamedEntries> = OnceLock::new();
    ENTRIES.get_or_init(|| {
        let is_method_for_startup_loads = |id: &BuiltinId| {
            table::NAMES_OF_METHODS_CALLING_STARTUP_LOADS.contains(&table::entry(*id).name)
        };
        let mut members = Vec::new();
        let mut of_language_with_code = Vec::new();
        let mut lead_to_startup_loads = vec![false; BuiltinId::COUNT as usize];
        for id in BuiltinId::ALL {
            let entry = table::entry(id);
            if is_of_language(id) && has_code_of_library(id) {
                of_language_with_code.push(id);
                if entry.holder.is_some() {
                    members.push((entry.name, id));
                }
            }
            let class = entry.class.map(table::class_data);
            let holders = [Some(id), class.and_then(|class| class.prototype)];
            if is_method_for_startup_loads(&id)
                || (holders.into_iter().flatten()).any(|holder| {
                    table::members(holder)
                        .iter()
                        .any(is_method_for_startup_loads)
                })
            {
                lead_to_startup_loads[id.to_wire() as usize] = true;
            }
        }
        members.sort_unstable();
        NamedEntries {
            members: members.into_boxed_slice(),
            of_language_with_code: of_language_with_code.into_boxed_slice(),
            lead_to_startup_loads: lead_to_startup_loads.into_boxed_slice(),
        }
    })
}

fn create_id_set(id_count: u32) -> DynamicBitSet {
    DynamicBitSet::init_empty(id_count as usize).unwrap_or_oom()
}

impl Collected {
    fn new() -> Collected {
        Collected {
            modules: create_id_set(RuntimeModule::COUNT),
            modules_read_whole: create_id_set(RuntimeModule::COUNT),
            exports_read: Vec::new(),
            functions: create_id_set(RuntimeFunction::COUNT),
            has_startup_loads: false,
        }
    }

    fn finish(mut self, platform: Platforms) -> RuntimeUses {
        let modules = RuntimeModule::ALL
            .into_iter()
            .filter(|module| self.modules.is_set(module.to_wire() as usize));
        let is_read_whole =
            |module: &RuntimeModule| self.modules_read_whole.is_set(module.to_wire() as usize);
        self.exports_read
            .retain(|(module, _)| !is_read_whole(module));
        self.exports_read.shared_sort_unstable();
        self.exports_read.dedup();
        let functions = table::runtime_functions()
            .iter()
            .filter(|data| data.platforms.contains(platform))
            .filter(|data| self.functions.is_set(data.function.to_wire() as usize))
            .map(|data| data.function);
        RuntimeUses {
            modules: modules.collect(),
            modules_read_whole: RuntimeModule::ALL
                .into_iter()
                .filter(is_read_whole)
                .collect(),
            exports_read: self.exports_read.clone().into(),
            functions: functions.collect(),
        }
    }
}

impl Collector {
    fn new(platform: Platforms) -> Collector {
        Collector {
            platform,
            visited: create_id_set(BuiltinId::COUNT),
            work_stack: Vec::new(),
            certain: Collected::new(),
            guessed: Collected::new(),
            is_guessing: false,
            has_unknown_module_loader: false,
            follows_names: false,
            is_of_program: false,
        }
    }

    fn collected(&mut self) -> &mut Collected {
        match self.is_guessing {
            true => &mut self.guessed,
            false => &mut self.certain,
        }
    }

    fn guess<R>(&mut self, is_guess: bool, add: impl FnOnce(&mut Collector) -> R) -> R {
        let was_guessing = self.is_guessing;
        self.is_guessing |= is_guess;
        let result = add(self);
        self.is_guessing = was_guessing;
        result
    }

    fn add_module(&mut self, module: RuntimeModule) {
        self.collected().modules.set(module.to_wire() as usize);
    }

    fn add_load(&mut self, module: RuntimeModule, exports_read: Option<&'static [&'static str]>) {
        self.add_module(module);
        let collected = self.collected();
        match exports_read {
            Some(names) => collected
                .exports_read
                .extend(names.iter().map(|&name| (module, name))),
            None => collected.modules_read_whole.set(module.to_wire() as usize),
        }
    }

    fn add_functions(&mut self, functions: &[RuntimeFunction]) {
        let collected = self.collected();
        for function in functions {
            collected.functions.set(function.to_wire() as usize);
        }
    }

    // The method gets functions of those modules, which look at whatever they are given under whatever name: no name in a source tells
    // any more what of the language runs.
    fn add_startup_loads(&mut self) {
        if core::mem::replace(&mut self.collected().has_startup_loads, true) {
            return;
        }
        for load in table::STARTUP_LOADS {
            self.add_load(load.module, load.exports_read);
        }
        for &module in table::STARTUP_MODULES {
            self.add_module(module);
        }
        self.add_functions(table::STARTUP_FUNCTIONS);
        for &id in &named_entries().of_language_with_code {
            self.add_entry(id);
        }
        // Reading an accessor is calling its getter.
        self.add_functions(table::ACCESSOR_FUNCTIONS);
        self.add_functions(table::MODULE_LOADER_FUNCTIONS);
        self.add_functions(table::FUNCTIONS_FOR_ANY_HOST_OBJECT);
        let functions = table::runtime_functions().iter();
        for data in functions.filter(|data| is_called_without_a_name(data.role)) {
            self.add_functions(&[data.function]);
        }
    }

    // Native code calls them for whatever is of the class.
    fn add_calls_for_class_of(&mut self, id: BuiltinId) {
        for object in objects_of_class_of(id) {
            self.add_functions(table::entry(object).calls());
        }
    }

    fn add_what_comes_with_call(&mut self, id: BuiltinId) {
        let id = table::canonical_id(id);
        let flags = table::entry(id).flags;
        if self.is_of_program && flags.intersects(UNKNOWN_MODULE_LOADERS) {
            self.add_functions(table::MODULE_LOADER_FUNCTIONS);
        }
        // Text may hold a method that native code loads the start-up modules for.
        if self.is_of_program && (flags.intersects(EVALUATORS) || id == BuiltinId::SymbolFor) {
            self.add_startup_loads();
        }
        let mut written = WRITTEN_IN_PLACE_OF.iter();
        if let Some((_, helpers)) = written.find(|(replaced, _)| *replaced == id) {
            for &helper in *helpers {
                self.add_entry(helper);
            }
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
        self.has_unknown_module_loader |= entry.flags.intersects(UNKNOWN_MODULE_LOADERS);
        if self.is_of_program && named_entries().lead_to_startup_loads[id.to_wire() as usize] {
            self.guess(true, Collector::add_startup_loads);
        }
        for load in entry.loads() {
            self.guess(load.is_conditional, |collector| {
                collector.add_load(load.module, load.exports_read);
            });
        }
        self.add_functions(entry.calls());
        self.add_functions(entry.implemented_by());
        self.guess(true, |collector| {
            collector.add_functions(entry.guessed_functions());
        });
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
            self.guess(!is_of_language(id), |collector| collector.add_entry(id));
            let entry = table::entry(id);
            self.work_stack.extend_from_slice(table::members(id));
            match entry.prototype {
                // What every object and every function inherits is found by its name.
                Prototype::Builtin(parent) if self.follows_names && is_of_language(parent) => {}
                Prototype::Builtin(parent) => self.work_stack.push(parent),
                Prototype::Unknown | Prototype::Null => {}
            }
            self.expose_class_of(id);
        }
    }

    fn finish_apart(self) -> MentionedUses {
        MentionedUses {
            certain: self.certain.finish(self.platform),
            guessed: self.guessed.finish(self.platform),
        }
    }

    fn finish(self) -> RuntimeUses {
        let (mut all, guessed) = (self.certain, self.guessed);
        all.modules.set_union(&guessed.modules);
        all.modules_read_whole
            .set_union(&guessed.modules_read_whole);
        all.exports_read.extend(guessed.exports_read);
        all.functions.set_union(&guessed.functions);
        all.finish(self.platform)
    }
}

/// The engine, which follows values, says what of `guessed` a program lacks.
#[derive(Clone, Default)]
pub struct MentionedUses {
    pub certain: RuntimeUses,
    pub guessed: RuntimeUses,
}

pub fn reaches_unknown_module_loader(
    loaded: &[BuiltinId],
    called: &[BuiltinId],
    exposed: &[BuiltinId],
    platform: Platforms,
) -> bool {
    if loaded.is_empty() && called.is_empty() && exposed.is_empty() {
        return false;
    }
    let mut collector = Collector::new(platform);
    // A load makes the object of the module. Where that is a constructor, as that of `node:module` is, nothing has been constructed.
    for &id in loaded {
        collector.add_entry(id);
    }
    for &id in called {
        collector.add_entry(id);
        collector.expose_class_of(id);
    }
    collector.work_stack.extend_from_slice(exposed);
    collector.add_reachable_entries();
    collector.has_unknown_module_loader
}

/// What a piece of source says of the built-ins.
#[derive(Copy, Clone, Default)]
pub struct Mentions<'a> {
    pub mentioned: &'a [BuiltinId],
    /// Those of `mentioned` that are only called, each time with a text that is none of those for which the entry calls more. They ascend.
    pub called_with_other_texts: &'a [BuiltinId],
    /// What is called, but for a load of a module whose name the build knows, and what gets out of sight.
    pub called: &'a [BuiltinId],
    pub exposed: &'a [BuiltinId],
    pub linked_functions: &'a [RuntimeFunction],
    /// The names of the members that are read off values which no name stands for.
    pub members_read: &'a [BuiltinName],
    pub has_decorator: bool,
    pub disposes_resource: bool,
    /// `for (.. of ..)`, `[...list]`, `[a, b] = list`, `yield* list`
    pub iterates: bool,
    pub has_generator: bool,
    /// An async function, `await` or `import()`.
    pub makes_promise: bool,
    /// No code of Bun's own.
    pub is_of_program: bool,
}

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

const DISPOSAL_HELPERS: &[BuiltinId] = &[
    BuiltinId::CompilerHelpersGetDisposeMethod,
    BuiltinId::CompilerHelpersGetAsyncDisposeMethod,
];

const METHODS_OF_GENERATORS: &[BuiltinId] = &[
    BuiltinId::GeneratorPrototypeNext,
    BuiltinId::GeneratorPrototypeReturn,
    BuiltinId::GeneratorPrototypeThrow,
];

impl RuntimeUses {
    pub fn of_mentions(mentions: &Mentions<'_>, platform: Platforms) -> RuntimeUses {
        Collector::of_mentions(mentions, platform)
            .map_or_else(RuntimeUses::default, Collector::finish)
    }

    pub fn of_mentions_apart(mentions: &Mentions<'_>, platform: Platforms) -> MentionedUses {
        Collector::of_mentions(mentions, platform)
            .map_or_else(MentionedUses::default, Collector::finish_apart)
    }
}

impl Collector {
    /// A guess where a member is read by its name: the engine, which follows values, says what a program lacks.
    fn of_mentions(mentions: &Mentions<'_>, platform: Platforms) -> Option<Collector> {
        let Mentions {
            mentioned,
            called_with_other_texts,
            called,
            exposed,
            linked_functions,
            members_read,
            has_decorator,
            disposes_resource,
            iterates,
            has_generator,
            makes_promise,
            is_of_program,
        } = *mentions;
        let names_nothing = mentioned.is_empty()
            && exposed.is_empty()
            && linked_functions.is_empty()
            && members_read.is_empty()
            && !(has_decorator || disposes_resource || iterates || has_generator || makes_promise);
        if names_nothing {
            return None;
        }
        let mut collector = Collector::new(platform);
        collector.follows_names = true;
        collector.is_of_program = is_of_program;
        for &id in mentioned {
            match called_with_other_texts.binary_search(&id) {
                Ok(_) => collector.add_entry_called_with_other_texts(id),
                Err(_) => collector.add_entry(id),
            }
            collector.expose_class_of(id);
        }
        for &id in called {
            collector.add_what_comes_with_call(id);
        }
        let members = &named_entries().members;
        for &name in members_read {
            let first = members.partition_point(|entry| entry.0 < name);
            let named = members[first..].iter().take_while(|entry| entry.0 == name);
            for &(_, id) in named {
                collector.add_entry(id);
                collector.add_calls_for_class_of(id);
            }
        }
        let helpers = [
            (has_decorator, DECORATOR_HELPERS),
            (disposes_resource, DISPOSAL_HELPERS),
            (iterates, &[BuiltinId::ArrayIteratorPrototypeNext]),
            (has_generator, METHODS_OF_GENERATORS),
            (makes_promise, &[BuiltinId::Promise]),
        ];
        for (_, helpers) in helpers.into_iter().filter(|it| it.0) {
            for &helper in helpers {
                collector.add_entry(helper);
            }
        }
        collector.add_functions(linked_functions);
        collector.work_stack.extend_from_slice(exposed);
        collector.add_reachable_entries();
        Some(collector)
    }
}

impl RuntimeUses {
    /// `used`: the entries that the engine has found a program to use.
    pub fn of_entries_used(
        used: impl Iterator<Item = BuiltinId>,
        platform: Platforms,
    ) -> RuntimeUses {
        let mut collector = Collector::new(platform);
        for id in used.map(table::canonical_id) {
            let entry = table::entry(id);
            // A program holds the code behind an entry of the host where it names the entry.
            if is_of_language(id) {
                collector.add_functions(entry.calls());
                collector.add_functions(entry.implemented_by());
            }
            if entry.flags.intersects(UNKNOWN_MODULE_LOADERS) {
                collector.add_functions(table::MODULE_LOADER_FUNCTIONS);
            }
            // It says that a module is read also where the program lacks the module.
            let mut modules = table::STARTUP_MODULES.iter();
            if modules.any(|&module| table::namespace_of(module) == id) {
                collector.add_startup_loads();
            }
        }
        collector.finish()
    }

    /// Whether some of it is a module of the host, which is written with all of the language and of the host at hand.
    pub fn has_module_of_host(&self) -> bool {
        let has_source = |module: &RuntimeModule| {
            (table::module_data(*module).flags).contains(table::ModuleFlags::HAS_SOURCE)
        };
        self.modules.iter().any(has_source)
    }

    pub fn has_code_of_host(&self) -> bool {
        let is_of_host = |function: &RuntimeFunction| {
            let data = table::runtime_function(*function);
            data.is_some_and(|data| data.role == RuntimeFunctionRole::HostBuiltin)
        };
        self.has_module_of_host() || self.functions.iter().any(is_of_host)
    }

    pub fn is_empty(&self) -> bool {
        self.modules.is_empty() && self.functions.is_empty()
    }

    /// What it says of the modules that `is_wanted` holds of.
    pub fn of_modules(&self, is_wanted: impl Fn(RuntimeModule) -> bool) -> RuntimeUses {
        let wanted = |modules: &[RuntimeModule]| {
            let modules = modules.iter().copied();
            modules.filter(|&module| is_wanted(module)).collect()
        };
        let exports_read = self.exports_read.iter().copied();
        RuntimeUses {
            modules: wanted(&self.modules),
            modules_read_whole: wanted(&self.modules_read_whole),
            exports_read: exports_read.filter(|it| is_wanted(it.0)).collect(),
            functions: Box::default(),
        }
    }

    pub fn add(&mut self, further: &RuntimeUses) {
        fn join<T: Copy + Ord>(list: &mut Box<[T]>, further: &[T]) {
            let mut joined = core::mem::take(list).into_vec();
            joined.extend_from_slice(further);
            joined.sort_unstable();
            joined.dedup();
            *list = joined.into_boxed_slice();
        }
        join(&mut self.modules, &further.modules);
        join(&mut self.modules_read_whole, &further.modules_read_whole);
        join(&mut self.exports_read, &further.exports_read);
        join(&mut self.functions, &further.functions);
    }

    /// What code that the build does not see may get at without a name that the build sees.
    pub fn of_unseen_code(platform: Platforms) -> RuntimeUses {
        let mut collector = Collector::new(platform);
        collector.add_startup_loads();
        collector.finish()
    }
}
