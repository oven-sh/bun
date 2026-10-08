use super::semicolon::OptionalSemicolon;
use crate::js::utils::assignment_like::AssignmentLike;
use crate::prelude::*;
use crate::{format_args, write};

fn var_kind_text(kind: VarKind) -> &'static str {
    match kind {
        VarKind::Var => "var",
        VarKind::Let => "let",
        VarKind::Const => "const",
        VarKind::Using => "using",
        VarKind::AwaitUsing => "await using",
    }
}

/// `const a = 1, b = 2;`
pub(crate) fn write_variable_declaration<'a>(
    statement: Stmt<'a>,
    declarations: List<'a, VarDecl<'a>>,
    f: &mut Formatter<'a>,
) {
    let parent = AstNodes::VariableDeclaration(statement).parent();
    let semicolon = match parent {
        AstNodes::ExportNamedDeclaration(_) => false,
        AstNodes::ForStatement(parent) => parent.for_init() != Some(statement),
        AstNodes::ForInStatement(parent) | AstNodes::ForOfStatement(parent) => parent.for_left() != Some(statement),
        _ => true,
    };

    if statement.modifiers().iter().any(|it| it.flag() == Flags::AMBIENT) {
        write!(f, ["declare", space()]);
    }

    let kind = declarations.first().map_or(VarKind::Var, VarDecl::var_kind);
    write!(
        f,
        group(&format_args!(
            var_kind_text(kind),
            space(),
            FormatVariableDeclarators {
                declarations,
                is_parent_for_loop: matches!(
                    parent,
                    AstNodes::ForStatement(_) | AstNodes::ForInStatement(_) | AstNodes::ForOfStatement(_)
                ),
            },
            semicolon.then_some(OptionalSemicolon)
        ))
    );
}

struct FormatVariableDeclarators<'a> {
    declarations: List<'a, VarDecl<'a>>,
    is_parent_for_loop: bool,
}

impl<'a> Format<'a> for FormatVariableDeclarators<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let length = self.declarations.len();
        let has_any_initializer = self.declarations.iter().any(|declarator| declarator.init().is_some());
        let format_separator = match !self.is_parent_for_loop && has_any_initializer {
            true => hard_line_break(),
            false => soft_line_break_or_space(),
        };

        let mut declarators = FormatSeparatedIter::new(self.declarations.iter(), ",")
            .with_trailing_separator(TrailingSeparator::Disallowed);
        let Some(first_declarator) = declarators.next() else {
            return;
        };

        if length == 1 && !f.comments().has_comment_before(first_declarator.span().start) {
            return write!(f, first_declarator);
        }

        write!(
            f,
            indent(&format_once(|f| {
                write!(f, first_declarator);
                if length > 1 {
                    write!(f, format_separator);
                }
                f.join_with(format_separator).entries(declarators);
            }))
        );
    }
}

/// `a = 1`
pub(crate) fn write_variable_declarator<'a>(declarator: VarDecl<'a>, f: &mut Formatter<'a>) {
    AssignmentLike::VariableDeclarator(declarator).fmt(f);
}
