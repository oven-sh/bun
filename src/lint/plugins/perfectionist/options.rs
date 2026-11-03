//! `types/all-common-options.ts`, `utils/complete.ts`, `utils/get-settings.ts`, `utils/matches.ts`, the
//! `validate-*.ts`. A [`Pattern`] that does not compile keeps the error until a node needs it, as `matches()` throws.

use super::FileState;
use super::configuration_if::{ConfigurationIf, ObjectType, ScopedPatterns};
use super::groups::GroupId;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::selector::Selector;
use rustc_hash::FxHashMap;
use std::sync::{Arc, OnceLock};

/// Which rule's `defaultOptions`, selectors, modifiers and schema apply. `sort-interfaces` is `ObjectTypes`, as
/// upstream.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum RuleKind {
    Objects,
    ObjectTypes,
    UnionTypes,
}

impl RuleKind {
    /// Upstream's `allSelectors`.
    fn selectors(self) -> &'static [&'static str] {
        match self {
            RuleKind::Objects => &["member", "method", "property"],
            RuleKind::ObjectTypes => &["index-signature", "member", "method", "property"],
            RuleKind::UnionTypes => &[
                "intersection",
                "conditional",
                "function",
                "operator",
                "keyword",
                "literal",
                "nullish",
                "import",
                "object",
                "named",
                "tuple",
                "union",
            ],
        }
    }

    /// Upstream's `allModifiers`.
    fn modifiers(self) -> &'static [&'static str] {
        match self {
            RuleKind::Objects => &["multiline"],
            RuleKind::ObjectTypes => &["optional", "required", "multiline"],
            RuleKind::UnionTypes => &[],
        }
    }

    /// The object rules have `sortBy`, in the main options and in `fallbackSort` (`additionalSortOptionsJsonSchema`).
    fn has_sort_by(self) -> bool {
        self != RuleKind::UnionTypes
    }

    /// `defaultOptions.fallbackSort`: `{ type: 'unsorted', sortBy: 'name' }` for `sort-object-types` and
    /// `sort-interfaces`, `{ type: 'unsorted' }` for the others.
    fn default_fallback_sort(self) -> FallbackSort {
        FallbackSort {
            type_: SortType::Unsorted,
            order: None,
            sort_by: (self == RuleKind::ObjectTypes).then_some(SortBy::Name),
        }
    }
}

/// `type`
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum SortType {
    Alphabetical,
    Natural,
    LineLength,
    Custom,
    Unsorted,
    SubgroupOrder,
}

/// `order`
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Order {
    Asc,
    Desc,
}

/// `specialCharacters`
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum SpecialCharacters {
    Remove,
    Trim,
    Keep,
}

/// `sortBy` of the object rules. `sort-union-types` has no such option and always compares names.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum SortBy {
    Name,
    Value,
}

/// `fallbackSort`: `type` is required, the rest overrides the main options only where given.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct FallbackSort {
    pub(crate) type_: SortType,
    pub(crate) order: Option<Order>,
    pub(crate) sort_by: Option<SortBy>,
}

/// The options that decide how two nodes compare: `CommonOptions` without `alphabet`, plus `sortBy`.
/// `Copy`, because settings, groups and custom groups each produce an overridden copy per group index.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct SortOptions {
    pub(crate) type_: SortType,
    pub(crate) order: Order,
    pub(crate) ignore_case: bool,
    pub(crate) special_characters: SpecialCharacters,
    pub(crate) fallback_sort: FallbackSort,
    pub(crate) sort_by: SortBy,
    /// `locales`, which no group overrides.
    pub(crate) locale: Locale,
}

impl SortOptions {
    /// Whether a comparison under these options reads a node's `size`: `type: "line-length"`, or that as the
    /// fallback. Where it does not, a caller that builds nodes only to compare them need not measure the text.
    pub(crate) fn reads_size(self) -> bool {
        self.type_ == SortType::LineLength || self.fallback_sort.type_ == SortType::LineLength
    }
}

/// `locales`, as `a.localeCompare(b, locales)` and natural-orderby's `compare({ locale })` read it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Locale {
    /// The root collation: the default `'en-US'`, or a list with no supported tag.
    Root,
    Collator(strings::Collator),
    /// A tag that is not well-formed: `localeCompare` throws [`Configuration::invalid_locale`] only when a comparison
    /// reaches it, so the rule throws after sorting.
    Invalid,
}

/// `alphabet` for `type: "custom"` (`compare-by-custom-sort.ts`). Values are compared UTF-16 unit by unit, so a code
/// point outside the BMP in the alphabet never matches.
#[derive(Default, Debug)]
pub(crate) struct Alphabet {
    pub(crate) index_of: FxHashMap<u32, u32>,
}

/// `newlinesBetween` and `newlinesInside`. `f64` because upstream compares and loops on the number as is: `1.5` is
/// not `1` or `2`.
#[derive(Clone, Copy, PartialEq, Debug)]
pub(crate) enum Newlines {
    Ignore,
    Count(f64),
}

/// `newlinesInside` at the top level: `'newlinesBetween'` (0 when `newlinesBetween` is a number, else `'ignore'`),
/// or a value of its own.
#[derive(Clone, Copy, PartialEq, Debug)]
pub(crate) enum NewlinesInside {
    FollowsNewlinesBetween,
    Fixed(Newlines),
}

/// One `RegexOption` (`types/common-options.ts`). Truthiness decides whether it is set: `""` is `None`, `[]` is
/// `Some` of an empty list, which never matches.
#[derive(Debug)]
pub(crate) struct Patterns(pub(crate) Vec<Pattern>);

/// A regex of a [`Patterns`]. `Invalid` keeps the `SyntaxError` message of `new RegExp`, thrown with `cx.throw` at
/// the first node that tests it.
#[derive(Debug)]
pub(crate) enum Pattern {
    Valid(Regex),
    Invalid(String),
}

