//! The syntax tree of one top-level statement.

use super::lexer::T;

pub(super) type Id = u32;
pub(super) const NONE: Id = 0;

/// The comments name the fields of [`Node`] that a kind uses: `a`, `b`, `c`, `d` and `[list]`.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
#[repr(u8)]
pub(super) enum K {
    None,
    // Expressions
    Ident,
    PrivateName,
    This,
    Super,
    Null,
    Bool,
    Num,
    BigInt,
    Str,
    Regex,
    /// `import.meta`, `new.target`
    Meta,
    /// `[text, expression, text, ..]`
    Template,
    /// tag, type arguments, template
    Tagged,
    Array,
    Object,
    /// name, type parameters, return type, body, and the `Params` in `list`
    Fn,
    Arrow,
    /// name, type parameters, `Extends`, `ClassBody`, `[implements]`
    Class,
    Unary,
    Update,
    Binary,
    Logical,
    Seq,
    Assign,
    Cond,
    /// callee, type arguments, `Args`
    Call,
    New,
    /// `c` is the `Args`
    ImportCall,
    Dot,
    Index,
    NonNull,
    As,
    Satisfies,
    Await,
    Yield,
    Spread,
    Hole,
    /// `JsxOpening`, closing name, `[children]`
    Jsx,
    // Parts of expressions
    /// With its delimiters.
    Quasi,
    Args,
    Params,
    /// pattern, type, default, `Decorators`
    Param,
    /// key, value. `op` is `Colon`, `Ident` for a shorthand, or `OpenParen`, `Get` or `Set` if the value is an `Fn`.
    Prop,
    ObjectPattern,
    ArrayPattern,
    /// key, value. `op` is `Colon`, or `Ident` for a shorthand, which only has a value.
    PatternProp,
    AssignPattern,
    Rest,
    /// expression, type arguments
    Extends,
    ClassBody,
    /// key, type, value, `Decorators`
    Field,
    /// key, `Fn`, and `d` is the `Decorators`. `op` is `OpenParen`, `Get`, `Set` or `Constructor`.
    Method,
    StaticBlock,
    /// `[expressions]`, each of which is right after its `@`
    Decorators,
    /// name, type arguments, `[attributes]`
    JsxOpening,
    JsxName,
    JsxAttr,
    JsxSpreadAttr,
    JsxContainer,
    JsxText,
    JsxStr,
    // Statements
    Directive,
    ExprStmt,
    Var,
    /// pattern, type, value
    Declarator,
    If,
    For,
    ForIn,
    ForOf,
    While,
    DoWhile,
    Return,
    Throw,
    Break,
    Continue,
    Debugger,
    /// label, statement
    Labeled,
    /// `Decorators`, and a class or the export of a class
    Decorated,
    Empty,
    Block,
    /// The block of a function
    Body,
    Switch,
    Case,
    /// block, `Catch`, block
    Try,
    /// `Param`, block
    Catch,
    /// default, namespace, `Specifiers`, source, `[value of the type attribute]`
    Import,
    /// `c` is the `Specifiers`, `d` the source
    ExportNamed,
    /// name, and `d` is the source
    ExportAll,
    ExportDefault,
    /// `export` before a declaration
    Export,
    Specifiers,
    /// name, alias
    Specifier,
    /// name, type parameters, type
    TypeAlias,
    /// name, type parameters, `TypeBody`, `[extends]`
    Interface,
    Enum,
    EnumMember,
    /// `namespace`, `module` and `declare global`: name, `ModuleBlock`
    Module,
    ModuleBlock,
    // Types
    TypeKeyword,
    /// name, type arguments
    TypeRef,
    QualifiedName,
    TypeArgs,
    TypeParams,
    /// name, constraint, default
    TypeParam,
    TypeLiteral,
    /// The body of an interface
    TypeBody,
    /// key, type
    PropertySignature,
    /// key, `Fn`. `op` is `OpenParen`, `Get` or `Set`.
    MethodSignature,
    /// `b` is the `Fn`. `op` is `New` for a construct signature.
    CallSignature,
    /// `Param`, type
    IndexSignature,
    /// name, constraint, `as` type, type
    Mapped,
    Tuple,
    /// name, type
    NamedElement,
    OptionalType,
    RestType,
    ArrayType,
    IndexedAccess,
    Union,
    Intersection,
    /// Like `Fn`. `op` is `New` for a constructor type.
    FnType,
    Conditional,
    /// `TypeParam`
    Infer,
    TypeOperator,
    /// name, type arguments
    TypeQuery,
    /// `Args`, name, type arguments
    ImportType,
    /// A string, number or boolean in `a`
    LiteralType,
    TemplateType,
    /// name, type
    Predicate,
}

