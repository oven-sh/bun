//! The names of CommonJS modules that stand for something else: a getter that returns a name of another module or a binding.

use super::{ExportTables, Resolution};
use crate::modules::ModuleRef;
use crate::modules::commonjs_exports::{AliasTarget, ModuleEntries, NameEntry};
use crate::modules::interop::ModuleKind;
use crate::modules::module_set::ModuleSet;
use bun_sema::atom::{Atom, known};
use bun_sema::program::Files;
use bun_sema::util::{FxHashMap, FxHashSet};

#[derive(Default)]
pub(in crate::modules) struct CommonJsNames {
    index: FxHashMap<ModuleRef, usize>,
    entries: Vec<ModuleEntries>,
    /// What a name stands for that has no variable in its own module.
    targets: FxHashMap<(ModuleRef, Atom), Resolution>,
    /// Of those, the names that an ES importer can tell from what they stand for: it holds what the getter answered when the file was linked, or under `default` the value of the module.
    copied: FxHashSet<(ModuleRef, Atom)>,
    /// Of those, the names whose getter reads a name of a CommonJS module off an ES module, which holds what that module had when it was linked.
    read_off_es_modules: FxHashSet<(ModuleRef, Atom)>,
    /// The names with a getter that returns a name of another module or a binding and that no loop over the object sees.
    hidden: FxHashSet<(ModuleRef, Atom)>,
    is_refused: Vec<bool>,
    /// The modules with a name that stands for something that has no variable: they keep their objects.
    pub(in crate::modules) refused: Vec<ModuleRef>,
}

impl CommonJsNames {
    /// What `require` of the module reads under the name. `None`: the name is a variable of the module itself, or the module keeps its object.
    pub(super) fn find(&self, module: ModuleRef, name: Atom) -> Option<Resolution> {
        self.targets.get(&(module, name)).copied()
    }

    /// An ES importer has a copy of the name itself, not of what the name stands for.
    pub(in crate::modules) fn is_copied(&self, module: ModuleRef, name: Atom) -> bool {
        self.copied.contains(&(module, name))
    }

    pub(in crate::modules) fn is_read_off_es_module(&self, module: ModuleRef, name: Atom) -> bool {
        self.read_off_es_modules.contains(&(module, name))
    }

    /// No loop over the object sees the name, so the namespace object lacks it. An import statement is still bound to what the name stands for.
    pub(super) fn is_hidden(&self, module: ModuleRef, name: Atom) -> bool {
        self.hidden.contains(&(module, name))
    }

    /// Whether the CommonJS module of the program may be without the name when an ES module that imports it is linked: a run of the body may end without it, the body may replace the object, the link may come while the body runs, or whoever lists the names of the object passes over the name.
    pub(super) fn may_lack(&self, module: ModuleRef, name: Atom) -> bool {
        let Some(&index) = self.index.get(&module) else {
            return false;
        };
        let entries = &self.entries[index];
        let mut names = entries.names.iter();
        let is_listed = |entry: &NameEntry| entry.target.is_none() || entry.is_enumerable;
        let is_created = |entry: &NameEntry| entry.created_at != u32::MAX && is_listed(entry);
        entries.is_half
            || !entries.has_names
            || !names
                .find(|entry| entry.name == name)
                .is_some_and(is_created)
    }

    /// Somebody may look at the module while its body runs.
    pub(in crate::modules) fn is_half(&self, module: ModuleRef) -> bool {
        let index = self.index.get(&module);
        index.is_some_and(|&index| self.entries[index].is_half)
    }

    /// Something may store to `module.exports` once the body has ended.
    pub(in crate::modules) fn is_replaced_late(&self, module: ModuleRef) -> bool {
        let index = self.index.get(&module);
        index.is_some_and(|&index| self.entries[index].is_replaced_late)
    }

    /// Whether an ES importer finds under the name what `require` of the module reads under it. Without the marker its `default` is the value of the module.
    fn shows_member(&self, module: ModuleRef, name: Atom) -> bool {
        let index = self.index.get(&module);
        name != known::default
            || index.is_some_and(|&index| self.entries[index].marker == Some(true))
    }

    /// The text says which names a loop over the object sees once the body has run.
    pub(in crate::modules) fn says_all_names(&self, module: ModuleRef) -> bool {
        self.index.get(&module).is_some_and(|&index| {
            let entries = &self.entries[index];
            !self.is_refused[index] && entries.has_names && entries.knows_all_names
        })
    }

