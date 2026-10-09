use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce combining multiple `Array#push()`, `Element#classList.{add,remove}()`, and `importScripts()` into one call.
pub struct PreferSingleCall {
    ignore: Vec<String>,
}

const PREFER_SINGLE_CALL: Message = Message::new("", "Do not call `{{description}}` multiple times.");

impl Rule for PreferSingleCall {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-single-call", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        PreferSingleCall { ignore: options.object(0).strings("ignore").into_iter().map(String::from).collect() }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions_any(&["push", "unshift", "classList", "importScripts"]) {
            return;
        }
        on.stmts([StmtTag::Expr], |rule, curr_es, cx| {
            let Some((curr_call, curr_info)) = rule.classify_statement(curr_es) else {
                return;
            };
            let stmts = match curr_es.parent() {
                Node::File(file) => Some(file.body()),
                Node::Func(func) => func.body_statements(),
                Node::Stmt(block) => block.as_block(),
                Node::Case(case) => Some(case.body()),
                _ => None,
            };
            let Some(prev_es) = stmts.and_then(|it| it.before(curr_es.span().start)) else {
                return;
            };
            let Some((prev_call, prev_info)) = rule.classify_statement(prev_es) else {
                return;
            };
            if prev_info.description != curr_info.description || prev_info.receiver_text != curr_info.receiver_text {
                return;
            }
            cx.report(curr_info.diagnostic_span, PREFER_SINGLE_CALL).data("description", curr_info.description).fix(|fixer| {
                let file = fixer.file();
                let text_of = |it: Expr<'a>| file.slice(it.outer_span());
                let (first, second) = (prev_es.span(), curr_es.span());
                let keep_second_call = curr_info.keep_second_call;
                let removal_span = if keep_second_call { Span::new(first.start, second.start) } else { Span::new(first.end, second.end) };
                // The first call changes what an argument of the second reads. A comment would be lost.
                if curr_call.1.args().iter().any(|it| arg_references_receiver(text_of(it), prev_info.receiver_text))
                    || file.comments_in(removal_span).next().is_some()
                {
                    return None;
                }
                let (target, source) = if keep_second_call { (curr_call, prev_call) } else { (prev_call, curr_call) };
                let mut fix = Vec::with_capacity(2);
                if !source.1.args().is_empty() {
                    let target_src = target.0.text();
                    let before_paren = text::trim_end(target_src.get(..target_src.len().saturating_sub(1)).unwrap_or_default());
                    let mut arguments = if target.1.args().is_empty() {
                        Vec::new()
                    } else if before_paren.ends_with(b",") {
                        b" ".to_vec()
                    } else {
                        b", ".to_vec()
                    };
                    for (i, argument) in source.1.args().iter().enumerate() {
                        arguments.extend_from_slice(if i == 0 { "" } else { ", " }.as_bytes());
                        arguments.extend_from_slice(text_of(argument));
                    }
                    arguments.push(b')');
                    let end = target.0.span().end;
                    fix.push(fixer.replace(Span::new(end.saturating_sub(1), end), arguments));
                }
                // The `;` of the second statement stays if the first has none.
                let has_semi = |it: Stmt<'a>| text::trim_end(it.text()).ends_with(b";");
                let needs_semi = !keep_second_call && !has_semi(prev_es) && has_semi(curr_es);
                fix.push(fixer.replace(removal_span, if needs_semi { ";" } else { "" }));
                Some(fix)
            });
        });
    }
}

const DEFAULT_ARRAY_MUTATION_IGNORE: [&str; 12] = [
    "stream.push",
    "this.push",
    "this.stream.push",
    "process.stdin.push",
    "process.stdout.push",
    "process.stderr.push",
    "stream.unshift",
    "this.unshift",
    "this.stream.unshift",
    "process.stdin.unshift",
    "process.stdout.unshift",
    "process.stderr.unshift",
];

struct CallInfo<'a> {
    description: &'static str,
    receiver_text: &'a [u8],
    diagnostic_span: Span,
    keep_second_call: bool,
}

/// `a`, `this`, `a.b.c`
fn is_stable_receiver(expr: Expr) -> bool {
    let mut at = expr;
    loop {
        match at.kind() {
            ExprKind::Ident(_) | ExprKind::This => return true,
            ExprKind::Dot { obj, chain: Chain::No, .. } if !at.is_private_member() => at = obj,
            _ => return false,
        }
    }
}

impl PreferSingleCall {
    /// The call that is all of `statement`, if it is one that the rule is about.
    fn classify_statement<'a>(&self, statement: Stmt<'a>) -> Option<((Expr<'a>, Call<'a>), CallInfo<'a>)> {
        let StmtKind::Expr(e) = statement.kind() else {
            return None;
        };
        // What is in parentheses, and an optional chain, is not a call for oxlint.
        let call = e.as_call().filter(|it| it.chain() == Chain::No && !e.is_parenthesized())?;
        Some(((e, call), self.classify_call(call)?))
    }

    fn classify_call<'a>(&self, call: Call<'a>) -> Option<CallInfo<'a>> {
        let callee = call.callee();
        let (object, property) = match callee.kind() {
            ExprKind::Ident(name) if name.is("importScripts") => {
                return Some(CallInfo {
                    description: "importScripts()",
                    receiver_text: b"importScripts",
                    diagnostic_span: callee.span(),
                    keep_second_call: false,
                });
            }
            ExprKind::Dot { obj, name, chain: Chain::No } if !callee.is_private_member() => (obj, name),
            _ => return None,
        };
        let (description, receiver, keep_second_call) = match property.bytes() {
            method @ (b"push" | b"unshift") => {
                let callee_text = callee.file().slice(callee.outer_span());
                if DEFAULT_ARRAY_MUTATION_IGNORE.iter().any(|it| it.as_bytes() == callee_text)
                    || self.ignore.iter().any(|it| it.as_bytes() == callee_text)
                {
                    return None;
                }
                let is_push = method == b"push";
                (if is_push { "Array#push()" } else { "Array#unshift()" }, object, !is_push)
            }
            method @ (b"add" | b"remove") => {
                // `<element>.classList.add/remove`
                let ExprKind::Dot { obj: element, name, chain: Chain::No } = object.kind() else {
                    return None;
                };
                if !name.name().is("classList") {
                    return None;
                }
                (if method == b"add" { "Element#classList.add()" } else { "Element#classList.remove()" }, element, false)
            }
            _ => return None,
        };
        is_stable_receiver(receiver).then(|| CallInfo {
            description,
            receiver_text: receiver.text(),
            diagnostic_span: property.span(),
            keep_second_call,
        })
    }
}

/// Whether the text `receiver` is in `arg_src`, not as a part of a longer name.
fn arg_references_receiver(arg_src: &[u8], receiver: &[u8]) -> bool {
    if receiver.is_empty() {
        return false;
    }
    let mut from = 0;
    while let Some(found) = arg_src.get(from..).and_then(|rest| strings::index_of(rest, receiver)) {
        let (start, end) = (from + found, from + found + receiver.len());
        let before = arg_src.get(..start).and_then(text::last_code_point);
        let after = arg_src.get(end..).and_then(text::first_code_point);
        if !before.is_some_and(text::is_identifier_part) && !after.is_some_and(text::is_identifier_part) {
            return true;
        }
        from = start + 1;
    }
    false
}
