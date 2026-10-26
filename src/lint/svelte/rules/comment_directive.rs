use bun_core::strings;
use bun_lint::ast::svelte::shared::{Loc, Rules, Shared};
use bun_lint::ast::svelte::{
    Component, InComponent, Role, SvelteId, SvelteNode, SvelteTag, html_comment_value,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use std::sync::LazyLock;

/// support comment-directives in HTML template
pub struct CommentDirective {
    report_unused: bool,
}

const UNUSED: Message = Message::new(
    "unused",
    "Unused {{kind}} directive (no problems were reported).",
);
const UNUSED_RULE: Message = Message::new(
    "unusedRule",
    "Unused {{kind}} directive (no problems were reported from '{{rule}}').",
);
const UNUSED_ENABLE: Message = Message::new(
    "unusedEnable",
    "Unused {{kind}} directive (reporting is not suppressed).",
);
const UNUSED_ENABLE_RULE: Message = Message::new(
    "unusedEnableRule",
    "Unused {{kind}} directive (reporting from '{{rule}}' is not suppressed).",
);

static BLOCK: LazyLock<Regex> =
    LazyLock::new(|| Regex::literal(r"/^\s*(eslint-(?:en|dis)able)(?:\s+|$)/"));
static LINE: LazyLock<Regex> =
    LazyLock::new(|| Regex::literal(r"/^\s*(eslint-disable(?:-next)?-line)(?:\s+|$)/"));
static RULES: LazyLock<Regex> = LazyLock::new(|| Regex::literal(r"/([^\s,]+)[\s,]*/g"));
/// Where `stripDirectiveComment` cuts the comment off.
static JUSTIFICATION: LazyLock<Regex> = LazyLock::new(|| Regex::literal(r"/\s-{2,}\s/u"));

pub struct Directives<'a> {
    shared: &'a Shared,
    /// The index in `shared`.
    at: usize,
    component: &'a Component,
    /// Keyed by the node each one belongs to, in the node's order.
    found: Vec<(SvelteId, Directive)>,
}

enum Directive {
    DisableLine(u32, Rules, Loc),
    DisableBlock(Loc, Rules, Loc),
    EnableBlock(Loc, Rules, Loc),
}

/// A directive comment as `parse` returns it: its kind, and each rule it names.
struct Parsed<'t> {
    kind: &'t [u8],
    rules: Vec<Named<'t>>,
}

/// A rule a directive names, and where upstream places the name.
struct Named<'t> {
    at: Span,
    /// How many UTF-16 code units into the character at the end of `at` the end falls: the middle of a surrogate pair.
    into_last: u32,
    id: &'t [u8],
}

/// `parse(pattern, comment)` for the text of an HTML comment that starts at `start`.
fn parse<'t>(pattern: &Regex, comment: &'t [u8], start: u32) -> Option<Parsed<'t>> {
    let value = html_comment_value(comment)?;
    let text = match JUSTIFICATION.find(value) {
        Some(it) => value.get(..it.start())?,
        None => value,
    };
    let found = pattern.exec_at(text, 0)?;
    let kind = found.get(1)?.as_bytes();
    let value_start = start + 4;
    // Each name starts where the previous one, or the directive, ends: past the separators that follow it, but not past
    // those before the first name. From there it's as long as the name in UTF-16 code units.
    let mut at = found.end();
    let mut rules = Vec::new();
    while let Some(rule) = RULES.exec_at(text, at) {
        let id = rule.get(1)?.as_bytes();
        let (from, units) = (text.get(at..)?, strings::wtf8_len_utf16(id));
        let len = strings::wtf8_offset_of_utf16_index(from, units);
        let name_start = value_start + at as u32;
        rules.push(Named {
            at: Span::new(name_start, name_start + len as u32),
            into_last: units.saturating_sub(strings::wtf8_len_utf16(from.get(..len)?)),
            id,
        });
        at = rule.end();
    }
    Some(Parsed { kind, rules })
}

