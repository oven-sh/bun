//! What the code around the token allows, and what has been found out about the function it is in.

use super::{Parsed, Session};
use crate::names::Name;
use crate::options::{FunctionFlags, FunctionKind};
use crate::token::{Token, TokenKind};

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub(super) struct Context: u32 {
        const STRICT = 1 << 0;
        const MODULE = 1 << 1;
        /// The code is known to be free of errors.
        const CHECKED_BEFORE = 1 << 2;
        const FUNCTION = 1 << 3;
        const ARROW = 1 << 4;
        const GENERATOR = 1 << 5;
        const ASYNC = 1 << 6;
        const ASYNC_BODY = 1 << 7;
        const TOP_LEVEL_OF_MODULE = 1 << 8;
        const STATIC_BLOCK = 1 << 9;
        const FIELD_INITIALIZER = 1 << 10;
        const PARAMETERS = 1 << 11;
        /// With no class in between.
        const PARAMETERS_OF_ARROW = 1 << 12;
        const NO_AWAIT_IN_PARAMETERS = 1 << 13;
        const NEW_TARGET = 1 << 14;
        const SUPER_PROPERTY = 1 << 15;
        const SUPER_CALL = 1 << 16;
        const NO_ARGUMENTS_IN_STATIC_BLOCK = 1 << 17;
        const NO_ARGUMENTS_IN_EVAL = 1 << 18;
        const BREAK = 1 << 19;
        const CONTINUE = 1 << 20;
        /// What is declared is exported.
        const EXPORTING = 1 << 21;
        const FIELD_IN_STATIC_BLOCK = 1 << 22;

        const AWAIT_IS_OPERATOR = Self::ASYNC_BODY.bits() | Self::TOP_LEVEL_OF_MODULE.bits();
        const AWAIT_IS_RESERVED = Self::NO_AWAIT_IN_PARAMETERS.bits()
            | Self::ASYNC.bits()
            | Self::STATIC_BLOCK.bits()
            | Self::MODULE.bits();
        const YIELD_IS_RESERVED = Self::STRICT.bits() | Self::GENERATOR.bits();
        const LOOP = Self::BREAK.bits() | Self::CONTINUE.bits();
        /// What holds inside any function too.
        const LEXICAL = Self::STRICT.bits() | Self::MODULE.bits() | Self::CHECKED_BEFORE.bits();
        /// What an arrow function has in common with the code around it.
        const SHARED_WITH_ARROWS = Self::LEXICAL.bits()
            | Self::FIELD_INITIALIZER.bits()
            | Self::NEW_TARGET.bits()
            | Self::SUPER_PROPERTY.bits()
            | Self::SUPER_CALL.bits()
            | Self::NO_ARGUMENTS_IN_STATIC_BLOCK.bits()
            | Self::NO_ARGUMENTS_IN_EVAL.bits();
    }
}

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub(super) struct Facts: u32 {
        const USES_THIS = 1 << 0;
        const USES_NEW_TARGET = 1 << 1;
        const USES_SUPER_PROPERTY = 1 << 2;
        const AWAITS = 1 << 3;
        const READS_ARGUMENTS_LENGTH = 1 << 4;
        const USES_ARGUMENTS = 1 << 5;
        const ELABORATE_PARAMETERS = 1 << 6;
        const PARAMETER_EXPRESSIONS = 1 << 7;
        const PARAMETER_PATTERNS = 1 << 8;
        const PARAMETERS_INVALID_IF_STRICT = 1 << 9;
        const TAGGED_TEMPLATE = 1 << 10;
        const PRIVATE_NAMES = 1 << 11;

        /// What holds for the function around too.
        const INHERITED = Self::TAGGED_TEMPLATE.bits() | Self::PRIVATE_NAMES.bits();
    }
}

impl Context {
    pub(super) fn of_body(self, kind: FunctionKind, flags: FunctionFlags) -> Context {
        let mut context = Context::FUNCTION;
        if kind == FunctionKind::Arrow {
            context |= Context::ARROW | self & Context::SHARED_WITH_ARROWS;
        } else {
            context |= Context::NEW_TARGET | self & Context::LEXICAL;
        }
        if kind.has_home_object() {
            context |= Context::SUPER_PROPERTY;
        }
        if kind == FunctionKind::DerivedConstructor {
            context |= Context::SUPER_CALL;
        }
        if flags.contains(FunctionFlags::GENERATOR) {
            context |= Context::GENERATOR;
        }
        if flags.contains(FunctionFlags::ASYNC) {
            context |= Context::ASYNC | Context::ASYNC_BODY;
        }
        context
    }

    pub(super) fn of_parameters(self, kind: FunctionKind, flags: FunctionFlags) -> Context {
        let mut context = (self.of_body(kind, flags) - Context::ASYNC_BODY) | Context::PARAMETERS;
        if kind == FunctionKind::Arrow {
            let kept = Context::GENERATOR | Context::STATIC_BLOCK;
            context |= Context::PARAMETERS_OF_ARROW | self & kept;
        }
        if context.contains(Context::ASYNC)
            || (kind == FunctionKind::Arrow && self.contains(Context::ASYNC))
        {
            context |= Context::NO_AWAIT_IN_PARAMETERS;
        }
        context
    }

    pub(super) fn of_static_block(self) -> Context {
        let kept = Context::TOP_LEVEL_OF_MODULE | Context::NO_AWAIT_IN_PARAMETERS;
        self.of_body(FunctionKind::StaticBlock, FunctionFlags::empty())
            | Context::STATIC_BLOCK
            | Context::NO_ARGUMENTS_IN_STATIC_BLOCK
            | self & kept
    }

