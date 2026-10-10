//! The value of `sortImports`: oxfmt's `to_sort_imports`, `SortImportsOptions::validate` and
//! `GroupMatcher::new`.

use bun_lint::options::Json;

/// What kind of import it is, or where it is from. In the order of their priority.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(super) enum Selector {
    Type,
    SideEffectStyle,
    SideEffect,
    Style,
    Index,
    Sibling,
    Parent,
    Subpath,
    Internal,
    Builtin,
    External,
    Import,
}

impl Selector {
    fn parse(name: &[u8]) -> Option<Selector> {
        Some(match name {
            b"type" => Selector::Type,
            b"side_effect_style" => Selector::SideEffectStyle,
            b"side_effect" => Selector::SideEffect,
            b"style" => Selector::Style,
            b"index" => Selector::Index,
            b"sibling" => Selector::Sibling,
            b"parent" => Selector::Parent,
            b"subpath" => Selector::Subpath,
            b"internal" => Selector::Internal,
            b"builtin" => Selector::Builtin,
            b"external" => Selector::External,
            b"import" => Selector::Import,
            _ => return None,
        })
    }

    #[inline]
    pub(super) fn bit(self) -> u16 {
        1 << self as u16
    }
}

/// How an import is written. In the order of their priority.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(super) enum Modifier {
    SideEffect,
    Type,
    Value,
    Default,
    Wildcard,
    Named,
}

impl Modifier {
    fn parse(name: &[u8]) -> Option<Modifier> {
        Some(match name {
            b"side_effect" => Modifier::SideEffect,
            b"type" => Modifier::Type,
            b"value" => Modifier::Value,
            b"default" => Modifier::Default,
            b"wildcard" => Modifier::Wildcard,
            b"named" => Modifier::Named,
            _ => return None,
        })
    }

    #[inline]
    pub(super) fn bit(self) -> u8 {
        1 << self as u8
    }
}

fn bits(modifiers: &[Modifier]) -> u8 {
    modifiers
        .iter()
        .fold(0, |bits, modifier| bits | modifier.bit())
}

/// `type-external`: modifiers, sorted, and a selector.
#[derive(PartialEq, Eq, Debug)]
struct GroupName {
    selector: Selector,
    modifiers: Vec<Modifier>,
}

impl GroupName {
    fn parse(name: &[u8]) -> Option<GroupName> {
        let mut parts: Vec<&[u8]> = bun_core::strings::split(name, b"-").collect();
        let selector = Selector::parse(parts.pop()?)?;
        let mut modifiers = parts
            .into_iter()
            .map(Modifier::parse)
            .collect::<Option<Vec<Modifier>>>()?;
        crate::sort::sort(&mut modifiers[..]);
        modifiers.dedup();
        Some(GroupName {
            selector,
            modifiers,
        })
    }
}

/// An element of `customGroups` that `groups` has.
#[derive(Debug)]
struct CustomGroup {
    element_name_pattern: Vec<Vec<u8>>,
    selector: Option<Selector>,
    modifiers: u8,
    /// Where it is in `groups`.
    group: usize,
}

#[derive(Debug)]
pub(crate) struct Options {
    pub(super) partition_by_newline: bool,
    pub(super) partition_by_comment: bool,
    pub(super) sort_side_effects: bool,
    pub(super) is_descending: bool,
    pub(super) ignore_case: bool,
    pub(super) newlines_between: bool,
    pub(super) internal_pattern: Vec<Vec<u8>>,
    /// For each boundary between two groups, what a `{ "newlinesBetween": .. }` there says.
    /// Empty if there is none.
    pub(super) newline_boundary_overrides: Vec<Option<bool>>,
    custom_groups: Vec<CustomGroup>,
    /// By priority: a selector, modifiers, and where it is in `groups`.
    predefined_groups: Vec<(Selector, u8, usize)>,
    unknown_group: usize,
    /// A group takes all imports with side effects, so they are moved there even though they are
    /// not sorted.
    pub(super) regroups_side_effect: bool,
    pub(super) regroups_side_effect_style: bool,
}

/// `fast_glob::glob_match`: `bun_glob` is a port of the same `glob-match`.
fn glob_match(pattern: &[u8], source: &[u8]) -> bool {
    bun_glob::r#match(pattern, source).matches()
}

impl Options {
    /// `GroupMatcher::compute_group_index`
    pub(super) fn group_of(&self, source: &[u8], selectors: u16, modifiers: u8) -> usize {
        let custom = self.custom_groups.iter().find(|group| {
            (group.element_name_pattern.is_empty()
                || group
                    .element_name_pattern
                    .iter()
                    .any(|pattern| glob_match(pattern, source)))
                && group
                    .selector
                    .is_none_or(|selector| selectors & selector.bit() != 0)
                && group.modifiers & !modifiers == 0
        });
        if let Some(custom) = custom {
            return custom.group;
        }
        let predefined = self
            .predefined_groups
            .iter()
            .find(|group| selectors & group.0.bit() != 0 && group.1 & !modifiers == 0);
        predefined.map_or(self.unknown_group, |group| group.2)
    }
}

