#![allow(dead_code)] // until every rule of the plugin is written
//! `settings["import/.."]` of eslint-plugin-import: `ignore.js` and `getParserPath` of
//! eslint-module-utils, and what `importType.js`, the `ExportMap` and a rule read of them.
//!
//! A value of a type that the original throws on says nothing here.

use bun_core::strings;
use bun_lint::language::Parser;
use bun_lint::paths;
use bun_lint::prelude::*;
use smallvec::SmallVec;
use std::cell::OnceCell;

/// What is JavaScript where `import/extensions` says nothing.
const EXTENSIONS: [&[u8]; 3] = [b".js", b".mjs", b".cjs"];

/// The settings of a file.
pub(crate) struct Settings<'s> {
    settings: &'s Json,
    /// `cachedSet`
    extensions: OnceCell<SmallVec<[&'s [u8]; 8]>>,
    /// `import/ignore`
    ignore: OnceCell<Vec<Regex>>,
    /// `import/internal-regex`
    internal_regex: OnceCell<Option<Regex>>,
}

/// A key of `availableDocStyleParsers`.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum DocStyle {
    Jsdoc,
    Tomdoc,
}

impl DocStyle {
    fn named(name: &[u8]) -> Option<DocStyle> {
        match name {
            b"jsdoc" => Some(DocStyle::Jsdoc),
            b"tomdoc" => Some(DocStyle::Tomdoc),
            _ => None,
        }
    }
}

/// `value || ..`: `None` for what is falsy.
fn truthy(value: Option<&Json>) -> Option<&Json> {
    value.filter(|it| match it {
        Json::Null | Json::Bool(false) => false,
        Json::Number(number) => *number != 0.0 && !number.is_nan(),
        Json::String(string) => !string.is_empty(),
        _ => true,
    })
}

fn strings_in(json: Option<&Json>) -> impl Iterator<Item = &[u8]> {
    let items = json.and_then(Json::as_array).unwrap_or_default();
    items.iter().filter_map(Json::as_str)
}

/// The strings of an array.
pub(crate) fn strings_of(json: Option<&Json>) -> Vec<&[u8]> {
    strings_in(json).collect()
}

/// The parser that `require(name)` gives: `name` is a package, or what `require.resolve` says.
fn parser_named(name: &[u8]) -> Parser {
    let path = paths::portable(name, name);
    let package = match strings::last_index_of(&path, b"/node_modules/") {
        Some(at) => path.get(at + b"/node_modules/".len()..).unwrap_or_default(),
        None => &path[..],
    };
    let is_in = |it: &[u8]| matches!(package.strip_prefix(it), Some([] | [b'/', ..]));
    if is_in(b"espree") {
        Parser::Espree
    } else if is_in(b"@typescript-eslint/parser") {
        Parser::TypeScript
    } else {
        Parser::Other
    }
}

impl<'s> Settings<'s> {
    pub(crate) fn new(settings: &'s Json) -> Settings<'s> {
        Settings {
            settings,
            extensions: OnceCell::new(),
            ignore: OnceCell::new(),
            internal_regex: OnceCell::new(),
        }
    }

    /// `makeValidExtensionSet`
    fn make_valid_extension_set(&self) -> SmallVec<[&'s [u8]; 8]> {
        let own = truthy(self.settings.get(b"import/extensions"));
        let mut exts: SmallVec<[&'s [u8]; 8]> = match own {
            Some(_) => SmallVec::new(),
            None => SmallVec::from_slice(&EXTENSIONS),
        };
        let parsers = self.settings.get(b"import/parsers");
        let parsers = parsers.and_then(Json::as_object).unwrap_or_default();
        let of_parsers = parsers.iter().flat_map(|it| strings_in(Some(&it.1)));
        for ext in strings_in(own).chain(of_parsers) {
            if !exts.contains(&ext) {
                exts.push(ext);
            }
        }
        exts
    }

    /// `validExtensions`
    fn valid_extensions(&self) -> &[&'s [u8]] {
        self.extensions
            .get_or_init(|| self.make_valid_extension_set())
    }

    /// `getFileExtensions`: in the order in which they are written, each once.
    pub(crate) fn file_extensions(&self) -> SmallVec<[&'s [u8]; 8]> {
        SmallVec::from_slice(self.valid_extensions())
    }

    /// `hasValidExtension`
    pub(crate) fn has_valid_extension(&self, path: &[u8]) -> bool {
        self.valid_extensions().contains(&paths::extname(path))
    }

    /// `ignore`
    pub(crate) fn is_ignored(&self, path: &[u8]) -> bool {
        if !self.has_valid_extension(path) {
            return true;
        }
        let ignore = self.ignore.get_or_init(|| {
            let ignore_strings = strings_in(self.settings.get(b"import/ignore"));
            ignore_strings
                .filter_map(|it| Regex::from_bytes(it, b"").ok())
                .collect()
        });
        ignore.iter().any(|regex| regex.test(path))
    }

    /// `extras.indexOf(name) > -1` in `isBuiltIn`
    pub(crate) fn is_core_module(&self, name: &[u8]) -> bool {
        strings_in(self.settings.get(b"import/core-modules")).any(|it| it == name)
    }

    /// `isInternalRegexMatch`
    pub(crate) fn is_internal_regex_match(&self, name: &[u8]) -> bool {
        let regex = self.internal_regex.get_or_init(|| {
            let internal_scope = truthy(self.settings.get(b"import/internal-regex"))?;
            Regex::from_bytes(internal_scope.as_str()?, b"").ok()
        });
        regex.as_ref().is_some_and(|it| it.test(name))
    }

    /// `folders` in `isExternalPath`
    pub(crate) fn external_module_folders(&self) -> SmallVec<[&'s [u8]; 2]> {
        match truthy(self.settings.get(b"import/external-module-folders")) {
            Some(folders) => strings_in(Some(folders)).collect(),
            None => SmallVec::from_slice(&[&b"node_modules"[..]]),
        }
    }

    /// The keys of `docStyleParsers`, in their order.
    pub(crate) fn docstyle(&self) -> SmallVec<[DocStyle; 2]> {
        let Some(docstyle) = truthy(self.settings.get(b"import/docstyle")) else {
            return SmallVec::from_slice(&[DocStyle::Jsdoc]);
        };
        let mut styles: SmallVec<[DocStyle; 2]> = SmallVec::new();
        // One that is not known throws when it is asked: those after it never are.
        let docstyle = docstyle.as_array().unwrap_or_default().iter();
        for style in docstyle.map_while(|it| DocStyle::named(it.as_str()?)) {
            if !styles.contains(&style) {
                styles.push(style);
            }
        }
        styles
    }

    /// `getParserPath`. `None`: the parser of the file that is linted.
    pub(crate) fn parser_for(&self, path: &[u8]) -> Option<Parser> {
        let parsers = self.settings.get(b"import/parsers")?.as_object()?;
        let extension = paths::extname(path);
        let mut parsers = parsers.iter();
        let lists_it = |extensions: &Json| strings_in(Some(extensions)).any(|it| it == extension);
        let (parser_path, _) = parsers.find(|entry| lists_it(&entry.1))?;
        Some(parser_named(parser_path))
    }

    /// `import/node-version`, whatever it is.
    pub(crate) fn node_version(&self) -> Option<&'s Json> {
        self.settings.get(b"import/node-version")
    }
}
