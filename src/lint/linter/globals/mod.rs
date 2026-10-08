//! The global variables that a file does not declare: what the version of ECMAScript, the
//! configuration, the libraries of TypeScript and `/* global */` comments define.
//!
//! | ESLint | here |
//! | --- | --- |
//! | `globalScope.set.get(name)`, if it has no `defs` | [`File::global`] |
//! | `variable.writeable` | [`GlobalVariable::is_writable`] |
//! | `variable.eslintImplicitGlobalSetting` | [`GlobalVariable::implicit_setting`] |
//! | `variable.eslintExplicitGlobal` | [`GlobalVariable::is_explicit`] |
//! | `variable.eslintExplicitGlobalComments` | [`GlobalVariable::comments`] |
//! | `variable.eslintExported` | [`GlobalVariable::is_exported`] |
//! | `variable instanceof ImplicitLibVariable` | [`GlobalVariable::is_in_lib`] |
//! | `variable.isTypeVariable`, `isValueVariable` | [`GlobalVariable::is_type`], [`GlobalVariable::is_value`] |
//! | the variables with `eslintExplicitGlobal` | [`File::globals_in_comments`] |
//! | `astUtils.getNameLocationInGlobalDirectiveComment` | [`File::name_in_global_comment`] |
//! | `require("globals").browser` | [`environment`]`(b"browser")` |

mod tables;

use super::space::{space_len, space_len_back};
use crate::ast::File;
use crate::language::{Global, LanguageOptions, Parser, SourceType};
use crate::span::Span;
use bun_core::strings;
use rustc_hash::{FxHashMap, FxHashSet};
use std::borrow::Cow;

const WRITABLE: u16 = 1;
const TYPE: u8 = 1;
const VALUE: u8 = 2;

fn name_at(id: usize) -> &'static [u8] {
    let start = id
        .checked_sub(1)
        .and_then(|it| tables::NAME_ENDS.get(it))
        .map_or(0, |it| *it as usize);
    let end = tables::NAME_ENDS.get(id).map_or(start, |it| *it as usize);
    tables::NAMES.get(start..end).unwrap_or_default()
}

/// The index of `name` in the pool.
fn id_of(name: &[u8]) -> Option<usize> {
    let (mut low, mut high) = (0, tables::NAME_ENDS.len());
    while low < high {
        let middle = low + (high - low) / 2;
        match name_at(middle).cmp(name) {
            std::cmp::Ordering::Equal => return Some(middle),
            std::cmp::Ordering::Less => low = middle + 1,
            std::cmp::Ordering::Greater => high = middle,
        }
    }
    None
}

fn entries(start: u16, len: u16) -> &'static [u16] {
    tables::ENTRIES
        .get(start as usize..start as usize + len as usize)
        .unwrap_or_default()
}

fn variables(start: u16, len: u16) -> impl Iterator<Item = (&'static [u8], Global)> {
    entries(start, len).iter().map(|entry| {
        let setting = if entry & WRITABLE != 0 {
            Global::Writable
        } else {
            Global::Readonly
        };
        (name_at((entry >> 2) as usize), setting)
    })
}

/// The variables of an environment of the `globals` package: `browser`, `node`, `es2021`, `jest`,
/// `shared-node-browser`, .. Sorted by name. `None` if there is no such environment.
pub fn environment(name: &[u8]) -> Option<impl Iterator<Item = (&'static [u8], Global)>> {
    let at = tables::ENVIRONMENTS
        .binary_search_by(|it| it.0.as_bytes().cmp(name))
        .ok()?;
    let (_, start, len) = tables::ENVIRONMENTS[at];
    Some(variables(start, len))
}

/// The names of all environments.
pub fn environments() -> impl Iterator<Item = &'static str> {
    tables::ENVIRONMENTS.iter().map(|it| it.0)
}

