// Port of internal/ast onto a node table. The generated files come from gen/generate-ast.ts.
pub mod ast;
pub mod ast_generated;
pub mod builder;
pub mod context;
pub mod dump;
pub mod factory;
pub mod flags_generated;
pub mod kind_generated;
pub mod node_arena;
pub mod program;
pub mod symbol;
pub mod table;

pub use ast_generated::*;
pub use context::{Ast, AstContext, Mode};
pub use factory::{
    NodeFactory, NodeFactoryHooks, NodeVisitor, NodeVisitorHooks, new_node_factory,
    new_node_visitor,
};
pub use flags_generated::{ModifierFlags, NodeFlags, TokenFlags};
pub use kind_generated::*;
pub use table::{FileData, NodeTable};
