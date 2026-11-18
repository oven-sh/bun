//! The tree of one script, module, `eval` code or function. Of the functions inside it has only what it takes to
//! parse them later.

use core::marker::PhantomData;
use core::num::NonZeroU32;
use core::ops::Index;

use bun_engine_text::StringRef;

use crate::names::{Name, Names};
use crate::options::{FunctionFlags, FunctionKind};

/// What a [`List`] holds.
pub trait Element: Copy {
    fn from_word(word: u32) -> Self;
    fn word(self) -> u32;
}

impl Element for Option<Name> {
    #[inline(always)]
    fn from_word(word: u32) -> Option<Name> {
        Name::from_word(word)
    }

    #[inline(always)]
    fn word(self) -> u32 {
        self.map_or(0, |name| name.index() as u32)
    }
}

pub struct List<T> {
    start: u32,
    length: u32,
    element: PhantomData<T>,
}

impl<T> Clone for List<T> {
    #[inline(always)]
    fn clone(&self) -> List<T> {
        *self
    }
}

impl<T> Copy for List<T> {}

impl<T> List<T> {
    pub const EMPTY: List<T> = List {
        start: 0,
        length: 0,
        element: PhantomData,
    };

    #[inline(always)]
    pub fn len(self) -> u32 {
        self.length
    }

    #[inline(always)]
    pub fn is_empty(self) -> bool {
        self.length == 0
    }

    /// All but the first `count`.
    #[inline]
    pub fn skip(self, count: u32) -> List<T> {
        let count = count.min(self.length);
        List {
            start: self.start + count,
            length: self.length - count,
            element: PhantomData,
        }
    }
}

macro_rules! arenas {
    ($($id:ident => $field:ident: $node:ty, $push:ident;)*) => {
        $(
            #[derive(Clone, Copy, PartialEq, Eq, Debug)]
            pub struct $id(NonZeroU32);

            impl $id {
                #[inline(always)]
                pub fn index(self) -> usize {
                    self.0.get() as usize - 1
                }
            }

            impl Element for $id {
                #[inline(always)]
                fn from_word(word: u32) -> $id {
                    $id(NonZeroU32::new(word).unwrap_or(NonZeroU32::MAX))
                }

                #[inline(always)]
                fn word(self) -> u32 {
                    self.0.get()
                }
            }

            impl Element for Option<$id> {
                #[inline(always)]
                fn from_word(word: u32) -> Option<$id> {
                    NonZeroU32::new(word).map($id)
                }

                #[inline(always)]
                fn word(self) -> u32 {
                    self.map_or(0, Element::word)
                }
            }

            impl Index<$id> for Ast {
                type Output = $node;

                #[inline(always)]
                fn index(&self, id: $id) -> &$node {
                    &self.$field[id.index()]
                }
            }

            impl core::ops::IndexMut<$id> for Ast {
                #[inline(always)]
                fn index_mut(&mut self, id: $id) -> &mut $node {
                    &mut self.$field[id.index()]
                }
            }
        )*

        #[derive(Default)]
        pub struct Ast {
            pub names: Names,
            pub root: Root,
            $($field: Vec<$node>,)*
            pub(crate) bindings: Vec<Binding>,
            lists: Vec<u32>,
            /// The elements of the lists that are being built, innermost last.
            open_lists: Vec<u32>,
        }

        impl Ast {
            $(
                #[inline(always)]
                pub(crate) fn $push(&mut self, node: $node) -> $id {
                    self.$field.push(node);
                    Element::from_word(self.$field.len() as u32)
                }
            )*

            pub(crate) fn clear(&mut self) {
                self.names.clear();
                self.root = Root::default();
                $(self.$field.clear();)*
                self.bindings.clear();
                self.lists.clear();
                self.open_lists.clear();
            }
        }
    };
}

