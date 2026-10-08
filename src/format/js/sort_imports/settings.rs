//! The options, as they are in a configuration file.

use super::ianvs::{self, Matcher};
use super::organize::{self, TypeOrder};
use super::trivago::{self, ByLength, Exclude, Group};
use super::{How, SortImports};
use bun_core::strings;
use bun_lint::linter::Glob;
use bun_lint::options::Json;
use bun_lint::regex::Regex;
use std::sync::Arc;

/// The options that are about imports, by name, with their values as they are written in JSON, a
/// string without its quotes.
///
/// | whose | options |
/// | --- | --- |
/// | both plugins | `plugins`, `importOrder`, `importOrderParserPlugins` |
/// | `@trivago/prettier-plugin-sort-imports` | `importOrderSeparation`, `importOrderSortSpecifiers`, `importOrderGroupNamespaceSpecifiers`, `importOrderCaseInsensitive`, `importOrderSideEffects`, `importOrderSortByLength`, `importOrderImportAttributesKeyword`, `importOrderExclude` |
/// | `@ianvs/prettier-plugin-sort-imports` | `importOrderTypeScriptVersion`, `importOrderCaseSensitive`, `importOrderSafeSideEffects` |
/// | `prettier-plugin-organize-imports` | `organizeImportsSkipDestructiveCodeActions`, `organizeImportsTypeOrder` |
/// | oxfmt | `sortImports`, which used to be `experimentalSortImports` |
#[derive(Debug, Default, Clone, PartialEq, Eq, Hash)]
pub struct Settings {
    entries: Vec<(Box<[u8]>, Box<[u8]>)>,
}

const OF_TRIVAGO: [&[u8]; 8] = [
    b"importOrderSeparation",
    b"importOrderSortSpecifiers",
    b"importOrderGroupNamespaceSpecifiers",
    b"importOrderCaseInsensitive",
    b"importOrderSideEffects",
    b"importOrderSortByLength",
    b"importOrderImportAttributesKeyword",
    b"importOrderExclude",
];

const OF_IANVS: [&[u8]; 3] = [b"importOrderTypeScriptVersion", b"importOrderCaseSensitive", b"importOrderSafeSideEffects"];

fn invalid(name: &[u8], value: &[u8]) -> Vec<u8> {
    [b"Invalid ", name, b" value: ", value, b"."].concat()
}

impl Settings {
    /// Takes the option `name` if it is about imports. A later value replaces an earlier one.
    pub fn set(&mut self, name: &[u8], value: &[u8]) -> bool {
        let is_known = matches!(name, b"plugins" | b"importOrder" | b"importOrderParserPlugins" | b"sortImports" | b"experimentalSortImports")
            || name.starts_with(b"organizeImports")
            || OF_TRIVAGO.contains(&name)
            || OF_IANVS.contains(&name);
        if is_known {
            self.entries.retain(|entry| &*entry.0 != name);
            self.entries.push((name.into(), value.into()));
        }
        is_known
    }

    fn get(&self, name: &[u8]) -> Option<&[u8]> {
        self.entries.iter().find(|entry| &*entry.0 == name).map(|entry| &*entry.1)
    }

    fn boolean(&self, name: &[u8], default: bool) -> Result<bool, Vec<u8>> {
        match self.get(name) {
            None => Ok(default),
            Some(b"true") => Ok(true),
            Some(b"false") => Ok(false),
            Some(value) => Err(invalid(name, value)),
        }
    }

    /// An array of strings. One string is an array of one.
    fn strings(&self, name: &[u8]) -> Result<Option<Vec<Vec<u8>>>, Vec<u8>> {
        let Some(value) = self.get(name) else {
            return Ok(None);
        };
        if !value.trim_ascii_start().starts_with(b"[") {
            return Ok(Some(vec![value.to_vec()]));
        }
        let Some(Json::Array(items)) = bun_lint::json::parse(value) else {
            return Err(invalid(name, value));
        };
        let strings: Option<Vec<Vec<u8>>> = items.iter().map(|item| item.as_str().map(<[u8]>::to_vec)).collect();
        strings.map(Some).ok_or_else(|| invalid(name, value))
    }

