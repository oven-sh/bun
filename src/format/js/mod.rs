//! JavaScript, JSX and TypeScript.

pub(crate) mod ast_nodes;
pub(crate) mod builders;
pub(crate) mod comments;
pub(crate) mod context;
pub(crate) mod fields;
pub(crate) mod format;
pub(crate) mod parentheses;
pub(crate) mod print;
pub(crate) mod siblings;
pub(crate) mod source_text;
pub(crate) mod trivia;
pub(crate) mod utils;

use crate::prelude::*;

pub(crate) mod prelude {
    pub(crate) use super::ast_nodes::{AsAstNodes, AstNodes, ChainElement, is_assignment_target, is_chain_root};
    pub(crate) use super::builders::FormatSeparatedIter;
    pub(crate) use super::comments::{Comment, Comments};
    pub(crate) use super::fields::{ExprFields, StmtFields};
    pub(crate) use super::source_text::SourceText;
    pub(crate) use super::trivia::{
        DanglingIndentMode, FormatDanglingComments, FormatLeadingComments, FormatTrailingComments,
        format_dangling_comments, format_leading_comments, format_trailing_comments,
    };
    pub(crate) use super::utils::operators::{BinOpExt, Precedence, UnOpExt};
}

pub(crate) fn format_file<'a>(file: &'a File<'a>, f: &mut Formatter<'a>) {
    print::program::write_program(file, f);
}