arenas! {
    ExprId => expressions: Expr, push_expression;
    StmtId => statements: Stmt, push_statement;
    PatternId => patterns: Pattern, push_pattern;
    PatternElementId => pattern_elements: PatternElement, push_pattern_element;
    PropertyId => properties: Property, push_property;
    FunctionId => functions: Function, push_function;
    ClassId => classes: Class, push_class;
    ClassElementId => class_elements: ClassElement, push_class_element;
    TemplateId => templates: Template, push_template;
    CaseId => cases: Case, push_case;
    ScopeId => scopes: Scope, push_scope;
    TreeId => trees: Tree, push_tree;
}

/// Where a list that is being built starts.
#[derive(Clone, Copy)]
pub(crate) struct OpenList(usize);

impl Ast {
    /// Panics past the end.
    #[inline(always)]
    pub fn at<T: Element>(&self, list: List<T>, index: u32) -> T {
        debug_assert!(index < list.length);
        T::from_word(self.lists[(list.start + index) as usize])
    }

    #[inline]
    pub fn get<T: Element>(&self, list: List<T>, index: u32) -> Option<T> {
        (index < list.length).then(|| self.at(list, index))
    }

    #[inline]
    pub fn iter<T: Element>(
        &self,
        list: List<T>,
    ) -> impl DoubleEndedIterator<Item = T> + ExactSizeIterator + Clone + '_ {
        self.lists[list.start as usize..][..list.length as usize]
            .iter()
            .map(|&word| T::from_word(word))
    }

    /// In the order of their declarations.
    #[inline]
    pub fn bindings(&self, scope: ScopeId) -> &[Binding] {
        let scope = &self[scope];
        &self.bindings[scope.first_binding as usize..][..scope.binding_count as usize]
    }

    /// Spares a large tree from being copied as it grows. Room that is not used is not touched.
    pub(crate) fn reserve(&mut self, source_length: usize) {
        let _ = self.expressions.try_reserve(source_length / 6);
        let _ = self.lists.try_reserve(source_length / 8);
        let _ = self.properties.try_reserve(source_length / 32);
        let _ = self.statements.try_reserve(source_length / 64);
    }

    pub(crate) fn expression_count(&self) -> usize {
        self.expressions.len()
    }

    #[inline(always)]
    pub(crate) fn open_list(&self) -> OpenList {
        OpenList(self.open_lists.len())
    }

    #[inline(always)]
    pub(crate) fn push_to_list(&mut self, element: impl Element) {
        self.open_lists.push(element.word());
    }

    #[inline]
    pub(crate) fn close_list<T>(&mut self, open: OpenList) -> List<T> {
        let start = self.lists.len() as u32;
        match self.open_lists[open.0..] {
            [] => return List::EMPTY,
            [only] => self.lists.push(only),
            ref elements => self.lists.extend_from_slice(elements),
        }
        self.open_lists.truncate(open.0);
        List {
            start,
            length: self.lists.len() as u32 - start,
            element: PhantomData,
        }
    }

    /// A list of the elements since `open` whose index is `first` more than a multiple of three.
    pub(crate) fn every_third<T>(&mut self, open: OpenList, first: usize) -> List<T> {
        let start = self.lists.len() as u32;
        let elements = self.open_lists[open.0..].iter().skip(first).step_by(3);
        self.lists.extend(elements);
        List {
            start,
            length: self.lists.len() as u32 - start,
            element: PhantomData,
        }
    }

    /// Drops what went into lists since `open`.
    #[inline(always)]
    pub(crate) fn abandon_list(&mut self, open: OpenList) {
        self.open_lists.truncate(open.0);
    }
}

bitflags::bitflags! {
    /// What an expression may evaluate to.
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub struct ResultType: u8 {
        /// If it is a number, it is an int32.
        const INT32 = 1 << 0;
        const NUMBER = 1 << 1;
        const STRING = 1 << 2;
        const BIGINT = 1 << 3;
        const NULL = 1 << 4;
        const BOOLEAN = 1 << 5;
        const OTHER = 1 << 6;
    }
}

