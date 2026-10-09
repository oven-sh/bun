//! `core/importType.js` of eslint-plugin-import: what kind of module a file means by a name.

use crate::import_resolve::{Resolved, Resolvers};
use bun_core::strings;
use bun_lint::linter::config::path;
use bun_lint::prelude::*;
use bun_lint::utils::node::is_builtin_module;
use std::cell::OnceCell;

/// In the order of `types` in `import/order`. `Object` and `Type` are only known there.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum ImportType {
    Builtin,
    External,
    Internal,
    Unknown,
    Parent,
    Sibling,
    Index,
    Object,
    Type,
    Absolute,
}

impl ImportType {
    pub(crate) fn named(name: &[u8]) -> Option<ImportType> {
        Some(match name {
            b"builtin" => ImportType::Builtin,
            b"external" => ImportType::External,
            b"internal" => ImportType::Internal,
            b"unknown" => ImportType::Unknown,
            b"parent" => ImportType::Parent,
            b"sibling" => ImportType::Sibling,
            b"index" => ImportType::Index,
            b"object" => ImportType::Object,
            b"type" => ImportType::Type,
            b"absolute" => ImportType::Absolute,
            _ => return None,
        })
    }
}

/// `/^@[^/]+\/?[^/]+/.test(name)`
fn is_scoped(name: &[u8]) -> bool {
    let Some(rest) = name.strip_prefix(b"@") else {
        return false;
    };
    let scope = strings::index_of_char_usize(rest, b'/').unwrap_or(rest.len());
    scope >= 2 || scope == 1 && rest.get(2).is_some_and(|it| *it != b'/')
}

/// `/^\w/.test(name) || isScoped(name)`
fn is_external_looking_name(name: &[u8]) -> bool {
    name.first()
        .is_some_and(|it| it.is_ascii_alphanumeric() || *it == b'_')
        || is_scoped(name)
}

/// `baseModule`: the package. `None`: a scope alone, which is no name of anything.
fn base_module(name: &[u8]) -> Option<&[u8]> {
    let first = strings::index_of_char_usize(name, b'/');
    if !is_scoped(name) {
        return Some(&name[..first.unwrap_or(name.len())]);
    }
    let rest = name.get(first? + 1..)?;
    let second = strings::index_of_char_usize(rest, b'/').unwrap_or(rest.len());
    name.get(..first? + 1 + second)
}

fn strings_of(json: Option<&Json>) -> Vec<&[u8]> {
    json.and_then(Json::as_array)
        .unwrap_or_default()
        .iter()
        .filter_map(Json::as_str)
        .collect()
}

/// The directory that `directory` is in.
fn parent_of(directory: &[u8]) -> Option<&[u8]> {
    match strings::last_index_of_char(directory, b'/')? {
        0 if directory.len() > 1 => Some(b"/"),
        0 => None,
        slash => directory.get(..slash),
    }
}

/// `!path.relative(directory, file).startsWith("..")`
fn is_below(directory: &[u8], file: &[u8]) -> bool {
    !path::relative(directory, file).starts_with(b"..")
}

/// What is the same for all the names in a file.
pub(crate) struct ImportTypes<'a> {
    file: &'a File<'a>,
    resolvers: Resolvers<'a>,
    /// `import/internal-regex`
    internal: Option<Regex>,
    /// `import/core-modules`
    core_modules: Vec<&'a [u8]>,
    /// `import/external-module-folders`
    folders: Vec<&'a [u8]>,
    /// `getContextPackagePath`: where the closest `package.json` is.
    package: OnceCell<Option<Vec<u8>>>,
}