impl Patterns {
    /// `matches(value, regexOption)`: the first pattern that matches ends it, so one that `new RegExp` rejects is
    /// only the `Err` when none before it matched.
    pub(crate) fn first_match(&self, value: &[u8]) -> Result<bool, &str> {
        for pattern in &self.0 {
            match pattern {
                Pattern::Valid(regex) if regex.test(value) => return Ok(true),
                Pattern::Valid(_) => {}
                Pattern::Invalid(message) => return Err(message),
            }
        }
        Ok(false)
    }

    pub(crate) fn has_invalid(&self) -> bool {
        self.0.iter().any(|it| matches!(it, Pattern::Invalid(_)))
    }
}

/// `partitionByComment` (`types/common-partition-options.ts`), as `is-partition-comment.ts` reads it.
#[derive(Debug)]
pub(crate) enum PartitionByComment {
    /// `false` or `""`: falsy, nothing partitions.
    Off,
    /// `true`, a regex option, or an object without `block` and `line` (`{}`, or a top-level `{pattern, flags}`,
    /// which upstream never matches): the same matcher for block and line comments.
    Any(CommentMatcher),
    /// `{ block?, line? }`: a missing key never matches that kind of comment.
    ByKind {
        block: CommentMatcher,
        line: CommentMatcher,
    },
}

/// What a comment's trimmed value has to satisfy to partition.
#[derive(Debug)]
pub(crate) enum CommentMatcher {
    /// `false`, or a missing `block` / `line`, or an object that is not a regex option.
    Never,
    /// `true`
    Always,
    Patterns(Patterns),
}

/// `"a"` or `["a", "b"]` of a `groups` entry. The distinction matters: `computeGroupName` gives an array no name, so
/// a custom group's overrides never apply to one, and `type: "subgroup-order"` only orders within an array.
#[derive(Debug)]
pub(crate) enum GroupNames {
    One(GroupId),
    Many(Box<[GroupId]>),
}

/// A `groups` entry (`GroupsOptions` in `types/common-groups-options.ts`).
#[derive(Debug)]
pub(crate) enum GroupEntry {
    Names(GroupNames),
    /// `{ group, type?, order?, fallbackSort?, sortBy?, newlinesInside? }` (`GroupWithOverridesOption`).
    /// `commentAbove` is not read: none of the four rules has a `missedCommentAbove` message.
    Overrides(GroupOverrides),
    /// `{ newlinesBetween }` between two groups.
    NewlinesBetween(Newlines),
}

/// The overrides of a `{ group, .. }` entry: each `Some` replaces the main option for the nodes of that group.
#[derive(Debug)]
pub(crate) struct GroupOverrides {
    pub(crate) names: GroupNames,
    pub(crate) type_: Option<SortType>,
    pub(crate) order: Option<Order>,
    pub(crate) fallback_sort: Option<FallbackSort>,
    pub(crate) sort_by: Option<SortBy>,
    pub(crate) newlines_inside: Option<Newlines>,
}

/// A `customGroups` entry. Custom groups are tried in order before the predefined groups, and only one whose name
/// is in `groups` can match (`compute-group.ts`).
#[derive(Debug)]
pub(crate) struct CustomGroup {
    pub(crate) name: GroupId,
    pub(crate) matcher: CustomGroupMatcher,
    pub(crate) type_: Option<SortType>,
    pub(crate) order: Option<Order>,
    pub(crate) fallback_sort: Option<FallbackSort>,
    pub(crate) sort_by: Option<SortBy>,
    pub(crate) newlines_inside: Option<Newlines>,
}

/// `anyOf: [..]` matches if any element does; otherwise the group's own `selector`, `modifiers`,
/// `elementNamePattern` and `elementValuePattern` all have to (`does-custom-group-match.ts`).
#[derive(Debug)]
pub(crate) enum CustomGroupMatcher {
    AnyOf(Vec<CustomGroupMatch>),
    Single(CustomGroupMatch),
}

/// The conditions of one custom group, every one optional. Selector and modifier names are compared as text with
/// the `&'static str` selectors and modifiers a rule gives its nodes.
#[derive(Debug, Default)]
pub(crate) struct CustomGroupMatch {
    pub(crate) selector: Option<Box<str>>,
    pub(crate) modifiers: Vec<Box<str>>,
    pub(crate) element_name_pattern: Option<Patterns>,
    pub(crate) element_value_pattern: Option<Patterns>,
}

/// What `complete()` returns for one element of the options array, for the keys all four rules share. A rule keeps
/// its own options in a parallel struct.
pub(crate) struct Configuration {
    pub(crate) sort: SortOptions,
    pub(crate) alphabet: Alphabet,
    pub(crate) partition_by_comment: PartitionByComment,
    pub(crate) partition_by_new_line: bool,
    pub(crate) newlines_between: Newlines,
    pub(crate) newlines_inside: NewlinesInside,
    pub(crate) groups: Vec<GroupEntry>,
    pub(crate) custom_groups: Vec<CustomGroup>,
    pub(crate) use_configuration_if: ConfigurationIf,
    /// Indexed by [`GroupId`]: `computeGroupsNames` in order, then the custom group names not in `groups`, then
    /// `"unknown"` if it was not in `groups`.
    pub(crate) group_names: Vec<Box<[u8]>>,
    /// For each [`GroupId`], `getGroupIndex`: the index of the `groups` entry that names it, or `groups.len()`.
    pub(crate) groups_index: Vec<u32>,
    /// The [`GroupId`] of `"unknown"`.
    pub(crate) unknown: GroupId,
    /// The first error of `validateSettingsValues`, `validateCustomSortConfig`, `validateGroupsConfig` and
    /// `validateNewlinesAndPartitionConfig`, thrown by [`FileState::pick`] at the first node that picks this slot.
    pub(crate) error: Option<Vec<u8>>,
    /// The message of the `RangeError` that `localeCompare` throws for a `locales` tag that is not well-formed,
    /// `Invalid language tag: <tag>`. `Some` exactly when [`SortOptions::locale`] is [`Locale::Invalid`].
    pub(crate) invalid_locale: Option<Vec<u8>>,
}

