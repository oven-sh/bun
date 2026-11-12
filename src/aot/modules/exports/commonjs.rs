use super::{ExportTables, Resolution};
use crate::modules::ModuleRef;
use crate::modules::commonjs_exports::{
    AliasTarget, ModuleEntries, NameEntry, is_listed_for_importers,
};
use crate::modules::graph;
use crate::modules::interop::ModuleKind;
use crate::modules::module_set::ModuleSet;
use bun_sema::atom::{Atom, known};
use bun_sema::components::strongly_connected_components;
use bun_sema::hir::FnId;
use bun_sema::program::{FileId, Files, Sym};
use bun_sema::util::SharedSort;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum ImporterCopy {
    None,
    OfAnswer,
    OfName,
}

#[derive(Copy, Clone)]
struct NameRow {
    module: u32,
    name: Atom,
    is_always_created: bool,
    is_always_listed: bool,
    is_hidden: bool,
    copy: ImporterCopy,
    target: Option<Resolution>,
}

fn is_listed(module: &ModuleEntries, entry: &NameEntry) -> bool {
    is_listed_for_importers(
        entry.is_enumerable,
        entry.getter.is_some(),
        module.lists_only_enumerable_names,
    )
}

impl NameRow {
    fn new(number: u32, module: &ModuleEntries, entry: &NameEntry) -> NameRow {
        let is_listed = is_listed_for_importers(
            entry.is_enumerable,
            entry.getter.is_some(),
            module.lists_only_enumerable_names && module.runs_in_place,
        );
        let is_always_created = entry.created_at != u32::MAX;
        NameRow {
            module: number,
            name: entry.name,
            is_always_created,
            is_always_listed: is_listed && is_always_created,
            is_hidden: !is_listed,
            copy: ImporterCopy::None,
            target: None,
        }
    }

    fn key(&self) -> (u32, u32) {
        (self.module, self.name.0)
    }
}

#[derive(Default)]
pub(in crate::modules) struct CommonJsNames {
    index: Vec<u32>,
    inner_modules: Vec<((FileId, FnId), u32)>,
    entries: Vec<ModuleEntries>,
    rows: Vec<NameRow>,
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
            rows.extend(names.map(|entry| NameRow::new(number, module, entry)));
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

    pub(super) fn find(&self, module: ModuleRef, name: Atom) -> Option<Resolution> {
        self.row(module, name)?.target
    }

    fn copy_of(&self, module: ModuleRef, name: Atom) -> ImporterCopy {
        let row = self.row(module, name);
        row.map_or(ImporterCopy::None, |row| row.copy)
    }

    pub(in crate::modules) fn is_copied(&self, module: ModuleRef, name: Atom) -> bool {
        self.copy_of(module, name) != ImporterCopy::None
    }

    pub(in crate::modules) fn is_copy_of_name(&self, module: ModuleRef, name: Atom) -> bool {
        self.copy_of(module, name) == ImporterCopy::OfName
    }

    pub(super) fn is_hidden(&self, module: ModuleRef, name: Atom) -> bool {
        self.row(module, name).is_some_and(|row| row.is_hidden)
    }

    pub(super) fn may_lack(&self, module: ModuleRef, name: Atom) -> bool {
        let Some(entries) = self.entries_of(module) else {
            return false;
        };
        let row = self.row(module, name);
        entries.is_half || !entries.has_names || !row.is_some_and(|row| row.is_always_listed)
    }

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

    pub(in crate::modules) fn exports_ordinary_object(&self, module: ModuleRef) -> bool {
        let entries = self.entries_of(module);
        entries.is_some_and(|entries| entries.exports_ordinary_object)
    }

    pub(in crate::modules) fn is_half(&self, module: ModuleRef) -> bool {
        let entries = self.entries_of(module);
        entries.is_some_and(|entries| entries.is_half)
    }

    pub(in crate::modules) fn is_replaced_late(&self, module: ModuleRef) -> bool {
        let entries = self.entries_of(module);
        entries.is_some_and(|entries| entries.is_replaced_late)
    }

    fn shows_member(&self, module: ModuleRef, name: Atom) -> bool {
        let entries = self.entries_of(module);
        name != known::default || entries.is_some_and(|entries| entries.marker == Some(true))
    }

    pub(in crate::modules) fn names_of(&self, module: ModuleRef) -> Option<Vec<Atom>> {
        let number = self.number_of(module)?;
        let entries = &self.entries[number];
        if self.is_refused[number] || !entries.has_names || !entries.knows_all_names {
            return None;
        }
        let is_shown =
            |entry: &&NameEntry| is_listed(entries, entry) && entry.name != known::__esModule;
        let shown = entries.names.iter().filter(is_shown);
        let mut names: Vec<Atom> = shown.map(|entry| entry.name).collect();
        if !names.contains(&known::default) {
            names.push(known::default);
        }
        Some(names)
    }

    fn refuse(&mut self, number: usize) {
        self.is_refused[number] = true;
        let first = self
            .rows
            .partition_point(|row| (row.module as usize) < number);
        let rows = self.rows[first..].iter_mut();
        for row in rows.take_while(|row| row.module as usize == number) {
            row.target = None;
            row.copy = ImporterCopy::None;
        }
    }
}

#[derive(Copy, Clone)]
enum Source {
    Binding(Sym),
    Name {
        number: usize,
        module: ModuleRef,
        name: Atom,
        is_handed_on_by_es_module: bool,
    },
    Unknown,
}

struct Resolver<'a, 's> {
    files: &'a Files<'s>,
    modules: &'a ModuleSet,
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