    /// The names that a loop over the object sees once the body has run, and `default`. `None`: the text does not say.
    pub(in crate::modules) fn names_of(&self, module: ModuleRef) -> Option<Vec<Atom>> {
        if !self.says_all_names(module) {
            return None;
        }
        let entries = &self.entries[*self.index.get(&module)?];
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

struct Resolver<'a, 's> {
    files: &'a Files<'s>,
    modules: &'a ModuleSet,
    /// The tables of the ES modules, in which a name of a CommonJS module is still that name.
    tables: &'a ExportTables,
    names: CommonJsNames,
    states: Vec<State>,
    /// Whether the last name that was resolved is read off an ES module.
    is_read_off_es_module: bool,
}

impl Resolver<'_, '_> {
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
            self.is_read_off_es_module = self.names.is_read_off_es_module(module, name);
            return Some(self.names.find(module, name).unwrap_or(own));
        }
        let file = self.es_module_file(module)?;
        self.is_read_off_es_module = false;
        match self.tables.resolve(self.modules, file, name).resolution {
            Resolution::Variable(symbol) => Some(Resolution::Variable(symbol)),
            // The ES module holds the copy, or the value of the module, which no name of a CommonJS module stands for.
            Resolution::Synthetic { module, name } => {
                let target = self.resolve_name(module, name);
                self.is_read_off_es_module = true;
                let names = &self.names;
                target
                    .filter(|_| !names.is_copied(module, name) && names.shows_member(module, name))
            }
            _ => None,
        }
    }

    // Whether an import that is bound to the target finds what the getter answers.
    fn is_found_by_import(&self, target: Resolution) -> bool {
        match target {
            Resolution::Synthetic { module, name } => self.names.shows_member(module, name),
            _ => true,
        }
    }

    // Whether what the getter answers may change behind the link, or the getter answers `undefined` for a name that is not there. A binding that the link may find unfilled says so itself.
    fn can_be_told_from_copy(&self, target: Resolution) -> bool {
        match target {
            Resolution::Variable(symbol) => {
                !self.files.bound(symbol.file).is_stable_binding(symbol.id)
            }
            Resolution::Synthetic { module, name } => self.names.may_lack(module, name),
            _ => false,
        }
    }

    fn bind_aliases(&mut self, index: usize) -> bool {
        let module = self.names.entries[index].module;
        for position in 0..self.names.entries[index].names.len() {
            let entry = self.names.entries[index].names[position];
            self.is_read_off_es_module = false;
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
            if self.is_read_off_es_module && matches!(target, Resolution::Synthetic { .. }) {
                let read = &mut self.names.read_off_es_modules;
                read.insert((module, entry.name));
            }
            let is_found_by_import =
                self.names.shows_member(module, entry.name) && self.is_found_by_import(target);
            if !entry.is_enumerable && (!is_found_by_import || entry.name == known::default) {
                return false;
            }
            self.names.targets.insert((module, entry.name), target);
            let is_told_from_copy =
                !is_found_by_import || entry.is_seen_unfilled || self.can_be_told_from_copy(target);
            if entry.is_enumerable && is_told_from_copy {
                self.names.copied.insert((module, entry.name));
            }
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
    files: &Files<'_>,
    modules: &ModuleSet,
    tables: &ExportTables,
    entries: Vec<ModuleEntries>,
) -> CommonJsNames {
    let count = entries.len();
    let entry_modules = entries.iter().map(|entries| entries.module);
    let index = entry_modules.zip(0..).collect();
    let is_hidden = |entry: &&NameEntry| entry.target.is_some() && !entry.is_enumerable;
    let hidden = entries.iter().flat_map(|entries| {
        let names = entries.names.iter().filter(is_hidden);
        names.map(|entry| (entries.module, entry.name))
    });
    let hidden = hidden.collect();
    let mut resolver = Resolver {
        files,
        modules,
        tables,
        names: CommonJsNames {
            index,
            entries,
            targets: FxHashMap::default(),
            copied: FxHashSet::default(),
            read_off_es_modules: FxHashSet::default(),
            hidden,
            is_refused: vec![false; count],
            refused: Vec::new(),
        },
        states: vec![State::Unvisited; count],
        is_read_off_es_module: false,
    };
    for index in 0..count {
        resolver.visit(index);
    }
    let mut names = resolver.names;
    let CommonJsNames {
        targets,
        copied,
        refused,
        ..
    } = &mut names;
    targets.retain(|key, _| !refused.contains(&key.0));
    copied.retain(|key| !refused.contains(&key.0));
    names
}