/// A rule's options: every element of the options array as a [`Configuration`], and the array itself, to complete
/// it again under a file's `settings.perfectionist`. Built once in `Rule::new`, shared by all threads.
pub(crate) struct RuleOptions {
    pub(crate) rule: RuleKind,
    /// `context.options`, parsed again as `{..settings, ..element}` for a file with `settings.perfectionist`.
    raw: Vec<Json>,
    /// One per element of `raw`, then the defaults alone, for when `context.options.find(..)` finds nothing. A rule's
    /// own options follow the same layout.
    pub(crate) configurations: Vec<Configuration>,
    /// The `settings.perfectionist` of the first file that had one, with [`RuleOptions::configurations_with`] of it.
    /// Every file of a resolved config shares the settings, so it is computed once.
    with_settings: OnceLock<(Json, WithSettings)>,
}

/// [`RuleOptions::configurations`] completed under a file's settings, or the error of `getSettings`.
type WithSettings = Result<Option<Arc<[Configuration]>>, Vec<u8>>;

impl RuleOptions {
    /// Every element of `options` as a [`Configuration`] over the rule's `defaultOptions`, then the defaults alone.
    pub(crate) fn new(options: &Options, rule: RuleKind) -> RuleOptions {
        let raw: Vec<Json> = options.all().to_vec();
        let configurations = elements(&raw)
            .map(|element| Configuration::complete(rule, Object::of(element), Object::default()))
            .collect();
        RuleOptions {
            rule,
            raw,
            configurations,
            with_settings: OnceLock::new(),
        }
    }

    /// What `create` throws for the options alone: an `esquery` error for `matchesAstSelector`. The rest is
    /// [`Configuration::error`], validated under the file's settings.
    pub(crate) fn validate(options: &Options) -> Result<(), Vec<u8>> {
        for element in options.all() {
            let object = Object::of(Some(element));
            if let Some(source) = selector_source(object.object("useConfigurationIf")) {
                Selector::parse(source.as_bytes()).map_err(|error| error.message().to_vec())?;
            }
        }
        Ok(())
    }

    /// `getSettings(context.settings)` and `complete()` of every element under the settings.
    pub(crate) fn file_state(&self, settings: &Json) -> FileState {
        let Some(value) = settings.get(b"perfectionist") else {
            return FileState::default();
        };
        let (known, cached) = self
            .with_settings
            .get_or_init(|| (value.clone(), self.configurations_with(value)));
        let with_settings = match known == value {
            true => cached.clone(),
            false => self.configurations_with(value),
        };
        let (with_settings, settings_error) = match with_settings {
            Ok(with_settings) => (with_settings, None),
            Err(error) => (None, Some(error)),
        };
        FileState {
            with_settings,
            settings_error,
            ..FileState::default()
        }
    }

    /// `{..defaults, ..settings, ..element}` for every element and for the defaults alone. `None` when the settings
    /// have nothing to merge.
    fn configurations_with(&self, value: &Json) -> WithSettings {
        let settings = settings_of(value)?;
        if settings.entries().is_empty() {
            return Ok(None);
        }
        let configurations = elements(&self.raw)
            .map(|element| Configuration::complete(self.rule, Object::of(element), settings))
            .collect();
        Ok(Some(configurations))
    }
}

/// The elements of the options array, then `None` for the defaults alone: the layout of
/// [`RuleOptions::configurations`].
fn elements(raw: &[Json]) -> impl Iterator<Item = Option<&Json>> {
    raw.iter().map(Some).chain(std::iter::once(None))
}

/// `matchesAstSelector` of a `useConfigurationIf` object, if it is set. `""` is not: it passes
/// `passesAstSelectorFilter` without a listener.
fn selector_source(use_configuration_if: Object<'_>) -> Option<&str> {
    use_configuration_if
        .str("matchesAstSelector")
        .filter(|source| !source.is_empty())
}

/// `rules/sort-objects/types.ts`, in the layout of [`RuleOptions::configurations`]. `getSettings` rejects these keys,
/// so one parse serves every file.
#[derive(Debug)]
pub(crate) struct SortObjectsOptions {
    pub(crate) styled_components: bool,
    pub(crate) partition_by_computed_key: bool,
    pub(crate) use_experimental_dependency_detection: bool,
    pub(crate) ignore_callback_dependencies_patterns: Patterns,
}

impl SortObjectsOptions {
    pub(crate) fn parse_all(options: &Options) -> Vec<SortObjectsOptions> {
        elements(options.all())
            .map(|element| SortObjectsOptions::parse(Object::of(element)))
            .collect()
    }

    fn parse(element: Object<'_>) -> SortObjectsOptions {
        SortObjectsOptions {
            styled_components: element.bool_or("styledComponents", true),
            partition_by_computed_key: element.bool_or("partitionByComputedKey", false),
            use_experimental_dependency_detection: element
                .bool_or("useExperimentalDependencyDetection", true),
            ignore_callback_dependencies_patterns: element
                .get("ignoreCallbackDependenciesPatterns")
                .map_or_else(|| Patterns(Vec::new()), patterns_of),
        }
    }
}

/// `{..defaults, ..settings, ..options}`: a key comes from the first of the three that has it.
#[derive(Clone, Copy)]
struct Merged<'o> {
    options: Object<'o>,
    settings: Object<'o>,
}

impl<'o> Merged<'o> {
    fn get(&self, key: &str) -> Option<&'o Json> {
        self.options.get(key).or_else(|| self.settings.get(key))
    }
}

