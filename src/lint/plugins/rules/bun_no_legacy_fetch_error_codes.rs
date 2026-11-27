use crate::bun::{chain_start, compared_with, is_named_code};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::ast_util::is_global_reference;

/// Disallow checking for error codes that `fetch()` no longer uses.
pub struct NoLegacyFetchErrorCodes;

const OLD: &str = "ConnectionRefused";
const NEW: &str = "ECONNREFUSED";

const RENAMED: &Message =
    &Message::new("renamed", "`fetch()` rejects with the code `ECONNREFUSED` instead of `ConnectionRefused`.");
const USE_NEW_CODE: &Message = &Message::new("useNewCode", "Replace it with `ECONNREFUSED`.");

/// `expect(error).toMatchObject({ code: literal })`, `expect(error).toHaveProperty("code", literal)`
fn is_expected_code(literal: Expr) -> bool {
    let argument = match literal.parent() {
        Node::Prop(it) if it.key().is_some_and(|it| it.is("code")) => it.parent().as_expr(),
        Node::Expr(it) => (it.as_call().and_then(|it| it.args().first()).and_then(Expr::as_string))
            .filter(|it| it.is("code"))
            .map(|_| literal),
        _ => None,
    };
    let call = argument.and_then(|it| it.parent().as_expr()).filter(|it| it.tag() == ExprTag::Call);
    call.is_some_and(|it| chain_start(it).as_ident().is_some_and(|it| it.is_any(&["expect", "assert"])))
}

/// `["ECONNRESET", literal]`, `[literal].includes(error.code)`
fn is_in_list_of_codes(literal: Expr) -> bool {
    let Some(list) = literal.parent().as_expr() else {
        return false;
    };
    let is_errno = |it: Name| matches!(it.bytes(), [b'E', rest @ ..] if rest.len() > 3 && rest.iter().all(u8::is_ascii_uppercase));
    let is_searched = || {
        let call = list.parent().as_expr().and_then(|it| it.parent().as_expr()).and_then(Expr::as_call);
        call.and_then(|it| it.args().first()).is_some_and(is_named_code)
    };
    list.as_array().is_some_and(|it| it.iter().filter_map(Expr::as_string).any(is_errno) || is_searched())
}

fn is_check(literal: Expr) -> bool {
    compared_with(literal).is_some_and(is_named_code) || is_expected_code(literal) || is_in_list_of_codes(literal)
}

fn is_fetch(callee: Expr) -> bool {
    match callee.as_dot() {
        Some((object, name, _)) => name.name().is("fetch") && object.as_ident().is_some_and(|it| it.is_any(&["Bun", "globalThis"])),
        None => callee.is_ident("fetch") && is_global_reference(callee),
    }
}

impl Rule for NoLegacyFetchErrorCodes {
    const META: Meta =
        Meta::plugin(Plugin::Bun, "no-legacy-fetch-error-codes", Kind::Problem).fixable(Fixable::Code).has_suggestions();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoLegacyFetchErrorCodes
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions(OLD).then_some(())
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        let fetches = file.exprs_of_kind(ExprTag::Call).filter_map(Expr::callee).any(is_fetch);
        // `Bun.S3Client` still has the old code.
        let uses_s3 = file.mentions_any(&["S3Client", "S3Error", "S3File", "s3"]) || strings::contains(file.text(), b"s3://");
        let literals = |code: &'static str| {
            file.exprs_of_kind(ExprTag::String).filter(move |it| it.as_string().is_some_and(|it| it.is(code)))
        };
        // A file that has the code anywhere else, as in a type or a key, may make such errors itself.
        let is_old = |it: &Token| matches!(it.text(), [b'"' | b'\'' | b'`', code @ .., _] | code if code == OLD.as_bytes());
        if uses_s3 && !fetches || literals(OLD).filter(|it| is_check(*it)).count() != file.tokens().filter(is_old).count() {
            return;
        }
        let function_of = |e: Expr<'a>| Node::Expr(e).enclosing_function();
        let handle_both: Vec<_> = literals(NEW).map(function_of).collect();
        let outdated: Vec<_> = literals(OLD).filter(|it| !handle_both.contains(&function_of(*it))).collect();
        for literal in &outdated {
            let report = cx.report(*literal, RENAMED);
            // All at once, or one that's left for the next pass looks like it's in a function that handles both.
            let fix = |fixer: Fixer<'a>| Vec::from_iter(outdated.iter().map(|it| fixer.replace(it.span().shrink(1, 1), NEW)));
            match fetches && !uses_s3 {
                true => report.fix(fix),
                false => report.suggest(USE_NEW_CODE, fix),
            };
        }
    }
}
