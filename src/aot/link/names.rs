use super::beside::{Beside, run_beside};
use super::body_remap::BodyRemap;
use super::keys::MergedKeys;
use super::program_keys::{
    ProgramFunctionKey, ProgramLayoutKey, ProgramModule, ProgramVariableKey,
};
use super::state::{ModuleTable, Numbering};
use crate::ir::{FunctionId, Id, LayoutId, ModuleId, Program, StringId, StringTable};

pub struct ProgramKeys {
    pub functions: Vec<ProgramFunctionKey>,
    pub layouts: Vec<ProgramLayoutKey>,
    pub variables: Vec<ProgramVariableKey>,
    pub modules: Vec<ProgramModule>,
}

impl ProgramKeys {
    pub(super) fn new(
        functions: &MergedKeys<ProgramFunctionKey>,
        layouts: &MergedKeys<ProgramLayoutKey>,
        variables: &MergedKeys<ProgramVariableKey>,
        modules: &ModuleTable,
        numbering: &Numbering,
    ) -> ProgramKeys {
        let counts = &numbering.counts;
        ProgramKeys {
            functions: keys_by_id(&functions.keys, &numbering.functions, counts.functions),
            layouts: keys_by_id(&layouts.keys, &numbering.layouts, counts.layouts),
            variables: keys_by_id(&variables.keys, &numbering.variables, counts.variables),
            modules: keys_by_id(&modules.modules, &numbering.modules, counts.modules),
        }
    }
}

fn keys_by_id<K: Copy, I: Id>(keys: &[K], ids: &[Option<I>], count: usize) -> Vec<K> {
    debug_assert_eq!(keys.len(), ids.len());
    let mut slots = vec![None; count];
    for (key, id) in keys.iter().zip(ids) {
        if let Some(id) = id {
            slots[id.index()] = Some(*key);
        }
    }
    slots
        .into_iter()
        .map(|slot| slot.expect("program ids are dense"))
        .collect()
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ModuleOrigin {
    Program,
    Dependency,
    Runtime,
}

type NameRange = core::ops::Range<usize>;

#[derive(Default)]
struct FunctionRow {
    name: NameRange,
    module: Option<ModuleId>,
    range: Option<(u32, u32)>,
    // How many values the function had when the front end sent it.
    values: u32,
}

pub struct ProgramNames {
    bytes: Vec<u8>,
    functions: Vec<FunctionRow>,
    layout_names: Vec<NameRange>,
    module_paths: Vec<NameRange>,
    module_origins: Vec<ModuleOrigin>,
}

impl ProgramNames {
    pub fn function_name(&self, function: FunctionId) -> &[u8] {
        let row = self.functions.get(function.index());
        row.map_or(&[][..], |row| &self.bytes[row.name.start..row.name.end])
    }

    pub fn function_module(&self, function: FunctionId) -> Option<ModuleId> {
        self.functions.get(function.index())?.module
    }

    pub fn function_range(&self, function: FunctionId) -> Option<(u32, u32)> {
        self.functions.get(function.index())?.range
    }

    pub fn function_values(&self, function: FunctionId) -> u32 {
        let row = self.functions.get(function.index());
        row.map_or(0, |row| row.values)
    }

    pub fn layout_name(&self, layout: LayoutId) -> &[u8] {
        self.name_at(&self.layout_names, layout.index())
    }

    pub fn module_path(&self, module: ModuleId) -> &[u8] {
        self.name_at(&self.module_paths, module.index())
    }

    pub fn module_origin(&self, module: ModuleId) -> ModuleOrigin {
        let origin = self.module_origins.get(module.index()).copied();
        origin.unwrap_or(ModuleOrigin::Runtime)
    }

    pub(super) fn new(
        program: &Program,
        functions: &BodyRemap,
        module_origins: Vec<ModuleOrigin>,
        beside: Beside<'_>,
    ) -> ProgramNames {
        debug_assert_eq!(module_origins.len(), program.modules.len());
        let ((bytes, rows), mut names) = run_beside(
            beside,
            || name_functions(program, functions),
            || {
                let mut pool = NamePool::new(&program.strings);
                let (layouts, modules) = (program.layouts.iter(), program.modules.iter());
                ProgramNames {
                    functions: Vec::new(),
                    layout_names: layouts
                        .map(|layout| pool.copy_optional(layout.name))
                        .collect(),
                    module_paths: modules
                        .map(|module| pool.copy(module.display_path))
                        .collect(),
                    module_origins,
                    bytes: pool.bytes,
                }
            },
        );
        // The names of the functions lie behind the others.
        let first = names.bytes.len();
        names.bytes.extend_from_slice(&bytes);
        names.functions = rows;
        for row in &mut names.functions {
            row.name.start += first;
            row.name.end += first;
        }
        names
    }

    #[cfg(test)]
    pub fn from_lists(
        functions: &[(&[u8], Option<ModuleId>)],
        layouts: &[&[u8]],
        modules: &[(&[u8], ModuleOrigin)],
    ) -> ProgramNames {
        let strings = StringTable::default();
        let mut pool = NamePool::new(&strings);
        let functions = functions.iter().map(|&(name, module)| FunctionRow {
            name: pool.copy_bytes(name),
            module,
            ..FunctionRow::default()
        });
        let functions = functions.collect();
        let layout_names = layouts.iter().map(|name| pool.copy_bytes(name)).collect();
        let module_paths = modules
            .iter()
            .map(|&(path, _)| pool.copy_bytes(path))
            .collect();
        ProgramNames {
            bytes: pool.bytes,
            functions,
            layout_names,
            module_paths,
            module_origins: modules.iter().map(|&(_, origin)| origin).collect(),
        }
    }

    fn name_at(&self, names: &[NameRange], index: usize) -> &[u8] {
        names
            .get(index)
            .map_or(&[][..], |range| &self.bytes[range.start..range.end])
    }
}

fn name_functions(program: &Program, functions: &BodyRemap) -> (Vec<u8>, Vec<FunctionRow>) {
    let mut pool = NamePool::new(&program.strings);
    let mut rows = Vec::with_capacity(functions.function_count());
    for (ids, function) in functions.functions() {
        let name = function.name.map(|name| {
            ids.strings[name.index()].expect("the name of a retained function is retained")
        });
        let text = function.text;
        rows.push(FunctionRow {
            name: pool.copy_optional(name),
            module: ids.modules[function.module.index()],
            range: (text.start < text.end).then_some((text.start, text.end)),
            values: function.body.value_count,
        });
    }
    (pool.bytes, rows)
}

struct NamePool<'a> {
    strings: &'a StringTable,
    bytes: Vec<u8>,
    copied: Vec<Option<NameRange>>,
}

impl<'a> NamePool<'a> {
    fn new(strings: &'a StringTable) -> NamePool<'a> {
        NamePool {
            strings,
            bytes: Vec::new(),
            copied: vec![None; strings.len()],
        }
    }

    fn copy(&mut self, id: StringId) -> NameRange {
        if let Some(range) = &self.copied[id.index()] {
            return range.clone();
        }
        let range = self.copy_bytes(self.strings.get(id));
        self.copied[id.index()] = Some(range.clone());
        range
    }

    fn copy_bytes(&mut self, bytes: &[u8]) -> NameRange {
        let start = self.bytes.len();
        self.bytes.extend_from_slice(bytes);
        start..self.bytes.len()
    }

    fn copy_optional(&mut self, id: Option<StringId>) -> NameRange {
        id.map_or_else(NameRange::default, |id| self.copy(id))
    }
}
