//! The global variables that a file doesn't declare: those defined by the ECMAScript version, the config, TypeScript's
//! libraries and `/* global */` comments.
//!
//! | ESLint | here |
//! | --- | --- |
//! | `globalScope.set.get(name)`, if it has no `defs` | [`File::global`] |
//! | `variable.writeable` | [`GlobalVariable::is_writable`] |
//! | `variable.eslintImplicitGlobalSetting` | [`GlobalVariable::implicit_setting`] |
//! | `variable.eslintExplicitGlobal` | `!variable.comments.is_empty()` |
//! | `variable.eslintExplicitGlobalComments` | [`GlobalVariable::comments`] |
//! | `variable.eslintExported` | [`GlobalVariable::is_exported`] |
//! | `variable instanceof ImplicitLibVariable` | [`GlobalVariable::is_in_lib`] |
//! | `variable.isTypeVariable`, `isValueVariable` | [`GlobalVariable::is_type`], [`GlobalVariable::is_value`] |
//! | the variables with `eslintExplicitGlobal` | [`File::globals_in_comments`] |
//! | `astUtils.getNameLocationInGlobalDirectiveComment` | [`File::name_in_global_comment`] |
//! | `require("globals").browser` | [`environment`]`(b"browser", Tables::Today)` |

mod inferred;
mod tables;

pub use inferred::{InferredGlobal, InferredGlobals, ProgramGlobals};

use crate::ast::File;
use crate::language::{Global, InferGlobals, LanguageOptions, Parser, SourceType};
use crate::span::Span;
use crate::utils::ast_utils::is_builtin_global_of_oxlint;
use bun_core::strings;
use rustc_hash::{FxHashMap, FxHashSet};
use std::borrow::Cow;

const WRITABLE: u16 = 1;
/// In a change to an environment: the name is removed from it.
const REMOVED: u16 = 2;
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

/// `name`'s index in the pool.
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

fn variable(entry: u16) -> (&'static [u8], Global) {
    let setting = if entry & WRITABLE != 0 {
        Global::Writable
    } else {
        Global::Readonly
    };
    (name_at((entry >> 2) as usize), setting)
}

fn variables(start: u16, len: u16) -> impl Iterator<Item = (&'static [u8], Global)> {
    entries(start, len).iter().copied().map(variable)
}

/// Whose environment tables to use.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Tables {
    /// The current `globals` package.
    Today,
    /// The tables that ESLint 8.57.1 ships with.
    Eslint8,
    /// The crate that oxlint is built with.
    Oxlint,
}

type Rows = &'static [(&'static str, u16, u16)];

impl Tables {
    /// The differences between its environments and `ENVIRONMENTS`.
    fn changes(self) -> Rows {
        match self {
            Tables::Today => &[],
            Tables::Eslint8 => tables::CHANGES_FOR_ESLINT_8,
            Tables::Oxlint => tables::CHANGES_FOR_OXLINT,
        }
    }
}

fn entries_of(rows: Rows, name: &[u8]) -> Option<&'static [u16]> {
    let at = rows.binary_search_by(|it| it.0.as_bytes().cmp(name)).ok()?;
    rows.get(at).map(|it| entries(it.1, it.2))
}

/// An environment's entries with the changes applied. Both lists are sorted by name.
struct Changed {
    entries: &'static [u16],
    changes: &'static [u16],
}

impl Iterator for Changed {
    type Item = u16;

    fn next(&mut self) -> Option<u16> {
        loop {
            let Some((&change, later)) = self.changes.split_first() else {
                let (&entry, rest) = self.entries.split_first()?;
                self.entries = rest;
                return Some(entry);
            };
            if let Some((&entry, rest)) = self.entries.split_first()
                && entry >> 2 <= change >> 2
            {
                self.entries = rest;
                if entry >> 2 < change >> 2 {
                    return Some(entry);
                }
            }
            self.changes = later;
            if change & REMOVED == 0 {
                return Some(change);
            }
        }
    }
}

