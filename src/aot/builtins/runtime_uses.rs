use super::table::{
    self, BuiltinFlags, BuiltinId, Origin, Platforms, Prototype, RuntimeFunction,
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
    /// By row of `table::runtime_functions()`: the numbers of functions are far apart.
    functions: DynamicBitSet,
}

struct Collector {
    platform: Platforms,
    visited: DynamicBitSet,
    work_stack: Vec<BuiltinId>,
    collected: Collected,
    has_unknown_module_loader: bool,
    /// Nothing is looked for above an object of the host: `RuntimeUses::of_every_program`.
    assumes_language_is_held: bool,
}

/// What `Collector::walk_reachable_entries` collects from one entry. Each file asks about the same few entries.
struct Reached {
    modules: Box<[RuntimeModule]>,
    modules_read_whole: Box<[RuntimeModule]>,
    exports_read: Box<[(RuntimeModule, &'static str)]>,
    /// Rows of `table::runtime_functions()`.
    functions: Box<[u32]>,
    has_unknown_module_loader: bool,
}

/// `id` is canonical.
fn reached_from(
    id: BuiltinId,
    platform: Platforms,
    assumes_language_is_held: bool,
) -> &'static Reached {
    type ByEntry = Box<[OnceLock<Box<Reached>>]>;
    const WAYS_TO_ASK: usize = (Platforms::all().bits() as usize + 1) * 2;
    static REACHED: [OnceLock<ByEntry>; WAYS_TO_ASK] = [const { OnceLock::new() }; WAYS_TO_ASK];
    let way = platform.bits() as usize * 2 + usize::from(assumes_language_is_held);
    let by_entry =
        REACHED[way].get_or_init(|| (0..BuiltinId::COUNT).map(|_| OnceLock::new()).collect());
    by_entry[id.to_wire() as usize].get_or_init(|| {
        let mut collector = Collector::new(platform);
        collector.assumes_language_is_held = assumes_language_is_held;
        collector.work_stack.push(id);
        collector.walk_reachable_entries();
        let Collected {
            modules,
            modules_read_whole,
            mut exports_read,
            functions,
        } = collector.collected;
        let listed = |set: &DynamicBitSet| {
            let modules = RuntimeModule::ALL.into_iter();
            modules
                .filter(|module| set.is_set(module.to_wire() as usize))
                .collect()
        };
        exports_read.shared_sort_unstable();
        exports_read.dedup();
        let rows = 0..table::runtime_functions().len() as u32;
        Box::new(Reached {
            modules: listed(&modules),
            modules_read_whole: listed(&modules_read_whole),
            exports_read: exports_read.into(),
            functions: rows.filter(|&row| functions.is_set(row as usize)).collect(),
            has_unknown_module_loader: collector.has_unknown_module_loader,
        })
    })
}

const UNKNOWN_MODULE_LOADERS: BuiltinFlags =
    BuiltinFlags::LOADS_MODULE_BY_NAME.union(BuiltinFlags::RUNS_UNSEEN_CODE);

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

fn has_code_of_library(id: BuiltinId) -> bool {
    let entry = table::entry(table::canonical_id(id));
    !(entry.loads().is_empty()
        && entry.calls().is_empty()
        && entry.calls_for_texts().is_empty()
        && entry.implemented_by().is_empty()
        && entry.guessed_functions().is_empty())
}

fn language_entries_with_code() -> &'static [BuiltinId] {
    static ENTRIES: OnceLock<Box<[BuiltinId]>> = OnceLock::new();
    ENTRIES.get_or_init(|| {
        let entries = BuiltinId::ALL.into_iter();
        entries
            .filter(|&id| is_of_language(id) && has_code_of_library(id))
            .collect()
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
            functions: create_id_set(table::runtime_functions().len() as u32),
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
        // In the order of the table, which is that of the numbers.
        let rows = table::runtime_functions();
        let mut set_rows = self.functions.iterator::<true, true>();
        let functions = std::iter::from_fn(|| set_rows.next())
            .map(|row| &rows[row])
            .filter(|data| data.platforms.contains(platform))
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
            collected: Collected::new(),
            has_unknown_module_loader: false,
            assumes_language_is_held: false,
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

    fn add_what_every_program_holds(&mut self) {
        for load in table::STARTUP_LOADS {
            self.add_load(load.module, load.exports_read);
        }
        for &module in table::STARTUP_MODULES {
            self.add_module(module);
        }
        self.add_functions(table::STARTUP_FUNCTIONS);
        // No program names it: the engine states its rows with those of the start-up.
        self.add_entry(BuiltinId::UndeclaredNativeCode);
        for &id in language_entries_with_code() {
            self.add_entry(id);
        }
        // Reading an accessor is calling its getter.
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
            let reached = reached_from(id, self.platform, self.assumes_language_is_held);
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
            self.work_stack.extend_from_slice(table::members(id));
            match entry.prototype {
                Prototype::Builtin(parent)
                    if self.assumes_language_is_held && is_of_language(parent) => {}
                Prototype::Builtin(parent) => self.work_stack.push(parent),
                Prototype::Unknown | Prototype::Null => {}
            }
            self.expose_class_of(id);
        }
    }

    fn finish(self) -> RuntimeUses {
        self.collected.finish(self.platform)
    }
}

/// `id`: a canonical id.
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
    // A load makes the object of the module. Where that is a constructor, as that of `node:module` is, nothing has been constructed.
    loaded.iter().chain(called).any(is_loader)
        || called.iter().any(class_reaches_loader)
        || exposed.iter().any(|&id| reaches_loader(id))
}

