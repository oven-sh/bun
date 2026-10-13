use super::semicolon::OptionalSemicolon;
use crate::js::utils::assignment_like::AssignmentLike;
use crate::js::utils::suppressed::FormatSuppressedNode;
use crate::prelude::*;
use crate::{format_args, write};

/// The keyword and the space after it.
fn var_kind_text(kind: VarKind) -> &'static str {
    match kind {
        VarKind::Var => "var ",
        VarKind::Let => "let ",
        VarKind::Const => "const ",
        VarKind::Using => "using ",
        VarKind::AwaitUsing => "await using ",
    }
}

/// `for (;;) var a = 1, b = 2;`: oxfmt does not give each variable a line of its own.
fn body_of_for_loop_is_written_like_its_head(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// `const a = 1, b = 2;`
pub(crate) fn write_variable_declaration<'a>(
    statement: Stmt<'a>,
    declarations: List<'a, VarDecl<'a>>,
    f: &mut Formatter<'a>,
) {
    // The keyword is a property of what is declared.
    let Some(kind) = declarations.first().map(VarDecl::var_kind) else {
        return write!(f, FormatSuppressedNode(statement.span()));
    };
    // Whether it ends with a `;`, which it does not in the head of a loop, and whether it is in a loop.
    let (semicolon, is_in_for_loop) = match statement.parent() {
        Node::File(_) if f.options().in_html.root == HtmlRoot::SvelteStatement => (false, false),
        _ if !statement.modifiers().is_empty() && statement.is_exported() => {
            (statement.is_default_export(), false)
        }
        Node::Stmt(parent) => match parent.tag() {
            StmtTag::For => (parent.for_init() != Some(statement), true),
            StmtTag::ForIn | StmtTag::ForOf => (parent.for_left() != Some(statement), true),
            _ => (true, false),
        },
        _ => (true, false),
    };
    let is_parent_for_loop =
        is_in_for_loop && (!semicolon || body_of_for_loop_is_written_like_its_head(f));

    if statement
        .modifiers()
        .iter()
        .any(|it| it.flag() == Flags::AMBIENT)
    {
        write!(f, ["declare", space()]);
    }

    let content = format_args!(
        var_kind_text(kind),
        FormatVariableDeclarators {
            declarations,
            is_parent_for_loop,
        },
        semicolon.then_some(OptionalSemicolon)
    );
    // All that can break in `const a = b;` is in the group of the declarator, which fits if and only
    // if a group around this fits.
    match f.is_quiet()
        && declarations.len() == 1
        && declarations.first().is_some_and(|it| it.init().is_some())
    {
        true => write!(f, content),
        false => write!(f, group(&content)),
    }
}

struct FormatVariableDeclarators<'a> {
    declarations: List<'a, VarDecl<'a>>,
    is_parent_for_loop: bool,
}

impl<'a> Format<'a> for FormatVariableDeclarators<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let length = self.declarations.len();
        if length == 1 && f.is_quiet() {
            return write!(f, self.declarations.first());
        }
        let has_any_initializer = self
            .declarations
            .iter()
            .any(|declarator| declarator.init().is_some());
        let format_separator = match !self.is_parent_for_loop && has_any_initializer {
            true => hard_line_break(),
            false => soft_line_break_or_space(),
        };

        let mut declarators = FormatSeparatedIter::new(self.declarations.iter(), ",")
            .with_trailing_separator(TrailingSeparator::Disallowed);
        let Some(first_declarator) = declarators.next() else {
            return;
        };

        if length == 1
            && !f
                .comments()
                .has_comment_before(first_declarator.span().start)
        {
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