impl ResultType {
    pub const UNKNOWN: ResultType = ResultType::all().difference(ResultType::INT32);

    #[inline(always)]
    pub fn is_only(self, kind: ResultType) -> bool {
        self.difference(ResultType::INT32) == kind
    }
}

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
    pub struct ExprFlags: u8 {
        /// A debugger can pause before it.
        const PAUSE = 1 << 0;
        const PARENTHESIZED = 1 << 1;
        /// `?.` follows it, and not as a call.
        const OPTIONAL_BASE = 1 << 2;
    }
}

/// An `f64` that needs no more alignment than the rest of a node.
#[derive(Clone, Copy)]
pub struct Number([u32; 2]);

impl Number {
    #[inline(always)]
    pub fn new(value: f64) -> Number {
        let bits = value.to_bits();
        Number([bits as u32, (bits >> 32) as u32])
    }

    #[inline(always)]
    pub fn get(self) -> f64 {
        f64::from_bits(u64::from(self.0[1]) << 32 | u64::from(self.0[0]))
    }
}

#[derive(Clone, Copy)]
pub struct Expr {
    /// Of the first token of the production that made it: the operators of `a + b * c` all start at `a`.
    pub start: u32,
    /// Set where coverage needs it: on operands of operators, conditions, branches, defaults and chains.
    pub end: u32,
    pub flags: ExprFlags,
    pub result: ResultType,
    pub kind: ExprKind,
}