    pub(super) fn of_field_initializer(self) -> Context {
        let dropped = Context::AWAIT_IS_OPERATOR
            | (Context::AWAIT_IS_RESERVED - Context::MODULE)
            | Context::ARROW
            | Context::SUPER_CALL;
        let mut context = (self - dropped)
            | Context::FIELD_INITIALIZER
            | Context::NEW_TARGET
            | Context::SUPER_PROPERTY;
        if self.contains(Context::STATIC_BLOCK) {
            context |= Context::FIELD_IN_STATIC_BLOCK;
        }
        context
    }
}

pub(super) fn is_eval_or_arguments(name: Name) -> bool {
    name == Name::EVAL || name == Name::ARGUMENTS
}

pub(super) fn is_reserved_in_strict_code(name: Name) -> bool {
    name == Name::LET || name == Name::YIELD || (Name::IMPLEMENTS..=Name::STATIC).contains(&name)
}

impl Session<'_> {
    #[inline(always)]
    pub(super) fn set_context(&mut self, context: Context) {
        self.context = context;
        self.lexer.set_strict(context.contains(Context::STRICT));
    }

    #[inline(always)]
    pub(super) fn is_strict(&self) -> bool {
        self.context.contains(Context::STRICT)
    }

    #[inline(always)]
    pub(super) fn is_yield_reserved(&self) -> bool {
        self.context.intersects(Context::YIELD_IS_RESERVED)
    }

    #[inline(always)]
    pub(super) fn is_await_reserved(&self) -> bool {
        self.context.intersects(Context::AWAIT_IS_RESERVED)
    }

    #[inline(always)]
    pub(super) fn is_await_operator(&self) -> bool {
        self.context.intersects(Context::AWAIT_IS_OPERATOR)
    }

    #[inline(always)]
    pub(super) fn at_await_operator(&self) -> bool {
        self.at(TokenKind::Await)
            && self.is_await_operator()
            && !self.context.contains(Context::STATIC_BLOCK)
    }

    /// Whether the token can be a name here. For `await` that is left to [`Session::refuse_await`].
    #[inline(always)]
    pub(super) fn is_name(&self, token: Token) -> bool {
        token.kind() == TokenKind::Identifier || self.is_contextual_name(token)
    }

    #[inline(always)]
    pub(super) fn at_name(&self) -> bool {
        self.is_name(self.token())
    }

    fn is_contextual_name(&self, token: Token) -> bool {
        (token.spells(TokenKind::Let) && !self.is_strict())
            || (token.spells(TokenKind::Yield) && !self.is_yield_reserved())
            || token.spells(TokenKind::Await)
    }

    /// For an escaped keyword.
    pub(super) fn is_unreserved(&self, token: Token) -> bool {
        match token.name() {
            Name::LET => !self.is_strict(),
            Name::YIELD => !self.is_yield_reserved(),
            Name::AWAIT => !self.is_await_reserved(),
            _ => false,
        }
    }

    pub(super) fn why_await_is_reserved(&self) -> &'static str {
        if (self.context).intersects(Context::NO_AWAIT_IN_PARAMETERS | Context::ASYNC) {
            "in an async function"
        } else if self.context.contains(Context::STATIC_BLOCK) {
            "in a static block"
        } else {
            "in a module"
        }
    }

    pub(super) fn why_yield_is_reserved(&self) -> &'static str {
        if self.is_strict() {
            "in strict mode"
        } else {
            "in a generator function"
        }
    }

    /// Fails if the token is an `await` that cannot be a name.
    #[inline(always)]
    pub(super) fn refuse_await(&mut self, token: Token, role: &'static str) -> Parsed<()> {
        if token.spells(TokenKind::Await) && self.is_await_reserved() {
            let parts = &[role.into(), self.why_await_is_reserved().into()];
            return Err(self.reject_with("Cannot use 'await' as a % %", parts));
        }
        Ok(())
    }

    /// Fails if the token is a keyword that cannot be a name. `role` and `suffix` say what of.
    #[cold]
    pub(super) fn refuse_keyword(
        &mut self,
        token: Token,
        role: &'static str,
        suffix: &'static str,
    ) -> Parsed<()> {
        let quoting = [token.into(), role.into(), suffix.into()];
        let explaining = |reason: &'static str| [role.into(), suffix.into(), reason.into()];
        let (sentence, parts) = match token.kind() {
            TokenKind::ReservedInStrictCode if self.is_strict() => (
                "Cannot use the reserved word '%' as a %% in strict mode",
                quoting,
            ),
            TokenKind::ReservedInStrictCode | TokenKind::Enum => {
                ("Cannot use the reserved word '%' as a %%", quoting)
            }
            TokenKind::Let if self.is_strict() => {
                ("Cannot use 'let' as a %% %", explaining("in strict mode"))
            }
            TokenKind::Await if self.is_await_reserved() => (
                "Cannot use 'await' as a %% %",
                explaining(self.why_await_is_reserved()),
            ),
            TokenKind::Yield if self.is_yield_reserved() => (
                "Cannot use 'yield' as a %% %",
                explaining(self.why_yield_is_reserved()),
            ),
            TokenKind::Let | TokenKind::Await | TokenKind::Yield => return Ok(()),
            kind if kind.is_keyword() => ("Cannot use the keyword '%' as a %%", quoting),
            _ => return Ok(()),
        };
        Err(self.reject_with(sentence, &parts))
    }
}
