// SCRATCH STAND-IN, not delivered: the two functions of the sibling's ast/utilities.rs that the node table calls, with the sibling's signatures.
use crate::ast::*;

pub fn modifier_to_flag(token: Kind) -> ModifierFlags {
    match token {
        Kind::StaticKeyword => ModifierFlags::STATIC,
        Kind::PublicKeyword => ModifierFlags::PUBLIC,
        Kind::ProtectedKeyword => ModifierFlags::PROTECTED,
        Kind::PrivateKeyword => ModifierFlags::PRIVATE,
        Kind::AbstractKeyword => ModifierFlags::ABSTRACT,
        Kind::AccessorKeyword => ModifierFlags::ACCESSOR,
        Kind::ExportKeyword => ModifierFlags::EXPORT,
        Kind::DeclareKeyword => ModifierFlags::AMBIENT,
        Kind::ConstKeyword => ModifierFlags::CONST,
        Kind::DefaultKeyword => ModifierFlags::DEFAULT,
        Kind::AsyncKeyword => ModifierFlags::ASYNC,
        Kind::ReadonlyKeyword => ModifierFlags::READONLY,
        Kind::OverrideKeyword => ModifierFlags::OVERRIDE,
        Kind::InKeyword => ModifierFlags::IN,
        Kind::OutKeyword => ModifierFlags::OUT,
        Kind::Decorator => ModifierFlags::DECORATOR,
        _ => ModifierFlags::NONE,
    }
}

pub fn is_private_identifier_class_element_declaration(a: Ast<'_>, node: NodeId) -> bool {
    matches!(
        a.kind(node),
        Kind::PropertyDeclaration | Kind::MethodDeclaration | Kind::GetAccessor | Kind::SetAccessor
    ) && is_private_identifier(a, a.name(node))
}

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct JSDeclarationKind(pub i32);

impl JSDeclarationKind {
    pub const NONE: Self = Self(0);
    pub const MODULE_EXPORTS: Self = Self(1);
    pub const EXPORTS_PROPERTY: Self = Self(2);
    pub const THIS_PROPERTY: Self = Self(3);
    pub const PROPERTY: Self = Self(4);
}

pub fn is_function_like_kind(kind: Kind) -> bool {
    matches!(
        kind,
        Kind::MethodSignature
            | Kind::CallSignature
            | Kind::JSDocSignature
            | Kind::ConstructSignature
            | Kind::IndexSignature
            | Kind::FunctionType
            | Kind::ConstructorType
            | Kind::FunctionDeclaration
            | Kind::MethodDeclaration
            | Kind::Constructor
            | Kind::GetAccessor
            | Kind::SetAccessor
            | Kind::FunctionExpression
            | Kind::ArrowFunction
    )
}