/// What a piece of source says of the built-ins.
#[derive(Copy, Clone, Default)]
pub struct Mentions<'a> {
    pub mentioned: &'a [BuiltinId],
    /// Those of `mentioned` that are only called, each time with a text that is none of those for which the entry calls more. They ascend.
    pub called_with_other_texts: &'a [BuiltinId],
    pub exposed: &'a [BuiltinId],
    pub linked_functions: &'a [RuntimeFunction],
}

impl RuntimeUses {
    pub fn of_mentions(mentions: &Mentions<'_>, platform: Platforms) -> RuntimeUses {
        Collector::of_mentions(mentions, platform)
            .map_or_else(RuntimeUses::default, Collector::finish)
    }
}

impl Collector {
    fn of_mentions(mentions: &Mentions<'_>, platform: Platforms) -> Option<Collector> {
        let Mentions {
            mentioned,
            called_with_other_texts,
            exposed,
            linked_functions,
        } = *mentions;
        if mentioned.is_empty() && exposed.is_empty() && linked_functions.is_empty() {
            return None;
        }
        let mut collector = Collector::new(platform);
        collector.assumes_language_is_held = true;
        for &id in mentioned {
            match called_with_other_texts.binary_search(&id) {
                Ok(_) => collector.add_entry_called_with_other_texts(id),
                Err(_) => collector.add_entry(id),
            }
            collector.expose_class_of(id);
        }
        collector.add_functions(linked_functions);
        collector.work_stack.extend_from_slice(exposed);
        collector.add_reachable_entries();
        Some(collector)
    }
}

impl RuntimeUses {
    /// Whether some of it is a module of the host, which is written with all of the language and of the host at hand.
    pub fn has_module_of_host(&self) -> bool {
        let has_source = |module: &RuntimeModule| {
            (table::module_data(*module).flags).contains(table::ModuleFlags::HAS_SOURCE)
        };
        self.modules.iter().any(has_source)
    }

    pub fn is_empty(&self) -> bool {
        self.modules.is_empty() && self.functions.is_empty()
    }

    /// The code that is reached by values and not by bindings: the language, the helpers of the compiler, what the host loads to print an object with a method of its own,
    /// and what an open world enters. Facts says which of it runs.
    pub fn of_every_program(platform: Platforms) -> RuntimeUses {
        let mut collector = Collector::new(platform);
        collector.add_what_every_program_holds();
        collector.finish()
    }
}
