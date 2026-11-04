//! The names of CommonJS modules that stand for something else: a getter that returns a name of another module or a binding.

use super::{ExportTables, Resolution};
use crate::modules::ModuleRef;
use crate::modules::commonjs_exports::{AliasTarget, ModuleEntries, NameEntry};
use crate::modules::graph;
use crate::modules::interop::ModuleKind;
use crate::modules::module_set::ModuleSet;
use bun_sema::atom::{Atom, known};
use bun_sema::components::strongly_connected_components;
use bun_sema::hir::FnId;
use bun_sema::program::{FileId, Files, Sym};
use bun_sema::util::SharedSort;

/// What the tables keep of one name of a module.
#[derive(Copy, Clone)]
struct NameRow {
    /// The place of the module in `CommonJsNames::entries`.
    module: u32,
    name: Atom,
    /// Every run of the body creates the name.
    is_always_created: bool,
    /// And whoever lists the names of the object finds it.
    is_always_listed: bool,
    /// A getter that returns a name of another module or a binding answers for the name, and no loop over the object sees it.
    is_hidden: bool,
    /// An ES importer can tell the name from what it stands for: it holds what the getter answered when the file was linked, or under `default` the value of the module.
    is_copied: bool,
    /// What the name stands for. `None`: it has a variable in its own module, or the module keeps its object.
    target: Option<Resolution>,
}

impl NameRow {
    fn new(module: u32, entry: &NameEntry) -> NameRow {
        let is_listed = entry.target.is_none() || entry.is_enumerable;
        let is_always_created = entry.created_at != u32::MAX;
        NameRow {
            module,
            name: entry.name,
            is_always_created,
            is_always_listed: is_listed && is_always_created,
            is_hidden: !is_listed,
            is_copied: false,
            target: None,
        }
    }

    fn key(&self) -> (u32, u32) {
        (self.module, self.name.0)
    }
}

#[derive(Default)]
pub(in crate::modules) struct CommonJsNames {
    /// By file: the place in `entries`, or `u32::MAX`.
    index: Vec<u32>,
    /// The inner modules, each with its place in `entries`. Ascending.
    inner_modules: Vec<((FileId, FnId), u32)>,
    entries: Vec<ModuleEntries>,
    /// By module, and of one module by name.
    rows: Vec<NameRow>,
    /// By module: a name of it stands for something that has no variable, so it keeps its object.
    is_refused: Vec<bool>,
}

impl CommonJsNames {
    fn new(file_count: usize, entries: Vec<ModuleEntries>) -> CommonJsNames {
        let name_count: usize = entries.iter().map(|module| module.names.len()).sum();
        let mut index = vec![u32::MAX; file_count];
        let mut rows = Vec::with_capacity(name_count);
        let mut inner_modules = Vec::new();
        for (module, number) in entries.iter().zip(0..) {
            match module.module {
                ModuleRef::File(file) => index[file.idx()] = number,
                ModuleRef::Inner { file, callback } => {
                    inner_modules.push(((file, callback), number));
                }
                _ => unreachable!("a CommonJS module of the program is a file or a callback"),
            }
            let names = module.names.iter();
            rows.extend(names.map(|entry| NameRow::new(number, entry)));
        }
        rows.shared_sort_by_key(NameRow::key);
        inner_modules.shared_sort_unstable_by_key(|entry: &((FileId, FnId), u32)| entry.0);
        CommonJsNames {
            index,
            inner_modules,
            is_refused: vec![false; entries.len()],
            entries,
            rows,
        }
    }

    fn number_of(&self, module: ModuleRef) -> Option<usize> {
        let file = match module {
            ModuleRef::File(file) => file,
            ModuleRef::Inner { file, callback } => {
                let number = graph::find(&self.inner_modules, (file, callback));
                return number.map(|number| number as usize);
            }
            _ => return None,
        };
        let number = *self.index.get(file.idx())?;
        (number != u32::MAX).then_some(number as usize)
    }

    fn entries_of(&self, module: ModuleRef) -> Option<&ModuleEntries> {
        Some(&self.entries[self.number_of(module)?])
    }

    fn find_row(&self, number: usize, name: Atom) -> Option<usize> {
        let key = (number as u32, name.0);
        let place = self.rows.partition_point(|row| row.key() < key);
        let row = self.rows.get(place)?;
        (row.key() == key).then_some(place)
    }