/// An environment's variables: `browser`, `node`, `es2021`, `jest`, `shared-node-browser`, .. Sorted by name. `None` if
/// `env_tables` has no such environment.
pub fn environment(
    name: &[u8],
    env_tables: Tables,
) -> Option<impl Iterator<Item = (&'static [u8], Global)>> {
    let (known, changes) = (
        entries_of(tables::ENVIRONMENTS, name),
        entries_of(env_tables.changes(), name),
    );
    if known.is_none() && changes.is_none() {
        return None;
    }
    let (entries, changes) = (known.unwrap_or_default(), changes.unwrap_or_default());
    Some(Changed { entries, changes }.map(variable))
}

/// The ECMAScript version whose variables are defined. ESLint 8 defines those of ES5 and leaves the rest to `env`.
fn globals_ecma_version(language: &LanguageOptions) -> u32 {
    match language.eslint_8 {
        Some(_) => 5,
        None => language.ecma_version,
    }
}

/// ESLint's `configGlobals` in key order: what each ECMAScript version adds, what `sourceType: "commonjs"` defines,
/// then `languageOptions.globals`. An existing entry keeps its position and gets the later setting. The entries of
/// `languageOptions.globals` are sorted by name, because the config's order isn't kept.
pub fn config_globals_in_order(language: &LanguageOptions) -> Vec<(Cow<'static, [u8]>, Global)> {
    let mut all: Vec<(Cow<'static, [u8]>, Global)> =
        Vec::with_capacity(80 + language.globals.len());
    // ESLint's lists are sorted case-insensitively.
    let mut add = |start: u16, len: u16| {
        let from = all.len();
        all.extend(variables(start, len).map(|(name, setting)| (Cow::Borrowed(name), setting)));
        if let Some(added) = all.get_mut(from..) {
            let folded = |it: &(Cow<'static, [u8]>, Global)| it.0.to_ascii_lowercase();
            crate::utils::sort::sort_by_cached_key(added, folded);
        }
    };
    let versions = tables::ECMA_VERSIONS.iter();
    let edition = globals_ecma_version(language);
    if versions.clone().any(|it| it.0 == edition) {
        for &(_, start, len) in versions.filter(|it| it.0 <= edition) {
            add(start, len);
        }
    }
    if language.source_type == SourceType::CommonJs && language.eslint_8.is_none() {
        add(tables::COMMONJS.0, tables::COMMONJS.1);
    }
    let defined = all.len();
    for (name, setting) in language.globals.iter() {
        match all.iter_mut().take(defined).find(|it| *it.0 == **name) {
            Some(existing) => existing.1 = *setting,
            None => all.push((Cow::Owned(name.to_vec()), *setting)),
        }
    }
    all
}

/// A config's settings for globals, computed once from its [`LanguageOptions`].
#[doc(hidden)]
#[derive(Clone, Debug, Default)]
pub struct ConfigGlobals {
    /// ESLint's `configGlobals`: what the ECMAScript version and `sourceType: "commonjs"` define, overridden by
    /// `languageOptions.globals`. Sorted by name.
    settings: Vec<(Cow<'static, [u8]>, Global)>,
    /// With an oxlint config: what `settings` would have for a variable if `globals` didn't turn it off. Sorted by name.
    shadowed_by_off: Vec<(Cow<'static, [u8]>, Global)>,
    /// Two bits for each name in the pool: whether TypeScript's libraries define it as a type, and as a value.
    libs: Box<[u8]>,
    /// The names that the libraries define, in typescript-eslint's order.
    lib_order: Box<[u16]>,
}

impl ConfigGlobals {
    pub(crate) fn new(language: &LanguageOptions) -> ConfigGlobals {
        let mut settings: Vec<(Cow<'static, [u8]>, Global)> =
            Vec::with_capacity(80 + language.globals.len());
        // ESLint has no table for a version it doesn't know, and then defines nothing.
        let edition = globals_ecma_version(language);
        if tables::ECMA_VERSIONS.iter().any(|it| it.0 == edition) {
            for &(_, start, len) in tables::ECMA_VERSIONS.iter().filter(|it| it.0 <= edition) {
                settings.extend(
                    variables(start, len)
                        .filter(|it| !language.is_oxlint || is_builtin_global_of_oxlint(it.0))
                        .map(|(name, setting)| (Cow::Borrowed(name), setting)),
                );
            }
        }
        if language.source_type == SourceType::CommonJs && language.eslint_8.is_none() {
            let (start, len) = tables::COMMONJS;
            settings.extend(
                variables(start, len).map(|(name, setting)| (Cow::Borrowed(name), setting)),
            );
        }
        settings.extend(
            (language.shadowed_env_globals.iter().rev())
                .chain(language.globals.iter())
                .map(|(name, setting)| (Cow::Owned(name.to_vec()), *setting)),
        );
        // If two have the same name, the later one wins.
        settings.reverse();
        crate::utils::sort::sort_by(&mut settings, |a, b| a.0.cmp(&b.0));
        let mut shadowed_by_off: Vec<(Cow<'static, [u8]>, Global)> = Vec::new();
        settings.dedup_by(|dropped, kept| {
            let is_same = dropped.0 == kept.0;
            if is_same && language.is_oxlint && kept.1 == Global::Off {
                shadowed_by_off.push(dropped.clone());
            }
            is_same
        });
        shadowed_by_off.dedup_by(|a, b| a.0 == b.0);
        let (libs, lib_order) = Self::libs(language);
        ConfigGlobals {
            settings,
            shadowed_by_off,
            libs,
            lib_order,
        }
    }

    /// `populateGlobalsFromLib` in typescript-eslint's scope manager.
    fn libs(language: &LanguageOptions) -> (Box<[u8]>, Box<[u16]>) {
        let mut flags = vec![0u8; tables::NAME_ENDS.len().div_ceil(4)].into_boxed_slice();
        let mut order = Vec::new();
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
                if (flags[id / 4] >> shift) & 3 == 0 {
                    order.push(entry >> 2);
                }
                flags[id / 4] |= ((entry & 3) as u8) << shift;
            }
        }
        (flags, order.into())
    }

    fn setting(&self, name: &[u8]) -> Option<Global> {
        let at = self
            .settings
            .binary_search_by(|it| (*it.0).cmp(name))
            .ok()?;
        Some(self.settings[at].1)
    }

    /// oxlint's `env_contains_var(name)`, for a variable that `globals` turns off.
    fn shadowed_by_off(&self, name: &[u8]) -> Option<Global> {
        let at = self
            .shadowed_by_off
            .binary_search_by(|it| (*it.0).cmp(name))
            .ok()?;
        Some(self.shadowed_by_off[at].1)
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
    /// The number of names [`Self::lib_name`] knows.
    pub fn lib_name_count() -> usize {
        tables::NAME_ENDS.len()
    }

    /// The name with the number `id`. Empty if there is none.
    pub fn lib_name(id: usize) -> &'static [u8] {
        name_at(id)
    }

    /// The [`Self::lib_variable_entries`] entry for `name`.
    pub fn lib_variable_entry(&self, name: &[u8]) -> Option<u32> {
        let id = id_of(name)?;
        let flags = (self.config_globals().libs[id / 4] >> (id % 4 * 2)) & 3;
        (flags != 0).then_some((id as u32) << 2 | u32::from(flags))
    }

    /// [`Self::lib_variables`] as numbers: the name's number `<< 2`, plus 1 if it's a type and 2 if it's a value.
    pub fn lib_variable_entries(&self) -> impl Iterator<Item = u32> + '_ {
        let ConfigGlobals {
            libs, lib_order, ..
        } = self.config_globals();
        lib_order.iter().map(move |&id| {
            let flags = (libs[usize::from(id) / 4] >> (id % 4 * 2)) & 3;
            u32::from(id) << 2 | u32::from(flags)
        })
    }

    /// The variables that TypeScript's libraries define, in typescript-eslint's order: the name, whether it's a type,
    /// whether it's a value.
    pub fn lib_variables(&self) -> impl Iterator<Item = (&'static [u8], bool, bool)> + '_ {
        let ConfigGlobals {
            libs, lib_order, ..
        } = self.config_globals();
        lib_order.iter().map(move |&id| {
            let id = usize::from(id);
            let flags = (libs[id / 4] >> (id % 4 * 2)) & 3;
            (name_at(id), flags & TYPE != 0, flags & VALUE != 0)
        })
    }
}

/// A variable that the file's `/* global */` comments define or turn off.
#[derive(Clone, Debug)]
pub struct CommentGlobal {
    pub name: Box<[u8]>,
    /// The last comment's setting.
    pub setting: Global,
    /// The comments that list it, in order.
    pub comments: Vec<Span>,
}

/// The variable settings in a file's comments.
#[derive(Default, Debug)]
pub(crate) struct CommentVariables {
    /// In the order they're first listed.
    pub(crate) globals: Vec<CommentGlobal>,
    /// Each one's index in `globals`.
    pub(crate) global_by_name: FxHashMap<Box<[u8]>, u32>,
    /// The variables of the environments listed in `/* eslint-env */` comments.
    pub(crate) env_comment_globals: FxHashMap<Cow<'static, [u8]>, Global>,
    /// The names in `/* exported */` comments.
    pub(crate) exported: Vec<Box<[u8]>>,
    pub(crate) is_exported: FxHashSet<Box<[u8]>>,
}

/// A global-scope variable that the file doesn't declare.
#[derive(Copy, Clone, Debug)]
pub struct GlobalVariable<'f> {
    /// ESLint's `variable.writeable`.
    pub is_writable: bool,
    /// ESLint's `variable.eslintImplicitGlobalSetting`: its setting without the file's comments. `None` if only a
    /// comment defines it.
    pub implicit_setting: Option<Global>,
    /// ESLint's `variable.eslintExplicitGlobalComments`: the `/* global */` comments that list it.
    pub comments: &'f [Span],
    /// typescript-eslint's `variable.isTypeVariable`.
    pub is_type: bool,
    /// typescript-eslint's `variable.isValueVariable`.
    pub is_value: bool,
    /// A TypeScript library defines it, whether or not anything else does: typescript-eslint's
    /// `variable instanceof ImplicitLibVariable`.
    pub is_in_lib: bool,
    /// Only a TypeScript library defines it. A reference then only resolves to it if the reference's kind (type or
    /// value) matches the variable's.
    pub is_only_in_lib: bool,
    /// Only the types of the file's program define it: [`File::inferred_globals`]. References resolve as for
    /// `is_only_in_lib`.
    pub is_inferred: bool,
    /// ESLint's `variable.eslintExported`, which also sets `variable.eslintUsed`: an `/* exported */` comment lists it.
    pub is_exported: bool,
}

impl GlobalVariable<'_> {
    /// True if a reference resolves to it. `is_type` tells whether the reference is in a type.
    #[inline]
    pub fn accepts(&self, is_type: bool) -> bool {
        let checks_reference_kind = self.is_only_in_lib || self.is_inferred;
        !checks_reference_kind || if is_type { self.is_type } else { self.is_value }
    }
}

impl<'a> File<'a> {
    /// True if ESLint would parse the file with `@typescript-eslint/parser`: either it's configured, or no parser is
    /// configured and the file is TypeScript.
    pub fn uses_typescript_parser(&self) -> bool {
        match self.language().parser {
            Parser::TypeScript => true,
            Parser::Espree => !self.is_javascript(),
            Parser::Other => false,
        }
    }

    /// The global-scope variable `name`, if something other than the file's code defines it: the ECMAScript version,
    /// `sourceType: "commonjs"`, `languageOptions.globals`, a `/* global */` comment, and with
    /// `@typescript-eslint/parser` TypeScript's libraries. Where [globals are inferred](InferGlobals), the types of its
    /// program count too. `None` if nothing defines it, or if it's `"off"`.
    ///
    /// If the file is a script that declares `name` at its top level, ESLint treats both as the same variable.
    pub fn global(&'a self, name: &[u8]) -> Option<GlobalVariable<'a>> {
        let config = self.language().config_globals();
        // The program's libraries replace the tables.
        let only_own_globals = self.language().infers_globals != InferGlobals::Besides
            && (self.inferred_globals())
                .is_some_and(|it| it.checks_javascript || !self.is_javascript());
        // TypeScript knows these in JavaScript without a declaration.
        let is_commonjs_global = || {
            matches!(name, b"require" | b"module" | b"exports")
                && self.is_javascript()
                && !crate::utils::oxlint::has_module_syntax(self)
        };
        // In oxlint, "off" only cancels an entry of `globals`. What an `env` defines stays defined.
        let config_setting = match config.setting(name) {
            Some(Global::Off) => config.shadowed_by_off(name).or(Some(Global::Off)),
            setting => setting,
        };
        let implicit = config_setting
            .filter(|it| {
                !only_own_globals
                    || *it == Global::Off
                    || self.language().is_enabled_own_global(name)
                    || is_commonjs_global()
            })
            .or_else(|| self.global_of_environment_in_comments(name));
        let comment = self.global_in_comments(name);
        let lib = if self.uses_typescript_parser() {
            config.lib(name)
        } else {
            0
        };
        let is_exported = self.is_exported_in_comments(name);
        let setting = comment.map(|it| it.setting).or(implicit);
        if setting.is_none()
            && let Some(ProgramGlobals { names: all, .. }) = self.inferred_globals()
            && let Ok(at) = all.binary_search_by(|it| (*it.name).cmp(name))
        {
            let found = &all[at];
            return Some(GlobalVariable {
                is_writable: found.is_writable,
                implicit_setting: Some(match found.is_writable {
                    true => Global::Writable,
                    false => Global::Readonly,
                }),
                comments: &[],
                is_type: found.is_type,
                is_value: found.is_value,
                is_in_lib: false,
                is_only_in_lib: false,
                is_inferred: true,
                is_exported,
            });
        }
        match setting {
            None | Some(Global::Off) if lib == 0 => None,
            None | Some(Global::Off) => Some(GlobalVariable {
                is_writable: false,
                implicit_setting: Some(Global::Readonly),
                comments: &[],
                is_type: lib & TYPE != 0,
                // oxlint has no libraries, so `Temporal` isn't defined.
                is_value: lib & VALUE != 0 && !self.language().is_oxlint,
                is_in_lib: true,
                is_only_in_lib: true,
                is_inferred: false,
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
                is_inferred: false,
                is_exported,
            }),
        }
    }

    /// ESLint's `getNameLocationInGlobalDirectiveComment`: the span of `name` in the `/* global */` comment at
    /// `comment`.
    pub fn name_in_global_comment(&self, comment: Span, name: &[u8]) -> Span {
        let value = self.slice(comment.shrink(2, 2));
        // `[\s,]name(?:$|[\s,:])`, searched from after the first "global".
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
                strings::js_whitespace_len_back(before)
            };
            let is_separated = separator > 0 && at - separator >= floor;
            if is_separated
                && (after.is_empty()
                    || matches!(after[0], b',' | b':')
                    || strings::js_whitespace_len(after) > 0)
            {
                let start = comment.start + 2 + at as u32;
                return Span::new(start, start + name.len() as u32);
            }
        }
        Span::new(comment.start + 2, comment.start + 3)
    }
}
