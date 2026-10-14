use bun_lint::prelude::*;

/// Require `Reflect` methods where applicable.
pub struct PreferReflect {
    /// The bit `i` is set if `METHODS[i]` is among the `exceptions`.
    exceptions: u16,
    allows_delete: bool,
}

const PREFER_REFLECT: Message =
    Message::new("preferReflect", "Avoid using {{existing}}, instead use {{substitute}}.");

/// The name of a method, what it is, and what replaces it.
const METHODS: [(&str, &str, &str); 9] = [
    ("apply", "Function.prototype.apply", "Reflect.apply"),
    ("call", "Function.prototype.call", "Reflect.apply"),
    ("defineProperty", "Object.defineProperty", "Reflect.defineProperty"),
    (
        "getOwnPropertyDescriptor",
        "Object.getOwnPropertyDescriptor",
        "Reflect.getOwnPropertyDescriptor",
    ),
    ("getPrototypeOf", "Object.getPrototypeOf", "Reflect.getPrototypeOf"),
    ("setPrototypeOf", "Object.setPrototypeOf", "Reflect.setPrototypeOf"),
    ("isExtensible", "Object.isExtensible", "Reflect.isExtensible"),
    ("getOwnPropertyNames", "Object.getOwnPropertyNames", "Reflect.getOwnPropertyNames"),
    ("preventExtensions", "Object.preventExtensions", "Reflect.preventExtensions"),
];

impl PreferReflect {
    fn check_call<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Call(call) = e.kind() else {
            return;
        };
        // `callee.property.name`: of an `Identifier`, computed or not, or a `PrivateIdentifier`.
        let (object, method) = match call.callee().kind() {
            ExprKind::Dot { obj, name, .. } => {
                let name = name.bytes();
                (obj, name.strip_prefix(b"#").unwrap_or(name))
            }
            ExprKind::Index { obj, index, .. } => match index.as_ident() {
                Some(name) => (obj, name.bytes()),
                None => return,
            },
            _ => return,
        };
        let Some(at) = METHODS.iter().position(|it| it.0.as_bytes() == method) else {
            return;
        };
        if self.exceptions & (1 << at) != 0 || object.is_ident("Reflect") {
            return;
        }
        let (_, existing, substitute) = METHODS[at];
        cx.report(e, PREFER_REFLECT).data("existing", existing).data("substitute", substitute);
    }

    fn check_unary<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let ExprKind::Unary {
            op: UnOp::Delete,
            operand,
        } = e.kind()
            && operand.tag() != ExprTag::Ident
        {
            cx.report(e, PREFER_REFLECT)
                .data("existing", "the delete keyword")
                .data("substitute", "Reflect.deleteProperty");
        }
    }
}

impl Rule for PreferReflect {
    const META: Meta = Meta::eslint("prefer-reflect", Kind::Suggestion).deprecated();
    const ON: On = On::new().exprs(&[ExprTag::Call, ExprTag::Unary]);
    no_state!();

    fn new(options: &Options) -> Self {
        let exceptions = options.object(0).strings("exceptions");
        let mut bits = 0;
        for (i, method) in METHODS.iter().enumerate() {
            if exceptions.contains(&method.0) {
                bits |= 1 << i;
            }
        }
        PreferReflect {
            exceptions: bits,
            allows_delete: exceptions.contains(&"delete"),
        }
    }

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        let on = On::new().exprs(&[ExprTag::Call]);
        if self.allows_delete { on } else { on.exprs(&[ExprTag::Unary]) }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Call => self.check_call(e, cx),
            ExprTag::Unary => self.check_unary(e, cx),
            _ => {}
        }
    }
}
