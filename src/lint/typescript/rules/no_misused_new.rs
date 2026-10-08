use bun_lint::prelude::*;

/// Enforce valid definition of `new` and `constructor`.
pub struct NoMisusedNew;

const ERROR_MESSAGE_CLASS: Message =
    Message::new("errorMessageClass", "Class cannot have method named `new`.");
const ERROR_MESSAGE_INTERFACE: Message = Message::new(
    "errorMessageInterface",
    "Interfaces cannot be constructed, only classes.",
);

/// Whether the return type of `func` is a reference to `parent`, the name of the class or the
/// interface.
fn is_matching_parent_type<'a>(parent: Option<Ident<'a>>, func: Func<'a>) -> bool {
    let (Some(parent), Some(ty)) = (parent, func.return_type()) else {
        return false;
    };
    matches!(ty.kind(), TypeKind::Ref { name, .. }
        if name.as_ident().is_some_and(|it| it.name() == parent.name()))
}

/// `key.name === name`: of an `Identifier`, also in brackets, or a `PrivateIdentifier`.
fn is_key_named(key: Key, name: &str) -> bool {
    match key.kind() {
        KeyKind::Ident(it) => it.is(name),
        KeyKind::Private(it) => it.bytes().strip_prefix(b"#") == Some(name.as_bytes()),
        KeyKind::Computed(e) => e.is_ident(name),
        _ => false,
    }
}

impl NoMisusedNew {
    fn check<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        let Some(func) = member.func() else {
            return;
        };
        match member.kind() {
            MemberKind::ConstructSignature => {
                if let Node::Stmt(parent) = member.parent()
                    && let StmtKind::Interface(interface) = parent.kind()
                    && is_matching_parent_type(Some(interface.name()), func)
                {
                    cx.report(member, ERROR_MESSAGE_INTERFACE);
                }
            }
            MemberKind::Method | MemberKind::Getter | MemberKind::Setter => {
                let Some(key) = member.key() else {
                    return;
                };
                if member.is_signature() {
                    if is_key_named(key, "constructor") {
                        cx.report(member, ERROR_MESSAGE_INTERFACE);
                    }
                } else if is_key_named(key, "new")
                    && !func.has_body()
                    && !member.flags().contains(Flags::ABSTRACT)
                    && let Node::Class(class) = member.parent()
                    && is_matching_parent_type(class.name(), func)
                {
                    cx.report(member, ERROR_MESSAGE_CLASS);
                }
            }
            _ => {}
        }
    }
}

impl Rule for NoMisusedNew {
    const META: Meta = Meta::typescript("no-misused-new", Kind::Problem).recommended();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoMisusedNew
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.members(Self::check);
    }
}
