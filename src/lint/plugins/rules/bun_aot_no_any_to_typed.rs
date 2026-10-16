use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::types::AotCheckKind;

/// Report a value of type `any` where `--aot` checks it against a type when the program runs.
pub struct AotNoAnyToTyped;

const CHECKED: Message = Message::new(
    "checked",
    "Under `--aot`, this `any` is checked against `{{type}}` here when the program runs, and throws a `TypeError` if it does not match.",
);
const STORED: Message = Message::new(
    "stored",
    "This `any` is stored as `{{type}}`. Under `--aot`, it is checked when it is read back, and throws a `TypeError` there if it does not match.",
);

fn check<'a>(value: Option<Expr<'a>>, cx: &Cx<'a, AotNoAnyToTyped>) {
    let Some(value) = value else { return };
    let Some(found) = value.ts_node().aot_check_where_any_enters() else {
        return;
    };
    let message = if found.kind == AotCheckKind::AnyIsStored {
        STORED
    } else {
        CHECKED
    };
    cx.report(value, message)
        .data("type", found.type_text)
        .hint_with(|| {
            let from = value.ts_node().aot_where_an_any_comes_from();
            let from = bstr::BStr::new(&from);
            Some(match from.is_empty() {
                true => "Give the value a type, or validate it where it comes in.".to_owned(),
                false => format!("It comes from {from}. Give it a type there, or validate it."),
            })
        });
}

impl Rule for AotNoAnyToTyped {
    const META: Meta = Meta::plugin(Plugin::Bun, "aot-no-any-to-typed", Kind::Problem)
        .requires_types()
        .hints();
    const ON: On = On::new()
        .exprs(&[
            ExprTag::Call,
            ExprTag::New,
            ExprTag::Array,
            ExprTag::Assign,
            ExprTag::Yield,
        ])
        .stmts(&[StmtTag::Return])
        .funcs()
        .members()
        .props()
        .params()
        .var_decls();
    no_state!();

    fn new(_: &Options) -> Self {
        AotNoAnyToTyped
    }

    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match node.kind() {
            ExprKind::Call(call) | ExprKind::New(call) => call
                .args()
                .iter()
                .for_each(|argument| check(Some(argument), cx)),
            ExprKind::Array(elements) => {
                elements.iter().for_each(|element| check(Some(element), cx))
            }
            ExprKind::Assign { value, .. } => check(Some(value), cx),
            ExprKind::Yield { value, .. } => check(value, cx),
            _ => {}
        }
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let StmtKind::Return(value) = statement.kind() {
            check(value, cx);
        }
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if let FnBody::Expr(body) = func.body() {
            check(Some(body), cx);
        }
    }

    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        check(member.init(), cx);
    }

    fn prop<'a>(&self, prop: Prop<'a>, cx: &mut Cx<'a, Self>) {
        check(prop.value(), cx);
    }

    fn param<'a>(&self, param: Param<'a>, cx: &mut Cx<'a, Self>) {
        check(param.default(), cx);
    }

    fn var_decl<'a>(&self, declared: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        check(declared.init(), cx);
    }
}
