//! The names of CommonJS modules that stand for something else: a getter that returns a name of another module or a binding.

use super::{ExportTables, Resolution};
use crate::modules::ModuleRef;
use crate::modules::commonjs_exports::{AliasTarget, ModuleEntries, NameEntry};
use crate::modules::interop::ModuleKind;
use crate::modules::module_set::ModuleSet;
use bun_sema::atom::{Atom, known};
use bun_sema::util::FxHashMap;

#[derive(Default)]
pub(in crate::modules) struct CommonJsNames {
    index: FxHashMap<ModuleRef, usize>,
    entries: Vec<ModuleEntries>,
    /// What a name stands for that has no variable in its own module.
    targets: FxHashMap<(ModuleRef, Atom), Resolution>,
    is_refused: Vec<bool>,
    /// The modules with a name that stands for something that has no variable: they keep their objects.
    pub(in crate::modules) refused: Vec<ModuleRef>,
}

impl CommonJsNames {
    /// `None`: the name is a variable of the module itself, or the module keeps its object.
    pub(super) fn find(&self, module: ModuleRef, name: Atom) -> Option<Resolution> {
        self.targets.get(&(module, name)).copied()
    }

    /// Whether the CommonJS module of the program may be without the name when an ES module that imports it is linked: a run of the body may end without it, or the link may come while the body runs.
    pub(super) fn may_lack(&self, module: ModuleRef, name: Atom) -> bool {
        let Some(&index) = self.index.get(&module) else {
            return false;
        };
        let entries = &self.entries[index];
        let mut names = entries.names.iter();
        let is_created = |entry: &NameEntry| entry.created_at != u32::MAX;
        entries.is_half
            || !names
                .find(|entry| entry.name == name)
                .is_some_and(is_created)
    }

    /// The names that a loop over the object sees once the body has run, and `default`. `None`: the text does not say.
    pub(in crate::modules) fn names_of(&self, module: ModuleRef) -> Option<Vec<Atom>> {
        let &index = self.index.get(&module)?;
        let entries = &self.entries[index];
        if self.is_refused[index] || !entries.has_names || !entries.knows_all_names {
            return None;
        }
        let is_shown = |entry: &&NameEntry| entry.is_enumerable && entry.name != known::__esModule;
        let shown = entries.names.iter().filter(is_shown);
        let mut names: Vec<Atom> = shown.map(|entry| entry.name).collect();
        if !names.contains(&known::default) {
            names.push(known::default);
        }
        Some(names)
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum State {
    Unvisited,
    Visiting,
    Done,
}

struct Resolver<'a> {
    modules: &'a ModuleSet,
    /// The tables of the ES modules, in which a name of a CommonJS module is still that name.
    tables: &'a ExportTables,
    names: CommonJsNames,
    states: Vec<State>,
}

impl Resolver<'_> {
    fn es_module_file(&self, module: ModuleRef) -> Option<bun_sema::program::FileId> {
        let file = self.modules.table_file(module)?;
        (self.modules.interop(module).kind == ModuleKind::SourceText).then_some(file)
    }

    // The variable behind a name of `module`. `None`: there is none that the build knows.
    fn resolve_name(&mut self, module: ModuleRef, name: Atom) -> Option<Resolution> {
        if let Some(&index) = self.names.index.get(&module) {
            if self.states[index] == State::Visiting {
                return None;
            }
            self.visit(index);
            if self.names.is_refused[index] || !self.names.entries[index].has_names {
                return None;
            }
            let own = Resolution::Synthetic { module, name };
            return Some(self.names.find(module, name).unwrap_or(own));
        }
        let file = self.es_module_file(module)?;
        match self.tables.resolve(self.modules, file, name).resolution {
            Resolution::Variable(symbol) => Some(Resolution::Variable(symbol)),
            Resolution::Synthetic { module, name } => self.resolve_name(module, name),
            _ => None,
        }
    }

    fn bind_aliases(&mut self, index: usize) -> bool {
        let module = self.names.entries[index].module;
        for position in 0..self.names.entries[index].names.len() {
            let entry = self.names.entries[index].names[position];
            let target = match entry.target {
                None => continue,
                Some(AliasTarget::Binding(symbol)) => Some(Resolution::Variable(symbol)),
                Some(AliasTarget::Member {
                    module: other,
                    name,
                }) => self.resolve_name(other, name),
            };
            let Some(target) = target else {
                return false;
            };
            self.names.targets.insert((module, entry.name), target);
        }
        true
    }

    fn visit(&mut self, index: usize) {
        if self.states[index] != State::Unvisited {
            return;
        }
        self.states[index] = State::Visiting;
        let has_names = self.names.entries[index].has_names;
        if has_names && !self.bind_aliases(index) {
            self.names.is_refused[index] = true;
            self.names.refused.push(self.names.entries[index].module);
        }
        self.states[index] = State::Done;
    }
}

pub(super) fn resolve_commonjs_names(
    modules: &ModuleSet,
    tables: &ExportTables,
    entries: Vec<ModuleEntries>,
) -> CommonJsNames {
    let count = entries.len();
    let entry_modules = entries.iter().map(|entries| entries.module);
    let index = entry_modules.zip(0..).collect();
    let mut resolver = Resolver {
        modules,
        tables,
        names: CommonJsNames {
            index,
            entries,
            targets: FxHashMap::default(),
            is_refused: vec![false; count],
            refused: Vec::new(),
        },
        states: vec![State::Unvisited; count],
    };
    for index in 0..count {
        resolver.visit(index);
    }
    let mut names = resolver.names;
    let CommonJsNames {
        targets, refused, ..
    } = &mut names;
    targets.retain(|key, _| !refused.contains(&key.0));
    names
}
