//! ESLint's `apply-disable-directives.js`: which messages the `eslint-disable` comments of a file
//! suppress, and which of these comments do nothing.

use super::message::{LintMessage, RuleId, Suppression};
use super::space::{space_len, space_len_back};
use crate::ast::File;
use crate::context::Severity;
use crate::fix::Fix;
use crate::span::Span;
use bun_core::strings;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Kind {
    Disable,
    Enable,
    DisableLine,
    DisableNextLine,
}

/// A comment that disables or enables rules: ESLint's `parentDirective`.
pub(crate) struct Parent<'a> {
    pub(crate) comment: Span,
    /// The list of rules as it is written, trimmed.
    pub(crate) list: &'a [u8],
    /// The names in `list`, of rules that exist and of others.
    pub(crate) names: Vec<&'a [u8]>,
    pub(crate) justification: &'a [u8],
    /// Where the comment starts.
    pub(crate) start: (u32, u32),
}

/// One rule of such a comment, or all rules if it names none.
pub(crate) struct Directive<'a> {
    pub(crate) kind: Kind,
    /// Where the comment starts. For `eslint-disable-next-line`, where it ends.
    pub(crate) line: u32,
    pub(crate) column: u32,
    pub(crate) rule: Option<RuleId>,
    /// As it is written.
    pub(crate) name: &'a [u8],
    /// An index into the `Parent`s.
    pub(crate) parent: u32,
}

/// A point of the file from which a rule, or all rules, are disabled or enabled.
struct Switch {
    disables: bool,
    line: u32,
    column: u32,
    /// An index into the `Directive`s.
    source: u32,
}

pub(crate) struct Input<'i, 'a> {
    pub(crate) file: &'a File<'a>,
    pub(crate) parents: &'i [Parent<'a>],
    pub(crate) directives: &'i [Directive<'a>],
    pub(crate) report_unused: Severity,
    pub(crate) wants_fixes: bool,
    /// The rules that are enabled and were filtered out. What disables them is not reported.
    pub(crate) rules_to_ignore: &'i [RuleId],
}

impl Input<'_, '_> {
    fn rule(&self, switch: &Switch) -> Option<&RuleId> {
        self.directives[switch.source as usize].rule.as_ref()
    }

    fn is_ignored(&self, rule: Option<&RuleId>) -> bool {
        match rule {
            // What applies to all rules may be used by one that did not run.
            None => !self.rules_to_ignore.is_empty(),
            Some(rule) => self.rules_to_ignore.contains(rule),
        }
    }

    /// `createIndividualDirectivesRemoval`: removes `name` from the list of `parent`.
    fn removal_from_list(&self, parent: &Parent, name: &[u8]) -> Option<Span> {
        let (text, list) = (self.file.text(), parent.list);
        let list_start = parent.comment.start as usize
            + strings::index_of(text.get(parent.comment.start as usize..)?, list)?;
        // `(?:^|\s*,\s*)(?<quote>['"]?)name\k<quote>(?:\s*,\s*|$)`
        let mut from = 0;
        while let Some(found) = strings::index_of(&list[from..], name) {
            let at = from + found;
            from = at + 1;
            let (mut start, mut end) = (at, at + name.len());
            if let Some(&quote @ (b'\'' | b'"')) = at.checked_sub(1).and_then(|i| list.get(i))
                && list.get(end) == Some(&quote)
            {
                start -= 1;
                end += 1;
            }
            let back_over_space = |mut i: usize| {
                while space_len_back(&list[..i]) > 0 {
                    i -= space_len_back(&list[..i]);
                }
                i
            };
            let over_space = |mut i: usize| {
                while space_len(&list[i..]) > 0 {
                    i += space_len(&list[i..]);
                }
                i
            };
            let mut comma_before = None;
            if start > 0 {
                let comma = back_over_space(start);
                if comma == 0 || list[comma - 1] != b',' {
                    continue;
                }
                comma_before = Some(comma - 1);
                start = back_over_space(comma - 1);
            }
            let mut comma_after = None;
            let comma = over_space(end);
            if list.get(comma) == Some(&b',') {
                comma_after = Some(comma);
                end = over_space(comma + 1);
            } else if end != list.len() {
                continue;
            }
            // In the middle of the list, one of the two commas stays.
            let (start, end) = match (comma_before, comma_after) {
                (Some(before), Some(after)) => (before, after),
                _ => (start, end),
            };
            return Some(Span::new(
                (list_start + start) as u32,
                (list_start + end) as u32,
            ));
        }
        None
    }