impl Configuration {
    /// Whether a pattern of `partitionByComment` or `customGroups` is one `new RegExp` rejects, which the first node
    /// that tests it throws for.
    pub(crate) fn has_invalid_pattern(&self) -> bool {
        let matcher_has_invalid = |matcher: &CommentMatcher| match matcher {
            CommentMatcher::Patterns(patterns) => patterns.has_invalid(),
            CommentMatcher::Never | CommentMatcher::Always => false,
        };
        let comment_has_invalid = match &self.partition_by_comment {
            PartitionByComment::Off => false,
            PartitionByComment::Any(matcher) => matcher_has_invalid(matcher),
            PartitionByComment::ByKind { block, line } => {
                matcher_has_invalid(block) || matcher_has_invalid(line)
            }
        };
        let match_has_invalid = |single: &CustomGroupMatch| {
            single
                .element_name_pattern
                .as_ref()
                .is_some_and(Patterns::has_invalid)
                || single
                    .element_value_pattern
                    .as_ref()
                    .is_some_and(Patterns::has_invalid)
        };
        comment_has_invalid
            || self
                .custom_groups
                .iter()
                .any(|custom| match &custom.matcher {
                    CustomGroupMatcher::AnyOf(subgroups) => subgroups.iter().any(match_has_invalid),
                    CustomGroupMatcher::Single(single) => match_has_invalid(single),
                })
    }

    /// `complete()` followed by the `validate*` calls, whose first error is [`Configuration::error`].
    fn complete(rule: RuleKind, options: Object<'_>, settings: Object<'_>) -> Configuration {
        let mut configuration = Configuration::parse(rule, options, settings);
        configuration.error = validate_settings_values(rule, settings, options)
            .and_then(|()| configuration.validate_custom_sort())
            .and_then(|()| configuration.validate_groups(rule))
            .and_then(|()| configuration.validate_newlines_and_partition())
            .err();
        configuration
    }

    /// `complete()` of one element of the options array (or of nothing, for the defaults alone) under a file's
    /// settings, with the regexes compiled and the group names interned. Nothing is validated yet.
    fn parse(rule: RuleKind, options: Object<'_>, settings: Object<'_>) -> Configuration {
        let merged = Merged { options, settings };
        let (locale, invalid_locale) = match locale_of(merged.get("locales")) {
            Ok(Some(collator)) => (Locale::Collator(collator), None),
            Ok(None) => (Locale::Root, None),
            Err(message) => (Locale::Invalid, Some(message)),
        };
        let sort = SortOptions {
            type_: sort_type_of(merged.get("type")).unwrap_or(SortType::Alphabetical),
            order: order_of(merged.get("order")).unwrap_or(Order::Asc),
            ignore_case: merged
                .get("ignoreCase")
                .and_then(Json::as_bool)
                .unwrap_or(true),
            special_characters: special_characters_of(merged.get("specialCharacters"))
                .unwrap_or(SpecialCharacters::Keep),
            fallback_sort: merged.get("fallbackSort").map_or_else(
                || rule.default_fallback_sort(),
                |value| fallback_sort_of(Object::of(Some(value))),
            ),
            sort_by: sort_by_of(merged.get("sortBy")).unwrap_or(SortBy::Name),
            locale,
        };
        let newlines_between =
            newlines_of(merged.get("newlinesBetween")).unwrap_or(Newlines::Ignore);
        let newlines_inside = match merged.get("newlinesInside") {
            Some(Json::String(text)) if text == b"newlinesBetween" => {
                NewlinesInside::FollowsNewlinesBetween
            }
            other => newlines_of(other).map_or(
                NewlinesInside::FollowsNewlinesBetween,
                NewlinesInside::Fixed,
            ),
        };

        let mut names = Interner::default();
        let groups: Vec<GroupEntry> = merged
            .get("groups")
            .and_then(Json::as_array)
            .unwrap_or_default()
            .iter()
            .map(|entry| group_entry_of(entry, &mut names))
            .collect();
        let custom_groups: Vec<CustomGroup> = merged
            .get("customGroups")
            .and_then(Json::as_array)
            .unwrap_or_default()
            .iter()
            .map(|entry| custom_group_of(entry, &mut names))
            .collect();
        let unknown = names.id(b"unknown");

        // `getGroupIndex`: `findIndex`, so the first entry that names a group wins.
        let mut groups_index = vec![groups.len() as u32; names.names.len()];
        for (index, entry) in groups.iter().enumerate() {
            for &id in entry.ids() {
                if let Some(slot) = groups_index.get_mut(id as usize)
                    && *slot == groups.len() as u32
                {
                    *slot = index as u32;
                }
            }
        }

        Configuration {
            sort,
            alphabet: alphabet_of(merged.get("alphabet")),
            partition_by_comment: partition_by_comment_of(merged.get("partitionByComment")),
            partition_by_new_line: merged
                .get("partitionByNewLine")
                .and_then(Json::as_bool)
                .unwrap_or(false),
            newlines_between,
            newlines_inside,
            groups,
            custom_groups,
            use_configuration_if: configuration_if_of(rule, options.get("useConfigurationIf")),
            group_names: names.names,
            groups_index,
            unknown,
            error: None,
            invalid_locale,
        }
    }

    /// The text of a group name, for a message.
    pub(crate) fn group_name(&self, id: GroupId) -> &[u8] {
        self.group_names
            .get(id as usize)
            .map_or(b"", |name| &**name)
    }

    /// `validateCustomSortConfig`
    fn validate_custom_sort(&self) -> Result<(), Vec<u8>> {
        let uses_custom_sort = self.sort.type_ == SortType::Custom
            || self.groups.iter().any(|entry| match entry {
                GroupEntry::Overrides(overrides) => overrides.type_ == Some(SortType::Custom),
                GroupEntry::Names(_) | GroupEntry::NewlinesBetween(_) => false,
            });
        if uses_custom_sort && self.alphabet.index_of.is_empty() {
            return Err(b"`alphabet` option must not be empty".to_vec());
        }
        Ok(())
    }

