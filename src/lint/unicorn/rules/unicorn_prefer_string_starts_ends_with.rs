use bun_lint_oxlint::ast_util::get_member_expr;
use bun_lint_oxlint::codegen::print_string;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::regex::{
    self,
    ast::{Assertion, Kind as RegexKind},
};
use bun_lint::rule::Plugin;

/// Prefer `String#startsWith()` and `String#endsWith()` over `RegExp#test()`.
pub struct PreferStringStartsEndsWith;

const STARTS_WITH: Message = Message::new("", "Prefer String#startsWith over a regex with a caret.");
const ENDS_WITH: Message = Message::new("", "Prefer String#endsWith over a regex with a dollar sign.");

impl Rule for PreferStringStartsEndsWith {
    const META: Meta =
        Meta::oxlint(Plugin::Unicorn, "prefer-string-starts-ends-with", Kind::Problem).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferStringStartsEndsWith
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        if !file.mentions("test") || !file.has_exprs([ExprTag::Regex]) {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call().filter(|it| !it.is_optional()) else {
            return;
        };
        let Some(member) = get_member_expr(call.callee()) else {
            return;
        };
        let ExprKind::Dot { obj, name, .. } = member.kind() else {
            return;
        };
        let ExprKind::Regex(literal) = obj.kind() else {
            return;
        };
        if !name.name().is("test") {
            return;
        }
        let Some((is_start, characters)) = check_regex(literal.pattern(), literal.flags()) else {
            return;
        };
        cx.report(member, if is_start { STARTS_WITH } else { ENDS_WITH }).fix(|fixer| {
            let target = can_replace(call)?;
            let argument: String = characters.iter().map(|it| char::from_u32(*it)).collect::<Option<_>>()?;
            let method: &[u8] = if is_start { b".startsWith(" } else { b".endsWith(" };
            let mut content = [target.text(), method].concat();
            print_string(&mut content, argument.as_bytes(), b'\'');
            content.push(b')');
            Some(fixer.replace(e, content))
        });
    }
}

/// The argument of the call, if a method can be called on it as it is written.
fn can_replace(call: Call<'_>) -> Option<Expr<'_>> {
    let argument = call.args().first().filter(|_| call.args().len() == 1)?;
    let can = match argument.tag() {
        ExprTag::String | ExprTag::Template | ExprTag::Ident => true,
        ExprTag::Dot | ExprTag::Index | ExprTag::Call => !argument.is_chain_root() && !argument.is_private_member(),
        _ => false,
    };
    can.then_some(argument)
}

/// Whether the pattern is a `^` and characters (`true`) or characters and a `$` (`false`), and the characters.
fn check_regex(pattern: &[u8], flags: &[u8]) -> Option<(bool, Vec<u32>)> {
    if !pattern.starts_with(b"^") && !pattern.ends_with(b"$")
        || strings::contains_char(flags, b'm')
        || strings::contains_char(flags, b'i') && pattern.iter().any(u8::is_ascii_alphabetic)
    {
        return None;
    }
    let ast = regex::parse_pattern(pattern, regex::Mode::of_flags(flags), regex::Options::default()).ok()?;
    let RegexKind::Pattern { alternatives } = ast.pattern().kind() else {
        return None;
    };
    let RegexKind::Alternative { elements } = alternatives.first().filter(|_| alternatives.len() == 1)?.kind() else {
        return None;
    };
    let mut terms = elements.iter();
    let is_start = if matches!(elements.first()?.kind(), RegexKind::Assertion(Assertion::Start)) {
        terms.next();
        true
    } else if matches!(terms.next_back()?.kind(), RegexKind::Assertion(Assertion::End)) {
        false
    } else {
        return None;
    };
    let characters = terms.map(|it| match it.kind() {
        RegexKind::Character { value } => Some(value),
        _ => None,
    });
    Some((is_start, characters.collect::<Option<_>>()?))
}
