#![allow(dead_code)] // until every rule of the plugin is written
//! `resolve` of eslint-module-utils: the file that a file means by a name, for the resolvers of
//! `settings["import/resolver"]`.

use bun_core::strings;
use bun_lint::modules::{Lookup, Modules};
use bun_lint::paths;
use bun_lint::prelude::*;
use bun_lint::utils::node::is_builtin_module;
use smallvec::SmallVec;
use std::borrow::Cow;

/// Those of eslint-import-resolver-node.
const EXTENSIONS: [&[u8]; 4] = [b".mjs", b".js", b".json", b".node"];

/// The resolvers of a file.
pub(crate) struct Resolvers<'s> {
    /// The `Map` of `resolverReducer`: by the name as it is written.
    map: SmallVec<[(&'s [u8], Lookup<'s>); 2]>,
    /// `settings["import/core-modules"]`: an array or a string.
    core_modules: Option<&'s Json>,
}

/// What `resolve` returns.
pub(crate) enum Resolved {
    /// `undefined`
    Nothing,
    /// `null`: a module of Node.js.
    Builtin,
    /// Separated by `/`. Absolute, unless it is in one of the `paths` that is not.
    File(Vec<u8>),
}

impl Resolved {
    /// `resolve(..) || ..`: the path, if there is one.
    pub(crate) fn file(&self) -> Option<&[u8]> {
        match self {
            Resolved::File(path) => Some(path),
            Resolved::Nothing | Resolved::Builtin => None,
        }
    }

    /// `resolve(..) !== undefined`
    pub(crate) fn is_found(&self) -> bool {
        !matches!(self, Resolved::Nothing)
    }
}

/// `Boolean(value)`
fn is_truthy(value: &Json) -> bool {
    match value {
        Json::Null => false,
        Json::Bool(value) => *value,
        Json::Number(value) => *value != 0.0 && !value.is_nan(),
        Json::String(value) => !value.is_empty(),
        Json::Array(_) | Json::Object(_) => true,
    }
}

/// `[].concat(value)`. `None` for what is no string.
fn concat(value: &Json) -> impl Iterator<Item = Option<&[u8]>> {
    let items = match value {
        Json::Array(items) => items.as_slice(),
        value => std::slice::from_ref(value),
    };
    items.iter().map(Json::as_str)
}

/// `opts` of eslint-import-resolver-node, as `resolve` reads them.
fn opts(config: Option<&Json>) -> Lookup<'_> {
    let option = |name: &[u8]| config.and_then(|it| it.get(name));
    let extensions: SmallVec<[&[u8]; 4]> = match option(b"extensions") {
        None => SmallVec::from_slice(&EXTENSIONS),
        Some(Json::Array(extensions)) => extensions.iter().filter_map(Json::as_str).collect(),
        // `extensions[i]`
        Some(Json::String(units)) if !units.is_empty() => units.chunks(1).collect(),
        Some(it) if is_truthy(it) => SmallVec::new(),
        // `opts.extensions || ['.js']`
        Some(_) => SmallVec::from_slice(&[&b".js"[..]]),
    };
    let roots = option(b"paths").filter(|it| is_truthy(it));
    let directories = option(b"moduleDirectory").filter(|it| is_truthy(it));
    if roots.or(directories).is_none() {
        return Lookup::Node(extensions);
    }
    let roots: Option<SmallVec<[&[u8]; 2]>> = match roots {
        Some(roots) => concat(roots).collect(),
        None => Some(SmallVec::new()),
    };
    let directories: Option<SmallVec<[&[u8]; 1]>> = match directories {
        Some(directories) => concat(directories).collect(),
        None => Some(SmallVec::from_slice(&[&b"node_modules"[..]])),
    };
    // `path.join` throws at what is no string, before anything is looked at: no package is found.
    let (roots, module_directories) = roots.zip(directories).unwrap_or_default();
    Lookup::NodeWith {
        extensions,
        paths: roots,
        module_directories,
    }
}

