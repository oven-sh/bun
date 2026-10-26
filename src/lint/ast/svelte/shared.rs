//! eslint-plugin-svelte's `lib/shared`: what its `svelte/comment-directive` and `svelte/system` rules leave for its
//! processor. A component has it if that processor is configured for it ([`File::svelte_shared`]), and without it the
//! two rules do nothing. Once all reports about the component are merged and its program's comments are applied, the
//! processor removes what the HTML comments and `settings.svelte.ignoreWarnings` disable ([`Shared::filter`]). Removed
//! messages are gone, not suppressed.
//!
//! Ports parts of eslint-plugin-svelte, Copyright (c) 2021 Yosuke Ota, under the MIT License: see LICENSE.md.

use crate::ast::File;
use crate::linter::LintMessage;
use crate::regex::{Regex, offset_of_utf16_index, utf16_index};
use bun_threading::Guarded;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

/// eslint-plugin-svelte's `Shared`.
#[derive(Default)]
pub struct Shared {
    comment_directives: Guarded<Vec<CommentDirectives>>,
}

impl Shared {
    /// `newCommentDirectives`: returns its index for [`Shared::comment_directives`]. With `report_unused`, messages
    /// with the id `rule_id` whose directive is used are removed.
    pub fn new_comment_directives(&self, rule_id: &'static [u8], report_unused: bool) -> usize {
        let mut all = self.comment_directives.lock();
        all.push(CommentDirectives {
            rule_id,
            report_unused,
            defines: Vec::new(),
            lines: Vec::new(),
            blocks: Vec::new(),
        });
        all.len() - 1
    }

    /// Adds to the directives that [`Shared::new_comment_directives`] created at index `at`.
    pub fn comment_directives(&self, at: usize, add: impl FnOnce(&mut CommentDirectives)) {
        if let Some(it) = self.comment_directives.lock().get_mut(at) {
            add(it);
        }
    }

    /// The processor's `postprocess`: each [`CommentDirectives`], in creation order, removes what it disables from what
    /// the previous one left. `messages` are sorted. Returns the remaining messages and the removed ones.
    pub fn filter(&self, messages: Vec<LintMessage>) -> (Vec<LintMessage>, Vec<LintMessage>) {
        let all = self.comment_directives.lock();
        let mut removed = Vec::new();
        let kept = all
            .iter()
            .fold(messages, |messages, it| it.filter(messages, &mut removed));
        (kept, removed)
    }
}

impl<'a> File<'a> {
    /// See [`Shared`]. Set before anything is queried on the file.
    pub fn set_svelte_shared(&self, shared: &'a Shared) {
        self.svelte_shared.set(Some(shared));
    }

    /// eslint-plugin-svelte's `getShared(filename)`.
    #[inline]
    pub fn svelte_shared(&self) -> Option<&'a Shared> {
        self.svelte_shared.get()
    }
}

/// A line from 1 and a column from 0: ESLint's `loc`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Loc {
    pub line: u32,
    pub column: u32,
}

impl Loc {
    /// The location of `offset` in `component`.
    pub fn of(component: &super::Component, offset: u32) -> Loc {
        let at = component.position(offset);
        Loc {
            line: at.line,
            column: at.column,
        }
    }
}

/// The rules a directive applies to.
#[derive(Clone)]
pub enum Rules {
    /// One rule, by id.
    Named(Box<[u8]>),
    /// `svelte/comment-directive`'s `ALL_RULES`.
    All,
    /// `svelte/system`'s `isIgnoreRule`.
    Ignored(Arc<IgnoreWarnings>),
}

impl Rules {
    fn test(&self, id: &[u8]) -> bool {
        match self {
            Rules::Named(name) => **name == *id,
            Rules::All => true,
            Rules::Ignored(warnings) => warnings.test(id),
        }
    }

    /// A block's `targetRule`. `None` means `ALL`.
    fn target(&self) -> Option<&[u8]> {
        match self {
            Rules::Named(name) => Some(name),
            Rules::All | Rules::Ignored(_) => None,
        }
    }
}

/// `settings.svelte.ignoreWarnings`, as `svelte/system` read it.
pub struct IgnoreWarnings(pub Vec<IgnoreWarning>);

pub enum IgnoreWarning {
    Id(Box<[u8]>),
    /// `"/pattern/flags"`. With the `g` or `y` flag, `test` starts at `lastIndex` and advances it, as in JavaScript, in
    /// UTF-16 code units of the id it tests, which the next id starts from too. Without the `u` flag it can stop
    /// between the two halves of a character.
    Pattern {
        regex: Regex,
        last_index: AtomicU32,
    },
}

/// `utils/regexp.js`'s `RE_REGEXP_STR`.
static PATTERN: std::sync::LazyLock<Regex> =
    std::sync::LazyLock::new(|| Regex::literal(r"/^\/(.+)\/([A-Za-z]*)$/u"));