impl<'a> ImportTypes<'a> {
    /// `None`: `import/resolver` names a resolver that is not known here.
    pub(crate) fn of(file: &'a File<'a>) -> Option<ImportTypes<'a>> {
        let settings = file.settings();
        let folders = settings.get(b"import/external-module-folders");
        Some(ImportTypes {
            file,
            resolvers: Resolvers::of(settings)?,
            internal: (settings
                .get(b"import/internal-regex")
                .and_then(Json::as_str))
            .filter(|it| !it.is_empty())
            .and_then(|it| Regex::from_bytes(it, b"").ok()),
            core_modules: strings_of(settings.get(b"import/core-modules")),
            folders: match folders.and_then(Json::as_array) {
                Some(_) => strings_of(folders),
                None => vec![&b"node_modules"[..]],
            },
            package: OnceCell::new(),
        })
    }

    fn exists(&self, path: &[u8]) -> bool {
        self.file.modules().is_some_and(|it| it.exists(path))
    }

    fn package(&self) -> Option<&[u8]> {
        let found = self.package.get_or_init(|| {
            let file = path::portable(self.file.path(), self.file.path());
            let mut directories = std::iter::successors(parent_of(&file), |it| parent_of(it));
            let found = directories.find(|it| self.exists(&path::resolve(it, b"package.json")));
            found.map(<[u8]>::to_vec)
        });
        found.as_deref()
    }

    /// `isExternalPath`
    fn is_external_path(&self, found: &[u8], package: &[u8]) -> bool {
        let is_outside_package = !is_below(package, found);
        self.folders.iter().any(|folder| {
            if folder.starts_with(b"/") {
                return is_below(folder, found);
            }
            if is_below(&path::resolve(package, folder), found) {
                return true;
            }
            let end = folder
                .iter()
                .rev()
                .take_while(|it| matches!(it, b'/' | b'\\'))
                .count();
            let name = &folder[..folder.len() - end];
            is_outside_package && strings::contains(found, &[b"/", name, b"/"].concat())
        })
    }

    /// `isInExternalModuleFolder`: a package that is a link is found elsewhere.
    fn is_in_external_module_folder(&self, name: &[u8], package: &[u8]) -> bool {
        let Some(base) = base_module(name) else {
            return false;
        };
        self.folders.iter().any(|folder| {
            if folder.starts_with(b"/") {
                return self.exists(&path::resolve(folder, base));
            }
            let mut directories = std::iter::successors(Some(package), |it| parent_of(it));
            directories.any(|it| self.exists(&path::resolve(&path::resolve(it, folder), base)))
        })
    }

    /// `importType(name, context)`
    pub(crate) fn of_name(&self, name: &[u8], is_require: bool) -> ImportType {
        if self.internal.as_ref().is_some_and(|it| it.test(name)) {
            return ImportType::Internal;
        }
        if name.starts_with(b"/") {
            return ImportType::Absolute;
        }
        let relative = match name {
            b".." | [b'.', b'.', b'/' | b'\\', ..] => Some(ImportType::Parent),
            b"." | b"./" | b"./index" | b"./index.js" => Some(ImportType::Index),
            [b'.', b'/' | b'\\', ..] => Some(ImportType::Sibling),
            _ => None,
        };
        let is_core = base_module(name)
            .filter(|_| !name.is_empty())
            .is_some_and(|base| is_builtin_module(base) || self.core_modules.contains(&base));
        // Only here does it matter what the name is resolved to.
        if let Some(relative) = relative.filter(|_| !is_core) {
            return relative;
        }
        let Resolved::File(found) = self.resolvers.resolve(self.file, name, is_require) else {
            return match (is_core, relative) {
                (true, _) => ImportType::Builtin,
                (false, Some(relative)) => relative,
                (false, None) if is_external_looking_name(name) => ImportType::External,
                (false, None) => ImportType::Unknown,
            };
        };
        if let Some(relative) = relative {
            return relative;
        }
        // Without a `package.json` above the file the original throws.
        let Some(package) = self.package() else {
            return ImportType::Internal;
        };
        let is_external = self.is_external_path(&found, package)
            || is_external_looking_name(name) && self.is_in_external_module_folder(name, package);
        if is_external {
            ImportType::External
        } else {
            ImportType::Internal
        }
    }
}
