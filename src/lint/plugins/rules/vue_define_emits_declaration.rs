use bun_lint_oxlint::ast_util::is_specific_id;
use crate::oxlint::vue::is_vue_setup;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce consistent declaration style for `defineEmits` in Vue.
pub struct DefineEmitsDeclaration(DeclarationStyle);

#[derive(Copy, Clone)]
enum DeclarationStyle {
    TypeBased,
    TypeLiteral,
    Runtime,
}

const HAS_ARG: Message = Message::new("", "Use type based declaration instead of runtime declaration");
const HAS_TYPE_ARG: Message = Message::new("", "Use runtime declaration instead of type based declaration");
const HAS_TYPE_CALL: Message = Message::new("", "Use new type literal declaration instead of the old call signature declaration");

impl Rule for DefineEmitsDeclaration {
    const META: Meta = Meta::oxlint(Plugin::Vue, "define-emits-declaration", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        DefineEmitsDeclaration(match options.str(0) {
            Some("type-literal") => DeclarationStyle::TypeLiteral,
            Some("runtime") => DeclarationStyle::Runtime,
            _ => DeclarationStyle::TypeBased,
        })
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !is_vue_setup(file) || file.is_javascript() || !file.mentions("defineEmits") {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call_expr) = e.as_call().filter(|it| is_specific_id(it.callee(), "defineEmits")) else {
            return;
        };
        match self.0 {
            DeclarationStyle::Runtime => {
                if !call_expr.type_args().is_empty() {
                    cx.report(e, HAS_TYPE_ARG);
                }
            }
            _ if !call_expr.args().is_empty() => drop(cx.report(e, HAS_ARG)),
            DeclarationStyle::TypeBased => {}
            DeclarationStyle::TypeLiteral => {
                for param in call_expr.type_args().iter().filter(|it| !it.is_parenthesized()) {
                    match param.kind() {
                        TypeKind::Object(members) => {
                            for member in members.iter().filter(|it| it.kind() != MemberKind::Property) {
                                cx.report(member, HAS_TYPE_CALL);
                            }
                        }
                        TypeKind::Fn(func) if func.kind() == FnKind::FunctionType => drop(cx.report(param, HAS_TYPE_CALL)),
                        _ => {}
                    }
                }
            }
        }
    }
}
