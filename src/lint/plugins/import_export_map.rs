//! `ExportMap` and `ExportMapBuilder` from eslint-plugin-import 2.32.0: the exports of another file as it is on disk,
//! evaluated with the settings, resolvers and `esModuleInterop` of the file being linted.

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

/// `reportErrors`. Reported at `declaration.source`, with `source.value` and [`ExportMap::errors_text`] as data.
pub(crate) const PARSE_ERRORS: Message = Message::new(
    "",
    "Parse errors in imported module '{{source}}': {{errors}}",
);

const DEFAULT: &[u8] = b"default";

/// How an `undefined` key is printed where a name is expected.
const UNDEFINED: &[u8] = b"undefined";

/// A key of `namespace` or `reexports`. `None` is `undefined`.
type Key<'k> = Option<&'k [u8]>;

/// One `set` call on a `Map`.
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

/// A `Map` reconstructed from the list of its `set` calls. It stores indices into that list.
struct Table {
    /// In the `Map`'s iteration order: each key's last `set`, at the position of its first.
    in_order: Box<[u32]>,
    /// The same indices, sorted by key.
    by_key: Box<[u32]>,
}

impl Table {
    /// `is_set` decides whether a `set` call is executed. Its second argument tells whether the `Map` already has the
    /// key.
    fn new<T: Keyed>(sets: &[T], is_set: &dyn Fn(&T, bool) -> bool) -> Table {
        let mut index_of_key: FxHashMap<Key<'_>, usize> = FxHashMap::default();
        let mut in_order: Vec<u32> = Vec::new();
        for (index, it) in sets.iter().enumerate() {
            let existing = index_of_key.get(&it.key()).copied();
            if !is_set(it, existing.is_some()) {
                continue;
            }
            let Some(existing) = existing else {
                index_of_key.insert(it.key(), in_order.len());
                in_order.push(index as u32);
                continue;
            };
            if let Some(value) = in_order.get_mut(existing) {
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

/// The cached data for one file.
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
    should_parse: import_export_record::may_be_module,
    read: read_boxed,
};

/// An `ExportMap`.
#[derive(Copy, Clone)]
pub(crate) struct ExportMap<'a> {
    facts: &'a Facts,
    /// True if the resolver returned a path relative to the working directory. Upstream keeps a separate map for that
    /// `path`.
    is_relative: bool,
}

/// Plays the role of upstream's `path`. A linted file has one map per `Id`.
type Id = (*const Facts, bool);

/// A value of `namespace`.
#[derive(Copy, Clone)]
pub(crate) struct Exported<'a> {
    /// The map whose `namespace` contains it.
    map: ExportMap<'a>,
    entry: &'a Entry,
}

/// An entry of `reexports`.
pub(crate) struct Reexported<'a> {
    /// `None` is `undefined`, here and in `local`.
    pub(crate) name: Option<&'a [u8]>,
    pub(crate) local: Option<&'a [u8]>,
    /// `getImport()`
    pub(crate) import: Option<ExportMap<'a>>,
}

/// The return value of `get`.
#[derive(Copy, Clone)]
pub(crate) enum Got<'a> {
    Undefined,
    /// It's re-exported from an ignored module.
    Null,
    Meta(Exported<'a>),
}