fn invalid(what: &str) -> Vec<u8> {
    format!("Invalid `sortImports` configuration: {what}").into_bytes()
}

fn boolean(config: &Json, name: &str, default: bool) -> Result<bool, Vec<u8>> {
    match config.get(name.as_bytes()) {
        None | Some(Json::Null) => Ok(default),
        Some(Json::Bool(value)) => Ok(*value),
        Some(_) => Err(invalid(&format!("`{name}` has to be a boolean"))),
    }
}

fn strings(value: &Json, name: &str) -> Result<Vec<Vec<u8>>, Vec<u8>> {
    let items = value
        .as_array()
        .ok_or_else(|| invalid(&format!("`{name}` has to be an array of strings")))?;
    items
        .iter()
        .map(|item| {
            item.as_str()
                .map(<[u8]>::to_vec)
                .ok_or_else(|| invalid(&format!("`{name}` has to be an array of strings")))
        })
        .collect()
}

fn shown(name: &[u8]) -> &bstr::BStr {
    bstr::BStr::new(name)
}

/// `value`: as it is written in JSON. `None`: imports are left as they are.
pub(crate) fn compile(value: &[u8]) -> Result<Option<Options>, Vec<u8>> {
    let config = match bun_lint::json::parse(value) {
        Some(Json::Bool(false)) => return Ok(None),
        Some(Json::Bool(true)) => Json::Object(Vec::new()),
        Some(config @ Json::Object(_)) => config,
        _ => return Err(invalid("it has to be a boolean or an object")),
    };
    let present = |name: &str| {
        config
            .get(name.as_bytes())
            .filter(|value| !matches!(value, Json::Null))
    };

    // The names in `groups`, and the markers between them.
    let mut groups: Vec<Vec<Vec<u8>>> = Vec::new();
    let mut newline_boundary_overrides: Vec<Option<bool>> = Vec::new();
    match present("groups") {
        None => {
            let default: [&[&str]; 6] = [
                &["builtin"],
                &["external"],
                &["internal", "subpath"],
                &["parent", "sibling", "index"],
                &["style"],
                &["unknown"],
            ];
            groups.extend(
                default
                    .iter()
                    .map(|group| group.iter().map(|name| name.as_bytes().to_vec()).collect()),
            );
        }
        Some(value) => {
            let items = value
                .as_array()
                .ok_or_else(|| invalid("`groups` has to be an array"))?;
            let is_marker = |item: &Json| matches!(item, Json::Object(_));
            if items.first().is_some_and(is_marker) {
                return Err(invalid(
                    "`{ \"newlinesBetween\" }` marker cannot appear at the start of `groups`",
                ));
            }
            if items.last().is_some_and(is_marker) {
                return Err(invalid(
                    "`{ \"newlinesBetween\" }` marker cannot appear at the end of `groups`",
                ));
            }
            if items
                .iter()
                .zip(items.iter().skip(1))
                .any(|pair| is_marker(pair.0) && is_marker(pair.1))
            {
                return Err(invalid(
                    "consecutive `{ \"newlinesBetween\" }` markers are not allowed in `groups`",
                ));
            }
            let mut pending_override = None;
            for item in items {
                let names = match item {
                    Json::Object(_) => {
                        let marker = item.get(b"newlinesBetween").and_then(Json::as_bool);
                        pending_override = Some(marker.ok_or_else(|| {
                            invalid(
                                "a marker in `groups` has to be `{ \"newlinesBetween\": boolean }`",
                            )
                        })?);
                        continue;
                    }
                    Json::String(name) => vec![name.clone()],
                    other => strings(other, "groups")?,
                };
                if !groups.is_empty() {
                    newline_boundary_overrides.push(pending_override.take());
                }
                groups.push(names);
            }
        }
    }

    struct Definition {
        name: Vec<u8>,
        element_name_pattern: Vec<Vec<u8>>,
        selector: Option<Selector>,
        modifiers: Vec<Modifier>,
    }
    let mut definitions: Vec<Definition> = Vec::new();
    for item in present("customGroups")
        .map(|value| {
            value
                .as_array()
                .ok_or_else(|| invalid("`customGroups` has to be an array"))
        })
        .transpose()?
        .unwrap_or_default()
    {
        let field = |name: &str| {
            item.get(name.as_bytes())
                .filter(|value| !matches!(value, Json::Null))
        };
        definitions.push(Definition {
            name: field("groupName")
                .and_then(Json::as_str)
                .unwrap_or_default()
                .to_vec(),
            element_name_pattern: field("elementNamePattern")
                .map(|value| strings(value, "elementNamePattern"))
                .transpose()?
                .unwrap_or_default(),
            selector: match field("selector") {
                None => None,
                Some(value) => Some(
                    value
                        .as_str()
                        .and_then(Selector::parse)
                        .ok_or_else(|| invalid("unknown `selector` in `customGroups`"))?,
                ),
            },
            modifiers: match field("modifiers") {
                None => Vec::new(),
                Some(value) => (strings(value, "modifiers")?.iter())
                    .map(|name| {
                        Modifier::parse(name)
                            .ok_or_else(|| invalid("unknown modifier in `customGroups`"))
                    })
                    .collect::<Result<_, _>>()?,
            },
        });
    }

    let partition_by_newline = boolean(&config, "partitionByNewline", false)?;
    let newlines_between = boolean(&config, "newlinesBetween", true)?;

    // `SortImportsOptions::validate`
    if partition_by_newline && newline_boundary_overrides.iter().any(Option::is_some) {
        return Err(invalid(
            "`partitionByNewline` and per-group `{ \"newlinesBetween\" }` markers cannot be used together",
        ));
    }
    if partition_by_newline && newlines_between {
        return Err(invalid(
            "`partitionByNewline: true` and `newlinesBetween: true` cannot be used together",
        ));
    }
    let is_predefined = |name: &[u8]| name == b"unknown" || GroupName::parse(name).is_some();
    for name in groups.iter().flatten().filter(|name| !is_predefined(name)) {
        if !definitions
            .iter()
            .any(|definition| definition.name == *name)
        {
            return Err(invalid(&format!(
                "unknown group name `{}` in `groups`",
                shown(name)
            )));
        }
    }
    if let Some(definition) = definitions
        .iter()
        .find(|definition| is_predefined(&definition.name))
    {
        return Err(invalid(&format!(
            "`customGroups` name `{}` conflicts with a predefined group name; predefined names and `unknown` cannot be used as `groupName`",
            shown(&definition.name)
        )));
    }

    // `GroupMatcher::new`
    let mut unknown_group = groups.len();
    let mut predefined: Vec<(GroupName, usize)> = Vec::new();
    for (index, name) in groups
        .iter()
        .enumerate()
        .flat_map(|(index, names)| names.iter().map(move |name| (index, name)))
    {
        match GroupName::parse(name) {
            _ if name == b"unknown" => unknown_group = index,
            Some(group) => predefined.push((group, index)),
            None => {}
        }
    }
    crate::sort::sort_by(&mut predefined[..], |a, b| {
        (a.0.selector.cmp(&b.0.selector))
            .then_with(|| b.0.modifiers.len().cmp(&a.0.modifiers.len()))
            .then_with(|| a.0.modifiers.cmp(&b.0.modifiers))
    });
    let custom_groups: Vec<CustomGroup> = definitions
        .into_iter()
        .filter_map(|definition| {
            Some(CustomGroup {
                group: groups
                    .iter()
                    .rposition(|names| names.contains(&definition.name))?,
                element_name_pattern: definition.element_name_pattern,
                selector: definition.selector,
                modifiers: bits(&definition.modifiers),
            })
        })
        .collect();
    let has_catch_all_group_for = |selector: Selector| {
        predefined
            .iter()
            .any(|group| group.0.selector == selector && group.0.modifiers.is_empty())
            || custom_groups.iter().any(|group| {
                group.selector == Some(selector)
                    && group.element_name_pattern.is_empty()
                    && group.modifiers == 0
            })
    };

    Ok(Some(Options {
        partition_by_newline,
        partition_by_comment: boolean(&config, "partitionByComment", false)?,
        sort_side_effects: boolean(&config, "sortSideEffects", false)?,
        is_descending: match present("order").map(|value| value.as_str()) {
            None | Some(Some(b"asc")) => false,
            Some(Some(b"desc")) => true,
            Some(_) => return Err(invalid("`order` has to be \"asc\" or \"desc\"")),
        },
        ignore_case: boolean(&config, "ignoreCase", true)?,
        newlines_between,
        internal_pattern: match present("internalPattern") {
            None => vec![b"~/".to_vec(), b"@/".to_vec(), b"#".to_vec()],
            Some(value) => strings(value, "internalPattern")?,
        },
        regroups_side_effect: has_catch_all_group_for(Selector::SideEffect),
        regroups_side_effect_style: has_catch_all_group_for(Selector::SideEffectStyle),
        newline_boundary_overrides,
        predefined_groups: predefined
            .into_iter()
            .map(|(group, index)| (group.selector, bits(&group.modifiers), index))
            .collect(),
        custom_groups,
        unknown_group,
    }))
}