    /// `validateGroupsConfig`, with `validateNoDuplicatedGroups` and `validateObjectsInsideGroups`.
    fn validate_groups(&self, rule: RuleKind) -> Result<(), Vec<u8>> {
        let is_custom = |id: GroupId| self.custom_groups.iter().any(|group| group.name == id);
        let mut invalid: Vec<&[u8]> = Vec::new();
        for &id in self.groups.iter().flat_map(GroupEntry::ids) {
            let name = self.group_name(id);
            if !is_custom(id) && !is_predefined_group(rule.selectors(), rule.modifiers(), name) {
                invalid.push(name);
            }
        }
        if !invalid.is_empty() {
            return Err(list_error("Invalid group(s): ", &invalid));
        }

        let mut seen: Vec<GroupId> = Vec::new();
        let mut duplicated: Vec<GroupId> = Vec::new();
        for &id in self.groups.iter().flat_map(GroupEntry::ids) {
            if !seen.contains(&id) {
                seen.push(id);
            } else if !duplicated.contains(&id) {
                duplicated.push(id);
            }
        }
        if !duplicated.is_empty() {
            let names: Vec<&[u8]> = duplicated.iter().map(|&id| self.group_name(id)).collect();
            return Err(list_error("Duplicated group(s): ", &names));
        }

        // An entry is group-based if its first name is truthy: `computeGroupsNames([group])[0]`.
        let mut previous_is_not_group = false;
        for entry in &self.groups {
            if entry
                .ids()
                .first()
                .is_some_and(|&id| !self.group_name(id).is_empty())
            {
                previous_is_not_group = false;
                continue;
            }
            if previous_is_not_group {
                return Err(b"Consecutive `newlinesBetween` objects are not allowed".to_vec());
            }
            previous_is_not_group = true;
        }
        Ok(())
    }

    /// `validateNewlinesAndPartitionConfig`
    fn validate_newlines_and_partition(&self) -> Result<(), Vec<u8>> {
        const NEWLINES_INSIDE: &[u8] =
            b"The 'partitionByNewLine' and 'newlinesInside' options cannot be used together";
        const NEWLINES_BETWEEN: &[u8] =
            b"The 'partitionByNewLine' and 'newlinesBetween' options cannot be used together";
        if !self.partition_by_new_line {
            return Ok(());
        }
        let is_ignore = |newlines: Newlines| matches!(newlines, Newlines::Ignore);

        if !is_ignore(self.newlines_between) {
            return Err(NEWLINES_BETWEEN.to_vec());
        }
        let has_newlines_between_group = self.groups.iter().any(
            |entry| matches!(entry, GroupEntry::NewlinesBetween(newlines) if !is_ignore(*newlines)),
        );
        if has_newlines_between_group {
            return Err(NEWLINES_BETWEEN.to_vec());
        }

        match self.newlines_inside {
            NewlinesInside::FollowsNewlinesBetween | NewlinesInside::Fixed(Newlines::Ignore) => {}
            NewlinesInside::Fixed(Newlines::Count(_)) => return Err(NEWLINES_INSIDE.to_vec()),
        }
        let group_newlines_inside = self.groups.iter().filter_map(|entry| match entry {
            GroupEntry::Overrides(overrides) => overrides.newlines_inside,
            GroupEntry::Names(_) | GroupEntry::NewlinesBetween(_) => None,
        });
        let custom_newlines_inside = self
            .custom_groups
            .iter()
            .filter_map(|group| group.newlines_inside);
        if group_newlines_inside
            .chain(custom_newlines_inside)
            .any(|newlines| !is_ignore(newlines))
        {
            return Err(NEWLINES_INSIDE.to_vec());
        }
        Ok(())
    }
}

impl GroupEntry {
    /// `computeGroupNames` of one entry: the ids of the names it has.
    pub(crate) fn ids(&self) -> &[GroupId] {
        match self {
            GroupEntry::Names(names) | GroupEntry::Overrides(GroupOverrides { names, .. }) => {
                names.ids()
            }
            GroupEntry::NewlinesBetween(_) => &[],
        }
    }
}

impl GroupNames {
    pub(crate) fn ids(&self) -> &[GroupId] {
        match self {
            GroupNames::One(id) => std::slice::from_ref(id),
            GroupNames::Many(ids) => &**ids,
        }
    }
}

/// Gives every distinct group name one [`GroupId`], in the order the names are first seen.
#[derive(Default)]
struct Interner {
    names: Vec<Box<[u8]>>,
}

impl Interner {
    fn id(&mut self, name: &[u8]) -> GroupId {
        if let Some(id) = self.names.iter().position(|known| &**known == name) {
            return id as GroupId;
        }
        self.names.push(Box::from(name));
        (self.names.len() - 1) as GroupId
    }
}

fn sort_type_of(value: Option<&Json>) -> Option<SortType> {
    match value?.as_str()? {
        b"alphabetical" => Some(SortType::Alphabetical),
        b"natural" => Some(SortType::Natural),
        b"line-length" => Some(SortType::LineLength),
        b"custom" => Some(SortType::Custom),
        b"unsorted" => Some(SortType::Unsorted),
        b"subgroup-order" => Some(SortType::SubgroupOrder),
        _ => None,
    }
}

fn order_of(value: Option<&Json>) -> Option<Order> {
    match value?.as_str()? {
        b"asc" => Some(Order::Asc),
        b"desc" => Some(Order::Desc),
        _ => None,
    }
}

fn special_characters_of(value: Option<&Json>) -> Option<SpecialCharacters> {
    match value?.as_str()? {
        b"remove" => Some(SpecialCharacters::Remove),
        b"trim" => Some(SpecialCharacters::Trim),
        b"keep" => Some(SpecialCharacters::Keep),
        _ => None,
    }
}

fn sort_by_of(value: Option<&Json>) -> Option<SortBy> {
    match value?.as_str()? {
        b"name" => Some(SortBy::Name),
        b"value" => Some(SortBy::Value),
        _ => None,
    }
}

fn fallback_sort_of(object: Object<'_>) -> FallbackSort {
    FallbackSort {
        type_: sort_type_of(object.get("type")).unwrap_or(SortType::Unsorted),
        order: order_of(object.get("order")),
        sort_by: sort_by_of(object.get("sortBy")),
    }
}

