//! What the `perfectionist/*` rules share: a port of eslint-plugin-perfectionist's `utils/` (Copyright Azat S., MIT
//! License). A rule turns the members of one node (an object literal, a union, an interface body) into
//! [`SortingNode`]s, picks the [`Configuration`] whose `useConfigurationIf` matches, sorts the nodes ([`sort`]) twice
//! (with and without the `eslint-disable`d members moving) and reports every adjacent pair that is out of order
//! (`report`), with one merged fix per node list ([`fixes`]).
//!
//! Module by module, the upstream files they port:
//! - `options`: `types/*.ts`, `utils/complete.ts`, `utils/get-settings.ts`, `utils/matches.ts`, the `validate-*.ts`
//! - `configuration_if`: `compute-matched-context-options.ts` of each rule, `utils/context-matching/`,
//!   `utils/scoped-regex/`, `compute-parent-nodes-with-types.ts`
//! - `groups`: `compute-group.ts`, `get-group-index.ts`, `does-custom-group-match.ts`,
//!   `generate-predefined-groups.ts`, `compute-overridden-options-by-group-index.ts`, `compute-group-name.ts`
//! - `compare`: `utils/compare/*.ts`
//! - `sort`: `sort-nodes.ts`, `sort-nodes-by-groups.ts`, `sort-nodes-by-dependencies.ts`,
//!   `compute-nodes-in-circular-dependencies.ts`, `is-node-dependent-on-other-node.ts`
//! - `partition`: `should-partition.ts`, `is-partition-comment.ts`, `get-comments-before.ts`, `get-lines-between.ts`
//! - `disabled`: `get-eslint-disabled-lines.ts`, `get-eslint-disabled-rules.ts`, `is-node-eslint-disabled.ts`
//! - `fixes`: `get-node-range.ts`, `make-order-fixes.ts`, `make-comment-after-fixes.ts`,
//!   `make-single-node-comment-after-fixes.ts`, `make-fixes.ts`, `range-to-diff.ts`

pub(crate) mod compare;
pub(crate) mod configuration_if;
pub(crate) mod disabled;
pub(crate) mod fixes;
pub(crate) mod groups;
pub(crate) mod options;
pub(crate) mod partition;
pub(crate) mod sort;

use bun_lint::prelude::*;
use groups::GroupId;
use smallvec::SmallVec;
use std::borrow::Cow;
use std::cell::OnceCell;

pub(crate) use options::Configuration;

/// Upstream's `SortingNode` (`types/sorting-node.ts`) plus `SortingNodeWithDependencies` and the `value` of the
/// object rules. The node itself is its spans: the engine only needs its text, its lines, its parentheses and the
/// tokens and comments around it. A rule that needs its AST handles keeps them beside the list, by index.
pub(crate) struct SortingNode<'a> {
    /// ESTree's range of the node: where the report goes, what `sourceCode.getText(node)` is, what `rangeToDiff`
    /// measures, whose lines `getLinesBetween` and `isNodeOnSingleLine` count. For an interface or type literal
    /// member that includes the `,` or `;`, like `TSPropertySignature`.
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
    /// Computed once here instead of at every use.
    pub(crate) group_index: u32,
    /// `partitionId`: 1 for the first partition, as upstream. Nodes of different partitions are never reordered
    /// relative to each other and get no spacing errors.
    pub(crate) partition_id: u32,
    /// `isEslintDisabled`: an `eslint-disable*` comment for this rule covers the line the node starts on. The node
    /// keeps its position in the fix, but still counts when errors are detected.
    pub(crate) is_eslint_disabled: bool,
    /// `dependencyNames` of `sort-objects` in a pattern: the names the property binds. Other nodes leave it empty.
    pub(crate) dependency_names: SmallVec<[Name<'a>; 1]>,
    /// `dependencies` of `sort-objects` in a pattern: the sibling bindings the property's default value reads. Empty
    /// unless the node is in an object pattern (`canHavePropertyDependencies`).
    pub(crate) dependencies: SmallVec<[Name<'a>; 2]>,
}

/// Upstream's `availableMessageIds`: which message each rule reports for each kind of error. A rule without
/// dependency errors (every rule but `sort-objects`) has `None`, and the engine then computes no dependencies.
pub(crate) struct Messages {
    pub(crate) unexpected_order: &'static Message,
    pub(crate) unexpected_group_order: &'static Message,
    pub(crate) unexpected_dependency_order: Option<&'static Message>,
    pub(crate) missed_spacing: &'static Message,
    pub(crate) extra_spacing: &'static Message,
}

/// What one of the four rules keeps per file. Each rule wraps it in `pub struct State(pub(crate) FileState);` with
/// `type State<'a> = State;`, because `Rule::State` has to be a reachable type.
#[derive(Default)]
pub(crate) struct FileState {
    /// The configurations parsed again under the file's `settings.perfectionist` (upstream's `complete`:
    /// `{..defaults, ..settings, ..options}` per option object). `None` for a file without that key, which uses the
    /// rule's own: [`options::RuleOptions::configurations`] picks.
    pub(crate) with_settings: Option<Vec<Configuration>>,
    /// Upstream's `Invalid Perfectionist setting(s): ..` / `Invalid value(s) for Perfectionist setting(s): ..`. `start`
    /// has no `Cx`, so the first listener throws it (`cx.throw(node, "Error", ..)`) and returns.
    pub(crate) settings_error: Option<Vec<u8>>,
    /// `getEslintDisabledLines` for this rule's id, which reads every comment of the file once. Computed on the first
    /// node with more than one member.
    pub(crate) disabled_lines: OnceCell<disabled::DisabledLines>,
}