/// `requireResolver`, with its configuration. `None`: it is not known here.
fn require_resolver<'s>(name: &[u8], config: Option<&'s Json>) -> Option<Lookup<'s>> {
    match name
        .strip_prefix(b"eslint-import-resolver-")
        .unwrap_or(name)
    {
        b"node" => Some(opts(config)),
        b"typescript" => Some(Lookup::TypeScript),
        _ => None,
    }
}

impl<'s> Resolvers<'s> {
    /// `map.set(name, config)`
    fn set(&mut self, name: &'s [u8], config: Option<&'s Json>) -> Option<()> {
        let lookup = require_resolver(name, config)?;
        match self.map.iter_mut().find(|it| it.0 == name) {
            Some(known) => known.1 = lookup,
            None => self.map.push((name, lookup)),
        }
        Some(())
    }

    /// `resolverReducer`. `None`: it throws, or a name is not known here.
    fn resolver_reducer(&mut self, resolvers: &'s Json) -> Option<()> {
        let mut pending: SmallVec<[std::slice::Iter<'s, Json>; 2]> = SmallVec::new();
        pending.push(std::slice::from_ref(resolvers).iter());
        while let Some(items) = pending.last_mut() {
            match items.next() {
                None => {
                    pending.pop();
                }
                Some(Json::Array(items)) => pending.push(items.iter()),
                Some(Json::String(name)) => self.set(name, None)?,
                Some(Json::Object(entries)) => {
                    for (name, config) in entries {
                        self.set(name, Some(config))?;
                    }
                }
                // `for (const key in null)`
                Some(Json::Null) => {}
                Some(Json::Bool(_) | Json::Number(_)) => return None,
            }
        }
        Some(())
    }

    /// `None`: nothing can be said about what a name means: a resolver is not known here, or
    /// `resolve` throws.
    pub(crate) fn of(settings: &'s Json) -> Option<Resolvers<'s>> {
        // `new Set(..)`
        let core_modules = match settings.get(b"import/core-modules") {
            None | Some(Json::Null) => None,
            Some(iterable @ (Json::Array(_) | Json::String(_))) => Some(iterable),
            Some(_) => return None,
        };
        let mut resolvers = Resolvers {
            map: SmallVec::new(),
            core_modules,
        };
        match (settings.get(b"import/resolver")).filter(|it| is_truthy(it)) {
            Some(written) => resolvers.resolver_reducer(written)?,
            // "backward compatibility"
            None => resolvers.set(b"node", settings.get(b"import/resolve"))?,
        }
        Some(resolvers)
    }

    /// `coreSet.has(specifier)`
    fn is_core_module(&self, specifier: &[u8]) -> bool {
        match self.core_modules {
            Some(Json::Array(items)) => items.iter().any(|it| it.as_str() == Some(specifier)),
            // The code points of a string.
            Some(Json::String(points)) => {
                let lead = specifier.first().copied().unwrap_or_default();
                usize::from(strings::wtf8_byte_sequence_length(lead)) == specifier.len()
                    && strings::contains(points, specifier)
            }
            _ => false,
        }
    }

    /// `resolve.relative(specifier, from, settings)`
    pub(crate) fn resolve_from(
        &self,
        modules: &dyn Modules,
        from: &[u8],
        specifier: &[u8],
        is_require: bool,
    ) -> Resolved {
        if self.is_core_module(specifier) {
            return Resolved::Builtin;
        }
        // Each resolver begins with `isCoreModule`.
        if !self.map.is_empty() && is_builtin_module(specifier) {
            return Resolved::Builtin;
        }
        // `path.resolve(file)`
        let from = if paths::is_absolute(from) {
            Cow::Borrowed(from)
        } else {
            Cow::Owned(paths::resolve(modules.cwd(), from))
        };
        let found = self
            .map
            .iter()
            .find_map(|it| modules.resolve_file(&from, specifier, is_require, &it.1));
        found.map_or(Resolved::Nothing, Resolved::File)
    }

    pub(crate) fn resolve(&self, file: &File, specifier: &[u8], is_require: bool) -> Resolved {
        match file.modules() {
            Some(modules) => self.resolve_from(modules, file.path(), specifier, is_require),
            None => Resolved::Nothing,
        }
    }
}