/// `'ignore'` or a number; `None` for anything else, including a missing value.
fn newlines_of(value: Option<&Json>) -> Option<Newlines> {
    match value? {
        Json::Number(count) => Some(Newlines::Count(*count)),
        Json::String(text) if text == b"ignore" => Some(Newlines::Ignore),
        _ => None,
    }
}

/// `compareByCustomSort`'s `indexByCharacters`: `[...alphabet].entries()` into a map, so a repeated character keeps
/// its last index.
fn alphabet_of(value: Option<&Json>) -> Alphabet {
    let mut index_of = FxHashMap::default();
    if let Some(text) = value.and_then(Json::as_str) {
        for (index, (_, code_point)) in strings::wtf8_codepoints(text).enumerate() {
            index_of.insert(code_point, index as u32);
        }
    }
    Alphabet { index_of }
}

/// `new RegExp(pattern, flags)`
fn pattern_of(pattern: &[u8], flags: &[u8]) -> Pattern {
    match Regex::from_bytes(pattern, flags) {
        Ok(regex) => Pattern::Valid(regex),
        Err(error) => Pattern::Invalid(error.message),
    }
}

/// One `SingleRegexOption`: a string, or `{ pattern, flags? }`.
fn single_pattern_of(value: &Json) -> Option<Pattern> {
    match value {
        Json::String(pattern) => Some(pattern_of(pattern, b"")),
        Json::Object(_) => {
            let object = Object::of(Some(value));
            let pattern = object
                .get("pattern")
                .and_then(Json::as_str)
                .unwrap_or_default();
            let flags = object
                .get("flags")
                .and_then(Json::as_str)
                .unwrap_or_default();
            Some(pattern_of(pattern, flags))
        }
        _ => None,
    }
}

/// A `RegexOption`, whatever its truthiness: `[]` is an empty list, and so is anything that is not a regex option.
fn patterns_of(value: &Json) -> Patterns {
    match value {
        Json::Array(items) => Patterns(items.iter().filter_map(single_pattern_of).collect()),
        _ => Patterns(single_pattern_of(value).into_iter().collect()),
    }
}

/// A `RegexOption` that is set, by JavaScript's truthiness: `""` and `false` are not, `[]` is.
fn truthy_patterns(value: Option<&Json>) -> Option<Patterns> {
    value.filter(|value| value.is_truthy()).map(patterns_of)
}

/// A `ScopedRegexOption` that is set, split as `partitionPatternsByScope` does.
fn scoped_patterns_of(value: Option<&Json>) -> Option<ScopedPatterns> {
    let value = value.filter(|value| value.is_truthy())?;
    let items: &[Json] = match value {
        Json::Array(items) => items.as_slice(),
        single => std::slice::from_ref(single),
    };
    let mut shallow = Vec::new();
    let mut deep = Vec::new();
    for item in items {
        let Some(pattern) = single_pattern_of(item) else {
            continue;
        };
        if Object::of(Some(item)).str("scope") == Some("deep") {
            deep.push(pattern);
        } else {
            shallow.push(pattern);
        }
    }
    Some(ScopedPatterns {
        shallow: Patterns(shallow),
        deep: Patterns(deep),
    })
}

/// `partitionByComment`, as `isPartitionComment` reads it.
fn partition_by_comment_of(value: Option<&Json>) -> PartitionByComment {
    let Some(value) = value.filter(|value| value.is_truthy()) else {
        return PartitionByComment::Off;
    };
    match value {
        Json::Bool(_) => PartitionByComment::Any(CommentMatcher::Always),
        Json::String(_) | Json::Array(_) => {
            PartitionByComment::Any(CommentMatcher::Patterns(patterns_of(value)))
        }
        Json::Object(_) => {
            let object = Object::of(Some(value));
            match (object.get("block"), object.get("line")) {
                (None, None) => PartitionByComment::Any(CommentMatcher::Never),
                (block, line) => PartitionByComment::ByKind {
                    block: comment_matcher_of(block),
                    line: comment_matcher_of(line),
                },
            }
        }
        Json::Null | Json::Number(_) => PartitionByComment::Any(CommentMatcher::Never),
    }
}

/// `block` or `line` of `partitionByComment`: here `""` is a pattern, because `isTrimmedCommentPartitionComment`
/// tests it, unlike the top-level value.
fn comment_matcher_of(value: Option<&Json>) -> CommentMatcher {
    match value {
        None | Some(Json::Null | Json::Bool(false)) => CommentMatcher::Never,
        Some(Json::Bool(true)) => CommentMatcher::Always,
        Some(value) => CommentMatcher::Patterns(patterns_of(value)),
    }
}

/// `"a"` or `["a", "b"]`; `None` for anything else.
fn group_names_of(value: &Json, names: &mut Interner) -> Option<GroupNames> {
    match value {
        Json::String(name) => Some(GroupNames::One(names.id(name))),
        Json::Array(items) => Some(GroupNames::Many(
            items
                .iter()
                .filter_map(Json::as_str)
                .map(|name| names.id(name))
                .collect(),
        )),
        _ => None,
    }
}

/// One `groups` entry, told apart as `computeGroupNames` does: a string or an array, then `group` in it, then
/// `newlinesBetween`.
fn group_entry_of(value: &Json, names: &mut Interner) -> GroupEntry {
    if let Some(group_names) = group_names_of(value, names) {
        return GroupEntry::Names(group_names);
    }
    let object = Object::of(Some(value));
    if let Some(group) = object.get("group") {
        return GroupEntry::Overrides(GroupOverrides {
            names: group_names_of(group, names).unwrap_or_else(|| GroupNames::Many(Box::default())),
            type_: sort_type_of(object.get("type")),
            order: order_of(object.get("order")),
            fallback_sort: object
                .get("fallbackSort")
                .map(|value| fallback_sort_of(Object::of(Some(value)))),
            sort_by: sort_by_of(object.get("sortBy")),
            newlines_inside: newlines_of(object.get("newlinesInside")),
        });
    }
    GroupEntry::NewlinesBetween(
        newlines_of(object.get("newlinesBetween")).unwrap_or(Newlines::Ignore),
    )
}

