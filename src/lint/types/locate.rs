//! From the syntax of the file to the type checker: which node of TypeScript's tree a handle is.

use super::{Signature, TsNode, TsSymbol, Type};
use crate::ast::{
    Alias, Case, Class, Enum, EnumMember, Export, ExportSpec, Expr, File, Func, Ident, Import,
    ImportEquals, ImportSpec, Interface, Member, Module, Node, Param, Pat, PatElem, PatProp, Prop,
    Stmt, TupleElem, TypeNode, TypeParam, VarDecl,
};
use bun_sema::check::services::{Location, Row};
use bun_sema::node::Part;

/// What the type checker can be asked about: a node of the file, or a [`TsNode`] of any file.
///
/// Which node of TypeScript's tree a handle stands for is what typescript-estree's
/// `esTreeNodeToTSNodeMap` has for the ESTree node that the handle stands for:
///
/// | handle | `ts.Node` |
/// | --- | --- |
/// | [`Expr`] | the expression, without parentheses |
/// | [`Pat`] | the `Identifier` that is bound, the `ObjectBindingPattern`, the `ArrayBindingPattern` |
/// | [`VarDecl`], [`Param`], [`PatProp`], [`PatElem`] | `VariableDeclaration`, `ParameterDeclaration`, `BindingElement` |
/// | [`Func`] | the function-like: for a method the `MethodDeclaration`, which is also what the [`Member`] or the [`Prop`] is |
/// | [`Class`] | `ClassDeclaration`, `ClassExpression` |
/// | [`Stmt`], [`TypeNode`], [`Member`], [`Prop`], [`TypeParam`], [`EnumMember`], [`Case`], [`ImportSpec`], [`ExportSpec`], [`TupleElem`] | the node of that kind |
/// | [`Ident`] | the `Identifier` (or the literal) that is written there |
/// | [`NameOf`]`(owner)` | `owner.name` |
pub trait Locate<'a>: Copy {
    fn locate(self, file: &'a File<'a>) -> TsNode<'a>;
}

impl<'a> Locate<'a> for TsNode<'a> {
    #[inline]
    fn locate(self, _: &'a File<'a>) -> TsNode<'a> {
        self
    }
}

impl<'a> Locate<'a> for Location {
    fn locate(self, file: &'a File<'a>) -> TsNode<'a> {
        TsNode::new(file, file.id_in_program(), file.query(|q| q.node(self)))
    }
}

impl<'a> Locate<'a> for &'a File<'a> {
    #[inline]
    fn locate(self, file: &'a File<'a>) -> TsNode<'a> {
        Location::from(Row::File).locate(file)
    }
}

impl<'a> Locate<'a> for Ident<'a> {
    #[inline]
    fn locate(self, file: &'a File<'a>) -> TsNode<'a> {
        Location::from(Row::NameAt(self.start())).locate(file)
    }
}

/// The name of a declaration, a member or a property access, as a node: ESTree's `node.id`,
/// `node.key`, `node.property`, TypeScript's `node.name`.
///
/// `NameOf(member).ts_symbol()` is `services.getSymbolAtLocation(node.key)`.
#[derive(Copy, Clone, Debug)]
pub struct NameOf<T>(pub T);

trait ToRow<'a>: Copy {
    fn row(self) -> Row;
    fn file_of(self) -> &'a File<'a>;
}

#[inline]
fn file_of<'a>(it: impl ToRow<'a>) -> &'a File<'a> {
    it.file_of()
}

macro_rules! rows {
    ($($handle:ident $row:expr, $file:expr;)*) => {
        $(impl<'a> ToRow<'a> for $handle<'a> {
            #[inline]
            fn row(self) -> Row {
                let row: fn(Self) -> Row = $row;
                row(self)
            }
            #[inline]
            fn file_of(self) -> &'a File<'a> {
                let file: fn(Self) -> &'a File<'a> = $file;
                file(self)
            }
        }

        impl<'a> Locate<'a> for $handle<'a> {
            #[inline]
            fn locate(self, file: &'a File<'a>) -> TsNode<'a> {
                Location::from(self.row()).locate(file)
            }
        }

        impl<'a> Locate<'a> for NameOf<$handle<'a>> {
            #[inline]
            fn locate(self, file: &'a File<'a>) -> TsNode<'a> {
                Location::part(self.0.row(), Part::Name).locate(file)
            }
        }

        impl<'a> NameOf<$handle<'a>> {
            /// `services.getTypeAtLocation(node.name)`
            pub fn ty(self) -> Type<'a> {
                self.locate(file_of(self.0)).get_type_at_location()
            }

            /// `services.getSymbolAtLocation(node.name)`
            pub fn ts_symbol(self) -> Option<TsSymbol<'a>> {
                self.locate(file_of(self.0)).get_symbol_at_location()
            }

            /// `services.esTreeNodeToTSNodeMap.get(node.name)`
            pub fn ts_node(self) -> TsNode<'a> {
                self.locate(file_of(self.0))
            }
        }

        impl<'a> $handle<'a> {
            /// `services.getTypeAtLocation(node)`
            pub fn type_at_location(self) -> Type<'a> {
                self.locate(file_of(self)).get_type_at_location()
            }

            /// `services.getSymbolAtLocation(node)`
            pub fn ts_symbol(self) -> Option<TsSymbol<'a>> {
                self.locate(file_of(self)).get_symbol_at_location()
            }

            /// `services.esTreeNodeToTSNodeMap.get(node)`
            pub fn ts_node(self) -> TsNode<'a> {
                self.locate(file_of(self))
            }
        })*
    };
}

