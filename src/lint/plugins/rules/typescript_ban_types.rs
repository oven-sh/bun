use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow certain types.
pub struct BanTypes;

const TYPE: Message = Message::new("", "Do not use \"{{banned_type}}\" as a type. Use \"{{suggested_type}}\" instead");
const TYPE_LITERAL: Message = Message::new("", "Prefer explicitly define the object shape");
const FUNCTION: Message = Message::new("", "Don't use `Function` as a type");
const OBJECT: Message = Message::new("", "'The `Object` type actually means \"any non-nullish value\"");

impl Rule for BanTypes {
    const META: Meta = Meta::oxlint(Plugin::TypeScript, "ban-types", Kind::Suggestion);
    const ON: On = On::new().types(&[TypeTag::Object, TypeTag::Ref]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        BanTypes
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().types(&[TypeTag::Object]);
        if !file.mentions_any(&["String", "Boolean", "Number", "Symbol", "BigInt", "Object", "Function"]) {
            return on;
        }
        on.types(&[TypeTag::Ref])
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if file.is_javascript() {
            return None;
        }
        Some(())
    }

    fn ty<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        match ty.tag() {
            TypeTag::Object => {
                if matches!(ty.kind(), TypeKind::Object(members) if members.is_empty()) {
                    cx.report(ty, TYPE_LITERAL);
                }
            }
            TypeTag::Ref => self.reference(ty, cx),
            _ => {}
        }
    }
}

impl BanTypes {
    fn reference<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        let TypeKind::Ref { name, .. } = ty.kind() else {
            return;
        };
        let Some(name) = name.first().filter(|_| name.len() == 1) else {
            return;
        };
        let message = match name.bytes() {
            b"String" | b"Boolean" | b"Number" | b"Symbol" | b"BigInt" => TYPE,
            b"Object" => OBJECT,
            b"Function" => FUNCTION,
            _ => return,
        };
        // What a class implements and an interface extends is no type reference.
        let is_heritage = match ty.parent() {
            Node::Class(class) => class.implements().iter().any(|it| it == ty),
            Node::Stmt(stmt) => matches!(stmt.kind(), StmtKind::Interface(it) if it.extends().iter().any(|it| it == ty)),
            _ => false,
        };
        if !is_heritage {
            cx.report(ty, message).data("banned_type", name).data("suggested_type", name.bytes().to_ascii_lowercase());
        }
    }
}
