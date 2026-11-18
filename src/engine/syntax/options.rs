//! What a parse is asked to do.

use core::ops::Range;

use bun_engine_text::Text;

bitflags::bitflags! {
    /// What the code around an arrow function or a direct `eval` allows the code inside it.
    #[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
    pub struct EvalContext: u8 {
        const STRICT = 1 << 0;
        /// `new.target`
        const IN_FUNCTION = 1 << 1;
        /// `super.x`
        const IN_METHOD = 1 << 2;
        /// `super()`, if `new.target` is allowed too. `this` may be unbound.
        const IN_DERIVED_CONSTRUCTOR = 1 << 3;
        /// No `arguments`.
        const IN_FIELD_INITIALIZER = 1 << 4;
        /// `super()` goes on to initialize the fields of the class.
        const HAS_FIELD_INITIALIZER = 1 << 5;
        /// The code comes from a debugger, and sees the variables that such code has declared.
        const BY_DEBUGGER = 1 << 6;
        /// No scope has the `this` of the function around. Only a debugger would ask for it.
        const LACKS_THIS = 1 << 7;
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum FunctionKind {
    Normal,
    Arrow,
    Method,
    Getter,
    Setter,
    BaseConstructor,
    DerivedConstructor,
    /// A built-in that `new` calls with no `this`.
    NakedConstructor,
    /// Defines the fields of an instance, or those of a class along with its static blocks.
    FieldInitializer,
    StaticBlock,
}

impl FunctionKind {
    pub const fn is_class_constructor(self) -> bool {
        matches!(
            self,
            FunctionKind::BaseConstructor | FunctionKind::DerivedConstructor
        )
    }

    /// Whether `super.x` is allowed.
    pub const fn has_home_object(self) -> bool {
        !matches!(
            self,
            FunctionKind::Normal | FunctionKind::Arrow | FunctionKind::NakedConstructor
        )
    }
}

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
    pub struct FunctionFlags: u16 {
        const STRICT = 1 << 0;
        const ASYNC = 1 << 1;
        const GENERATOR = 1 << 2;
        /// An arrow function without braces.
        const EXPRESSION_BODY = 1 << 3;
        /// A function expression whose name is bound inside it.
        const BINDS_OWN_NAME = 1 << 4;
        /// An element of a class that is `static`.
        const STATIC = 1 << 5;
        /// It, or an arrow function or a direct `eval` in it, may ask for its home object.
        const USES_HOME = 1 << 6;
        /// An async function with an `await`.
        const AWAITS = 1 << 7;
        /// A function in a block that is assigned to a variable of its name where it stands (ECMA-262 B.3.2).
        const HOISTED_AS_VARIABLE = 1 << 8;
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum FieldKind {
    Named,
    Private,
    Computed,
    StaticBlock,
}

/// Where an element that runs in a [`FunctionKind::FieldInitializer`] is in the source.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct FieldSource {
    pub kind: FieldKind,
    /// Of the element, with its `static`.
    pub start: u32,
    /// Of the token that names it. Of the brace of a static block.
    pub key_start: u32,
    /// Of the first token after `=`, or zero.
    pub initializer_start: u32,
}

/// A function that an earlier parse has found free of errors.
#[derive(Clone, Copy)]
pub struct FunctionSource<'a> {
    pub kind: FunctionKind,
    pub flags: FunctionFlags,
    /// For a [`FunctionKind::FieldInitializer`].
    pub fields: &'a [FieldSource],
}

#[derive(Clone, Copy)]
pub enum Goal<'a> {
    Script {
        strict: bool,
    },
    Module,
    Eval {
        context: EvalContext,
        /// Whether a class around the call declares `#name`.
        is_private_name_declared: &'a dyn Fn(Text<'_>) -> bool,
    },
    /// What the `Function` constructor and its kin put together: one function declaration.
    SingleFunction {
        /// Where the `)` that closes the parameters has to end.
        parameters_end: Option<u32>,
    },
    /// The range starts with the parameters, or with the first token if there is a name to bind.
    Function(FunctionSource<'a>),
}

#[derive(Clone)]
pub struct Options<'a> {
    pub goal: Goal<'a>,
    /// The part of the source to parse. Every offset counts from the start of the source.
    pub range: Range<u32>,
    /// `@name` and `@@name` are names.
    pub builtin: bool,
    /// For a function: whether it is in a module.
    pub in_module: bool,
    /// A function that looks as if it is called at once comes with its tree, unless the cache knows it.
    pub eager_functions: bool,
    /// Every binding goes in a scope, where a debugger finds it.
    pub capture_everything: bool,
    /// The parse fails before the stack grows below this address.
    pub stack_limit: usize,
}

impl Options<'_> {
    pub(crate) fn is_module_code(&self) -> bool {
        self.in_module || matches!(self.goal, Goal::Module)
    }
}