/// ESLint's `configGlobals` in the order of its keys: what each version of ECMAScript adds, what `sourceType: "commonjs"` defines,
/// `languageOptions.globals`. One that is there already keeps its place and gets the later setting. Those of
/// `languageOptions.globals` are in the order of their names, which is not kept from the configuration.
pub fn config_globals_in_order(language: &LanguageOptions) -> Vec<(Cow<'static, [u8]>, Global)> {
    let mut all: Vec<(Cow<'static, [u8]>, Global)> =
        Vec::with_capacity(80 + language.globals.len());
    // ESLint's lists are sorted without regard to case.
    let mut add = |start: u16, len: u16| {
        let from = all.len();
        all.extend(variables(start, len).map(|(name, setting)| (Cow::Borrowed(name), setting)));
        if let Some(added) = all.get_mut(from..) {
            let folded = |it: &(Cow<'static, [u8]>, Global)| it.0.to_ascii_lowercase();
            added.sort_by_cached_key(folded);
        }
    };
    let versions = tables::ECMA_VERSIONS.iter();
    if versions.clone().any(|it| it.0 == language.ecma_version) {
        for &(_, start, len) in versions.filter(|it| it.0 <= language.ecma_version) {
            add(start, len);
        }
    }
    if language.source_type == SourceType::CommonJs {
        add(tables::COMMONJS.0, tables::COMMONJS.1);
    }
    let defined = all.len();
    for (name, setting) in &language.globals {
        match all.iter_mut().take(defined).find(|it| *it.0 == **name) {
            Some(existing) => existing.1 = *setting,
            None => all.push((Cow::Owned(name.to_vec()), *setting)),
        }
    }
    all
}

/// What a configuration says about globals, computed once from its [`LanguageOptions`].
#[doc(hidden)]
#[derive(Clone, Debug, Default)]
pub struct ConfigGlobals {
    /// ESLint's `configGlobals`: what the version of ECMAScript and `sourceType: "commonjs"`
    /// define, overridden by `languageOptions.globals`. Sorted by name.
    settings: Vec<(Cow<'static, [u8]>, Global)>,
    /// For each name of the pool, two bits: whether the libraries of TypeScript define it as a
    /// type, as a value.
    libs: Box<[u8]>,
}

impl ConfigGlobals {
    pub(crate) fn new(language: &LanguageOptions) -> ConfigGlobals {
        let mut settings: Vec<(Cow<'static, [u8]>, Global)> =
            Vec::with_capacity(80 + language.globals.len());
        // ESLint has no table for a version that it does not know, and then defines nothing.
        if tables::ECMA_VERSIONS
            .iter()
            .any(|it| it.0 == language.ecma_version)
        {
            for &(_, start, len) in tables::ECMA_VERSIONS
                .iter()
                .filter(|it| it.0 <= language.ecma_version)
            {
                settings.extend(
                    variables(start, len).map(|(name, setting)| (Cow::Borrowed(name), setting)),
                );
            }
        }
        if language.source_type == SourceType::CommonJs {
            let (start, len) = tables::COMMONJS;
            settings.extend(
                variables(start, len).map(|(name, setting)| (Cow::Borrowed(name), setting)),
            );
        }
        settings.extend(
            language
                .globals
                .iter()
                .map(|(name, setting)| (Cow::Owned(name.to_vec()), *setting)),
        );
        // Of two with the same name, the later one counts.
        settings.reverse();
        settings.sort_by(|a, b| a.0.cmp(&b.0));
        settings.dedup_by(|a, b| a.0 == b.0);
        ConfigGlobals {
            settings,
            libs: Self::libs(language),
        }
    }

    /// `populateGlobalsFromLib` of typescript-eslint's scope manager.
    fn libs(language: &LanguageOptions) -> Box<[u8]> {
        let mut flags = vec![0u8; tables::NAME_ENDS.len().div_ceil(4)].into_boxed_slice();
        let find = |name: &[u8]| {
            tables::LIBS
                .binary_search_by(|it| it.0.as_bytes().cmp(name))
                .ok()
        };
        let mut included: Vec<usize> = match &language.lib {
            Some(libs) => libs.iter().filter_map(|lib| find(lib)).collect(),
            None => find(b"esnext").into_iter().collect(),
        };
        let mut is_included = vec![false; tables::LIBS.len()];
        included.retain(|&lib| !std::mem::replace(&mut is_included[lib], true));
        let mut next = 0;
        while let Some(&lib) = included.get(next) {
            next += 1;
            let (_, start, len, dependencies, count) = tables::LIBS[lib];
            let dependencies = dependencies as usize..dependencies as usize + count as usize;
            for &dependency in tables::LIB_DEPENDENCIES
                .get(dependencies)
                .unwrap_or_default()
            {
                if !std::mem::replace(&mut is_included[dependency as usize], true) {
                    included.push(dependency as usize);
                }
            }
            for entry in entries(start, len) {
                let (id, shift) = ((entry >> 2) as usize, (entry >> 2) % 4 * 2);
                flags[id / 4] |= ((entry & 3) as u8) << shift;
            }
        }
        flags
    }

    fn setting(&self, name: &[u8]) -> Option<Global> {
        let at = self
            .settings
            .binary_search_by(|it| (*it.0).cmp(name))
            .ok()?;
        Some(self.settings[at].1)
    }

    /// `TYPE`, `VALUE`, or 0 if no library defines `name`.
    fn lib(&self, name: &[u8]) -> u8 {
        // For `x as const`.
        if name == b"const" {
            return TYPE;
        }
        id_of(name).map_or(0, |id| (self.libs[id / 4] >> (id % 4 * 2)) & 3)
    }
}

impl LanguageOptions {
    /// ESLint's `configGlobals[name]`: what the configuration says about the global variable
    /// `name`, with what the version of ECMAScript and `sourceType: "commonjs"` define. Comments
    /// of a file can change it: see [`File::global`].
    pub fn configured_global(&self, name: &[u8]) -> Option<Global> {
        self.config_globals().setting(name)
    }

    /// What the libraries of TypeScript define, sorted by name: the name, whether it is a type, whether it is a value.
    pub fn lib_variables(&self) -> impl Iterator<Item = (&'static [u8], bool, bool)> + '_ {
        let libs = &self.config_globals().libs;
        (0..tables::NAME_ENDS.len()).filter_map(move |id| {
            let flags = (libs.get(id / 4)? >> (id % 4 * 2)) & 3;
            (flags != 0).then(|| (name_at(id), flags & TYPE != 0, flags & VALUE != 0))
        })
    }
}

/// A variable that `/* global */` comments of the file define, or turn off.
#[derive(Clone, Debug)]
pub struct CommentGlobal {
    pub name: Box<[u8]>,
    /// What the last comment says.
    pub setting: Global,
    /// The comments that name it, in order.
    pub comments: Vec<Span>,
}

/// What the comments of a file say about variables.
#[derive(Default, Debug)]
pub(crate) struct CommentVariables {
    /// In the order they are first named.
    pub(crate) globals: Vec<CommentGlobal>,
    /// Where each is in `globals`.
    pub(crate) global_by_name: FxHashMap<Box<[u8]>, u32>,
    /// The names in `/* exported */` comments.
    pub(crate) exported: Vec<Box<[u8]>>,
    pub(crate) is_exported: FxHashSet<Box<[u8]>>,
}

/// A variable of the global scope that the file does not declare.
#[derive(Copy, Clone, Debug)]
pub struct GlobalVariable<'f> {
    /// ESLint's `variable.writeable`.
    pub is_writable: bool,
    /// ESLint's `variable.eslintImplicitGlobalSetting`: what it is without the comments of the
    /// file. `None` if only a comment defines it.
    pub implicit_setting: Option<Global>,
    /// ESLint's `variable.eslintExplicitGlobalComments`: the `/* global */` comments that name it.
    pub comments: &'f [Span],
    /// typescript-eslint's `variable.isTypeVariable`.
    pub is_type: bool,
    /// typescript-eslint's `variable.isValueVariable`.
    pub is_value: bool,
    /// A library of TypeScript defines it, whatever else does: typescript-eslint's
    /// `variable instanceof ImplicitLibVariable`.
    pub is_in_lib: bool,
    /// Only a library of TypeScript defines it. Then a reference resolves to it only if it asks
    /// for what the variable is: a type, a value.
    pub is_only_in_lib: bool,
    /// ESLint's `variable.eslintExported`, with which `variable.eslintUsed` is set: an
    /// `/* exported */` comment names it.
    pub is_exported: bool,
}

impl GlobalVariable<'_> {
    /// ESLint's `variable.eslintExplicitGlobal`.
    #[inline]
    pub fn is_explicit(&self) -> bool {
        !self.comments.is_empty()
    }

    /// Whether a reference that is in a type (`is_type`), or not, resolves to it.
    #[inline]
    pub fn accepts(&self, is_type: bool) -> bool {
        !self.is_only_in_lib || if is_type { self.is_type } else { self.is_value }
    }
}

impl<'a> File<'a> {
    /// Whether ESLint would parse the file with `@typescript-eslint/parser`: it is configured, or
    /// no parser is and the file is TypeScript.
    pub fn uses_typescript_parser(&self) -> bool {
        match self.language().parser {
            Parser::TypeScript => true,
            Parser::Espree => !self.is_javascript(),
            Parser::Other => false,
        }
    }

    /// The variable `name` of the global scope, if something other than the code of the file
    /// defines it: the version of ECMAScript, `sourceType: "commonjs"`, `languageOptions.globals`,
    /// a `/* global */` comment, and with `@typescript-eslint/parser` the libraries of TypeScript.
    /// `None` if nothing does, or if it is `"off"`.
    ///
    /// If the file is a script that declares `name` at its top level, it is the same variable in
    /// ESLint.
    pub fn global(&'a self, name: &[u8]) -> Option<GlobalVariable<'a>> {
        let config = self.language().config_globals();
        let implicit = config.setting(name);
        let comment = self.global_in_comments(name);
        let lib = if self.uses_typescript_parser() {
            config.lib(name)
        } else {
            0
        };
        let is_exported = self.is_exported_in_comments(name);
        match comment.map(|it| it.setting).or(implicit) {
            None | Some(Global::Off) if lib == 0 => None,
            None | Some(Global::Off) => Some(GlobalVariable {
                is_writable: false,
                implicit_setting: Some(Global::Readonly),
                comments: &[],
                is_type: lib & TYPE != 0,
                is_value: lib & VALUE != 0,
                is_in_lib: true,
                is_only_in_lib: true,
                is_exported,
            }),
            Some(setting) => Some(GlobalVariable {
                is_writable: setting == Global::Writable,
                implicit_setting: implicit,
                comments: comment.map_or(&[], |it| &it.comments),
                is_type: lib == 0 || lib & TYPE != 0,
                is_value: lib == 0 || lib & VALUE != 0,
                is_in_lib: lib != 0,
                is_only_in_lib: false,
                is_exported,
            }),
        }
    }

    /// What ESLint's `addDeclaredGlobals` declares `name` as: [`File::global`] without the
    /// libraries of TypeScript. Never [`Global::Off`].
    pub fn declared_global(&'a self, name: &[u8]) -> Option<Global> {
        let global = self.global(name).filter(|it| !it.is_only_in_lib)?;
        Some(if global.is_writable {
            Global::Writable
        } else {
            Global::Readonly
        })
    }

    /// ESLint's `getNameLocationInGlobalDirectiveComment`: where `name` is in the `/* global */`
    /// comment at `comment`.
    pub fn name_in_global_comment(&self, comment: Span, name: &[u8]) -> Span {
        let value = self.slice(comment.shrink(2, 2));
        // `[\s,]name(?:$|[\s,:])`, from after the first "global".
        let floor = strings::index_of(value, b"global").map_or(5, |at| at + 6);
        let mut from = floor;
        while let Some(found) = value
            .get(from..)
            .and_then(|rest| strings::index_of(rest, name))
        {
            let at = from + found;
            from = at + 1;
            let (before, after) = (&value[..at], &value[at + name.len()..]);
            let separator = if before.ends_with(b",") {
                1
            } else {
                space_len_back(before)
            };
            let is_separated = separator > 0 && at - separator >= floor;
            if is_separated
                && (after.is_empty() || matches!(after[0], b',' | b':') || space_len(after) > 0)
            {
                let start = comment.start + 2 + at as u32;
                return Span::new(start, start + name.len() as u32);
            }
        }
        Span::new(comment.start + 2, comment.start + 3)
    }
}
