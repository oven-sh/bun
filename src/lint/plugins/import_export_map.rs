#![allow(dead_code)] // until every rule of the plugin is written
//! `ExportMap` and `ExportMapBuilder` of eslint-plugin-import 2.32.0: what another file exports, as it is on the disk,
//! for the settings, the resolvers and the `esModuleInterop` of the file that asks.

use crate::import_export_record::{self, Dependency, Entry, ExportRecord, Reexport, When};
use crate::import_resolve::{Resolved, Resolvers};
use crate::import_settings::{DocStyle, Settings};
use bun_lint::language::Parser;
use bun_lint::modules::{Modules, Reader};
use bun_lint::paths;
use bun_lint::prelude::*;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::{SmallVec, smallvec};
use std::any::Any;
use std::borrow::Cow;
use std::cell::{OnceCell, RefCell};
use std::rc::Rc;
use std::sync::OnceLock;

/// `reportErrors`: at `declaration.source`, with `source.value` and [`ExportMap::errors_text`].
pub(crate) const PARSE_ERRORS: Message = Message::new(
    "",
    "Parse errors in imported module '{{source}}': {{errors}}",
);

const DEFAULT: &[u8] = b"default";

/// A key that is `undefined`, where it is given as a name.
const UNDEFINED: &[u8] = b"undefined";

/// A key of `namespace` or of `reexports`. `None`: `undefined`.
type Key<'k> = Option<&'k [u8]>;

/// A `set` of a `Map`.
trait Keyed {
    fn key(&self) -> Key<'_>;
}

impl Keyed for Entry {
    fn key(&self) -> Key<'_> {
        self.name.as_deref()
    }
}

impl Keyed for Reexport {
    fn key(&self) -> Key<'_> {
        self.name.as_deref()
    }
}

/// A `Map`, out of the list of its `set`s: where in the list its values are.
struct Table {
    /// In the order of the `Map`: the last `set` of a key, at the place of the first.
    in_order: Box<[u32]>,
    /// The same, sorted by the key.
    by_key: Box<[u32]>,
}

impl Table {
    /// `is_set`: whether a `set` is reached, where the `Map` has its key or has it not.
    fn new<T: Keyed>(sets: &[T], is_set: &dyn Fn(&T, bool) -> bool) -> Table {
        let mut places: FxHashMap<Key<'_>, usize> = FxHashMap::default();
        let mut in_order: Vec<u32> = Vec::new();
        for (index, it) in sets.iter().enumerate() {
            let place = places.get(&it.key()).copied();
            if !is_set(it, place.is_some()) {
                continue;
            }
            let Some(place) = place else {
                places.insert(it.key(), in_order.len());
                in_order.push(index as u32);
                continue;
            };
            if let Some(value) = in_order.get_mut(place) {
                *value = index as u32;
            }
        }
        let mut by_key = in_order.clone();
        let key_at = |index: u32| sets.get(index as usize).and_then(T::key);
        utils::sort::sort_indices_unstable(&mut by_key, &mut |a, b| key_at(a).cmp(&key_at(b)));
        Table {
            in_order: in_order.into(),
            by_key: by_key.into(),
        }
    }

    fn get<'r, T: Keyed>(&self, sets: &'r [T], key: Key) -> Option<&'r T> {
        let key_at = |index: u32| sets.get(index as usize).and_then(T::key);
        let found = self
            .by_key
            .binary_search_by(|&index| key_at(index).cmp(&key));
        sets.get(*self.by_key.get(found.ok()?)? as usize)
    }

    fn iter<'r, T>(&'r self, sets: &'r [T]) -> impl Iterator<Item = &'r T> {
        let in_order = self.in_order.iter();
        in_order.filter_map(move |&index| sets.get(index as usize))
    }

    fn len(&self) -> usize {
        self.in_order.len()
    }
}

/// What is kept of a file.
struct Facts {
    record: ExportRecord,
    /// `namespace`, without `esModuleInterop` and with it.
    namespace: [OnceLock<Table>; 2],
    reexports: Table,
}

