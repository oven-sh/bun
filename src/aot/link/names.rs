use super::beside::{Beside, run_beside};
use super::body_remap::BodyRemap;
use super::keys::MergedKeys;
use super::program_keys::{ProgramFunctionKey, ProgramLayoutKey, ProgramModule, ProgramVariableKey};
use super::state::{ModuleTable, Numbering};
use crate::engine::Position;
use crate::ir::generated::SourceRange;
use crate::ir::{
    FunctionId, Id, LayoutId, ModuleId, Program, PropertyKey, StringId, StringTable, VariableId,
};

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

pub(super) struct NameInput<'a> {
    pub program: &'a Program,
    pub functions: &'a BodyRemap,
    pub module_origins: Vec<ModuleOrigin>,
    pub beside: Beside<'a>,
}

#[derive(Copy, Clone, Default)]
struct NameRange {
    start: usize,
    end: usize,
}

pub struct ProgramNames {
    bytes: Vec<u8>,
    function_names: Vec<NameRange>,
    function_modules: Vec<Option<ModuleId>>,
    function_ranges: Vec<Option<(u32, u32)>>,
    function_values: Vec<u32>,
    layout_names: Vec<NameRange>,
    layout_positions: Vec<Option<Position>>,
    variable_names: Vec<NameRange>,
    module_paths: Vec<NameRange>,
    module_origins: Vec<ModuleOrigin>,
    field_starts: Vec<usize>,
    field_names: Vec<NameRange>,
}

fn text_range(text: SourceRange) -> Option<(u32, u32)> {
    (text.start < text.end).then_some((text.start, text.end))
}

impl ProgramNames {
    pub fn function_name(&self, function: FunctionId) -> &[u8] {
        self.name_at(&self.function_names, function.index())
    }

    pub fn function_module(&self, function: FunctionId) -> Option<ModuleId> {
        self.function_modules.get(function.index()).copied().flatten()
    }

    pub fn function_range(&self, function: FunctionId) -> Option<(u32, u32)> {
        self.function_ranges.get(function.index()).copied().flatten()
    }

    // How many values the function had when the front end sent it.
    pub fn function_values(&self, function: FunctionId) -> u32 {
        self.function_values.get(function.index()).copied().unwrap_or(0)
    }

    pub fn layout_name(&self, layout: LayoutId) -> &[u8] {
        self.name_at(&self.layout_names, layout.index())
    }

    pub fn layout_position(&self, layout: LayoutId) -> Option<Position> {
        self.layout_positions.get(layout.index()).copied().flatten()
    }

    pub fn field_name(&self, layout: LayoutId, field: u32) -> &[u8] {
        let starts = self.field_starts.get(layout.index()..);
        let Some(&[start, end]) = starts.and_then(|starts| starts.first_chunk()) else {
            return &[];
        };
        self.name_at(&self.field_names[start..end], field as usize)
    }

    pub fn variable_name(&self, variable: VariableId) -> &[u8] {
        self.name_at(&self.variable_names, variable.index())
    }

    pub fn module_path(&self, module: ModuleId) -> &[u8] {
        self.name_at(&self.module_paths, module.index())
    }

    pub fn module_origin(&self, module: ModuleId) -> ModuleOrigin {
        let origin = self.module_origins.get(module.index()).copied();
        origin.unwrap_or(ModuleOrigin::Runtime)
    }

    pub(super) fn new(input: NameInput<'_>) -> ProgramNames {
        let NameInput {
            program,
            functions,
            module_origins,
            beside,
        } = input;
        debug_assert_eq!(module_origins.len(), program.modules.len());
        let (of_functions, mut names) = run_beside(
            beside,
            || FunctionNames::new(program, functions),
            || ProgramNames::without_functions(program, module_origins),
        );
        // The names of the functions lie behind the others.
        let first = names.bytes.len();
        names.bytes.extend_from_slice(&of_functions.bytes);
        let moved = of_functions.names.into_iter().map(|range| NameRange {
            start: range.start + first,
            end: range.end + first,
        });
        names.function_names = moved.collect();
        names.function_modules = of_functions.modules;
        names.function_ranges = of_functions.ranges;
        names.function_values = of_functions.values;
        names
    }