    fn modules_asked_by(&self, number: usize) -> Vec<u32> {
        let entries = &self.names.entries[number];
        if !entries.has_names {
            return Vec::new();
        }
        let names = entries.names.iter();
        let asked = names.filter_map(|entry| match self.find_source(entry.getter?.target) {
            Source::Name { number, .. } => Some(number as u32),
            Source::Binding(_) | Source::Unknown => None,
        });
        asked.collect()
    }

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
            Source::Name {
                module,
                name,
                is_handed_on_by_es_module: true,
                ..
            } if names.copy_of(module, name) == ImporterCopy::OfAnswer
                || !names.shows_member(module, name) =>
            {
                Resolution::NotFound
            }
            Source::Name { module, name, .. } => {
                let own = Resolution::Synthetic { module, name };
                names.find(module, name).unwrap_or(own)
            }
        }
    }

    fn is_found_by_import(&self, target: Resolution) -> bool {
        match target {
            Resolution::Synthetic { module, name } => self.names.shows_member(module, name),
            _ => true,
        }
    }

    fn can_be_told_from_copy(&self, target: Resolution) -> bool {
        match target {
            Resolution::Variable(symbol) => {
                !self.files.bound(symbol.file).is_stable_binding(symbol.id)
            }
            Resolution::Synthetic { module, name } => self.names.may_lack(module, name),
            _ => false,
        }
    }

    fn bind_getters(&mut self, number: usize) -> bool {
        let entries = &self.names.entries[number];
        if !entries.has_names {
            return true;
        }
        let (module, name_count) = (entries.module, entries.names.len());
        for position in 0..name_count {
            let entry = self.names.entries[number].names[position];
            let Some(getter) = entry.getter else {
                continue;
            };
            let target = self.resolve(self.find_source(getter.target));
            if target == Resolution::NotFound {
                return false;
            }
            let is_found_by_import =
                self.names.shows_member(module, entry.name) && self.is_found_by_import(target);
            if !entry.is_enumerable && (!is_found_by_import || entry.name == known::default) {
                return false;
            }
            let is_told_from_copy = !is_found_by_import
                || getter.is_seen_unfilled
                || self.can_be_told_from_copy(target);
            let is_copy_of_name =
                !is_told_from_copy && matches!(target, Resolution::Synthetic { .. });
            let row = self.names.find_row(number, entry.name);
            let row = &mut self.names.rows[row.expect("every name has a row")];
            row.target = Some(target);
            row.copy = if is_copy_of_name {
                ImporterCopy::OfName
            } else if entry.is_enumerable && is_told_from_copy {
                ImporterCopy::OfAnswer
            } else {
                ImporterCopy::None
            };
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
    let (_, components) = strongly_connected_components(&asked);
    for members in components {
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
    use crate::modules::commonjs_exports::Getter;
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
            getter: None,
            created_at: 0,
            is_enumerable: true,
        }
    }

    fn getter(name: Atom, target: AliasTarget) -> NameEntry {
        NameEntry {
            getter: Some(Getter {
                target,
                is_seen_unfilled: false,
            }),
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
            lists_only_enumerable_names: false,
            runs_in_place: false,
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
            for (module, name) in [(a, x), (b, y)] {
                assert!(names.is_copied(module, name) && names.is_copy_of_name(module, name));
            }
            assert!(!names.is_copied(c, z) && !names.is_copy_of_name(c, z));
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
            let not_enumerable = NameEntry {
                is_enumerable: false,
                ..variable(unseen)
            };
            let marker = variable(known::__esModule);
            let written = vec![variable(high), not_enumerable, marker, variable(low)];
            let names = fixture.resolve(vec![entries_of(a, written.clone())]);
            let all = vec![high, unseen, low, known::default];
            assert_eq!(names.names_of(a), Some(all));
            assert!(!names.may_lack(a, unseen) && !names.is_hidden(a, unseen));
            for runs_in_place in [false, true] {
                let names = fixture.resolve(vec![ModuleEntries {
                    lists_only_enumerable_names: true,
                    runs_in_place,
                    ..entries_of(a, written.clone())
                }]);
                assert_eq!(names.names_of(a), Some(vec![high, low, known::default]));
                assert_eq!(names.may_lack(a, unseen), runs_in_place);
                assert_eq!(names.is_hidden(a, unseen), runs_in_place);
            }
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
            assert!(names.is_copied(a, changed) && !names.is_copy_of_name(a, changed));
        });
    }

    #[test]
    fn a_getter_that_no_loop_sees_has_a_copy_over_a_name_and_none_over_a_binding() {
        with_fixture(|fixture| {
            let [a, b] = ["a.cjs", "b.cjs"].map(|name| fixture.module(name));
            let [x, y, changed] = ["x", "y", "changed"].map(|name| fixture.atom(name));
            let changed_binding = fixture.binding("a.cjs", "changed");
            let unseen = |entry: NameEntry| NameEntry {
                is_enumerable: false,
                ..entry
            };
            let names = fixture.resolve(vec![
                entries_of(
                    a,
                    vec![
                        unseen(getter(x, member(b, y))),
                        unseen(getter(changed, AliasTarget::Binding(changed_binding))),
                    ],
                ),
                entries_of(b, vec![variable(y)]),
            ]);
            assert_eq!(
                names.find(a, x),
                Some(Resolution::Synthetic { module: b, name: y })
            );
            assert!(names.is_hidden(a, x) && names.is_copied(a, x) && names.is_copy_of_name(a, x));
            assert!(names.is_hidden(a, changed) && !names.is_copied(a, changed));
        });
    }
}