    fn row(&self, module: ModuleRef, name: Atom) -> Option<&NameRow> {
        let number = self.number_of(module)?;
        Some(&self.rows[self.find_row(number, name)?])
    }

    /// What `require` of the module reads under the name. `None`: the name is a variable of the module itself, or the module keeps its object.
    pub(super) fn find(&self, module: ModuleRef, name: Atom) -> Option<Resolution> {
        self.row(module, name)?.target
    }

    /// An ES importer has a copy of the name itself, not of what the name stands for.
    pub(in crate::modules) fn is_copied(&self, module: ModuleRef, name: Atom) -> bool {
        self.row(module, name).is_some_and(|row| row.is_copied)
    }

    /// No loop over the object sees the name, so the namespace object lacks it. An import statement is still bound to what the name stands for.
    pub(super) fn is_hidden(&self, module: ModuleRef, name: Atom) -> bool {
        self.row(module, name).is_some_and(|row| row.is_hidden)
    }

    /// Whether the CommonJS module of the program may be without the name when an ES module that imports it is linked: a run of the body may end without it, the body may replace the object, the link may come while the body runs, or whoever lists the names of the object passes over the name.
    pub(super) fn may_lack(&self, module: ModuleRef, name: Atom) -> bool {
        let Some(entries) = self.entries_of(module) else {
            return false;
        };
        let row = self.row(module, name);
        entries.is_half || !entries.has_names || !row.is_some_and(|row| row.is_always_listed)
    }

    /// Whoever gets the object once the body has run finds the name on it, whether or not a loop over the object sees it.
    pub(in crate::modules) fn has_name_once_run(&self, module: ModuleRef, name: Atom) -> bool {
        let Some(entries) = self.entries_of(module) else {
            return false;
        };
        let row = self.row(module, name);
        !entries.is_half
            && !entries.is_replaced_late
            && entries.has_names
            && row.is_some_and(|row| row.is_always_created)
    }

    /// What `require` of the module answers is an object on which no trap runs: the text makes it.
    pub(in crate::modules) fn exports_ordinary_object(&self, module: ModuleRef) -> bool {
        let entries = self.entries_of(module);
        entries.is_some_and(|entries| entries.exports_ordinary_object)
    }

    /// Somebody may look at the module while its body runs.
    pub(in crate::modules) fn is_half(&self, module: ModuleRef) -> bool {
        let entries = self.entries_of(module);
        entries.is_some_and(|entries| entries.is_half)
    }

    /// Something may store to `module.exports` once the body has ended.
    pub(in crate::modules) fn is_replaced_late(&self, module: ModuleRef) -> bool {
        let entries = self.entries_of(module);
        entries.is_some_and(|entries| entries.is_replaced_late)
    }

    /// Whether an ES importer finds under the name what `require` of the module reads under it. Without the marker its `default` is the value of the module.
    fn shows_member(&self, module: ModuleRef, name: Atom) -> bool {
        let entries = self.entries_of(module);
        name != known::default || entries.is_some_and(|entries| entries.marker == Some(true))
    }

