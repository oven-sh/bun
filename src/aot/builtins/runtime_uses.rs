use super::table::{
    self, BuiltinFlags, BuiltinId, Origin, Platforms, Prototype, RuntimeFunction, RuntimeModule,
};
use bun_collections::DynamicBitSet;
use bun_core::UnwrapOrOom as _;
use bun_sema::util::SharedSort;

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

struct Collector {
    platform: Platforms,
    visited: DynamicBitSet,
    work_stack: Vec<BuiltinId>,
    modules: DynamicBitSet,
    modules_read_whole: DynamicBitSet,
    exports_read: Vec<(RuntimeModule, &'static str)>,
    functions: DynamicBitSet,
    has_unknown_module_loader: bool,
}

const UNKNOWN_MODULE_LOADERS: BuiltinFlags =
    BuiltinFlags::LOADS_MODULE_BY_NAME.union(BuiltinFlags::RUNS_UNSEEN_CODE);

fn create_id_set(id_count: u32) -> DynamicBitSet {
    DynamicBitSet::init_empty(id_count as usize).unwrap_or_oom()
}

impl Collector {
    fn new(platform: Platforms) -> Collector {
        Collector {
            platform,
            visited: create_id_set(BuiltinId::COUNT),
            work_stack: Vec::new(),
            modules: create_id_set(RuntimeModule::COUNT),
            modules_read_whole: create_id_set(RuntimeModule::COUNT),
            exports_read: Vec::new(),
            functions: create_id_set(RuntimeFunction::COUNT),
            has_unknown_module_loader: false,
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
        for function in table::entry(id)
            .calls_for_texts()
            .iter()
            .flat_map(|listed| listed.calls)
        {
            self.functions.set(function.to_wire() as usize);
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
            self.modules.set(load.module.to_wire() as usize);
            match load.exports_read {
                Some(names) => self
                    .exports_read
                    .extend(names.iter().map(|&name| (load.module, name))),
                None => self.modules_read_whole.set(load.module.to_wire() as usize),
            }
        }
        for function in entry.calls().iter().chain(entry.implemented_by()) {
            self.functions.set(function.to_wire() as usize);
        }
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
            self.add_entry(id);
            let entry = table::entry(id);
            self.work_stack.extend_from_slice(table::members(id));
            match entry.prototype {
                Prototype::Builtin(parent) => self.work_stack.push(parent),
                Prototype::Unknown | Prototype::Null => {}
            }
            self.expose_class_of(id);
        }
    }

    fn finish(mut self) -> RuntimeUses {
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
            .filter(|data| data.platforms.contains(self.platform))
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

impl RuntimeUses {
    /// `called_with_other_texts`: those of `mentioned` that are only called, each time with a text that is none of those for which the entry calls more. They ascend.
    pub fn of_mentions(
        mentioned: &[BuiltinId],
        called_with_other_texts: &[BuiltinId],
        exposed: &[BuiltinId],
        linked_functions: &[RuntimeFunction],
        platform: Platforms,
    ) -> RuntimeUses {
        if mentioned.is_empty() && exposed.is_empty() && linked_functions.is_empty() {
            return RuntimeUses::default();
        }
        let mut collector = Collector::new(platform);
        for &id in mentioned {
            match called_with_other_texts.binary_search(&id) {
                Ok(_) => collector.add_entry_called_with_other_texts(id),
                Err(_) => collector.add_entry(id),
            }
            collector.expose_class_of(id);
        }
        for function in linked_functions {
            collector.functions.set(function.to_wire() as usize);
        }
        collector.work_stack.extend_from_slice(exposed);
        collector.add_reachable_entries();
        collector.finish()
    }

    pub fn of_language(platform: Platforms) -> RuntimeUses {
        let mut collector = Collector::new(platform);
        for id in BuiltinId::ALL {
            let entry = table::entry(id);
            if entry.origin == Origin::Engine
                || entry.flags.contains(BuiltinFlags::IS_COMPILER_HELPER)
            {
                collector.add_entry(id);
            }
        }
        // Reading an accessor is calling its getter, and text that nobody has seen reads what it likes.
        for function in table::ACCESSOR_FUNCTIONS {
            collector.functions.set(function.to_wire() as usize);
        }
        collector.finish()
    }
}