    /// Whether the behaviour is that of `@ianvs/prettier-plugin-sort-imports`, where it differs
    /// from `@trivago/prettier-plugin-sort-imports`, which it is a fork of. What says so, in this
    /// order: the plugin that is named, an option or a special word that only one of them has.
    /// Otherwise the more popular one it is.
    fn is_ianvs(&self, order: Option<&[Vec<u8>]>) -> bool {
        let plugins = self.get(b"plugins").unwrap_or_default();
        let names = |name: &[u8]| strings::contains(plugins, name);
        if names(b"@ianvs/prettier-plugin-sort-imports") || names(b"@trivago/prettier-plugin-sort-imports") {
            return names(b"@ianvs/prettier-plugin-sort-imports");
        }
        let has_any = |names: &[&[u8]]| self.entries.iter().any(|entry| names.contains(&&*entry.0));
        if has_any(&OF_IANVS) || has_any(&OF_TRIVAGO) {
            return has_any(&OF_IANVS);
        }
        order.unwrap_or_default().iter().any(|group| group.trim_ascii().is_empty() || strings::contains(group, b"<TYPES>"))
    }

    fn trivago(&self, order: Option<Vec<Vec<u8>>>) -> Result<trivago::Options, Vec<u8>> {
        let mut order = order.unwrap_or_default();
        if !order.iter().any(|group| group == trivago::THIRD_PARTY_MODULES) {
            order.insert(0, trivago::THIRD_PARTY_MODULES.to_vec());
        }
        let groups: Result<Vec<Group>, Vec<u8>> = (order.iter().enumerate())
            .map(|(index, text)| {
                Ok(Group {
                    regex: regex(text.strip_prefix(trivago::TYPES).unwrap_or(text))?,
                    same_as: order.iter().position(|other| other == text).unwrap_or(index),
                    text: text.clone().into_boxed_slice(),
                })
            })
            .collect();
        Ok(trivago::Options {
            order: groups?,
            is_case_insensitive: self.boolean(b"importOrderCaseInsensitive", false)?,
            separation: self.boolean(b"importOrderSeparation", false)?,
            group_namespace_specifiers: self.boolean(b"importOrderGroupNamespaceSpecifiers", false)?,
            sort_specifiers: self.boolean(b"importOrderSortSpecifiers", false)?,
            sort_by_length: match self.get(b"importOrderSortByLength") {
                None | Some(b"null") => None,
                Some(b"asc") => Some(ByLength::Ascending),
                Some(b"desc") => Some(ByLength::Descending),
                Some(value) => return Err(invalid(b"importOrderSortByLength", value)),
            },
            side_effects: self.boolean(b"importOrderSideEffects", true)?,
            attributes_keyword: match self.get(b"importOrderImportAttributesKeyword") {
                None | Some(b"with") => b"with",
                Some(b"assert") => b"assert",
                Some(b"with-legacy") => b"with-legacy",
                Some(value) => return Err(invalid(b"importOrderImportAttributesKeyword", value)),
            },
            exclude: (self.strings(b"importOrderExclude")?.unwrap_or_default().iter())
                .map(|pattern| Exclude {
                    glob: Glob::new(pattern),
                    has_slash: strings::contains_char(pattern, b'/'),
                })
                .collect(),
        })
    }

    /// `examineAndNormalizePluginOptions`. `None`: `importOrder` is empty, which turns the plugin off.
    fn ianvs(&self, order: Option<Vec<Vec<u8>>>) -> Result<Option<ianvs::Options>, Vec<u8>> {
        let is_separator = |group: &[u8]| group.trim_ascii().is_empty();
        let mut order = order.unwrap_or_else(|| vec![ianvs::BUILTIN_MODULES.to_vec(), ianvs::THIRD_PARTY_MODULES.to_vec(), b"^[.]".to_vec()]);
        if order.is_empty() {
            return Ok(None);
        }
        let at = usize::from(is_separator(&order[0]));
        for word in [ianvs::THIRD_PARTY_MODULES, ianvs::BUILTIN_MODULES] {
            if !order.iter().any(|group| group == word) {
                order.insert(at, word.to_vec());
            }
        }
        let groups: Result<Vec<ianvs::Group>, Vec<u8>> = (order.iter().enumerate())
            .map(|(index, text)| {
                Ok(ianvs::Group {
                    matcher: match &text[..] {
                        text if is_separator(text) => Matcher::Separator,
                        ianvs::THIRD_PARTY_MODULES => Matcher::ThirdParty,
                        ianvs::BUILTIN_MODULES => Matcher::Builtin,
                        ianvs::TYPES => Matcher::Types,
                        text => match strings::index_of(text, ianvs::TYPES) {
                            Some(at) => Matcher::Regex {
                                regex: regex(&[&text[..at], &text[at + ianvs::TYPES.len()..]].concat())?,
                                is_for_types: true,
                            },
                            None => Matcher::Regex {
                                regex: regex(text)?,
                                is_for_types: false,
                            },
                        },
                    },
                    same_as: order.iter().position(|other| other == text).unwrap_or(index),
                })
            })
            .collect();
        let has_types = order.iter().any(|group| strings::contains(group, ianvs::TYPES));
        let has_typescript = self.strings(b"importOrderParserPlugins")?.is_none_or(|plugins| plugins.iter().any(|it| it == b"typescript"));
        let version = self.get(b"importOrderTypeScriptVersion").and_then(semver).unwrap_or(((1, 0, 0), false));
        let safe_side_effects: Result<Vec<Regex>, Vec<u8>> =
            self.strings(b"importOrderSafeSideEffects")?.unwrap_or_default().iter().map(|it| regex(it)).collect();
        Ok(Some(ianvs::Options {
            order: groups?,
            combine_type_and_value_imports: !has_types && !(has_typescript && version < ((4, 5, 0), true)),
            is_case_sensitive: self.boolean(b"importOrderCaseSensitive", false)?,
            safe_side_effects: safe_side_effects?,
        }))
    }