impl<'a> ExportMap<'a> {
    /// Always absolute.
    pub(crate) fn path(self) -> &'a [u8] {
        &self.facts.record.path
    }

    /// `errors.length > 0`
    pub(crate) fn has_errors(self) -> bool {
        !self.facts.record.errors.is_empty()
    }

    /// `msg` in `reportErrors`
    pub(crate) fn errors_text(self) -> Vec<u8> {
        let mut msg = Vec::new();
        for (index, e) in self.facts.record.errors.iter().enumerate() {
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
        !self.facts.record.is_module
    }

    fn id(self) -> Id {
        (std::ptr::from_ref(self.facts), self.is_relative)
    }

    /// `path === other.path`
    fn is(self, other: ExportMap) -> bool {
        self.id() == other.id()
    }

    fn namespace(self, interop: bool) -> &'a Table {
        let facts = self.facts;
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
        self.namespace(interop).iter(&self.facts.record.namespace)
    }

    /// `namespace.get(name)`
    fn entry(self, interop: bool, name: Key) -> Option<&'a Entry> {
        self.namespace(interop)
            .get(&self.facts.record.namespace, name)
    }

    /// The values of `reexports`.
    fn reexports(self) -> impl Iterator<Item = &'a Reexport> {
        self.facts.reexports.iter(&self.facts.record.reexports)
    }

    /// `reexports.get(name)`
    fn reexport(self, name: Key) -> Option<&'a Reexport> {
        self.facts.reexports.get(&self.facts.record.reexports, name)
    }

    /// `namespace.size + reexports.size`
    fn own_size(self, interop: bool) -> usize {
        self.namespace(interop).len() + self.facts.reexports.len()
    }
}

/// The results of calling each of a map's `dependencies`. `None` is `null`.
type Dependencies<'a> = Rc<[Option<ExportMap<'a>>]>;

/// The dependencies that a call hasn't visited yet.
#[derive(Default)]
struct Rest<'a> {
    dependencies: Dependencies<'a>,
    next_index: usize,
}

impl<'a> Iterator for Rest<'a> {
    type Item = Option<ExportMap<'a>>;

    fn next(&mut self) -> Option<Self::Item> {
        let dep = self.dependencies.get(self.next_index).copied();
        self.next_index += 1;
        dep
    }
}

/// A stack frame of `hasDeep`.
struct HasDeep<'a, 'n> {
    this: ExportMap<'a>,
    name: Key<'n>,
    /// `None` if this call returns whatever `imported.hasDeep` returns.
    rest: Option<Rest<'a>>,
}

impl<'a> HasDeep<'a, '_> {
    /// The `path` that's returned when the last frame of `running` returns.
    fn path_of(running: &[Self]) -> Vec<ExportMap<'a>> {
        running.iter().map(|it| it.this).collect()
    }
}

/// A stack frame of `size`.
struct Size<'a> {
    this: ExportMap<'a>,
    rest: Rest<'a>,
    size: usize,
}

/// The `ExportMapBuilder` for one linted file. Plays the role of upstream's `context`.
pub(crate) struct ExportMaps<'a> {
    file: &'a File<'a>,
    modules: &'a dyn Modules,
    settings: Settings<'a>,
    resolvers: Resolvers<'a>,
    /// `isEsModuleInterop`
    interop: OnceCell<bool>,
    /// `file`'s language options with the parser set to espree and to `@typescript-eslint/parser`, for
    /// `import/parsers`.
    languages: [OnceCell<Box<LanguageOptions>>; 2],
    dependencies: RefCell<FxHashMap<Id, Dependencies<'a>>>,
}

impl<'a> ExportMaps<'a> {
    /// `None` if there's nothing to report because there's no module graph, or a configured resolver isn't supported.
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

    /// The language options that `parse` uses for the file at `path`. `None` for an unsupported parser.
    fn language_of(&self, path: &[u8]) -> Option<&LanguageOptions> {
        let own = self.file.configured_language();
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
        let language: &LanguageOptions = language.get_or_init(|| Box::new(own.with_parser(parser)));
        Some(language)
    }