impl IgnoreWarning {
    /// eslint-plugin-svelte's `toRegExp`: `"/pattern/flags"` is a pattern, and anything else is a text to compare for
    /// equality. `Err` holds what `new RegExp` throws, in V8's words.
    pub fn of(item: &[u8]) -> Result<IgnoreWarning, Vec<u8>> {
        let Some(parts) = PATTERN.exec_at(item, 0) else {
            return Ok(IgnoreWarning::Id(item.into()));
        };
        let (source, flags) = (parts.bytes(1), parts.bytes(2));
        if Regex::from_bytes(b"", flags).is_err() {
            let quoted = [
                &b"Invalid flags supplied to RegExp constructor '"[..],
                flags,
                b"'",
            ];
            return Err(quoted.concat());
        }
        match Regex::from_bytes(source, flags) {
            Ok(regex) => Ok(IgnoreWarning::Pattern {
                regex,
                last_index: AtomicU32::new(0),
            }),
            Err(error) => Err(error.message.into_bytes()),
        }
    }
}

impl IgnoreWarnings {
    /// True if one of them equals or matches `id`: `some((r) => r.test(id))`.
    pub fn test(&self, id: &[u8]) -> bool {
        self.0.iter().any(|it| match it {
            IgnoreWarning::Id(ignored) => **ignored == *id,
            IgnoreWarning::Pattern { regex, last_index } => {
                let flags = regex.flags();
                if !flags.global && !flags.sticky {
                    return regex.test(id);
                }
                let from = last_index.load(Ordering::Relaxed) as usize;
                let found = (from <= utf16_index(id, id.len()))
                    .then(|| regex.find_at(id, offset_of_utf16_index(id, from)))
                    .flatten();
                let end = found.map_or(0, |it| utf16_index(id, it.end()));
                last_index.store(end as u32, Ordering::Relaxed);
                found.is_some()
            }
        })
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Kind {
    Enable,
    Disable,
}

/// The key of `CommentDirectives`' maps: an id, or `COMPUTED` for the rules a function selects.
#[derive(PartialEq, Eq)]
enum Key {
    Id(Box<[u8]>),
    Computed,
}

impl Key {
    fn of(rules: &Rules) -> Key {
        match rules.target() {
            Some(id) => Key::Id(id.into()),
            None => Key::Computed,
        }
    }
}

/// A directive's index, which marks it as used and finds its `define.loc`.
type Number = usize;

struct LineDisable {
    number: Number,
    rules: Rules,
}

struct Block {
    number: Number,
    loc: Loc,
    rules: Rules,
    kind: Kind,
}

/// eslint-plugin-svelte's `CommentDirectives`.
pub struct CommentDirectives {
    rule_id: &'static [u8],
    report_unused: bool,
    /// Each directive's `define.loc`, by index.
    defines: Vec<Loc>,
    /// `lineDisableDirectives`: by key, then by line. Maps in insertion order.
    lines: Vec<(Key, Vec<(u32, Vec<LineDisable>)>)>,
    /// `blockDirectives`
    blocks: Vec<(Key, Vec<Block>)>,
}

impl CommentDirectives {
    fn define(&mut self, loc: Loc) -> Number {
        self.defines.push(loc);
        self.defines.len() - 1
    }

    /// `disableLine`
    pub fn disable_line(&mut self, line: u32, rules: Rules, define: Loc) {
        let number = self.define(define);
        let key = Key::of(&rules);
        let at = match self.lines.iter().position(|it| it.0 == key) {
            Some(at) => at,
            None => {
                self.lines.push((key, Vec::new()));
                self.lines.len() - 1
            }
        };
        let Some((_, by_line)) = self.lines.get_mut(at) else {
            return;
        };
        let on_line = match by_line.iter().position(|it| it.0 == line) {
            Some(at) => at,
            None => {
                by_line.push((line, Vec::new()));
                by_line.len() - 1
            }
        };
        if let Some((_, list)) = by_line.get_mut(on_line) {
            list.push(LineDisable { number, rules });
        }
    }

    /// `disableBlock`
    pub fn disable_block(&mut self, loc: Loc, rules: Rules, define: Loc) {
        self.block(loc, rules, define, Kind::Disable);
    }

    /// `enableBlock`
    pub fn enable_block(&mut self, loc: Loc, rules: Rules, define: Loc) {
        self.block(loc, rules, define, Kind::Enable);
    }

    fn block(&mut self, loc: Loc, rules: Rules, define: Loc, kind: Kind) {
        let number = self.define(define);
        let key = Key::of(&rules);
        let block = Block {
            number,
            loc,
            rules,
            kind,
        };
        match self.blocks.iter_mut().find(|it| it.0 == key) {
            Some((_, list)) => list.push(block),
            None => self.blocks.push((key, vec![block])),
        }
    }

    /// `getFromRule`: the entries for `id` by name, then the entries for rules a function selects.
    fn from_rule<'s, T>(map: &'s [(Key, T)], id: &[u8]) -> impl Iterator<Item = &'s T> {
        let named = map
            .iter()
            .find(|it| matches!(&it.0, Key::Id(key) if **key == *id));
        let computed = map.iter().find(|it| it.0 == Key::Computed);
        named.into_iter().chain(computed).map(|it| &it.1)
    }