/// One `customGroups` entry: `anyOf` in it makes it match if any of those does (`doesCustomGroupMatch`).
fn custom_group_of(value: &Json, names: &mut Interner) -> CustomGroup {
    let object = Object::of(Some(value));
    let matcher = match object.get("anyOf") {
        Some(any_of) => CustomGroupMatcher::AnyOf(
            any_of
                .as_array()
                .unwrap_or_default()
                .iter()
                .map(|subgroup| custom_group_match_of(Object::of(Some(subgroup))))
                .collect(),
        ),
        None => CustomGroupMatcher::Single(custom_group_match_of(object)),
    };
    CustomGroup {
        name: names.id(object
            .get("groupName")
            .and_then(Json::as_str)
            .unwrap_or_default()),
        matcher,
        type_: sort_type_of(object.get("type")),
        order: order_of(object.get("order")),
        fallback_sort: object
            .get("fallbackSort")
            .map(|value| fallback_sort_of(Object::of(Some(value)))),
        sort_by: sort_by_of(object.get("sortBy")),
        newlines_inside: newlines_of(object.get("newlinesInside")),
    }
}

/// The conditions of one custom group or `anyOf` element (`doesSingleCustomGroupMatch`): `selector: ""` is no
/// condition, `modifiers: []` neither.
fn custom_group_match_of(object: Object<'_>) -> CustomGroupMatch {
    CustomGroupMatch {
        selector: object
            .str("selector")
            .filter(|selector| !selector.is_empty())
            .map(Box::from),
        modifiers: object
            .strings("modifiers")
            .into_iter()
            .map(Box::from)
            .collect(),
        element_name_pattern: truthy_patterns(object.get("elementNamePattern")),
        element_value_pattern: truthy_patterns(object.get("elementValuePattern")),
    }
}

/// `useConfigurationIf`: only the keys the rule's schema has are read.
fn configuration_if_of(rule: RuleKind, value: Option<&Json>) -> ConfigurationIf {
    let object = Object::of(value);
    let is_objects = rule == RuleKind::Objects;
    let has_declaration = rule != RuleKind::UnionTypes;
    ConfigurationIf {
        all_names_match_pattern: truthy_patterns(object.get("allNamesMatchPattern")),
        object_type: match object.str("objectType").filter(|_| is_objects) {
            Some("destructured") => Some(ObjectType::Destructured),
            Some("non-destructured") => Some(ObjectType::NonDestructured),
            _ => None,
        },
        has_numeric_keys_only: object
            .bool("hasNumericKeysOnly")
            .filter(|_| has_declaration),
        calling_function_name_pattern: scoped_patterns_of(
            object
                .get("callingFunctionNamePattern")
                .filter(|_| is_objects),
        ),
        declaration_matches_pattern: scoped_patterns_of(
            object
                .get("declarationMatchesPattern")
                .filter(|_| has_declaration),
        ),
        declaration_comment_matches_pattern: scoped_patterns_of(
            object
                .get("declarationCommentMatchesPattern")
                .filter(|_| has_declaration),
        ),
        matches_ast_selector: selector_source(object)
            .and_then(|source| Selector::parse(source.as_bytes()).ok()),
    }
}

/// Upstream's `isPredefinedGroup`: `modifier(-modifier)*-selector` or a selector alone, read from the end, where a
/// selector or a modifier is up to three dash-separated words and no modifier repeats.
fn is_predefined_group(selectors: &[&str], modifiers: &[&str], input: &[u8]) -> bool {
    if input == b"unknown" {
        return true;
    }
    let words: Vec<&[u8]> = strings::split(input, b"-").collect();
    let Some(selector_words) = longest_allowed_word(&words, selectors) else {
        return false;
    };
    let mut rest = &words[..words.len() - selector_words];
    let mut parsed: Vec<&[&[u8]]> = Vec::new();
    while !rest.is_empty() {
        let Some(count) = longest_allowed_word(rest, modifiers) else {
            return false;
        };
        let modifier = &rest[rest.len() - count..];
        if parsed.contains(&modifier) {
            return false;
        }
        parsed.push(modifier);
        rest = &rest[..rest.len() - count];
    }
    true
}

/// `computeLongestAllowedWord`: how many of the last words, three, two or one, join with dashes to an allowed value.
fn longest_allowed_word(words: &[&[u8]], allowed: &[&str]) -> Option<usize> {
    (1..=3)
        .rev()
        .filter(|&count| count <= words.len())
        .find(|&count| {
            let tail = &words[words.len() - count..];
            let is_empty_word = count == 1 && tail.first().is_none_or(|word| word.is_empty());
            !is_empty_word
                && allowed
                    .iter()
                    .any(|value| joined_eq(tail, value.as_bytes()))
        })
}

/// `words.join('-') === value`, without joining.
fn joined_eq(words: &[&[u8]], value: &[u8]) -> bool {
    let mut rest = value;
    for (index, word) in words.iter().enumerate() {
        if index > 0 {
            let Some(after_dash) = rest.strip_prefix(b"-") else {
                return false;
            };
            rest = after_dash;
        }
        let Some(after_word) = rest.strip_prefix(*word) else {
            return false;
        };
        rest = after_word;
    }
    rest.is_empty()
}

/// `prefix` + `names.join(', ')`
fn list_error(prefix: &str, names: &[&[u8]]) -> Vec<u8> {
    let mut error = prefix.as_bytes().to_vec();
    for (index, name) in names.iter().enumerate() {
        if index > 0 {
            error.extend_from_slice(b", ");
        }
        error.extend_from_slice(name);
    }
    error
}

/// The keys `settings.perfectionist` may have: `settingsJsonSchemas` in `get-settings.ts`.
const SETTINGS_KEYS: &[&[u8]] = &[
    b"fallbackSort",
    b"type",
    b"specialCharacters",
    b"ignoreCase",
    b"alphabet",
    b"locales",
    b"order",
    b"partitionByComment",
    b"partitionByNewLine",
    b"tsconfig",
    b"newlinesBetween",
    b"newlinesInside",
];