    /// `processUnusedDirectives`, and the messages that `applyDirectives` makes of its result.
    /// `unused`: indices into the directives.
    fn report(&self, unused: &[u32], out: &mut Vec<LintMessage>) {
        let mut groups: Vec<(u32, Vec<u32>)> = Vec::new();
        for &directive in unused {
            let parent = self.directives[directive as usize].parent;
            match groups.iter_mut().find(|it| it.0 == parent) {
                Some(group) => group.1.push(directive),
                None => groups.push((parent, vec![directive])),
            }
        }
        for (parent, group) in groups {
            let parent = &self.parents[parent as usize];
            let names = || group.iter().map(|&it| self.directives[it as usize].name);
            let is_whole_comment = parent
                .names
                .iter()
                .all(|name| names().any(|it| it == *name));
            if !is_whole_comment {
                for &directive in &group {
                    let name = self.directives[directive as usize].name;
                    let Some(span) = self.removal_from_list(parent, name) else {
                        continue;
                    };
                    let mut description = vec![b'\''];
                    description.extend_from_slice(name);
                    description.push(b'\'');
                    out.push(self.message(
                        directive,
                        parent,
                        &description,
                        Fix {
                            span,
                            text: Vec::new(),
                        },
                    ));
                }
                continue;
            }
            let quoted: Vec<&[u8]> = names().filter(|name| !name.is_empty()).collect();
            let mut description = Vec::new();
            for (i, name) in quoted.iter().enumerate() {
                if i > 0 {
                    description.extend_from_slice(match (quoted.len(), i + 1 == quoted.len()) {
                        (2, _) => b" or ",
                        (_, true) => b", or ",
                        _ => b", ",
                    });
                }
                description.push(b'\'');
                description.extend_from_slice(name);
                description.push(b'\'');
            }
            let fix = Fix {
                span: parent.comment,
                text: b" ".to_vec(),
            };
            out.push(self.message(group[0], parent, &description, fix));
        }
    }

    fn message(
        &self,
        directive: u32,
        parent: &Parent,
        description: &[u8],
        fix: Fix,
    ) -> LintMessage {
        let directive = &self.directives[directive as usize];
        let (what, why) = match directive.kind {
            Kind::Enable => (
                "enable",
                &b"no matching eslint-disable directives were found"[..],
            ),
            _ => ("disable", &b"no problems were reported"[..]),
        };
        let mut message = format!("Unused eslint-{what} directive (").into_bytes();
        message.extend_from_slice(why);
        if !description.is_empty() {
            message.extend_from_slice(if directive.kind == Kind::Enable {
                b" for "
            } else {
                b" from "
            });
            message.extend_from_slice(description);
        }
        message.extend_from_slice(b").");
        let (line, column) = match directive.kind {
            Kind::DisableNextLine => parent.start,
            _ => (directive.line, directive.column),
        };
        LintMessage {
            rule_id: None,
            severity: self.report_unused,
            message,
            message_id: None,
            line,
            column,
            end: None,
            is_fatal: false,
            fix: self.wants_fixes.then_some(fix),
            suggestions: Vec::new(),
            suppressions: Vec::new(),
        }
    }

    /// `collectUsedEnableDirectives`: marks the `eslint-enable` directives that end what an
    /// `eslint-disable` before them has started.
    fn mark_used_enables(&self, switches: &[Switch], is_used: &mut [bool]) {
        // The `eslint-enable` that is the next for each rule, and for all rules.
        let mut enabled: Vec<(Option<&RuleId>, u32)> = Vec::new();
        for switch in switches.iter().rev() {
            let rule = self.rule(switch);
            if !switch.disables {
                if rule.is_none() {
                    enabled.clear();
                }
                match enabled.iter_mut().find(|it| it.0 == rule) {
                    Some(entry) => entry.1 = switch.source,
                    None => enabled.push((rule, switch.source)),
                }
            } else if rule.is_none() {
                for (_, source) in enabled.drain(..) {
                    is_used[source as usize] = true;
                }
            } else if let Some(entry) = (enabled.iter().find(|it| it.0 == rule))
                .or_else(|| enabled.iter().find(|it| it.0.is_none()))
            {
                is_used[entry.1 as usize] = true;
            }
        }
    }

