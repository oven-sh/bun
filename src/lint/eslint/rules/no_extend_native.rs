use bun_lint::prelude::*;

/// Disallow extending native types.
pub struct NoExtendNative {
    exceptions: Vec<Vec<u8>>,
}

const UNEXPECTED: Message = Message::new(
    "unexpected",
    "{{builtin}} prototype is read only, properties should not be added.",
);

/// Whether the identifier `e` resolves to a variable of the global scope.
fn is_variable_of_global_scope(e: Expr) -> bool {
    e.reference().is_some_and(|reference| match reference.symbol() {
        Some(symbol) => symbol.scope().kind() == ScopeKind::Global,
        None => reference.global().is_some(),
    })
}

impl NoExtendNative {
    /// The `Builtin` of `e`, if that is `Builtin.prototype`.
    fn builtin_of_prototype<'a>(&self, e: Expr<'a>) -> Option<Name<'a>> {
        let object = ast_utils::member_object(e)?;
        let name = object.as_ident()?;
        let bytes = name.bytes();
        (bytes.first().is_some_and(u8::is_ascii_uppercase)
            && ast_utils::is_specific_member_access(e, None, Some("prototype"))
            && ast_utils::is_ecmascript_global(bytes)
            && !self.exceptions.iter().any(|it| it == bytes)
            && is_variable_of_global_scope(object))
        .then_some(name)
    }

    /// `Builtin.prototype.p = 0`
    fn check_assignment<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let ExprKind::Assign { target, .. } = e.kind()
            && let Some(prototype) = ast_utils::member_object(target)
            && let Some(builtin) = self.builtin_of_prototype(prototype)
            && !utils::is_assignment_target(e)
        {
            cx.report(e, UNEXPECTED).data("builtin", builtin);
        }
    }

    /// `Object.defineProperty(Builtin.prototype, ..)`
    fn check_call<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let ExprKind::Call(call) = e.kind()
            && ast_utils::member_object(call.callee()).is_some_and(|object| object.is_ident("Object"))
            && ast_utils::is_member_access_of_any(call.callee(), &["defineProperty", "defineProperties"])
            && let Some(builtin) = call.args().first().and_then(|first| self.builtin_of_prototype(first))
        {
            cx.report(e, UNEXPECTED).data("builtin", builtin);
        }
    }
}

impl Rule for NoExtendNative {
    const META: Meta = Meta::eslint("no-extend-native", Kind::Suggestion).reports_at_the_end();
    const ON: On = On::new().exprs(&[ExprTag::Assign, ExprTag::Call]);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let exceptions = options.object(0).strings("exceptions");
        NoExtendNative {
            exceptions: exceptions.into_iter().map(|it| it.as_bytes().to_vec()).collect(),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions("prototype").then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Assign => self.check_assignment(e, cx),
            ExprTag::Call => self.check_call(e, cx),
            _ => {}
        }
    }
}
