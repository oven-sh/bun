use bun_core::strings;
use bun_lint_oxlint::text::find_next_token_within;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use std::cell::OnceCell;

/// Forbid empty named import blocks.
pub struct NoEmptyNamedBlocks;

const UNEXPECTED: Message = Message::new("", "Unexpected empty named import block");
const REMOVE_IMPORT: Message = Message::new("", "Remove unused import");
const REMOVE_BLOCK: Message = Message::new("", "Remove empty import block");
const NO_EMPTY_NAMED_BLOCKS: Message = Message::new("", "Unexpected empty named `import` block.");

impl Rule for NoEmptyNamedBlocks {
    const META: Meta = Meta::plugin(Plugin::Import, "no-empty-named-blocks", Kind::Suggestion)
        .fixable(Fixable::Code)
        .has_suggestions()
        .reports_at_the_end();
    const ON: On = On::new().stmts(&[StmtTag::Import]);
    /// What `up_to_from` says, which is the same for every import of a file.
    type State<'a> = OnceCell<Option<(u32, &'static str)>>;

    fn new(_: &Options) -> Self {
        NoEmptyNamedBlocks
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Self::State<'a>> {
        Some(OnceCell::new())
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Import(import) = stmt.kind() else {
            return;
        };
        if !import.named().is_empty() {
            return;
        }
        // oxlint looks at the tree, the plugin at every `{` that a `}` follows: that of `with {}` too.
        if !cx.language().is_oxlint {
            if import.has_named_imports() || import.attributes().is_some_and(|it| it.entries().is_empty()) {
                check_tokens(stmt, cx);
            }
            return;
        }
        if import.namespace().is_some() {
            return;
        }
        let Some(specifier) = import.default() else {
            // Without an `import {} from "a"` the module `a` is not run. An `import type` runs nothing.
            if import.has_named_imports() {
                let report = cx.report(stmt, NO_EMPTY_NAMED_BLOCKS);
                match import.is_type_only() {
                    true => report.fix(|fixer| fixer.remove(stmt)),
                    false => report.suggest(NO_EMPTY_NAMED_BLOCKS, |fixer| fixer.remove(stmt)),
                };
            }
            return;
        };
        // As oxlint: a `,` and a `from` anywhere in what follows, also in the specifier and in the attributes.
        let (start, end) = (specifier.span().end, stmt.span().end);
        if let Some(comma) = find_next_token_within(cx.file(), Span::new(start, end), b",")
            && let Some(from) = find_next_token_within(cx.file(), Span::new(comma, end), b"from")
        {
            cx.report(stmt, NO_EMPTY_NAMED_BLOCKS).fix(|fixer| fixer.replace(Span::new(start, from), " "));
        }
    }
}

fn has_value(token: Token, values: &[&str]) -> bool {
    let value = token.decoded_value();
    values.iter().any(|it| it.as_bytes() == &*value)
}

#[cold]
#[inline(never)]
fn check_tokens<'a>(stmt: Stmt<'a>, cx: &Cx<'a, NoEmptyNamedBlocks>) {
    let file = cx.file();
    let has_other_identifiers = file
        .tokens_in(stmt)
        .any(|it| it.kind() == TokenKind::Identifier && !has_value(it, &["from", "type", "typeof"]));
    let mut previous: Option<Token> = None;
    let mut tokens = file.tokens_in(stmt).peekable();
    while let Some(open) = tokens.next() {
        if open.is_punctuator("{")
            && let Some(close) = tokens.peek().copied().filter(|it| it.is_punctuator("}"))
        {
            // upstream's `getEmptyBlockRange`
            let start = previous.filter(|it| has_value(*it, &[",", "type", "typeof"])).unwrap_or(open).start();
            let block = Span::new(start, close.end());
            let report = cx.report(stmt, UNEXPECTED);
            match has_other_identifiers {
                true => report.fix(|fixer| fixer.remove(block)),
                false => report.suggest(REMOVE_IMPORT, |fixer| fixer.remove(stmt)).suggest(REMOVE_BLOCK, |fixer| {
                    let (end, filler) = (*cx.state.get_or_init(|| up_to_from(file)))?;
                    Some(fixer.replace(Span::new(start, end), filler))
                }),
            };
        }
        previous = Some(open);
    }
}

/// Where the suggestion that leaves `import 'mod'` ends, and what it puts there. Upstream takes the first `from` and
/// the first `import` of the program, whichever import it is at. Without a `from`, or with nothing after it, it throws.
fn up_to_from<'a>(file: &'a File<'a>) -> Option<(u32, &'static str)> {
    let from = file.tokens().find(|it| has_value(*it, &["from"]))?;
    let import = file.tokens().find(|it| has_value(*it, &["import"]))?;
    let after = file.token_after(from)?;
    let end = match file.is_space_between(from, after) {
        true => from.end() + strings::js_whitespace_len(file.slice(from.span().between(after.span()))).max(1) as u32,
        false => from.end(),
    };
    Some((end, if file.is_space_between(import, after) { "" } else { " " }))
}