pub(super) mod flag {
    pub(in super::super) const PARENS: u32 = 1;
    /// There's a line break between its first and its last token.
    pub(in super::super) const MULTILINE: u32 = 1 << 1;
    /// There's a comment between its first and its last token.
    pub(in super::super) const COMMENT: u32 = 1 << 2;
    /// A statement with something that isn't handled here, not counting the statement lists inside it.
    pub(in super::super) const UNSURE: u32 = 1 << 3;
    /// Part of the left side of a destructuring assignment.
    pub(in super::super) const TARGET: u32 = 1 << 4;
    /// `?.`, or the `?` after a name
    pub(in super::super) const OPTIONAL: u32 = 1 << 5;
    /// A member or a call at or after a `?.`
    pub(in super::super) const CHAIN: u32 = 1 << 6;
    pub(in super::super) const COMPUTED: u32 = 1 << 7;
    pub(in super::super) const ASYNC: u32 = 1 << 8;
    pub(in super::super) const STAR: u32 = 1 << 9;
    pub(in super::super) const ESCAPE: u32 = 1 << 10;
    pub(in super::super) const PREFIX: u32 = 1 << 11;
    pub(in super::super) const TYPE_ONLY: u32 = 1 << 12;
    pub(in super::super) const DEFINITE: u32 = 1 << 13;
    pub(in super::super) const DECLARE: u32 = 1 << 14;
    pub(in super::super) const PUBLIC: u32 = 1 << 15;
    pub(in super::super) const PROTECTED: u32 = 1 << 16;
    pub(in super::super) const PRIVATE: u32 = 1 << 17;
    pub(in super::super) const STATIC: u32 = 1 << 18;
    pub(in super::super) const ABSTRACT: u32 = 1 << 19;
    pub(in super::super) const OVERRIDE: u32 = 1 << 20;
    pub(in super::super) const READONLY: u32 = 1 << 21;
    pub(in super::super) const CONST: u32 = 1 << 22;
    pub(in super::super) const REST: u32 = 1 << 23;
    /// A function or class that's a statement, or follows `export default`
    pub(in super::super) const DECLARATION: u32 = 1 << 24;
    pub(in super::super) const TRAILING_COMMA: u32 = 1 << 25;
    pub(in super::super) const SELF_CLOSING: u32 = 1 << 26;
    pub(in super::super) const ASSERTS: u32 = 1 << 27;
    pub(in super::super) const TYPEOF: u32 = 1 << 28;
    pub(in super::super) const IN: u32 = 1 << 29;
    pub(in super::super) const OUT: u32 = 1 << 30;

    /// Without this, `MULTILINE` and `COMMENT`, it's certain to be printed as it is if it fits on the line.
    pub(in super::super) const ODD: u32 = 1 << 31;
    pub(in super::super) const ACCESSIBILITY: u32 = PUBLIC | PROTECTED | PRIVATE;
}

#[derive(Copy, Clone, Debug)]
pub(super) struct Node {
    pub(super) kind: K,
    pub(super) op: T,
    pub(super) len: u16,
    pub(super) flags: u32,
    /// Without parentheses.
    pub(super) start: u32,
    pub(super) end: u32,
    pub(super) a: Id,
    pub(super) b: Id,
    pub(super) c: Id,
    pub(super) d: Id,
    pub(super) list: u32,
    pub(super) parent: Id,
}

impl Node {
    pub(super) const NONE: Node = Node {
        kind: K::None,
        op: T::Unknown,
        len: 0,
        flags: 0,
        start: 0,
        end: 0,
        a: NONE,
        b: NONE,
        c: NONE,
        d: NONE,
        list: 0,
        parent: NONE,
    };

    #[inline]
    pub(super) fn has(&self, flags: u32) -> bool {
        self.flags & flags != 0
    }

    /// The `Params` of a function.
    #[inline]
    pub(super) fn params(&self) -> Id {
        self.list
    }
}

#[derive(Default)]
pub(super) struct Tree {
    pub(super) nodes: Vec<Node>,
    pub(super) lists: Vec<Id>,
}

impl Tree {
    pub(super) fn clear(&mut self) {
        self.nodes.clear();
        self.nodes.push(Node::NONE);
        self.lists.clear();
    }

    #[inline]
    pub(super) fn node(&self, id: Id) -> &Node {
        self.nodes.get(id as usize).unwrap_or(&Node::NONE)
    }

    #[inline]
    pub(super) fn kind(&self, id: Id) -> K {
        self.node(id).kind
    }

    #[inline]
    pub(super) fn list(&self, id: Id) -> &[Id] {
        self.list_of(self.node(id))
    }

    #[inline]
    pub(super) fn list_of(&self, node: &Node) -> &[Id] {
        let start = node.list as usize;
        (self.lists.get(start..start + node.len as usize)).unwrap_or_default()
    }

    #[inline]
    pub(super) fn is_function_composition(&self, args: &[Id]) -> bool {
        if args.len() <= 1 {
            return false;
        }
        let mut has_seen_function = false;
        for &argument in args {
            let mut node = self.node(argument);
            match node.kind {
                K::Fn | K::Arrow if has_seen_function => return true,
                K::Fn | K::Arrow => has_seen_function = true,
                K::Call | K::NonNull => {
                    while node.kind == K::NonNull {
                        node = self.node(node.a);
                    }
                    let is_function = |&it: &Id| matches!(self.kind(it), K::Fn | K::Arrow);
                    if node.kind == K::Call && self.list(node.c).iter().any(is_function) {
                        return true;
                    }
                }
                _ => {}
            }
        }
        false
    }

    #[inline]
    pub(super) fn should_break_array(&self, elements: &[Id]) -> bool {
        let [first, _, ..] = *elements else {
            return false;
        };
        let kind = self.kind(first);
        matches!(kind, K::Array | K::Object)
            && (elements.iter()).all(|&it| self.kind(it) == kind && self.node(it).len >= 2)
    }

    /// For the type parameters, parameters and return type of an arrow function.
    pub(super) fn can_avoid_parentheses(&self, (type_params, params, ty): (Id, Id, Id)) -> bool {
        (type_params, ty) == (NONE, NONE)
            && matches!(*self.list(params), [only] if {
                let param = self.node(only);
                param.flags & (flag::REST | flag::OPTIONAL) == 0
                    && (param.b, param.c) == (NONE, NONE)
                    && self.kind(param.a) == K::Ident
            })
    }
}
