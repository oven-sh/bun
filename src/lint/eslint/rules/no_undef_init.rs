use bun_lint::prelude::*;

/// Disallow initializing variables to `undefined`.
pub struct NoUndefInit;

const UNNECESSARY_UNDEFINED_INIT: Message = Message::new(
    "unnecessaryUndefinedInit",
    "It's not necessary to initialize '{{name}}' to undefined.",
);

impl Rule for NoUndefInit {
    const META: Meta = Meta::eslint("no-undef-init", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().var_decls();
    no_state!();

    fn new(_: &Options) -> Self {
        NoUndefInit
    }

    fn var_decl<'a>(&self, decl: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        let Some(init) = decl.init() else {
            return;
        };
        if !init.is_ident("undefined")
            || matches!(decl.var_kind(), VarKind::Const | VarKind::Using | VarKind::AwaitUsing)
            || Node::VarDecl(decl).scope().resolve("undefined").is_some()
        {
            return;
        }
        let id = decl.binding_span();
        cx.report(decl, UNNECESSARY_UNDEFINED_INIT).data("name", cx.slice(id)).fix(|fixer| {
            if decl.var_kind() == VarKind::Var || decl.pat().tag() != PatTag::Ident {
                return None;
            }
            let last_token = fixer.file().last_token(decl)?;
            if fixer.file().comments_exist_between(id, last_token) {
                return None;
            }
            Some(fixer.remove(Span::new(id.end, decl.span().end)))
        });
    }
}
