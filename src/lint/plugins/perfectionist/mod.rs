//! What the `perfectionist/*` rules share: eslint-plugin-perfectionist's `utils/` (Copyright Azat S., MIT License).
//! Each module's doc names the upstream files it corresponds to.

pub(crate) mod compare;
pub(crate) mod configuration_if;
pub(crate) mod disabled;
pub(crate) mod fixes;
pub(crate) mod groups;
pub(crate) mod newlines;
pub(crate) mod object_types;
pub(crate) mod options;
pub(crate) mod partition;
pub(crate) mod report;
pub(crate) mod sort;

use bun_lint::prelude::*;
use configuration_if::{Subject, matching_configuration};
use disabled::DisabledLines;
use groups::GroupId;
use options::RuleOptions;
use smallvec::SmallVec;
use std::borrow::Cow;
use std::cell::OnceCell;
use std::sync::Arc;

pub(crate) use options::Configuration;

/// `SortingNode` (`types/sorting-node.ts`) plus `SortingNodeWithDependencies` and the object rules' `value`.
/// Holds spans only: a rule that needs the AST handles keeps them beside the list, by index.
pub(crate) struct SortingNode<'a> {
    /// ESTree's range of the node. For an interface or type literal member that includes the `,` or `;`, like
    /// `TSPropertySignature`.
    pub(crate) span: Span,
    /// `span` widened to the parentheses around the node (`getNodeRange`'s `isParenthesized`). Equal to `span` for
    /// everything but a union member (`TypeNode::outer_span`).
    pub(crate) outer_span: Span,
    /// What is compared: `computeNodeName` of the rule. Borrowed from the file unless it had to be computed, like
    /// `String(1e3)` for a numeric key. `toSingleLine` is applied when it is reported, not here.
    pub(crate) name: Cow<'a, [u8]>,
    /// `sortBy: "value"` and `elementValuePattern` compare this. Empty where upstream has `null` or `''`: both are
    /// falsy there, and a regex is tested against `''` for either.
    pub(crate) value: &'a [u8],
    /// `rangeToDiff`: the UTF-16 length of `span`'s text, minus one if the text ends with `;` or `,`.
    pub(crate) size: u32,
    /// `computeGroup`: the group the node is in.
    pub(crate) group: GroupId,
    /// `getGroupIndex(options.groups, node)`: the position of `group`'s entry in `groups`, or `groups.len()`.
    pub(crate) group_index: u32,
    /// `partitionId`: 1 for the first partition, as upstream.
    pub(crate) partition_id: u32,
    /// `isEslintDisabled`: an `eslint-disable*` comment for this rule covers the line the node starts on.
    pub(crate) is_eslint_disabled: bool,
    /// `dependencyNames` of `sort-objects` in a pattern: the names the property binds. Other nodes leave it empty.
    pub(crate) dependency_names: SmallVec<[Name<'a>; 1]>,
    /// `dependencies` of `sort-objects` in a pattern: the sibling bindings the property's default value reads.
    pub(crate) dependencies: SmallVec<[Name<'a>; 2]>,
}

impl<'a> SortingNode<'a> {
    /// A node of a list that [`report::is_in_order_without_groups`] looks at: only what the comparator reads is
    /// filled in.
    pub(crate) fn for_comparison(
        span: Span,
        name: &'a [u8],
        value: &'a [u8],
        size: u32,
    ) -> SortingNode<'a> {
        SortingNode {
            span,
            outer_span: span,
            name: Cow::Borrowed(name),
            value,
            size,
            group: 0,
            group_index: 0,
            partition_id: 1,
            is_eslint_disabled: false,
            dependency_names: SmallVec::new(),
            dependencies: SmallVec::new(),
        }
    }
}

/// `availableMessageIds`. `unexpected_dependency_order: None` (every rule but `sort-objects`) also turns off the
/// dependency computation.
pub(crate) struct Messages {
    pub(crate) unexpected_order: &'static Message,
    pub(crate) unexpected_group_order: &'static Message,
    pub(crate) unexpected_dependency_order: Option<&'static Message>,
    pub(crate) missed_spacing: &'static Message,
    pub(crate) extra_spacing: &'static Message,
}

/// What a rule keeps per file. Each rule wraps it in a `pub struct`, because `Rule::State` has to be a reachable type.
#[derive(Default)]
pub(crate) struct FileState {
    /// The configurations under the file's `settings.perfectionist` (`complete`), from [`RuleOptions::file_state`].
    /// `None` for a file without that key, which uses [`RuleOptions::configurations`].
    pub(crate) with_settings: Option<Arc<[Configuration]>>,
    /// `getSettings`' `Invalid Perfectionist setting(s): ..`, thrown by [`FileState::pick`] because `start` has no `Cx`.
    pub(crate) settings_error: Option<Vec<u8>>,
    /// `getEslintDisabledLines` for this rule's id.
    disabled_lines: OnceCell<DisabledLines>,
}

impl FileState {
    /// `getSettings`, `computeMatchedContextOptions`, `complete` and the `validate*` calls: the [`Configuration`]
    /// for the node at `at` and its index, or `None` after a throw on `cx`. `names` feed `allNamesMatchPattern`.
    pub(crate) fn pick<'s, 'n, R: Rule>(
        &'s self,
        rule: &'s RuleOptions,
        subject: Subject<'_>,
        names: &(impl Iterator<Item = &'n [u8]> + Clone),
        cx: &Cx<'_, R>,
        at: Span,
    ) -> Option<(&'s Configuration, usize)> {
        if let Some(error) = &self.settings_error {
            cx.throw(at, "Error", error.clone());
            return None;
        }
        let configurations = self
            .with_settings
            .as_deref()
            .unwrap_or(&rule.configurations);
        let index = match matching_configuration(configurations, subject, names) {
            Ok(index) => index,
            Err(rejected) => {
                rejected.throw(cx, at);
                return None;
            }
        };
        let config = configurations.get(index)?;
        if let Some(error) = &config.error {
            cx.throw(at, "Error", error.clone());
            return None;
        }
        Some((config, index))
    }

    /// `getEslintDisabledLines` for `rule_id` (`context.id`), computed on the first call.
    pub(crate) fn disabled_lines<'a>(&self, file: &'a File<'a>, rule_id: &[u8]) -> &DisabledLines {
        self.disabled_lines
            .get_or_init(|| DisabledLines::compute(file, rule_id))
    }
}