fn read_boxed<'f>(file: &'f File<'f>) -> Box<dyn Any + Send + Sync> {
    let record = import_export_record::read(file);
    let reexports = Table::new(&record.reexports, &|_, _| true);
    Box::new(Facts {
        record,
        namespace: [OnceLock::new(), OnceLock::new()],
        reexports,
    })
}

const READER: Reader = Reader {
    wants: import_export_record::may_be_module,
    read: read_boxed,
};

/// An `ExportMap`.
#[derive(Copy, Clone)]
pub(crate) struct ExportMap<'a>(&'a Facts);

/// A value of `namespace`.
#[derive(Copy, Clone)]
pub(crate) struct Exported<'a> {
    /// Whose `namespace` has it.
    map: ExportMap<'a>,
    entry: &'a Entry,
}

/// What `get` returns.
#[derive(Copy, Clone)]
pub(crate) enum Got<'a> {
    Undefined,
    /// It is exported again from a module that is ignored.
    Null,
    Meta(Exported<'a>),
}

impl<'a> ExportMap<'a> {
    /// Absolute.
    pub(crate) fn path(self) -> &'a [u8] {
        &self.0.record.path
    }

    /// `errors.length > 0`
    pub(crate) fn has_errors(self) -> bool {
        !self.0.record.errors.is_empty()
    }

    /// `msg` in `reportErrors`
    pub(crate) fn errors_text(self) -> Vec<u8> {
        let mut msg = Vec::new();
        for (index, e) in self.0.record.errors.iter().enumerate() {
            if index > 0 {
                msg.extend_from_slice(b", ");
            }
            msg.extend_from_slice(&e.message);
            match e.line {
                0 => msg.extend_from_slice(b" (undefined:undefined)"),
                line => msg.extend_from_slice(format!(" ({line}:{})", e.column).as_bytes()),
            }
        }
        msg
    }

    /// `parseGoal === 'ambiguous'`
    pub(crate) fn is_ambiguous(self) -> bool {
        !self.0.record.is_module
    }

    /// The keys of `reexports`.
    pub(crate) fn reexport_names(self) -> impl Iterator<Item = &'a [u8]> {
        self.reexports().map(|it| it.key().unwrap_or(UNDEFINED))
    }

    fn id(self) -> *const Facts {
        std::ptr::from_ref(self.0)
    }

    /// `path === other.path`: who asks has one map for a path.
    fn is(self, other: ExportMap) -> bool {
        std::ptr::eq(self.0, other.0)
    }

    fn namespace(self, interop: bool) -> &'a Table {
        let facts = self.0;
        let [without, with] = &facts.namespace;
        let table = if interop { with } else { without };
        table.get_or_init(|| {
            Table::new(&facts.record.namespace, &|it, has| match it.when {
                When::Always => true,
                When::WithInterop => interop,
                When::WithInteropIfAbsent => interop && !has,
            })
        })
    }

    /// The values of `namespace`.
    fn entries(self, interop: bool) -> impl Iterator<Item = &'a Entry> {
        self.namespace(interop).iter(&self.0.record.namespace)
    }

    /// `namespace.get(name)`
    fn entry(self, interop: bool, name: Key) -> Option<&'a Entry> {
        self.namespace(interop).get(&self.0.record.namespace, name)
    }

    /// The values of `reexports`.
    fn reexports(self) -> impl Iterator<Item = &'a Reexport> {
        self.0.reexports.iter(&self.0.record.reexports)
    }

    /// `reexports.get(name)`
    fn reexport(self, name: Key) -> Option<&'a Reexport> {
        self.0.reexports.get(&self.0.record.reexports, name)
    }

    /// `namespace.size + reexports.size`
    fn own_size(self, interop: bool) -> usize {
        self.namespace(interop).len() + self.0.reexports.len()
    }
}

/// `dependencies` of a map, each called. `None`: `null`.
type Dependencies<'a> = Rc<[Option<ExportMap<'a>>]>;

/// The dependencies that a call has not come to yet.
#[derive(Default)]
struct Rest<'a> {
    dependencies: Dependencies<'a>,
    asked: usize,
}

impl<'a> Iterator for Rest<'a> {
    type Item = Option<ExportMap<'a>>;

    fn next(&mut self) -> Option<Self::Item> {
        let dep = self.dependencies.get(self.asked).copied();
        self.asked += 1;
        dep
    }
}