/// An error is reported at `divot` and quotes the text up to `end`.
#[derive(Clone, Copy)]
pub enum ExprKind {
    Null,
    Boolean(bool),
    Number {
        value: Number,
        /// Written without a fraction.
        is_integer: bool,
    },
    String(Name),
    BigInt {
        /// Without prefix, separators and suffix.
        digits: Name,
        radix: u8,
        is_negative: bool,
    },
    RegExp {
        pattern: Name,
        flags: Name,
    },
    Template(TemplateId),
    TaggedTemplate {
        tag: ExprId,
        template: TemplateId,
        divot: u32,
        end: u32,
    },
    This,
    Super,
    NewTarget,
    ImportMeta,
    Identifier(Name),
    /// `#x` in `#x in y`.
    PrivateName(Name),
    Array(List<Option<ExprId>>),
    Object {
        properties: List<PropertyId>,
        /// Binds `CLASS_HOME` for the methods that use it.
        home: Option<ScopeId>,
    },
    Function(FunctionId),
    Class(ClassId),
    Dot {
        base: ExprId,
        name: Name,
        divot: u32,
        end: u32,
    },
    PrivateDot {
        base: ExprId,
        name: Name,
        divot: u32,
        end: u32,
    },
    Index {
        base: ExprId,
        key: ExprId,
        divot: u32,
        end: u32,
        key_assigns: bool,
    },
    Call {
        callee: ExprId,
        arguments: List<ExprId>,
        divot: u32,
        end: u32,
        flags: CallFlags,
    },
    New {
        callee: ExprId,
        arguments: List<ExprId>,
        divot: u32,
        end: u32,
        flags: CallFlags,
    },
    Spread {
        value: ExprId,
        divot: u32,
        end: u32,
    },
    Import {
        specifier: ExprId,
        options: Option<ExprId>,
        divot: u32,
        end: u32,
        is_deferred: bool,
    },
    OptionalChain {
        chain: ExprId,
        is_outermost: bool,
    },
    Unary {
        operator: UnaryOperator,
        operand: ExprId,
    },
    Typeof {
        operand: ExprId,
        end: u32,
    },
    /// `delete a?.b` is a chain that ends in one of these.
    Delete {
        operand: ExprId,
        operator_start: u32,
        end: u32,
    },
    Prefix {
        operator: UpdateOperator,
        operand: ExprId,
        operator_start: u32,
        end: u32,
    },
    Postfix {
        operator: UpdateOperator,
        operand: ExprId,
        operand_start: u32,
        divot: u32,
        end: u32,
    },
    Binary {
        operator: BinaryOperator,
        lhs: ExprId,
        rhs: ExprId,
        rhs_assigns: bool,
    },
    /// `in` and `instanceof`.
    Relation {
        is_instanceof: bool,
        rhs_assigns: bool,
        lhs: ExprId,
        rhs: ExprId,
        lhs_start: u32,
        divot: u32,
        end: u32,
    },
    Logical {
        operator: LogicalOperator,
        lhs: ExprId,
        rhs: ExprId,
    },
    Conditional {
        test: ExprId,
        consequent: ExprId,
        alternate: ExprId,
    },
    /// The target is an identifier, a member or, in code that is not strict, a call.
    Assign {
        operator: AssignOperator,
        target_assigns: bool,
        value_assigns: bool,
        target: ExprId,
        value: ExprId,
        divot: u32,
        end: u32,
    },
    /// A declarator with an initializer, a class declaration or `export default` of an expression.
    Initialize {
        kind: DeclarationKind,
        name: Name,
        name_start: u32,
        value: ExprId,
    },
    /// A declarator without.
    Declare {
        kind: DeclarationKind,
        name: Name,
    },
    Destructure {
        pattern: PatternId,
        value: ExprId,
    },
    Sequence(List<ExprId>),
    Yield(Option<ExprId>),
    YieldDelegate {
        argument: ExprId,
        divot: u32,
        end: u32,
    },
    Await(ExprId),
}

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
    pub struct CallFlags: u8 {
        /// `f?.()`
        const OPTIONAL = 1 << 0;
        const ARGUMENTS_ASSIGN = 1 << 1;
        const SPREAD = 1 << 2;
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum UnaryOperator {
    Not,
    BitNot,
    Negate,
    Plus,
    Void,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum UpdateOperator {
    Increment,
    Decrement,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum BinaryOperator {
    Add,
    Subtract,
    Multiply,
    Divide,
    Remainder,
    Exponentiate,
    BitAnd,
    BitOr,
    BitXor,
    ShiftLeft,
    ShiftRight,
    ShiftRightUnsigned,
    Equal,
    NotEqual,
    StrictEqual,
    StrictNotEqual,
    Less,
    LessEqual,
    Greater,
    GreaterEqual,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum LogicalOperator {
    And,
    Or,
    Coalesce,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum AssignOperator {
    Plain,
    Binary(BinaryOperator),
    Logical(LogicalOperator),
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DeclarationKind {
    Var,
    /// Classes, parameters and those of `catch` too.
    Let,
    Const,
    Using,
    AwaitUsing,
}

#[derive(Clone, Copy)]
pub struct Template {
    /// None where an escape is malformed, which only a tagged template may have.
    pub cooked: List<Option<Name>>,
    /// Of a tagged template.
    pub raw: List<Option<Name>>,
    pub expressions: List<ExprId>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PropertyKey {
    /// Of a number, its canonical text.
    Named(Name),
    Private(Name),
    Computed(ExprId),
    None,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PropertyKind {
    /// Shorthands and methods too.
    Value,
    Getter,
    Setter,
    /// `__proto__: value`
    Prototype,
    /// The value is an [`ExprKind::Spread`].
    Spread,
}

#[derive(Clone, Copy)]
pub struct Property {
    pub kind: PropertyKind,
    pub key: PropertyKey,
    pub value: ExprId,
}

#[derive(Clone, Copy)]
pub struct Pattern {
    pub start: u32,
    pub end: u32,
    pub kind: PatternKind,
}

#[derive(Clone, Copy)]
pub enum PatternKind {
    Binding {
        name: Name,
        /// None for the shorthand of an assignment: `({ a } = b)`.
        declaration: Option<DeclarationKind>,
    },
    /// An identifier or a member.
    Target(ExprId),
    Array(List<PatternElementId>),
    Object(List<PatternElementId>),
}

/// Of an array pattern, an object pattern or a list of parameters.
#[derive(Clone, Copy)]
pub struct PatternElement {
    pub key: PropertyKey,
    /// None for a hole.
    pub pattern: Option<PatternId>,
    pub default: Option<ExprId>,
    pub is_rest: bool,
}

#[derive(Clone, Copy)]
pub struct Function {
    pub kind: FunctionKind,
    pub flags: FunctionFlags,
    /// As written, of a declaration or an expression; of a constructor, that of the class.
    pub own_name: Option<Name>,
    /// What its `name` property says, unless that is computed.
    pub name: Option<Name>,
    /// Of the text that `toString` returns.
    pub start: u32,
    pub parameters_start: u32,
    pub end: u32,
    /// The value of its `length` property.
    pub length: u32,
    /// What `Goal::Function` gives for it. See `Options::eager_functions`.
    pub tree: Option<TreeId>,
}

#[derive(Clone, Copy)]
pub struct Class {
    pub own_name: Option<Name>,
    pub name: Option<Name>,
    pub end: u32,
    pub divot: u32,
    pub head_end: u32,
    pub heritage: Option<ExprId>,
    pub constructor: Option<FunctionId>,
    pub elements: List<ClassElementId>,
    /// Binds the name of the class.
    pub head_scope: Option<ScopeId>,
    /// Binds the private names, and the names of the engine that start with `CLASS_`.
    pub body_scope: Option<ScopeId>,
    /// Code in the heritage may look for the private names of an outer class.
    pub heritage_sees_private_names: bool,
}

#[derive(Clone, Copy)]
pub enum ClassElementKind {
    Method(FunctionId),
    Getter(FunctionId),
    Setter(FunctionId),
    Field(Option<Initializer>),
    StaticBlock,
}

#[derive(Clone, Copy)]
pub struct Initializer {
    pub start: u32,
    pub end: u32,
}

#[derive(Clone, Copy)]
pub struct ClassElement {
    pub kind: ClassElementKind,
    pub is_static: bool,
    pub key: PropertyKey,
    pub start: u32,
    pub key_start: u32,
}

#[derive(Clone, Copy)]
pub struct Case {
    /// None for `default`.
    pub test: Option<ExprId>,
    pub body: List<StmtId>,
    pub start: u32,
    pub end: u32,
}

#[derive(Clone, Copy)]
pub struct Stmt {
    pub start: u32,
    pub end: u32,
    /// A debugger can pause before it.
    pub pause: bool,
    /// It, or something in it, has a completion value.
    pub has_value: bool,
    /// It may jump away before anything in it has one.
    pub jumps_early: bool,
    pub kind: StmtKind,
}

#[derive(Clone, Copy)]
pub enum ForTarget {
    Pattern {
        pattern: PatternId,
        /// Of the declaration.
        start: u32,
    },
    /// An identifier, a member, a call, or the [`ExprKind::Initialize`] of `for (var a = b in c)`.
    Expression(ExprId),
}

#[derive(Clone, Copy)]
pub struct Enumeration {
    pub target: ForTarget,
    pub subject: ExprId,
    pub body: StmtId,
    pub scope: Option<ScopeId>,
    pub target_start: u32,
    pub divot: u32,
    pub end: u32,
}

/// A list of statements has no empty ones.
#[derive(Clone, Copy)]
pub enum StmtKind {
    Empty,
    Debugger,
    Block {
        body: List<StmtId>,
        scope: Option<ScopeId>,
    },
    Expression(ExprId),
    /// One declarator, or a sequence of them.
    Variables(ExprId),
    Function(FunctionId),
    /// An [`ExprKind::Initialize`].
    Class(ExprId),
    If {
        test: ExprId,
        consequent: StmtId,
        alternate: Option<StmtId>,
    },
    DoWhile {
        body: StmtId,
        test: ExprId,
    },
    While {
        test: ExprId,
        body: StmtId,
        test_has_closure: bool,
    },
    For {
        init: Option<ExprId>,
        test: Option<ExprId>,
        update: Option<ExprId>,
        body: StmtId,
        scope: Option<ScopeId>,
        init_has_closure: bool,
        test_has_closure: bool,
    },
    ForIn(Enumeration),
    ForOf(Enumeration),
    ForAwait(Enumeration),
    Continue(Option<Name>),
    Break(Option<Name>),
    Return(Option<ExprId>),
    With {
        object: ExprId,
        body: StmtId,
        object_start: u32,
        object_end: u32,
    },
    Switch {
        discriminant: ExprId,
        cases: List<CaseId>,
        scope: Option<ScopeId>,
    },
    Labeled {
        label: Name,
        body: StmtId,
    },
    Throw {
        value: ExprId,
        end: u32,
    },
    Try {
        block: StmtId,
        /// None too if nothing refers to it.
        parameter: Option<PatternId>,
        parameter_scope: Option<ScopeId>,
        handler: Option<StmtId>,
        finalizer: Option<StmtId>,
    },
    /// An import, or an export that declares nothing.
    ModuleItem,
    Export(StmtId),
    /// In a field initializer: the element of `FunctionSource::fields` at `index`.
    DefineField {
        index: u32,
        key: PropertyKey,
        value: Option<ExprId>,
    },
    StaticBlock {
        function: FunctionId,
    },
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum ScopeKind {
    /// The top level of a script, or of `eval` code that is not strict: its variables live elsewhere.
    Script,
    Module,
    /// The parameters of a function and, if they have no expressions, what its body declares. Also the top level
    /// of strict `eval` code.
    Function,
    /// What the body of a function declares if its parameters have expressions.
    FunctionBody,
    Block,
    Switch,
    /// `catch (e)`, which lets `var e` through (ECMA-262 B.3.4).
    SimpleCatch,
    Class,
    With,
}

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
    pub struct ScopeFlags: u8 {
        /// A direct `eval` is somewhere inside.
        const CONTAINS_EVAL = 1 << 0;
        /// A direct `eval` may declare variables here.
        const EXTENSIBLE = 1 << 1;
        const HAS_CAPTURED = 1 << 2;
        const HAS_USING = 1 << 3;
        const HAS_AWAIT_USING = 1 << 4;
        /// Of a `FunctionBody`: a closure among the parameters may name something that it declares.
        const HIDDEN_FROM_PARAMETERS = 1 << 5;
    }
}

#[derive(Clone, Copy)]
pub struct Scope {
    pub kind: ScopeKind,
    pub flags: ScopeFlags,
    pub(crate) first_binding: u32,
    pub(crate) binding_count: u32,
    /// The declarations to instantiate on entry, in the order of the source.
    pub functions: List<FunctionId>,
    pub start: u32,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum BindingKind {
    Var,
    Parameter,
    /// The name of a function expression, inside it.
    Callee,
    /// The `arguments` object.
    Arguments,
    /// A name of the engine.
    Internal,
    Let,
    Const,
    Using,
    AwaitUsing,
    /// A function in a block or at the top level of a module.
    LexicalFunction,
    Import,
    ImportNamespace,
    PrivateField,
    PrivateMethod,
    PrivateAccessor,
}

impl BindingKind {
    pub const fn is_lexical(self) -> bool {
        self as u8 >= BindingKind::Let as u8
    }

    pub const fn is_constant(self) -> bool {
        matches!(
            self,
            BindingKind::Const
                | BindingKind::Using
                | BindingKind::AwaitUsing
                | BindingKind::Import
                | BindingKind::ImportNamespace
        )
    }

    pub const fn is_private(self) -> bool {
        self as u8 >= BindingKind::PrivateField as u8
    }
}

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
    pub struct BindingFlags: u16 {
        const USED = 1 << 0;
        /// It has to be in a scope: a closure, `eval` or `with` can reach it, or a frame is no good place for it.
        const CAPTURED = 1 << 1;
        /// Assigned to, which the initializer of a `var` does as well.
        const WRITTEN = 1 << 2;
        /// More than once for all the parser knows.
        const REWRITTEN = 1 << 3;
        /// Its own function may refer to it before it is initialized, but for the body of a `with`.
        const USED_EARLY = 1 << 4;
        /// `let x;`
        const STARTS_UNDEFINED = 1 << 5;
        /// A function declaration gives the variable or parameter its first value.
        const FUNCTION = 1 << 6;
        /// A function declaration that is neither async nor a generator.
        const PLAIN_FUNCTION = 1 << 7;
        /// The variable is there only for a function in a block.
        const HOISTED = 1 << 8;
        const EXPORTED = 1 << 9;
        const STATIC = 1 << 10;
        const HAS_GETTER = 1 << 11;
        const HAS_SETTER = 1 << 12;
        /// Of a variable of a `FunctionBody`.
        const HIDES_PARAMETER = 1 << 13;
    }
}

#[derive(Clone, Copy)]
pub struct Binding {
    pub name: Name,
    pub kind: BindingKind,
    pub flags: BindingFlags,
    /// Code of its function from here up to `initialized_until` finds it initialized.
    pub initialized_from: u32,
    pub initialized_until: u32,
}

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
    pub struct Features: u16 {
        const STRICT = 1 << 0;
        const USES_THIS = 1 << 1;
        const AWAITS = 1 << 2;
        /// Every parameter is a name without a default.
        const SIMPLE_PARAMETERS = 1 << 3;
        /// Nothing is done with `arguments` but read its `length`.
        const ONLY_ARGUMENTS_LENGTH = 1 << 4;
        /// Here or in an inner function.
        const TAGGED_TEMPLATE = 1 << 5;
        /// `super()` does too.
        const USES_NEW_TARGET = 1 << 6;
    }
}

#[derive(Clone, Copy)]
pub struct ModuleRequest {
    pub specifier: Name,
    /// Keys and values in turn.
    pub attributes: List<Option<Name>>,
    pub is_deferred: bool,
}

/// `request` is an index into [`Module::requests`]. A name that is none stands for the namespace.
#[derive(Clone, Copy)]
pub struct Import {
    pub request: u32,
    pub imported: Option<Name>,
    pub local: Name,
}

#[derive(Clone, Copy)]
pub enum Export {
    Local {
        exported: Name,
        local: Name,
    },
    Indirect {
        exported: Name,
        request: u32,
        imported: Option<Name>,
    },
    Star {
        request: u32,
    },
}

#[derive(Default)]
pub struct Module {
    /// One for each declaration that names a module.
    pub requests: Vec<ModuleRequest>,
    pub imports: Vec<Import>,
    pub exports: Vec<Export>,
}

/// The code of a function, or of what is parsed.
#[derive(Clone, Copy)]
pub struct Tree {
    pub features: Features,
    /// Of the first token.
    pub start: u32,
    pub end: u32,
    pub scope: Option<ScopeId>,
    pub parameters: List<PatternElementId>,
    pub body_scope: Option<ScopeId>,
    /// Of a function, one block without a scope or one `return`.
    pub body: List<StmtId>,
}

impl Default for Tree {
    fn default() -> Tree {
        Tree {
            features: Features::empty(),
            start: 0,
            end: 0,
            scope: None,
            parameters: List::EMPTY,
            body_scope: None,
            body: List::EMPTY,
        }
    }
}

#[derive(Default)]
pub struct Root {
    pub tree: Tree,
    pub module: Module,
    pub source_url: Option<StringRef>,
    pub source_mapping_url: Option<StringRef>,
}
