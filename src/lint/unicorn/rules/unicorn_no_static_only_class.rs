use bun_lint_oxlint::text::find_next_token_within;
use crate::unicorn::concat;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow `class` declarations that exclusively contain `static` members.
pub struct NoStaticOnlyClass;

const NO_STATIC_ONLY_CLASS: Message = Message::new("", "Use an object instead of a `class` with only `static` members.");

impl Rule for NoStaticOnlyClass {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-static-only-class", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoStaticOnlyClass
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.classes(|_, class, cx| {
            if class.extends().is_some()
                || class.members().is_empty()
                || !class.members().iter().all(is_plain_static_member)
                || class.decorators().next().is_some()
            {
                return;
            }
            cx.report(class.estree_span(), NO_STATIC_ONLY_CLASS).fix_dangerously(|fixer| fix(class, fixer));
        });
    }
}

/// A method or a property that is `static` and nothing else that an object cannot have.
fn is_plain_static_member(member: Member) -> bool {
    let flags = member.flags();
    let is_allowed = match member.kind() {
        MemberKind::Method | MemberKind::Getter | MemberKind::Setter | MemberKind::Constructor => true,
        MemberKind::Property => !flags.intersects(Flags::ACCESSOR | Flags::READONLY | Flags::AMBIENT),
        _ => false,
    };
    is_allowed
        && flags.contains(Flags::STATIC)
        && !flags.intersects(Flags::PUBLIC | Flags::PROTECTED | Flags::PRIVATE)
        && !member.key().is_some_and(Key::is_private)
}

fn fix<'a>(class: Class<'a>, fixer: Fixer<'a>) -> Option<Vec<Fix>> {
    let file = fixer.file();
    let is_expression = matches!(class.owner(), Node::Expr(_));
    let is_default_export = matches!(class.owner(), Node::Stmt(statement) if statement.is_default_export());
    if class.members().iter().any(|it| it.ty().is_some())
        || class.flags().intersects(Flags::AMBIENT | Flags::ABSTRACT)
        || (is_expression || is_default_export) && class.name().is_some()
        || !class.implements().is_empty()
    {
        return None;
    }
    let mut rule_fixes = Vec::with_capacity(class.members().len() + 1);
    let mut members = class.members().iter().peekable();
    while let Some(member) = members.next() {
        let mut replacement = match (member.key(), member.constructor_keyword()) {
            (Some(key), _) => match key.kind() {
                KeyKind::Computed(e) => concat(&[b"[", file.slice(e.outer_span()), b"]"]),
                _ if key.is_computed() => concat(&[b"[", file.slice(key.inner_span(file)), b"]"]),
                _ => key.name()?.bytes().to_vec(),
            },
            (None, keyword) => keyword?.bytes().to_vec(),
        };
        match member.func() {
            Some(value) => {
                // `static a() {};`
                let next_start = members.peek().map_or_else(|| class.span().end, |it| it.span().start);
                if let Some(semicolon) = find_next_token_within(file, member.span().end, next_start, b";") {
                    rule_fixes.push(fixer.remove(Span::new(semicolon, semicolon + 1)));
                }
                replacement.extend_from_slice(file.slice(value.span_from_params()));
            }
            None => {
                replacement.extend_from_slice(b": ");
                replacement.extend_from_slice(member.init().map_or(&b"undefined"[..], |it| file.slice(it.outer_span())));
            }
        }
        replacement.push(b',');
        rule_fixes.push(fixer.replace(member, replacement));
    }
    let start = class.estree_span().start;
    rule_fixes.push(match class.name() {
        Some(id) => fixer.replace(Span::new(start, id.span().end), concat(&[b"const ", id.bytes(), b" ="])),
        None => fixer.remove(Span::new(start, start + 5)),
    });
    Some(rule_fixes)
}