impl CommentDirective {
    /// Reports `message` about the directive of `kind` at the rule it names.
    fn report_rule<'a>(
        &self,
        name: &Named<'a>,
        message: Message,
        kind: &'a [u8],
        cx: &mut Cx<'a, Self>,
    ) {
        let report = cx.report(InComponent(name.at), message);
        let report = report.data("rule", name.id).data("kind", kind);
        if name.into_last > 0 {
            let end = cx.state.loc(name.at.end);
            let column = end.column + name.into_last;
            drop(report.end_at(Position { line: end.line, column }));
        }
    }

    /// `processBlock`
    fn process_block<'a>(&self, comment: SvelteNode<'a>, cx: &mut Cx<'a, Self>) {
        let span = comment.span();
        let Some(parsed) = parse(&BLOCK, comment.text(), span.start) else {
            return;
        };
        let is_disable = parsed.kind == b"eslint-disable";
        let (start, end) = (cx.state.loc(span.start), cx.state.loc(span.end));
        if parsed.rules.is_empty() {
            if self.report_unused {
                let message = if is_disable { UNUSED } else { UNUSED_ENABLE };
                cx.report(comment, message).data("kind", parsed.kind);
            }
            let directive = match is_disable {
                true => Directive::DisableBlock(end, Rules::All, start),
                false => Directive::EnableBlock(start, Rules::All, start),
            };
            cx.state.found.push((comment.id(), directive));
            return;
        }
        for name in parsed.rules {
            if self.report_unused {
                let message = if is_disable {
                    UNUSED_RULE
                } else {
                    UNUSED_ENABLE_RULE
                };
                self.report_rule(&name, message, parsed.kind, cx);
            }
            let (define, rules) = (cx.state.loc(name.at.start), Rules::Named(name.id.into()));
            let directive = match is_disable {
                true => Directive::DisableBlock(end, rules, define),
                false => Directive::EnableBlock(start, rules, define),
            };
            cx.state.found.push((comment.id(), directive));
        }
    }

    /// `processLine`
    fn process_line<'a>(&self, comment: SvelteNode<'a>, cx: &mut Cx<'a, Self>) {
        let span = comment.span();
        let Some(parsed) = parse(&LINE, comment.text(), span.start) else {
            return;
        };
        let (start, end) = (cx.state.loc(span.start), cx.state.loc(span.end));
        if start.line != end.line {
            return;
        }
        let line = start.line + u32::from(parsed.kind != b"eslint-disable-line");
        if parsed.rules.is_empty() {
            if self.report_unused {
                cx.report(comment, UNUSED).data("kind", parsed.kind);
            }
            let directive = Directive::DisableLine(line, Rules::All, start);
            cx.state.found.push((comment.id(), directive));
            return;
        }
        for name in parsed.rules {
            if self.report_unused {
                self.report_rule(&name, UNUSED_RULE, parsed.kind, cx);
            }
            let define = cx.state.loc(name.at.start);
            let directive = Directive::DisableLine(line, Rules::Named(name.id.into()), define);
            cx.state.found.push((comment.id(), directive));
        }
    }
}

impl Directives<'_> {
    fn loc(&self, offset: u32) -> Loc {
        Loc::of(self.component, offset)
    }
}

impl Rule for CommentDirective {
    const META: Meta =
        Meta::plugin(Plugin::Svelte, "comment-directive", Kind::Problem).feeds_processor();
    const ON: On = On::new()
        .svelte_nodes(&[SvelteTag::HtmlComment, SvelteTag::ScriptElement])
        .finish();
    type State<'a> = Directives<'a>;

    fn new(options: &Options) -> Self {
        CommentDirective {
            report_unused: options
                .object(0)
                .bool_or("reportUnusedDisableDirectives", false),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Directives<'a>> {
        let (shared, component) = (file.svelte_shared()?, file.svelte()?);
        // Whatever name the config gives the rule, its messages under another name stay wherever their directive is
        // used.
        let at = shared.new_comment_directives(b"svelte/comment-directive", self.report_unused);
        Some(Directives {
            shared,
            at,
            component,
            found: Vec::new(),
        })
    }

    fn svelte_node<'a>(&self, node: SvelteNode<'a>, cx: &mut Cx<'a, Self>) {
        match node.tag() {
            SvelteTag::HtmlComment => {
                self.process_block(node, cx);
                self.process_line(node, cx);
            }
            _ => {
                let Some(start_tag) = node.child(Role::StartTag) else {
                    return;
                };
                let (loc, define) = (
                    cx.state.loc(start_tag.span().end),
                    cx.state.loc(node.span().start),
                );
                let directive = Directive::EnableBlock(loc, Rules::All, define);
                cx.state.found.push((node.id(), directive));
            }
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let state = &mut cx.state;
        // In ESLint's traversal order.
        bun_lint::utils::sort::sort_by_key(&mut state.found, |it| it.0);
        let found = std::mem::take(&mut state.found);
        state.shared.comment_directives(state.at, |directives| {
            for (_, directive) in found {
                match directive {
                    Directive::DisableLine(line, rules, define) => {
                        directives.disable_line(line, rules, define);
                    }
                    Directive::DisableBlock(loc, rules, define) => {
                        directives.disable_block(loc, rules, define);
                    }
                    Directive::EnableBlock(loc, rules, define) => {
                        directives.enable_block(loc, rules, define);
                    }
                }
            }
        });
    }
}
