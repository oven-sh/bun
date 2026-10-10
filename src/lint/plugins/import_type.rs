#![allow(dead_code)] // until every rule of the plugin is written
//! `core/importType.js` of eslint-plugin-import: what kind of module a file means by a name.

use crate::import_package_path::file_package_path;
use crate::import_resolve::{Resolved, Resolvers};
use crate::import_settings::Settings;
use bun_core::strings;
use bun_lint::paths;
use bun_lint::prelude::*;
use bun_lint::utils::node::is_builtin_module;
use std::borrow::Cow;
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

/// `isScoped`: `/^@[^/]+\/?[^/]+/.test(name)`, which counts units of UTF-16.
pub(crate) fn is_scoped(name: &[u8]) -> bool {
    let Some(rest) = name.strip_prefix(b"@") else {
        return false;
    };
    let scope = strings::index_of_char_usize(rest, b'/').unwrap_or(rest.len());
    match strings::wtf8_len_utf16(&rest[..scope]) {
        0 => false,
        1 => rest.get(scope + 1).is_some_and(|it| *it != b'/'),
        _ => true,
    }
}

/// `baseModule`
fn base_module(name: &[u8]) -> Cow<'_, [u8]> {
    let slash = strings::index_of_char_usize(name, b'/');
    if is_scoped(name) {
        let Some(slash) = slash else {
            // `pkg` is `undefined`.
            return Cow::Owned([name, b"/undefined"].concat());
        };
        let rest = &name[slash + 1..];
        let pkg = strings::index_of_char_usize(rest, b'/').unwrap_or(rest.len());
        return Cow::Borrowed(&name[..slash + 1 + pkg]);
    }
    Cow::Borrowed(&name[..slash.unwrap_or(name.len())])
}

/// `isModule`: `/^\w/.test(name)`
fn is_module(name: &[u8]) -> bool {
    name.first()
        .is_some_and(|it| strings::is_regexp_word_byte(*it))
}

/// `isRelativeToParent`
fn is_relative_to_parent(name: &[u8]) -> bool {
    matches!(name, b".." | [b'.', b'.', b'\\' | b'/', ..])
}

/// `isIndex`
fn is_index(name: &[u8]) -> bool {
    matches!(name, b"." | b"./" | b"./index" | b"./index.js")
}

/// `isRelativeToSibling`
fn is_relative_to_sibling(name: &[u8]) -> bool {
    matches!(name, [b'.', b'\\' | b'/', ..])
}

/// `isExternalLookingName`
fn is_external_looking_name(name: &[u8]) -> bool {
    is_module(name) || is_scoped(name)
}

/// What is the same for all the names in a file.
pub(crate) struct ImportTypes<'a> {
    file: &'a File<'a>,
    resolvers: Resolvers<'a>,
    settings: Settings<'a>,
    /// `getContextPackagePath(context)`
    package_path: OnceCell<Option<Vec<u8>>>,
}

impl<'a> ImportTypes<'a> {
    /// `None`: as [`Resolvers::of`].
    pub(crate) fn of(file: &'a File<'a>) -> Option<ImportTypes<'a>> {
        Some(ImportTypes {
            file,
            resolvers: Resolvers::of(file.settings())?,
            settings: Settings::new(file.settings()),
            package_path: OnceCell::new(),
        })
    }

    pub(crate) fn resolvers(&self) -> &Resolvers<'a> {
        &self.resolvers
    }

    /// `isBuiltIn(name, settings, path)`. `None`: it is called without a path.
    pub(crate) fn is_built_in(&self, name: &[u8], path: Option<&Resolved>) -> bool {
        if path.is_some_and(|it| it.file().is_some()) || name.is_empty() {
            return false;
        }
        let base = base_module(name);
        is_builtin_module(&base) || self.settings.is_core_module(&base)
    }

    /// Where the closest `package.json` is. `None`: there is none, and upstream throws.
    fn package_path(&self) -> Option<&[u8]> {
        let found = self
            .package_path
            .get_or_init(|| file_package_path(self.file.modules()?, self.file.path()));
        found.as_deref()
    }

    /// `path.resolve(path)`, which is what `path.relative` begins with.
    fn absolute<'p>(&self, path: &'p [u8]) -> Cow<'p, [u8]> {
        match self.file.modules() {
            Some(modules) if !paths::is_absolute(path) => {
                Cow::Owned(paths::resolve(modules.cwd(), path))
            }
            _ => Cow::Borrowed(path),
        }
    }

    /// `isExternalPath`
    fn is_external_path(&self, path: Option<&[u8]>) -> bool {
        let Some(path) = path else {
            return false;
        };
        let Some(package_path) = self.package_path() else {
            return false;
        };
        if paths::relative(package_path, path).starts_with(b"..") {
            return true;
        }
        let folders = self.settings.external_module_folders();
        folders.iter().any(|folder| {
            let folder_path = paths::resolve(package_path, folder);
            let relative_path = paths::relative(&folder_path, path);
            !relative_path.starts_with(b"..")
        })
    }

    /// `isInternalPath`
    fn is_internal_path(&self, path: Option<&[u8]>) -> bool {
        let Some(path) = path else {
            return false;
        };
        let Some(package_path) = self.package_path() else {
            return true;
        };
        !paths::relative(package_path, path).starts_with(b"../")
    }

    /// `typeTest`. `path` is only asked for where it decides: to resolve a name costs the most.
    fn type_test<'p>(&self, name: &[u8], path: &dyn Fn() -> &'p Resolved) -> ImportType {
        if self.settings.is_internal_regex_match(name) {
            return ImportType::Internal;
        }
        if paths::is_absolute(name) {
            return ImportType::Absolute;
        }
        if self.is_built_in(name, None) && path().file().is_none() {
            return ImportType::Builtin;
        }
        if is_relative_to_parent(name) {
            return ImportType::Parent;
        }
        if is_index(name) {
            return ImportType::Index;
        }
        if is_relative_to_sibling(name) {
            return ImportType::Sibling;
        }
        let path = path().file().map(|it| self.absolute(it));
        if self.is_external_path(path.as_deref()) {
            return ImportType::External;
        }
        if self.is_internal_path(path.as_deref()) {
            return ImportType::Internal;
        }
        if is_external_looking_name(name) {
            return ImportType::External;
        }
        ImportType::Unknown
    }

    /// `typeTest(name, context, path)`
    pub(crate) fn of_resolved(&self, name: &[u8], path: &Resolved) -> ImportType {
        self.type_test(name, &|| path)
    }

    /// `isExternalModule(name, path, context)`
    pub(crate) fn is_external_module(&self, name: &[u8], path: &Resolved) -> bool {
        (is_module(name) || is_scoped(name)) && self.of_resolved(name, path) == ImportType::External
    }

    /// `importType(name, context)`
    pub(crate) fn of_name(&self, name: &[u8], is_require: bool) -> ImportType {
        let path = OnceCell::new();
        self.type_test(name, &|| {
            path.get_or_init(|| self.resolvers.resolve(self.file, name, is_require))
        })
    }
}