    /// `None`: imports are left as they are. `Err`: what is wrong, for the user.
    pub fn compile(&self) -> Result<Option<Arc<SortImports>>, Vec<u8>> {
        if let Some(value) = self.get(b"sortImports").or_else(|| self.get(b"experimentalSortImports")) {
            return Ok(super::oxfmt::compile(value)?.map(|options| Arc::new(SortImports { how: How::Oxfmt(options) })));
        }
        let plugins = self.get(b"plugins").unwrap_or_default();
        let is_plugin_named = strings::contains(plugins, b"/prettier-plugin-sort-imports");
        if !is_plugin_named && !self.entries.iter().any(|entry| entry.0.starts_with(b"importOrder")) {
            let is_asked_for = strings::contains(plugins, b"prettier-plugin-organize-imports")
                || self.entries.iter().any(|entry| entry.0.starts_with(b"organizeImports"));
            if !is_asked_for {
                return Ok(None);
            }
            let options = organize::Options {
                skips_destructive_code_actions: self.boolean(b"organizeImportsSkipDestructiveCodeActions", false)?,
                type_order: match self.get(b"organizeImportsTypeOrder") {
                    None => None,
                    Some(b"last") => Some(TypeOrder::Last),
                    Some(b"first") => Some(TypeOrder::First),
                    Some(b"inline") => Some(TypeOrder::Inline),
                    Some(value) => return Err(invalid(b"organizeImportsTypeOrder", value)),
                },
            };
            return Ok(Some(Arc::new(SortImports { how: How::Organize(options) })));
        }
        let order = self.strings(b"importOrder")?;
        let how = match self.is_ianvs(order.as_deref()) {
            true => match self.ianvs(order)? {
                Some(options) => How::Ianvs(options),
                None => return Ok(None),
            },
            false => How::Trivago(self.trivago(order)?),
        };
        Ok(Some(Arc::new(SortImports { how })))
    }
}

/// `semver.valid(version)`: the three numbers, and whether it is a release and not a prerelease.
fn semver(version: &[u8]) -> Option<((u64, u64, u64), bool)> {
    let version = version.trim_ascii();
    let version = version.strip_prefix(b"=").unwrap_or(version);
    let version = version.strip_prefix(b"v").unwrap_or(version);
    let version = strings::split_once_char(version, b'+').map_or(version, |it| it.0);
    let (numbers, prerelease) = strings::split_once_char(version, b'-').map_or((version, None), |it| (it.0, Some(it.1)));
    if prerelease.is_some_and(<[u8]>::is_empty) {
        return None;
    }
    let mut parts = strings::split(numbers, b".").map(|part| {
        let is_number = !part.is_empty() && part.iter().all(u8::is_ascii_digit) && (part.len() == 1 || part[0] != b'0');
        std::str::from_utf8(part).ok().filter(|_| is_number)?.parse::<u64>().ok()
    });
    let numbers = (parts.next()??, parts.next()??, parts.next()??);
    parts.next().is_none().then_some((numbers, prerelease.is_none()))
}

/// `new RegExp(pattern)`
fn regex(pattern: &[u8]) -> Result<Regex, Vec<u8>> {
    Regex::from_bytes(pattern, b"").map_err(|error| format!("Invalid regular expression in importOrder: {error}").into_bytes())
}