/// `getSettings`: `settings.perfectionist` with every key known, or empty when it is falsy. The keys of a string or
/// an array are its indices, none of which is a setting.
fn settings_of(value: &Json) -> Result<Object<'_>, Vec<u8>> {
    const PREFIX: &str = "Invalid Perfectionist setting(s): ";
    let index_count = match value {
        Json::Object(entries) => {
            let invalid: Vec<&[u8]> = entries
                .iter()
                .map(|(key, _)| key.as_slice())
                .filter(|key| !SETTINGS_KEYS.contains(key))
                .collect();
            if !invalid.is_empty() {
                return Err(list_error(PREFIX, &invalid));
            }
            return Ok(Object::of(Some(value)));
        }
        Json::String(text) if !text.is_empty() => strings::wtf8_len_utf16(text) as usize,
        Json::Array(items) if !items.is_empty() => items.len(),
        _ => return Ok(Object::default()),
    };
    let indices: Vec<String> = (0..index_count).map(|index| index.to_string()).collect();
    let names: Vec<&[u8]> = indices.iter().map(String::as_bytes).collect();
    Err(list_error(PREFIX, &names))
}

/// `validateSettingsValues`. `tsconfig` is the one allowed setting these rules have no default for, so it is not
/// checked.
fn validate_settings_values(
    rule: RuleKind,
    settings: Object<'_>,
    options: Object<'_>,
) -> Result<(), Vec<u8>> {
    let mut invalid: Vec<&[u8]> = Vec::new();
    for (key, value) in settings.entries() {
        if key == b"tsconfig" || options.entries().iter().any(|(own, _)| own == key) {
            continue;
        }
        if !matches_setting_schema(rule, key, value) {
            invalid.push(key);
        }
    }
    if invalid.is_empty() {
        Ok(())
    } else {
        Err(list_error(
            "Invalid value(s) for Perfectionist setting(s): ",
            &invalid,
        ))
    }
}

/// `matchesJsonSchema(value, schema)` for the schema of one setting, with the `oneOf` branches written out: each
/// `oneOf` here has branches no value matches two of, so "exactly one" is "any".
fn matches_setting_schema(rule: RuleKind, key: &[u8], value: &Json) -> bool {
    match key {
        b"type" => sort_type_of(Some(value)).is_some(),
        b"order" => order_of(Some(value)).is_some(),
        b"specialCharacters" => special_characters_of(Some(value)).is_some(),
        b"ignoreCase" | b"partitionByNewLine" => matches!(value, Json::Bool(_)),
        b"alphabet" => matches!(value, Json::String(_)),
        b"locales" => match value {
            Json::String(_) => true,
            Json::Array(items) => items.iter().all(|item| matches!(item, Json::String(_))),
            _ => false,
        },
        b"fallbackSort" => {
            let Json::Object(entries) = value else {
                return false;
            };
            entries.iter().any(|(key, _)| key == b"type")
                && entries.iter().all(|(key, value)| match key.as_slice() {
                    b"type" => sort_type_of(Some(value)).is_some(),
                    b"order" => order_of(Some(value)).is_some(),
                    b"sortBy" => rule.has_sort_by() && sort_by_of(Some(value)).is_some(),
                    _ => false,
                })
        }
        b"partitionByComment" => matches_partition_by_comment_schema(value),
        b"newlinesBetween" => matches_newlines_schema(value),
        b"newlinesInside" => {
            matches_newlines_schema(value)
                || matches!(value, Json::String(text) if text == b"newlinesBetween")
        }
        _ => true,
    }
}

/// `newlinesBetweenJsonSchema`: `'ignore'`, or a finite number that is at least 0.
fn matches_newlines_schema(value: &Json) -> bool {
    match value {
        Json::String(text) => text == b"ignore",
        Json::Number(count) => count.is_finite() && *count >= 0.0,
        _ => false,
    }
}

/// `partitionByCommentJsonSchema`: a boolean, a regex option, or `{ block?, line? }` with at least one of them,
/// each a boolean or a regex option.
fn matches_partition_by_comment_schema(value: &Json) -> bool {
    let is_boolean_or_regex =
        |value: &Json| matches!(value, Json::Bool(_)) || matches_regex_schema(value);
    if is_boolean_or_regex(value) {
        return true;
    }
    let Json::Object(entries) = value else {
        return false;
    };
    !entries.is_empty()
        && entries.iter().all(|(key, value)| {
            matches!(key.as_slice(), b"block" | b"line") && is_boolean_or_regex(value)
        })
}

/// `buildRegexJsonSchema()`: a single regex option, or an array of them.
fn matches_regex_schema(value: &Json) -> bool {
    match value {
        Json::Array(items) => items.iter().all(matches_single_regex_schema),
        _ => matches_single_regex_schema(value),
    }
}

/// A string, or `{ pattern, flags? }` with both strings and nothing else.
fn matches_single_regex_schema(value: &Json) -> bool {
    match value {
        Json::String(_) => true,
        Json::Object(entries) => {
            entries.iter().any(|(key, _)| key == b"pattern")
                && entries.iter().all(|(key, value)| {
                    matches!(key.as_slice(), b"pattern" | b"flags")
                        && matches!(value, Json::String(_))
                })
        }
        _ => false,
    }
}

/// `locales`, as `Intl.Collator` reads it. `Err` is the `RangeError` message of the first tag that is not well-formed,
/// wherever it is in the list.
fn locale_of(value: Option<&Json>) -> Result<Option<strings::Collator>, Vec<u8>> {
    let Some(value) = value else {
        return Ok(None);
    };
    let locales: &[Json] = match value {
        Json::Array(items) => items.as_slice(),
        single => std::slice::from_ref(single),
    };
    strings::Collator::open_first(locales.iter().filter_map(Json::as_str)).map_err(|tag| {
        let mut message = b"Invalid language tag: ".to_vec();
        message.extend_from_slice(tag);
        message
    })
}
