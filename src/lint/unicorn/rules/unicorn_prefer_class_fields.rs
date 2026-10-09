use bun_core::strings;
use bun_lint_oxlint::codegen::Codegen;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prefers class field declarations over `this` assignments in constructors for static values.
pub struct PreferClassFields;

const PREFER_CLASS_FIELDS: Message =
    Message::new("", "Prefer class field declaration over `this` assignment in constructor for static values.");
const SAME_NAMED_FIELD: Message =
    Message::new("", "Encountered same-named class field declaration and `this` assignment in constructor.");
const REPLACE_ASSIGNMENT: Message = Message::new("", "Replace `this` assignment with class field declaration");

fn print(before: &[u8], value: Expr, after: &[u8]) -> Vec<u8> {
    let mut codegen = Codegen::default();
    codegen.code.extend_from_slice(before);
    codegen.print_expression(value);
    codegen.code.extend_from_slice(after);
    codegen.code
}

impl Rule for PreferClassFields {
    const META: Meta =
        Meta::oxlint(Plugin::Unicorn, "prefer-class-fields", Kind::Suggestion).fixable(Fixable::Code).has_suggestions();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferClassFields
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.classes(|_, class, cx| {
            // An overload counts: a class that has some is left alone.
            let Some(constructor) = class.members().iter().find(|it| it.is_constructor()) else {
                return;
            };
            let Some(statements) = constructor.func().and_then(Func::body_statements) else {
                return;
            };
            let first = statements.iter().find(|it| it.tag() != StmtTag::Empty && it.directive().is_none());
            let Some((statement, StmtKind::Expr(assignment))) = first.map(|it| (it, it.kind())) else {
                return;
            };
            let ExprKind::Assign { op: None, target, value } = assignment.kind() else {
                return;
            };
            let ExprKind::Dot { obj, name, .. } = target.kind() else {
                return;
            };
            if obj.tag() != ExprTag::This
                || obj.is_parenthesized()
                || assignment.is_parenthesized()
                || value.is_parenthesized()
                || !matches!(
                    value.tag(),
                    ExprTag::String
                        | ExprTag::Number
                        | ExprTag::True
                        | ExprTag::False
                        | ExprTag::Null
                        | ExprTag::BigInt
                        | ExprTag::Regex
                )
            {
                return;
            }
            let property_name = strings::without_prefix(name.bytes(), b"#");
            let existing_property = class.members().iter().find(|it| {
                it.kind() == MemberKind::Property
                    && !it.flags().intersects(Flags::STATIC | Flags::ABSTRACT | Flags::ACCESSOR)
                    && it.key().is_some_and(|key| {
                        !key.is_computed()
                            && key.name().is_some_and(|it| strings::without_prefix(it.bytes(), b"#") == property_name)
                    })
            });
            if let Some(old_value) = existing_property.and_then(Member::init) {
                cx.report(assignment, SAME_NAMED_FIELD).suggest(REPLACE_ASSIGNMENT, |fixer| {
                    [fixer.remove(statement), fixer.replace(old_value.outer_span(), print(b"", value, b""))]
                });
                return;
            }
            cx.report(assignment, PREFER_CLASS_FIELDS).fix(|fixer| {
                let declaration = match existing_property {
                    Some(property) => {
                        let end_of_key = property.key().map(|it| it.span(fixer.file()));
                        let declared = property.ty().map(|it| it.outer_span()).or(end_of_key)?;
                        fixer.insert_after(declared, print(b" = ", value, b""))
                    }
                    None => fixer.insert_before(constructor, print(&[property_name, b" = "].concat(), value, b";\n")),
                };
                Some([fixer.remove(statement), declaration])
            });
        });
    }
}