    /// `ExportMapBuilder.get(source, context)`
    pub(crate) fn get(&self, source: &[u8]) -> Option<ExportMap<'a>> {
        let path = self.resolvers.resolve(self.file, source, false);
        self.at(path.file()?)
    }

    /// `ExportMapBuilder.for(childContext(path, context))`
    pub(crate) fn at(&self, path: &[u8]) -> Option<ExportMap<'a>> {
        // Upstream checks `hasValidExtension` first.
        if self.settings.is_ignored(path) {
            return None;
        }
        let modules = self.modules;
        let language = self.language_of(path)?;
        let is_relative = !paths::is_absolute(path);
        let path = if is_relative {
            Cow::Owned(paths::resolve(modules.cwd(), path))
        } else {
            Cow::Borrowed(path)
        };
        let facts = modules.facts(&path, language, &READER)?;
        let facts = facts.downcast_ref::<Facts>()?;
        // "ambiguous modules return null"
        (!facts.record.is_null).then_some(ExportMap { facts, is_relative })
    }

    /// `RemotePath.resolve`, in `map`. `None` is `null` or `undefined`.
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

    /// There's one getter per path, because `captureDependency` returns the one that's already in `imports`.
    fn dependencies_of(&self, map: ExportMap<'a>) -> Dependencies<'a> {
        let star_exports = &map.facts.record.star_exports;
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
            next_index: 0,
        }
    }

    /// `size`. A module that re-exports all of itself, directly or transitively, is counted once.
    pub(crate) fn size(&self, map: ExportMap<'a>) -> usize {
        let interop = self.is_es_module_interop();
        if map.facts.record.star_exports.is_empty() {
            return map.own_size(interop);
        }
        let call = |this: ExportMap<'a>| Size {
            this,
            rest: self.rest_of(this),
            size: this.own_size(interop),
        };
        // The results of finished calls. A call that's still running has 0.
        let mut known: FxHashMap<Id, usize> = FxHashMap::default();
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

    pub(crate) fn has(&self, map: ExportMap<'a>, name: &[u8]) -> bool {
        let (interop, name) = (self.is_es_module_interop(), Some(name));
        // A stack of pending calls, with the next one on top.
        let mut pending: SmallVec<[ExportMap<'a>; 8]> = smallvec![map];
        let mut visited = FxHashSet::default();
        while let Some(this) = pending.pop() {
            if this.entry(interop, name).is_some() || this.reexport(name).is_some() {
                return true;
            }
            // "default exports must be explicitly re-exported (#328)"
            if name != Some(DEFAULT) && visited.insert(this.id()) {
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

    /// `hasDeep`. Returns `found` and `path`. A query that recurs while it's still running counts as not found, where
    /// upstream overflows the stack.
    pub(crate) fn has_deep(&self, map: ExportMap<'a>, name: &[u8]) -> (bool, Vec<ExportMap<'a>>) {
        let interop = self.is_es_module_interop();
        let mut running: Vec<HasDeep<'a, '_>> = Vec::new();
        let mut visited = FxHashSet::default();
        let mut call = Some((map, Some(name)));
        loop {
            if let Some((this, name)) = call.take() {
                let rest = None;
                running.push(HasDeep { this, name, rest });
                if this.entry(interop, name).is_some() {
                    return (true, HasDeep::path_of(&running));
                }
                let is_new = visited.insert((this.id(), name));
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
                // This call didn't find it, and neither did the callers that just return its result.
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

    /// A query that recurs while it's still running returns `undefined`, where upstream overflows the stack.
    fn get_key(&self, map: ExportMap<'a>, name: Key) -> Got<'a> {
        let interop = self.is_es_module_interop();
        // A stack of pending calls, with the next one on top. The result is the first one that isn't `undefined`.
        let mut pending: SmallVec<[(ExportMap<'a>, Key<'_>); 8]> = smallvec![(map, name)];
        let mut visited = FxHashSet::default();
        while let Some((this, name)) = pending.pop() {
            if let Some(entry) = this.entry(interop, name) {
                return Got::Meta(Exported { map: this, entry });
            }
            if !visited.insert((this.id(), name)) {
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

    /// `forEach`. The callback gets the value (`None` for `null` and `undefined`) and the name. A module that's
    /// reachable in two ways is visited once, where upstream repeats its entries.
    pub(crate) fn for_each(
        &self,
        map: ExportMap<'a>,
        callback: &mut dyn FnMut(Option<Exported<'a>>, &'a [u8]),
    ) {
        let interop = self.is_es_module_interop();
        // A stack of pending calls, with the next one on top.
        let mut pending: SmallVec<[ExportMap<'a>; 8]> = smallvec![map];
        let mut visited = FxHashSet::default();
        while let Some(this) = pending.pop() {
            if !visited.insert(this.id()) {
                continue;
            }
            // For a dependency, upstream checks `n !== 'default'`.
            let is_forwarded = |n: Key<'_>| this.is(map) || n != Some(DEFAULT);
            for entry in this.entries(interop).filter(|it| is_forwarded(it.key())) {
                let v = Exported { map: this, entry };
                callback(Some(v), entry.key().unwrap_or(UNDEFINED));
            }
            for reexports in this.reexports().filter(|it| is_forwarded(it.key())) {
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

    /// `reexports.get(name)`. Returns `local` and `getImport()`.
    pub(crate) fn reexport(
        &self,
        map: ExportMap<'a>,
        name: &[u8],
    ) -> Option<(&'a [u8], Option<ExportMap<'a>>)> {
        let reexports = map.reexport(Some(name))?;
        let local = reexports.local.as_deref().unwrap_or(UNDEFINED);
        Some((local, self.resolve_import(map, &reexports.source)))
    }

    /// `reexports`, in iteration order.
    pub(crate) fn reexports(&self, map: ExportMap<'a>) -> Vec<Reexported<'a>> {
        let entries = map.reexports().map(|it| Reexported {
            name: it.key(),
            local: it.local.as_deref(),
            import: self.resolve_import(map, &it.source),
        });
        entries.collect()
    }

    /// The description of `meta.doc.tags.find((t) => t.title === 'deprecated')`.
    pub(crate) fn deprecation(&self, exported: Exported<'a>) -> Option<Option<&'a [u8]>> {
        let docs = &exported.entry.doc;
        let styles = self.settings.docstyle();
        // `captureDoc` keeps the last parser's result.
        let doc = styles.iter().rev().find_map(|style| match style {
            DocStyle::Jsdoc => docs.jsdoc.as_ref(),
            DocStyle::Tomdoc => docs.tomdoc.as_ref(),
        })?;
        doc.deprecated.as_ref().map(|it| it.as_deref())
    }

    /// The same for `map.doc`.
    pub(crate) fn module_deprecation(&self, map: ExportMap<'a>) -> Option<Option<&'a [u8]>> {
        let doc = map.facts.record.doc.as_ref()?;
        doc.deprecated.as_ref().map(|it| it.as_deref())
    }

    /// The keys of `namespace`.
    pub(crate) fn namespace_names(&self, map: ExportMap<'a>) -> Vec<&'a [u8]> {
        let entries = map.entries(self.is_es_module_interop());
        entries.map(|it| it.key().unwrap_or(UNDEFINED)).collect()
    }

    /// The results of calling each of `dependencies`.
    pub(crate) fn dependencies(&self, map: ExportMap<'a>) -> Vec<Option<ExportMap<'a>>> {
        self.dependencies_of(map).to_vec()
    }

    /// `imports`: each path as the resolver returns it, with its `declarations`.
    pub(crate) fn imports(&self, map: ExportMap<'a>) -> Vec<(Vec<u8>, Vec<&'a Dependency>)> {
        let mut index_of_path: FxHashMap<Vec<u8>, usize> = FxHashMap::default();
        let mut imports: Vec<(Vec<u8>, Vec<&'a Dependency>)> = Vec::new();
        for declaration in &map.facts.record.imports {
            let Some(p) = self.remote_path(map, &declaration.specifier) else {
                continue;
            };
            let Some(existing) = index_of_path.get(&p).copied() else {
                index_of_path.insert(p.clone(), imports.len());
                imports.push((p, vec![declaration]));
                continue;
            };
            if let Some((_, declarations)) = imports.get_mut(existing) {
                if declaration.is_dynamic {
                    declarations.clear();
                }
                declarations.push(declaration);
            }
        }
        imports
    }
}