    /// `filterMessages`. Removed messages go to `removed`.
    fn filter(
        &self,
        messages: Vec<LintMessage>,
        removed: &mut Vec<LintMessage>,
    ) -> Vec<LintMessage> {
        let mut used = vec![false; self.defines.len()];
        if self.report_unused {
            // An enable directive is used if a disable directive before it is in effect.
            let mut all: Vec<&Block> = self.blocks.iter().flat_map(|it| &it.1).collect();
            all.sort_by(|a, b| compare(b.loc, a.loc));
            let mut enables: Vec<&Block> = Vec::new();
            for block in all {
                match (block.kind, block.rules.target()) {
                    (Kind::Enable, target) => {
                        if target.is_none() {
                            enables.clear();
                        }
                        enables.push(block);
                    }
                    (Kind::Disable, None) => {
                        for it in enables.drain(..) {
                            mark(&mut used, it.number);
                        }
                    }
                    (Kind::Disable, Some(target)) => enables.retain(|it| {
                        let is_used = it.rules.target().is_none_or(|it| it == target);
                        if is_used {
                            mark(&mut used, it.number);
                        }
                        !is_used
                    }),
                }
            }
        }
        // Each key's blocks, last first: the order of `getFromRule(..).sort(comparePos).reverse()`.
        let blocks: Vec<Vec<&Block>> = (self.blocks.iter())
            .map(|(_, list)| {
                let mut list: Vec<&Block> = list.iter().collect();
                list.sort_by(|a, b| compare(b.loc, a.loc));
                list
            })
            .collect();
        let mut id = Vec::new();
        let mut kept: Vec<LintMessage> = Vec::with_capacity(messages.len());
        for message in messages {
            let Some(rule_id) = &message.rule_id else {
                kept.push(message);
                continue;
            };
            id.clear();
            rule_id.write_to(&mut id);
            match self.is_enabled(&message, &id, &blocks, &mut used) {
                true => kept.push(message),
                false => removed.push(message),
            }
        }
        if !self.report_unused {
            return kept;
        }
        let used_at: Vec<Loc> = (used.iter().zip(&self.defines))
            .filter(|it| *it.0)
            .map(|it| *it.1)
            .collect();
        // A message's column counts from 1.
        let is_used = |it: &LintMessage| {
            (used_at.iter())
                .any(|at| at.line == it.line && i64::from(at.column) == i64::from(it.column) - 1)
                && it.rule_id.as_ref().is_some_and(|id| {
                    let mut written = Vec::new();
                    id.write_to(&mut written);
                    written == self.rule_id
                })
        };
        let (used_messages, kept): (Vec<LintMessage>, Vec<LintMessage>) =
            kept.into_iter().partition(is_used);
        removed.extend(used_messages);
        kept
    }

    /// `isEnable` for a message of the rule `id`. `blocks` holds each key's blocks from `self.blocks`, last first.
    fn is_enabled(
        &self,
        message: &LintMessage,
        id: &[u8],
        blocks: &[Vec<&Block>],
        used: &mut [bool],
    ) -> bool {
        for by_line in Self::from_rule(&self.lines, id) {
            let on_line = by_line.iter().filter(|it| it.0 == message.line);
            for disable in on_line.flat_map(|it| &it.1) {
                if disable.rules.test(id) {
                    mark(used, disable.number);
                    return false;
                }
            }
        }
        // The entries for `id` by name, then the ones for rules a function selects, when two are at the same position.
        let at_key = |is: &dyn Fn(&Key) -> bool| {
            let at = self.blocks.iter().position(|it| is(&it.0));
            at.and_then(|it| blocks.get(it))
                .map_or(&[][..], |it| &it[..])
        };
        let named = at_key(&|key| matches!(key, Key::Id(key) if **key == *id));
        let computed = at_key(&|key| *key == Key::Computed);
        let (mut named, mut computed) = (named.iter().peekable(), computed.iter().peekable());
        let in_order = std::iter::from_fn(|| match (named.peek(), computed.peek()) {
            (Some(a), Some(b)) if compare(b.loc, a.loc).is_gt() => computed.next(),
            (Some(_), _) => named.next(),
            (None, _) => computed.next(),
        });
        // A message's column counts from 1 and a `loc`'s from 0, and upstream compares them as is.
        let at = (i64::from(message.line), i64::from(message.column));
        for block in in_order {
            if at < (i64::from(block.loc.line), i64::from(block.loc.column)) {
                continue;
            }
            if !block.rules.test(id) {
                continue;
            }
            if block.kind == Kind::Enable {
                return true;
            }
            mark(used, block.number);
            return false;
        }
        true
    }
}

fn mark(used: &mut [bool], number: Number) {
    if let Some(it) = used.get_mut(number) {
        *it = true;
    }
}

/// `comparePos`
fn compare(a: Loc, b: Loc) -> std::cmp::Ordering {
    (a.line, a.column).cmp(&(b.line, b.column))
}