    fn without_functions(program: &Program, module_origins: Vec<ModuleOrigin>) -> ProgramNames {
        let mut pool = NamePool::new(&program.strings);
        let mut layout_names = Vec::with_capacity(program.layouts.len());
        let mut layout_positions = Vec::with_capacity(program.layouts.len());
        let mut field_starts = Vec::with_capacity(program.layouts.len() + 1);
        let mut field_names = Vec::new();
        for layout in &program.layouts {
            let offset = layout.position;
            layout_names.push(pool.copy_optional(layout.name));
            layout_positions.push(layout.module.map(|module| Position { module, offset }));
            field_starts.push(field_names.len());
            for field in &layout.fields {
                let key = field.key.map(|key| program.property_keys.get(key));
                field_names.push(pool.copy_optional(key.and_then(PropertyKey::string_name)));
            }
        }
        field_starts.push(field_names.len());

        let variables = program.variables.iter();
        let variable_names = variables
            .map(|variable| pool.copy_optional(variable.name))
            .collect();
        let modules = program.modules.iter();
        let module_paths = modules
            .map(|module| pool.copy(module.display_path))
            .collect();

        ProgramNames {
            bytes: pool.bytes,
            function_names: Vec::new(),
            function_modules: Vec::new(),
            function_ranges: Vec::new(),
            function_values: Vec::new(),
            layout_names,
            layout_positions,
            variable_names,
            module_paths,
            module_origins,
            field_starts,
            field_names,
        }
    }

    #[cfg(test)]
    pub fn from_lists(
        functions: &[(&[u8], Option<ModuleId>)],
        layouts: &[&[u8]],
        modules: &[(&[u8], ModuleOrigin)],
    ) -> ProgramNames {
        let strings = StringTable::default();
        let mut pool = NamePool::new(&strings);
        let function_names = functions
            .iter()
            .map(|&(name, _)| pool.copy_bytes(name))
            .collect();
        let layout_names = layouts.iter().map(|name| pool.copy_bytes(name)).collect();
        let module_paths = modules
            .iter()
            .map(|&(path, _)| pool.copy_bytes(path))
            .collect();
        ProgramNames {
            bytes: pool.bytes,
            function_names,
            function_modules: functions.iter().map(|&(_, module)| module).collect(),
            function_ranges: vec![None; functions.len()],
            function_values: vec![0; functions.len()],
            layout_names,
            layout_positions: vec![None; layouts.len()],
            variable_names: Vec::new(),
            module_paths,
            module_origins: modules.iter().map(|&(_, origin)| origin).collect(),
            field_starts: vec![0; layouts.len() + 1],
            field_names: Vec::new(),
        }
    }

    fn name_at(&self, names: &[NameRange], index: usize) -> &[u8] {
        names
            .get(index)
            .map_or(&[][..], |range| &self.bytes[range.start..range.end])
    }
}

struct FunctionNames {
    bytes: Vec<u8>,
    names: Vec<NameRange>,
    modules: Vec<Option<ModuleId>>,
    ranges: Vec<Option<(u32, u32)>>,
    values: Vec<u32>,
}

impl FunctionNames {
    fn new(program: &Program, functions: &BodyRemap) -> FunctionNames {
        let mut pool = NamePool::new(&program.strings);
        let count = functions.function_count();
        let mut names = FunctionNames {
            bytes: Vec::new(),
            names: Vec::with_capacity(count),
            modules: Vec::with_capacity(count),
            ranges: Vec::with_capacity(count),
            values: Vec::with_capacity(count),
        };
        for (ids, function) in functions.functions() {
            let name = function.name.map(|name| ids.strings[name.index()].expect("the name of a retained function is retained"));
            names.names.push(pool.copy_optional(name));
            names.modules.push(ids.modules[function.module.index()]);
            names.ranges.push(text_range(function.text));
            names.values.push(function.body.value_count);
        }
        names.bytes = pool.bytes;
        names
    }
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
        if let Some(range) = self.copied[id.index()] {
            return range;
        }
        let range = self.copy_bytes(self.strings.get(id));
        self.copied[id.index()] = Some(range);
        range
    }

    fn copy_bytes(&mut self, bytes: &[u8]) -> NameRange {
        let start = self.bytes.len();
        self.bytes.extend_from_slice(bytes);
        NameRange {
            start,
            end: self.bytes.len(),
        }
    }

    fn copy_optional(&mut self, id: Option<StringId>) -> NameRange {
        id.map_or_else(NameRange::default, |id| self.copy(id))
    }
}
