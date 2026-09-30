// internal/ast/functionflags.go: whether a function-like declaration is a generator, async, or has no body.
use crate::ast::*;

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct FunctionFlags(pub u32);

impl FunctionFlags {
    pub const NORMAL: Self = Self(0);
    pub const GENERATOR: Self = Self(1 << 0);
    pub const ASYNC: Self = Self(1 << 1);
    pub const INVALID: Self = Self(1 << 2);
    pub const ASYNC_GENERATOR: Self = Self(Self::ASYNC.0 | Self::GENERATOR.0);

    #[inline]
    pub const fn intersects(self, other: Self) -> bool {
        self.0 & other.0 != 0
    }
    #[inline]
    pub const fn contains(self, other: Self) -> bool {
        self.0 & other.0 == other.0
    }
    #[inline]
    pub const fn without(self, other: Self) -> Self {
        Self(self.0 & !other.0)
    }
}

impl std::ops::BitOr for FunctionFlags {
    type Output = Self;
    #[inline]
    fn bitor(self, rhs: Self) -> Self {
        Self(self.0 | rhs.0)
    }
}

impl std::ops::BitAnd for FunctionFlags {
    type Output = Self;
    #[inline]
    fn bitand(self, rhs: Self) -> Self {
        Self(self.0 & rhs.0)
    }
}

impl std::ops::BitOrAssign for FunctionFlags {
    #[inline]
    fn bitor_assign(&mut self, rhs: Self) {
        self.0 |= rhs.0;
    }
}

pub fn get_function_flags(a: Ast<'_>, node: NodeId) -> FunctionFlags {
    if node.is_nil() {
        return FunctionFlags::INVALID;
    }
    let Some(data) = a.body_data(node) else {
        return FunctionFlags::INVALID;
    };
    let mut flags = FunctionFlags::NORMAL;
    let kind = a.kind(node);
    // Upstream's first case falls through into the arrow function case.
    if matches!(
        kind,
        Kind::FunctionDeclaration | Kind::FunctionExpression | Kind::MethodDeclaration
    ) && !data.asterisk_token.is_nil()
    {
        flags |= FunctionFlags::GENERATOR;
    }
    if matches!(
        kind,
        Kind::FunctionDeclaration
            | Kind::FunctionExpression
            | Kind::MethodDeclaration
            | Kind::ArrowFunction
    ) && has_syntactic_modifier(a, node, ModifierFlags::ASYNC)
    {
        flags |= FunctionFlags::ASYNC;
    }
    if data.body.is_nil() {
        flags |= FunctionFlags::INVALID;
    }
    flags
}