    /// The names that a loop over the object sees once the body has run, in the order of the text, and `default`. `None`: the text does not say.
    pub(in crate::modules) fn names_of(&self, module: ModuleRef) -> Option<Vec<Atom>> {
        let number = self.number_of(module)?;
        let entries = &self.entries[number];
        if self.is_refused[number] || !entries.has_names || !entries.knows_all_names {
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

    // No name of a module that keeps its object stands for anything.
    fn refuse(&mut self, number: usize) {
        self.is_refused[number] = true;
        let first = self
            .rows
            .partition_point(|row| (row.module as usize) < number);
        let rows = self.rows[first..].iter_mut();
        for row in rows.take_while(|row| row.module as usize == number) {
            row.target = None;
            row.is_copied = false;
        }
    }
}

/// Where a getter reads what it returns.
#[derive(Copy, Clone)]
enum Source {
    /// A binding of the file of the getter, or of an ES module.
    Binding(Sym),
    /// A name of a CommonJS module of the program.
    Name {
        /// The place of the module in `CommonJsNames::entries`.
        number: usize,
        module: ModuleRef,
        name: Atom,
        /// The getter reads it off an ES module that hands it on.
        is_handed_on_by_es_module: bool,
    },
    /// Nothing that the build knows a variable for.
    Unknown,
}

struct Resolver<'a, 's> {
    files: &'a Files<'s>,
    modules: &'a ModuleSet,
    /// The tables of the ES modules, in which a name of a CommonJS module is still that name.
    tables: &'a ExportTables,
    names: CommonJsNames,
}

impl Resolver<'_, '_> {
    fn es_module_file(&self, module: ModuleRef) -> Option<FileId> {
        let file = self.modules.table_file(module)?;
        (self.modules.interop(module).kind == ModuleKind::SourceText).then_some(file)
    }

    fn find_source(&self, written: AliasTarget) -> Source {
        let (module, name) = match written {
            AliasTarget::Binding(symbol) => return Source::Binding(symbol),
            AliasTarget::Member { module, name } => (module, name),
        };
        if let Some(number) = self.names.number_of(module) {
            return Source::Name {
                number,
                module,
                name,
                is_handed_on_by_es_module: false,
            };
        }
        let Some(file) = self.es_module_file(module) else {
            return Source::Unknown;
        };
        let resolved = self.tables.resolve(self.modules, file, name);
        // Only the link says whether the module has a name that it compares with what stands behind a star.
        if resolved.required_name.is_some() {
            return Source::Unknown;
        }
        match resolved.resolution {
            Resolution::Variable(symbol) => Source::Binding(symbol),
            Resolution::Synthetic { module, name } => match self.names.number_of(module) {
                Some(number) => Source::Name {
                    number,
                    module,
                    name,
                    is_handed_on_by_es_module: true,
                },
                None => Source::Unknown,
            },
            Resolution::Namespace { .. }
            | Resolution::RuntimeMember { .. }
            | Resolution::LiveName { .. }
            | Resolution::DynamicStar { .. }
            | Resolution::Unloadable { .. }
            | Resolution::NotFound
            | Resolution::Ambiguous => Source::Unknown,
        }
    }

    // The CommonJS modules of the program that the getters of the module read a name of.
    fn modules_asked_by(&self, number: usize) -> Vec<u32> {
        let entries = &self.names.entries[number];
        if !entries.has_names {
            return Vec::new();
        }
        let names = entries.names.iter();
        let asked = names.filter_map(|entry| match self.find_source(entry.target?) {
            Source::Name { number, .. } => Some(number as u32),
            Source::Binding(_) | Source::Unknown => None,
        });
        asked.collect()
    }

    // The variable behind what a getter reads. The module that it reads a name of is bound by then. `NotFound`: there is no variable that the build knows.
    fn resolve(&self, source: Source) -> Resolution {
        let names = &self.names;
        match source {
            Source::Binding(symbol) => Resolution::Variable(symbol),
            Source::Unknown => Resolution::NotFound,
            Source::Name { number, .. }
                if names.is_refused[number] || !names.entries[number].has_names =>
            {
                Resolution::NotFound
            }
            // The ES module holds the copy, or the value of the module, which no name of a CommonJS module stands for.
            Source::Name {
                module,
                name,
                is_handed_on_by_es_module: true,
                ..
            } if names.is_copied(module, name) || !names.shows_member(module, name) => {
                Resolution::NotFound
            }
            Source::Name { module, name, .. } => {
                let own = Resolution::Synthetic { module, name };
                names.find(module, name).unwrap_or(own)
            }
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

    // `false`: a name of the module stands for something that has no variable, or that no import can be bound to.
    fn bind_getters(&mut self, number: usize) -> bool {
        let entries = &self.names.entries[number];
        if !entries.has_names {
            return true;
        }
        let (module, name_count) = (entries.module, entries.names.len());
        for position in 0..name_count {
            let entry = self.names.entries[number].names[position];
            let Some(written) = entry.target else {
                continue;
            };
            let target = self.resolve(self.find_source(written));
            if target == Resolution::NotFound {
                return false;
            }
            let is_found_by_import =
                self.names.shows_member(module, entry.name) && self.is_found_by_import(target);
            if !entry.is_enumerable && (!is_found_by_import || entry.name == known::default) {
                return false;
            }
            let is_told_from_copy =
                !is_found_by_import || entry.is_seen_unfilled || self.can_be_told_from_copy(target);
            let row = self.names.find_row(number, entry.name);
            let row = &mut self.names.rows[row.expect("every name has a row")];
            row.target = Some(target);
            row.is_copied = entry.is_enumerable && is_told_from_copy;
        }
        true
    }
}

pub(super) fn resolve_commonjs_names(
    files: &Files<'_>,
    modules: &ModuleSet,
    tables: &ExportTables,
    entries: Vec<ModuleEntries>,
) -> CommonJsNames {
    let mut resolver = Resolver {
        files,
        modules,
        tables,
        names: CommonJsNames::new(files.modules.len(), entries),
    };
    let numbers = 0..resolver.names.entries.len();
    let asked: Vec<Vec<u32>> = numbers
        .map(|number| resolver.modules_asked_by(number))
        .collect();
    // A module comes behind every module that it asks.
    let (_, components) = strongly_connected_components(&asked);
    for members in components {
        // On a cycle, following a getter can come back to where it began.
        let is_cycle = match members[..] {
            [member] => asked[member].contains(&(member as u32)),
            _ => true,
        };
        for member in members {
            if is_cycle || !resolver.bind_getters(member) {
                resolver.names.refuse(member);
            }
        }
    }
    resolver.names
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compile::testing::{default_settings, with_bind_input};
    use crate::modules::BindInput;
    use crate::modules::module_set::collect_modules;
    use crate::modules::requests::scan_files;
    use crate::modules::testing::{file_named, symbol_named};

    const FILES: [(&str, &str); 4] = [
        (
            "main.cjs",
            "require('./a.cjs'); require('./b.cjs'); require('./c.cjs');",
        ),
        ("a.cjs", "const fixed = 1; let changed = 1; changed = 2;"),
        ("b.cjs", "exports.b = 1;"),
        ("c.cjs", "exports.c = 1;"),
    ];

    struct Fixture<'a, 'b, 's> {
        input: &'a BindInput<'b, 's>,
        modules: &'a ModuleSet,
    }

    impl Fixture<'_, '_, '_> {
        fn module(&self, name: &str) -> ModuleRef {
            ModuleRef::File(file_named(self.input, name))
        }

        fn atom(&self, text: &str) -> Atom {
            self.input.files.atoms.intern(text.as_bytes())
        }

        fn binding(&self, file: &str, name: &str) -> Sym {
            let file = file_named(self.input, file);
            let id = symbol_named(self.input, file, name);
            Sym { file, id }
        }

        fn resolve(&self, entries: Vec<ModuleEntries>) -> CommonJsNames {
            let tables = ExportTables::default();
            resolve_commonjs_names(self.input.files, self.modules, &tables, entries)
        }
    }

    fn with_fixture(then: impl FnOnce(&Fixture<'_, '_, '_>)) {
        with_bind_input(&FILES, &default_settings(), |input| {
            let scans = scan_files(input);
            let modules = collect_modules(input, &scans);
            then(&Fixture {
                input,
                modules: &modules,
            });
        });
    }

    fn variable(name: Atom) -> NameEntry {
        NameEntry {
            name,
            target: None,
            created_at: 0,
            is_enumerable: true,
            is_seen_unfilled: false,
        }
    }

    fn getter(name: Atom, target: AliasTarget) -> NameEntry {
        NameEntry {
            target: Some(target),
            ..variable(name)
        }
    }

    fn member(module: ModuleRef, name: Atom) -> AliasTarget {
        AliasTarget::Member { module, name }
    }

    fn entries_of(module: ModuleRef, names: Vec<NameEntry>) -> ModuleEntries {
        ModuleEntries {
            module,
            has_names: true,
            knows_all_names: true,
            is_half: false,
            is_replaced_late: false,
            exports_ordinary_object: true,
            marker: Some(false),
            names,
        }
    }

    #[test]
    fn a_getter_stands_for_the_variable_at_the_end_of_the_chain() {
        with_fixture(|fixture| {
            let [a, b, c] = ["a.cjs", "b.cjs", "c.cjs"].map(|name| fixture.module(name));
            let [x, y, z] = ["x", "y", "z"].map(|name| fixture.atom(name));
            let names = fixture.resolve(vec![
                entries_of(a, vec![getter(x, member(b, y))]),
                entries_of(b, vec![getter(y, member(c, z))]),
                entries_of(c, vec![variable(z)]),
            ]);
            let end = Some(Resolution::Synthetic { module: c, name: z });
            assert_eq!(names.find(a, x), end);
            assert_eq!(names.find(b, y), end);
            assert_eq!(names.find(c, z), None);
            assert!(!names.is_copied(a, x));
            assert!(names.names_of(a).is_some());
        });
    }

    #[test]
    fn modules_on_a_cycle_keep_their_objects() {
        with_fixture(|fixture| {
            let [a, b, c] = ["a.cjs", "b.cjs", "c.cjs"].map(|name| fixture.module(name));
            let [x, y] = ["x", "y"].map(|name| fixture.atom(name));
            let names = fixture.resolve(vec![
                entries_of(a, vec![getter(x, member(b, x))]),
                entries_of(b, vec![variable(y), getter(x, member(a, x))]),
                entries_of(c, vec![getter(y, member(b, y))]),
            ]);
            for (module, name) in [(a, x), (b, x), (c, y)] {
                assert_eq!(names.find(module, name), None);
                assert_eq!(names.names_of(module), None);
            }
            let asks_itself = vec![variable(y), getter(x, member(a, y))];
            let names = fixture.resolve(vec![entries_of(a, asks_itself)]);
            assert_eq!(names.find(a, x), None);
            assert_eq!(names.names_of(a), None);
        });
    }

    #[test]
    fn a_name_may_be_lacking_unless_every_run_creates_it_where_a_loop_sees_it() {
        with_fixture(|fixture| {
            let files = ["main.cjs", "a.cjs", "b.cjs", "c.cjs"];
            let [main, a, b, c] = files.map(|name| fixture.module(name));
            let texts = ["always", "sometimes", "hidden", "other"];
            let [always, sometimes, hidden, other] = texts.map(|name| fixture.atom(name));
            let created_sometimes = NameEntry {
                created_at: u32::MAX,
                ..variable(sometimes)
            };
            let hidden_getter = NameEntry {
                is_enumerable: false,
                ..getter(hidden, member(b, always))
            };
            let names = fixture.resolve(vec![
                entries_of(a, vec![variable(always), created_sometimes, hidden_getter]),
                ModuleEntries {
                    is_half: true,
                    ..entries_of(b, vec![variable(always)])
                },
                ModuleEntries {
                    has_names: false,
                    ..entries_of(c, Vec::new())
                },
            ]);
            assert!(!names.may_lack(a, always));
            for name in [sometimes, hidden, other] {
                assert!(names.may_lack(a, name));
            }
            assert!(names.may_lack(b, always));
            assert!(names.may_lack(c, always));
            assert!(!names.may_lack(main, always));
            assert!(names.is_hidden(a, hidden) && !names.is_hidden(a, always));
            assert!(names.is_half(b) && !names.is_half(a));
        });
    }

    #[test]
    fn names_are_listed_in_the_order_of_the_text() {
        with_fixture(|fixture| {
            let a = fixture.module("a.cjs");
            let [low, high, unseen] = ["low", "high", "unseen"].map(|name| fixture.atom(name));
            let passed_over = NameEntry {
                is_enumerable: false,
                ..variable(unseen)
            };
            let marker = variable(known::__esModule);
            let written = vec![variable(high), passed_over, marker, variable(low)];
            let names = fixture.resolve(vec![entries_of(a, written)]);
            assert_eq!(names.names_of(a), Some(vec![high, low, known::default]));
            let names = fixture.resolve(vec![ModuleEntries {
                knows_all_names: false,
                ..entries_of(a, vec![variable(low)])
            }]);
            assert_eq!(names.names_of(a), None);
        });
    }

    #[test]
    fn an_importer_has_a_copy_of_a_binding_that_changes() {
        with_fixture(|fixture| {
            let a = fixture.module("a.cjs");
            let [fixed, changed] = ["fixed", "changed"].map(|name| fixture.atom(name));
            let fixed_binding = fixture.binding("a.cjs", "fixed");
            let changed_binding = fixture.binding("a.cjs", "changed");
            let names = fixture.resolve(vec![entries_of(
                a,
                vec![
                    getter(fixed, AliasTarget::Binding(fixed_binding)),
                    getter(changed, AliasTarget::Binding(changed_binding)),
                ],
            )]);
            let variable_of = |binding: Sym| Some(Resolution::Variable(binding));
            assert_eq!(names.find(a, fixed), variable_of(fixed_binding));
            assert_eq!(names.find(a, changed), variable_of(changed_binding));
            assert!(!names.is_copied(a, fixed));
            assert!(names.is_copied(a, changed));
        });
    }
}