/// A call of `hasDeep` that is running.
struct HasDeep<'a, 'n> {
    this: ExportMap<'a>,
    name: Key<'n>,
    /// `None`: it returns what `imported.hasDeep` returns.
    rest: Option<Rest<'a>>,
}

impl<'a> HasDeep<'a, '_> {
    /// `path`, where the last of `running` returns.
    fn path_of(running: &[Self]) -> Vec<ExportMap<'a>> {
        running.iter().map(|it| it.this).collect()
    }
}

/// A call of `size` that is running.
struct Size<'a> {
    this: ExportMap<'a>,
    rest: Rest<'a>,
    size: usize,
}

/// The `ExportMapBuilder` of a file: `context`.
pub(crate) struct ExportMaps<'a> {
    file: &'a File<'a>,
    modules: &'a dyn Modules,
    settings: Settings<'a>,
    resolvers: Resolvers<'a>,
    /// `isEsModuleInterop`
    interop: OnceCell<bool>,
    /// The language of `file`, read by espree and by `@typescript-eslint/parser`: for `import/parsers`.
    languages: [OnceCell<Box<LanguageOptions>>; 2],
    dependencies: RefCell<FxHashMap<*const Facts, Dependencies<'a>>>,
}

impl<'a> ExportMaps<'a> {
    /// `None`: there is nothing to report: no other file can be asked for, or a resolver is not known here.
    pub(crate) fn of(file: &'a File<'a>) -> Option<ExportMaps<'a>> {
        Some(ExportMaps {
            file,
            modules: file.modules()?,
            settings: Settings::new(file.settings()),
            resolvers: Resolvers::of(file.settings())?,
            interop: OnceCell::new(),
            languages: [OnceCell::new(), OnceCell::new()],
            dependencies: RefCell::default(),
        })
    }

    /// `isEsModuleInterop`
    fn is_es_module_interop(&self) -> bool {
        *self.interop.get_or_init(|| {
            let parser_options = &self.file.language().parser_options;
            let root = parser_options.get(b"tsconfigRootDir");
            let cwd = self.modules.cwd();
            match root.and_then(Json::as_str).filter(|it| !it.is_empty()) {
                Some(root) => self.modules.es_module_interop(&paths::resolve(cwd, root)),
                None => self.modules.es_module_interop(cwd),
            }
        })
    }

    /// What `parse` reads the file at `path` with. `None`: a parser that is not known here.
    fn language_of(&self, path: &[u8]) -> Option<&LanguageOptions> {
        let own = self.file.language();
        let other = self.settings.parser_for(path);
        let Some(parser) = other.filter(|it| *it != own.parser) else {
            return Some(own);
        };
        let [espree, typescript] = &self.languages;
        let language = match parser {
            Parser::Espree => espree,
            Parser::TypeScript => typescript,
            Parser::Other => return None,
        };
        let language: &LanguageOptions = language.get_or_init(|| {
            Box::new(LanguageOptions {
                parser,
                ..own.clone()
            })
        });
        Some(language)
    }

    /// `ExportMapBuilder.get(source, context)`
    pub(crate) fn get(&self, source: &[u8]) -> Option<ExportMap<'a>> {
        let path = self.resolvers.resolve(self.file, source, false);
        self.at(path.file()?)
    }

    /// `ExportMapBuilder.for(childContext(path, context))`
    pub(crate) fn at(&self, path: &[u8]) -> Option<ExportMap<'a>> {
        // What it asks first is `hasValidExtension`.
        if self.settings.is_ignored(path) {
            return None;
        }
        let modules = self.modules;
        let language = self.language_of(path)?;
        let path = if paths::is_absolute(path) {
            Cow::Borrowed(path)
        } else {
            Cow::Owned(paths::resolve(modules.cwd(), path))
        };
        let facts = modules.facts(&path, language, &READER)?;
        let facts = facts.downcast_ref::<Facts>()?;
        // "ambiguous modules return null"
        (!facts.record.is_null).then_some(ExportMap(facts))
    }

    /// `RemotePath.resolve`, in `map`. `None`: `null` or `undefined`.
    fn remote_path(&self, map: ExportMap, value: &[u8]) -> Option<Vec<u8>> {
        let from = map.path();
        match self
            .resolvers
            .resolve_from(self.modules, from, value, false)
        {
            Resolved::File(path) => Some(path),
            Resolved::Nothing | Resolved::Builtin => None,
        }
    }

    /// `Namespace.resolveImport`, in `map`.
    fn resolve_import(&self, map: ExportMap, value: &[u8]) -> Option<ExportMap<'a>> {
        self.at(&self.remote_path(map, value)?)
    }

    /// One getter for a path: `captureDependency` returns the one that `imports` has.
    fn dependencies_of(&self, map: ExportMap<'a>) -> Dependencies<'a> {
        let star_exports = &map.0.record.star_exports;
        if star_exports.is_empty() {
            return Rc::default();
        }
        if let Some(known) = self.dependencies.borrow().get(&map.id()) {
            return Rc::clone(known);
        }
        let mut seen = FxHashSet::default();
        let mut dependencies = Vec::new();
        for source in star_exports {
            if let Some(p) = self.remote_path(map, source)
                && seen.insert(p.clone())
            {
                dependencies.push(self.at(&p));
            }
        }
        let dependencies: Dependencies<'a> = dependencies.into();
        let known = Rc::clone(&dependencies);
        self.dependencies.borrow_mut().insert(map.id(), known);
        dependencies
    }

    fn rest_of(&self, map: ExportMap<'a>) -> Rest<'a> {
        Rest {
            dependencies: self.dependencies_of(map),
            asked: 0,
        }
    }

    /// `size`. A module that exports all of itself again, directly or not, counts once.
    pub(crate) fn size(&self, map: ExportMap<'a>) -> usize {
        let interop = self.is_es_module_interop();
        if map.0.record.star_exports.is_empty() {
            return map.own_size(interop);
        }
        let call = |this: ExportMap<'a>| Size {
            this,
            rest: self.rest_of(this),
            size: this.own_size(interop),
        };
        // What has returned. Of a call that is running: nothing.
        let mut known: FxHashMap<*const Facts, usize> = FxHashMap::default();
        known.insert(map.id(), 0);
        let mut running = vec![call(map)];
        let mut returned = 0;
        while let Some(top) = running.last_mut() {
            top.size = top.size.saturating_add(std::mem::take(&mut returned));
            match top.rest.next() {
                // "CJS / ignored dependencies won't exist (#717)"
                Some(None) => {}
                Some(Some(d)) => match known.get(&d.id()).copied() {
                    Some(size) => returned = size,
                    None => {
                        known.insert(d.id(), 0);
                        running.push(call(d));
                    }
                },
                None => {
                    returned = top.size;
                    known.insert(top.this.id(), returned);
                    running.pop();
                }
            }
        }
        returned
    }

    /// `has`
    pub(crate) fn has(&self, map: ExportMap<'a>, name: &[u8]) -> bool {
        let (interop, name) = (self.is_es_module_interop(), Some(name));
        // The calls that are to come, the next last.
        let mut pending: SmallVec<[ExportMap<'a>; 8]> = smallvec![map];
        let mut asked = FxHashSet::default();
        while let Some(this) = pending.pop() {
            if this.entry(interop, name).is_some() || this.reexport(name).is_some() {
                return true;
            }
            // "default exports must be explicitly re-exported (#328)"
            if name != Some(DEFAULT) && asked.insert(this.id()) {
                let dependencies = self.dependencies_of(this);
                pending.extend(dependencies.iter().rev().flatten().copied());
            }
        }
        false
    }

    /// `namespace.has(name)`
    pub(crate) fn namespace_has(&self, map: ExportMap<'a>, name: &[u8]) -> bool {
        let interop = self.is_es_module_interop();
        map.entry(interop, Some(name)).is_some()
    }

    /// `hasDeep`: `found`, `path`. What is asked again while it is asked is not found: upstream runs out of stack.
    pub(crate) fn has_deep(&self, map: ExportMap<'a>, name: &[u8]) -> (bool, Vec<ExportMap<'a>>) {
        let interop = self.is_es_module_interop();
        let mut running: Vec<HasDeep<'a, '_>> = Vec::new();
        let mut asked = FxHashSet::default();
        let mut call = Some((map, Some(name)));
        loop {
            if let Some((this, name)) = call.take() {
                let rest = None;
                running.push(HasDeep { this, name, rest });
                if this.entry(interop, name).is_some() {
                    return (true, HasDeep::path_of(&running));
                }
                let is_new = asked.insert((this.id(), name));
                if let Some(reexports) = this.reexport(name) {
                    // "if import is ignored, return explicit 'null'"
                    let Some(imported) = self.resolve_import(this, &reexports.source) else {
                        return (true, HasDeep::path_of(&running));
                    };
                    let local = reexports.local.as_deref();
                    // "safeguard against cycles, only if name matches"
                    if is_new && !(imported.is(this) && local == name) {
                        call = Some((imported, local));
                        continue;
                    }
                } else if let Some(top) = running.last_mut() {
                    // "default exports must be explicitly re-exported (#328)"
                    let has_rest = is_new && name != Some(DEFAULT);
                    top.rest = Some(if has_rest {
                        self.rest_of(this)
                    } else {
                        Rest::default()
                    });
                }
            }
            let Some((top, callers)) = running.split_last_mut() else {
                return (false, Vec::new());
            };
            match top.rest.as_mut().and_then(Rest::next) {
                Some(None) => return (true, HasDeep::path_of(&running)),
                // "safeguard against cycles"
                Some(Some(inner_map)) if inner_map.is(top.this) => {}
                Some(Some(inner_map)) => call = Some((inner_map, top.name)),
                // It has not found it, nor have those that return what it returns.
                None => match callers.iter().rposition(|it| it.rest.is_some()) {
                    Some(caller) => running.truncate(caller + 1),
                    None => return (false, HasDeep::path_of(&running)),
                },
            }
        }
    }

    /// `get`
    pub(crate) fn get_export(&self, map: ExportMap<'a>, name: &[u8]) -> Got<'a> {
        self.get_key(map, Some(name))
    }

    /// What is asked again while it is asked is `undefined`: upstream runs out of stack.
    fn get_key(&self, map: ExportMap<'a>, name: Key) -> Got<'a> {
        let interop = self.is_es_module_interop();
        // The calls that are to come, the next last. All return what the first that is not `undefined` returns.
        let mut pending: SmallVec<[(ExportMap<'a>, Key<'_>); 8]> = smallvec![(map, name)];
        let mut asked = FxHashSet::default();
        while let Some((this, name)) = pending.pop() {
            if let Some(entry) = this.entry(interop, name) {
                return Got::Meta(Exported { map: this, entry });
            }
            if !asked.insert((this.id(), name)) {
                continue;
            }
            if let Some(reexports) = this.reexport(name) {
                // "if import is ignored, return explicit 'null'"
                let Some(imported) = self.resolve_import(this, &reexports.source) else {
                    return Got::Null;
                };
                let local = reexports.local.as_deref();
                // "safeguard against cycles, only if name matches"
                if !(imported.is(this) && local == name) {
                    pending.push((imported, local));
                }
            } else if name != Some(DEFAULT) {
                // "default exports must be explicitly re-exported (#328)"
                let dependencies = self.dependencies_of(this);
                let inner_maps = dependencies.iter().rev().flatten();
                // "safeguard against cycles"
                pending.extend(inner_maps.filter(|it| !it.is(this)).map(|&it| (it, name)));
            }
        }
        Got::Undefined
    }

    /// `hasDefault`: "stronger than this.has"
    pub(crate) fn has_default(&self, map: ExportMap<'a>) -> bool {
        matches!(self.get_key(map, Some(DEFAULT)), Got::Meta(_))
    }

    /// `forEach`: the value, which is `None` for `null` and `undefined`, and the name. A module that is reached on two
    /// ways is gone through once: upstream says the same again.
    pub(crate) fn for_each(
        &self,
        map: ExportMap<'a>,
        callback: &mut dyn FnMut(Option<Exported<'a>>, &'a [u8]),
    ) {
        let interop = self.is_es_module_interop();
        // The calls that are to come, the next last.
        let mut pending: SmallVec<[ExportMap<'a>; 8]> = smallvec![map];
        let mut asked = FxHashSet::default();
        while let Some(this) = pending.pop() {
            if !asked.insert(this.id()) {
                continue;
            }
            // Of a dependency: `n !== 'default'`.
            let is_passed = |n: Key<'_>| this.is(map) || n != Some(DEFAULT);
            for entry in this.entries(interop).filter(|it| is_passed(it.key())) {
                let v = Exported { map: this, entry };
                callback(Some(v), entry.key().unwrap_or(UNDEFINED));
            }
            for reexports in this.reexports().filter(|it| is_passed(it.key())) {
                // "can't look up meta for ignored re-exports (#348)"
                let reexported = self.resolve_import(this, &reexports.source);
                let v = match reexported.map(|it| self.get_key(it, reexports.local.as_deref())) {
                    Some(Got::Meta(v)) => Some(v),
                    _ => None,
                };
                callback(v, reexports.key().unwrap_or(UNDEFINED));
            }
            let dependencies = self.dependencies_of(this);
            pending.extend(dependencies.iter().rev().flatten().copied());
        }
    }

    /// `meta.namespace`
    pub(crate) fn namespace_of(&self, exported: Exported<'a>) -> Option<ExportMap<'a>> {
        self.resolve_import(exported.map, exported.entry.namespace_of.as_deref()?)
    }

    /// `reexports.get(name)`: `local`, `getImport()`.
    pub(crate) fn reexport(
        &self,
        map: ExportMap<'a>,
        name: &[u8],
    ) -> Option<(&'a [u8], Option<ExportMap<'a>>)> {
        let reexports = map.reexport(Some(name))?;
        let local = reexports.local.as_deref().unwrap_or(UNDEFINED);
        Some((local, self.resolve_import(map, &reexports.source)))
    }

    /// `meta.doc.tags.find((t) => t.title === 'deprecated')`: its description.
    pub(crate) fn deprecation(&self, exported: Exported<'a>) -> Option<Option<&'a [u8]>> {
        let docs = &exported.entry.doc;
        let styles = self.settings.docstyle();
        // `captureDoc` keeps what the last parser finds.
        let doc = styles.iter().rev().find_map(|style| match style {
            DocStyle::Jsdoc => docs.jsdoc.as_ref(),
            DocStyle::Tomdoc => docs.tomdoc.as_ref(),
        })?;
        doc.deprecated.as_ref().map(|it| it.as_deref())
    }

    /// The same of `map.doc`.
    pub(crate) fn module_deprecation(&self, map: ExportMap<'a>) -> Option<Option<&'a [u8]>> {
        let doc = map.0.record.doc.as_ref()?;
        doc.deprecated.as_ref().map(|it| it.as_deref())
    }

    /// The keys of `namespace`.
    pub(crate) fn namespace_names(&self, map: ExportMap<'a>) -> Vec<&'a [u8]> {
        let entries = map.entries(self.is_es_module_interop());
        entries.map(|it| it.key().unwrap_or(UNDEFINED)).collect()
    }

    /// `dependencies`, each called.
    pub(crate) fn dependencies(&self, map: ExportMap<'a>) -> Vec<Option<ExportMap<'a>>> {
        self.dependencies_of(map).to_vec()
    }

    /// `imports`: the path as the resolver gives it, and `declarations`.
    pub(crate) fn imports(&self, map: ExportMap<'a>) -> Vec<(Vec<u8>, Vec<&'a Dependency>)> {
        let mut places: FxHashMap<Vec<u8>, usize> = FxHashMap::default();
        let mut imports: Vec<(Vec<u8>, Vec<&'a Dependency>)> = Vec::new();
        for declaration in &map.0.record.imports {
            let Some(p) = self.remote_path(map, &declaration.specifier) else {
                continue;
            };
            let Some(place) = places.get(&p).copied() else {
                places.insert(p.clone(), imports.len());
                imports.push((p, vec![declaration]));
                continue;
            };
            if let Some((_, declarations)) = imports.get_mut(place) {
                if declaration.is_dynamic {
                    declarations.clear();
                }
                declarations.push(declaration);
            }
        }
        imports
    }
}