    /// `applyDirectives`. `switches` and `messages` are sorted by position. Linear in both, apart
    /// from the comments that are in effect at the same time.
    fn apply(
        &self,
        switches: &[Switch],
        messages: &mut [LintMessage],
        unused: &mut Vec<LintMessage>,
    ) {
        if switches.is_empty() {
            return;
        }
        let mut is_used = vec![false; self.directives.len()];
        // The switches that disable and that no later one has undone for all the rules they are
        // for, as indices into `switches`.
        let mut active: Vec<u32> = Vec::new();
        // For each rule that has been enabled by name: the index of the switch that did it last.
        let mut enabled_at: Vec<(&RuleId, u32)> = Vec::new();
        let mut next = 0;
        for message in messages {
            while let Some(switch) = switches.get(next)
                && (switch.line, switch.column) <= (message.line, message.column)
            {
                match (switch.disables, self.rule(switch)) {
                    (true, _) => active.push(next as u32),
                    (false, None) => {
                        active.clear();
                        enabled_at.clear();
                    }
                    (false, Some(rule)) => {
                        active.retain(|&it| self.rule(&switches[it as usize]) != Some(rule));
                        match enabled_at.iter_mut().find(|it| it.0 == rule) {
                            Some(entry) => entry.1 = next as u32,
                            None => enabled_at.push((rule, next as u32)),
                        }
                    }
                }
                next += 1;
            }
            let rule = message.rule_id.as_ref();
            let since = enabled_at
                .iter()
                .find(|it| Some(it.0) == rule)
                .map(|it| it.1);
            let mut applying = active.iter().filter(|&&it| {
                let of_switch = self.rule(&switches[it as usize]);
                (of_switch.is_none() || of_switch == rule) && since.is_none_or(|since| it > since)
            });
            let was_suppressed = !message.suppressions.is_empty();
            let mut last = None;
            for &it in &mut applying {
                let source = switches[it as usize].source;
                let parent = &self.parents[self.directives[source as usize].parent as usize];
                message.suppressions.push(Suppression {
                    justification: parent.justification.into(),
                });
                last = Some(source);
            }
            if let Some(last) = last
                && !was_suppressed
            {
                is_used[last as usize] = true;
            }
        }
        if self.report_unused == Severity::Off {
            return;
        }
        let is_reported = |switch: &&Switch| {
            !is_used[switch.source as usize] && !self.is_ignored(self.rule(switch))
        };
        let disables: Vec<u32> = (switches.iter().filter(|it| it.disables).filter(is_reported))
            .map(|it| it.source)
            .collect();
        let is_enable =
            |switch: &&Switch| self.directives[switch.source as usize].kind == Kind::Enable;
        let mut enables = Vec::new();
        if switches.iter().any(|it| is_enable(&it)) {
            let mut is_used = vec![false; self.directives.len()];
            self.mark_used_enables(switches, &mut is_used);
            let unused = switches.iter().filter(is_enable);
            let unused =
                unused.filter(|it| !is_used[it.source as usize] && !self.is_ignored(self.rule(it)));
            enables.extend(unused.map(|it| it.source));
        }
        self.report(&disables, unused);
        self.report(&enables, unused);
    }
}

/// Adds to each of `messages`, which are sorted by position, what suppresses it, and adds a message
/// for each comment that does nothing, if these are to be reported.
pub(crate) fn apply_disable_directives(input: &Input, messages: &mut Vec<LintMessage>) {
    let (mut blocks, mut lines) = (Vec::new(), Vec::new());
    for (i, directive) in input.directives.iter().enumerate() {
        let source = i as u32;
        let first_line = match directive.kind {
            Kind::Disable | Kind::Enable => {
                blocks.push(Switch {
                    disables: directive.kind == Kind::Disable,
                    line: directive.line,
                    column: directive.column,
                    source,
                });
                continue;
            }
            Kind::DisableLine => directive.line,
            Kind::DisableNextLine => directive.line + 1,
        };
        lines.push(Switch {
            disables: true,
            line: first_line,
            column: 1,
            source,
        });
        lines.push(Switch {
            disables: false,
            line: first_line + 1,
            column: 0,
            source,
        });
    }
    blocks.sort_by_key(|it| (it.line, it.column));
    lines.sort_by_key(|it| (it.line, it.column));
    let mut unused = Vec::new();
    input.apply(&blocks, messages, &mut unused);
    input.apply(&lines, messages, &mut unused);
    if !unused.is_empty() {
        messages.append(&mut unused);
        messages.sort_by_key(|it| (it.line, it.column));
    }
}