rows! {
    Expr |it| Row::Expr(it.id()), |it| it.file();
    Stmt |it| Row::Stmt(it.id()), |it| it.file();
    TypeNode |it| Row::Type(it.id()), |it| it.file();
    Pat |it| Row::Pat(it.id()), |it| it.file();
    PatProp |it| Row::PatProp(it.id()), |it| it.file();
    PatElem |it| Row::PatElem(it.id()), |it| it.file();
    Func |it| Row::Fn(it.id()), |it| it.file();
    Class |it| Row::Class(it.id()), |it| it.file();
    Param |it| Row::Param(it.id()), |it| it.file();
    TypeParam |it| Row::TypeParam(it.id()), |it| it.file();
    Member |it| Row::Member(it.id()), |it| it.file();
    Prop |it| Row::Prop(it.id()), |it| it.file();
    VarDecl |it| Row::VarDecl(it.id()), |it| it.file();
    Case |it| Row::Case(it.id()), |it| it.file();
    EnumMember |it| Row::EnumMember(it.id()), |it| it.file();
    ImportSpec |it| Row::ImportSpec(it.id()), |it| it.file();
    ExportSpec |it| Row::ExportSpec(it.id()), |it| it.file();
    TupleElem |it| Row::TupleElem(it.id()), |it| it.file();
    Interface |it| Row::Stmt(it.stmt().id()), |it| it.stmt().file();
    Alias |it| Row::Stmt(it.stmt().id()), |it| it.stmt().file();
    Enum |it| Row::Stmt(it.stmt().id()), |it| it.stmt().file();
    Module |it| Row::Stmt(it.stmt().id()), |it| it.stmt().file();
    Import |it| Row::Stmt(it.stmt().id()), |it| it.stmt().file();
    ImportEquals |it| Row::Stmt(it.stmt().id()), |it| it.stmt().file();
    Export |it| Row::Stmt(it.stmt().id()), |it| it.stmt().file();
}

impl<'a> ToRow<'a> for Node<'a> {
    #[inline]
    fn file_of(self) -> &'a File<'a> {
        self.file()
    }

    fn row(self) -> Row {
        match self {
            Node::File(_) => Row::File,
            Node::Expr(it) => it.row(),
            Node::Stmt(it) => it.row(),
            Node::Type(it) => it.row(),
            Node::Pat(it) => it.row(),
            Node::PatProp(it) => it.row(),
            Node::PatElem(it) => it.row(),
            Node::Func(it) => it.row(),
            Node::Param(it) => it.row(),
            Node::TypeParam(it) => it.row(),
            Node::Class(it) => it.row(),
            Node::Member(it) => it.row(),
            Node::Prop(it) => it.row(),
            Node::VarDecl(it) => it.row(),
            Node::Case(it) => it.row(),
            Node::EnumMember(it) => it.row(),
            Node::ImportSpec(it) => it.row(),
            Node::ExportSpec(it) => it.row(),
            Node::TupleElem(it) => it.row(),
        }
    }
}

impl<'a> Locate<'a> for Node<'a> {
    #[inline]
    fn locate(self, file: &'a File<'a>) -> TsNode<'a> {
        Location::from(self.row()).locate(file)
    }
}

impl<'a> Locate<'a> for NameOf<Node<'a>> {
    #[inline]
    fn locate(self, file: &'a File<'a>) -> TsNode<'a> {
        Location::part(self.0.row(), Part::Name).locate(file)
    }
}

impl<'a> Node<'a> {
    /// `services.getTypeAtLocation(node)`
    pub fn ty(self) -> Type<'a> {
        self.locate(self.file()).get_type_at_location()
    }

    /// `services.getTypeAtLocation(node)`
    pub fn type_at_location(self) -> Type<'a> {
        self.ty()
    }

    /// `services.getSymbolAtLocation(node)`
    pub fn ts_symbol(self) -> Option<TsSymbol<'a>> {
        self.locate(self.file()).get_symbol_at_location()
    }

    /// `services.esTreeNodeToTSNodeMap.get(node)`
    pub fn ts_node(self) -> TsNode<'a> {
        self.locate(self.file())
    }
}

impl<'a> Pat<'a> {
    /// `services.getTypeAtLocation(node)`: the type of the variable, or of what the pattern
    /// destructures.
    pub fn ty(self) -> Type<'a> {
        self.type_at_location()
    }
}

impl<'a> TypeNode<'a> {
    /// `services.getTypeAtLocation(node)`, `checker.getTypeFromTypeNode(node)`: the type that is
    /// written.
    pub fn ty(self) -> Type<'a> {
        self.type_at_location()
    }
}

impl<'a> Expr<'a> {
    /// `services.getTypeAtLocation(node)`: the type of the expression where it stands, narrowed by
    /// control flow. The type of a literal is the literal type.
    pub fn ty(self) -> Type<'a> {
        self.type_at_location()
    }

    /// `checker.getContextualType(node)`: the type that its position expects of the expression.
    pub fn contextual_type(self) -> Option<Type<'a>> {
        self.ts_node().get_contextual_type()
    }

    /// `checker.getResolvedSignature(node)`: the overload that a call, a `new`, a tagged template
    /// or a JSX element resolves to. `None`: the callee is untyped or the call is in error.
    pub fn resolved_signature(self) -> Option<Signature<'a>> {
        self.ts_node().get_resolved_signature()
    }

    /// The expression with its parentheses, as the `ParenthesizedExpression` that TypeScript has.
    pub fn ts_node_with_parentheses(self) -> TsNode<'a> {
        Location::from(Row::Parenthesized(self.id())).locate(self.file())
    }
}

impl<'a> Func<'a> {
    /// `checker.getSignatureFromDeclaration(node)`
    pub fn signature(self) -> Option<Signature<'a>> {
        self.ts_node().get_signature_from_declaration()
    }
}
