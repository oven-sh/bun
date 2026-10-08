use bun_lint::prelude::*;
use bun_lint::utils::ast_utils::{
    is_opening_brace_token, is_token_on_same_line, matches_comments_ignore_pattern,
};
use bun_lint::utils::text::is_blank;
use bun_lint::utils::{estree_span, get_node_by_range_index};

/// Require empty lines around comments.
pub struct LinesAroundComment {
    before_block_comment: bool,
    after_block_comment: bool,
    before_line_comment: bool,
    after_line_comment: bool,
    after_hashbang_comment: bool,
    at_start: Exceptions,
    at_end: Exceptions,
    ignore_pattern: Option<Regex>,
    applies_default_ignore_patterns: bool,
}

/// Where a comment needs no empty line: `allowBlockStart` and the like, or `allowBlockEnd` and the
/// like.
struct Exceptions {
    block: bool,
    class: Option<bool>,
    object: bool,
    array: bool,
}

const AFTER: Message = Message::new("after", "Expected line after comment.");
const BEFORE: Message = Message::new("before", "Expected line before comment.");

const CLASS_BODY: u8 = 1 << 0;
const BLOCK_STATEMENT: u8 = 1 << 1;
const STATIC_BLOCK: u8 = 1 << 2;
const SWITCH_CASE: u8 = 1 << 3;
const SWITCH_STATEMENT: u8 = 1 << 4;
/// `ObjectExpression`, `ObjectPattern`
const OBJECT: u8 = 1 << 5;
/// `ArrayExpression`, `ArrayPattern`
const ARRAY: u8 = 1 << 6;
const BLOCKS: u8 = CLASS_BODY | BLOCK_STATEMENT | STATIC_BLOCK | SWITCH_CASE | SWITCH_STATEMENT;

impl Exceptions {
    fn new(options: Object<'_>, position: &str) -> Exceptions {
        let option = |what: &str| options.bool(&format!("allow{what}{position}"));
        Exceptions {
            block: option("Block") == Some(true),
            class: option("Class"),
            object: option("Object") == Some(true),
            array: option("Array") == Some(true),
        }
    }

    fn is_empty(&self) -> bool {
        !self.block && self.class != Some(true) && !self.object && !self.array
    }

    /// Whether one applies in a node of one of `types`.
    fn allow(&self, types: u8) -> bool {
        let is_class = types & CLASS_BODY != 0;
        (self.block && types & BLOCKS != 0 && !(self.class == Some(false) && is_class))
            || (self.class == Some(true) && is_class)
            || (self.object && types & OBJECT != 0)
            || (self.array && types & ARRAY != 0)
    }
}

/// The innermost node of ESTree that a comment is in, as far as the rule looks at it.
struct Parent {
    /// Its `type`, its `body.type` and its `consequent.type`.
    types: u8,
    /// Where it starts. For a static block and a `switch` statement, the `{`.
    start: u32,
    end: u32,
}

impl Parent {
    fn new(types: u8, span: Span) -> Option<Parent> {
        Some(Parent {
            types,
            start: span.start,
            end: span.end,
        })
    }
}

fn type_of_statement(statement: Stmt<'_>) -> u8 {
    match statement.kind() {
        StmtKind::Block(_) => BLOCK_STATEMENT,
        StmtKind::Switch { .. } => SWITCH_STATEMENT,
        _ => 0,
    }
}

fn type_of_expression(e: Expr<'_>) -> u8 {
    match e.tag() {
        ExprTag::Object => OBJECT,
        ExprTag::Array => ARRAY,
        _ => 0,
    }
}

/// For a comment at `offset` that is in `func` and not in a parameter, a type or a statement of it.
fn parent_in_function(func: Func<'_>, offset: u32) -> Option<Parent> {
    let body = func.body_span();
    if func.kind() == FnKind::StaticBlock {
        return Parent::new(STATIC_BLOCK, body.filter(|it| offset >= it.start)?);
    }
    if let Some(body) = body.filter(|it| it.contains_offset(offset)) {
        return Parent::new(BLOCK_STATEMENT, body);
    }
    let types = match func.body() {
        FnBody::Block(_) => BLOCK_STATEMENT,
        FnBody::Expr(e) => type_of_expression(e),
        FnBody::None => 0,
    };
    Parent::new(types, Some(func.estree_span()).filter(|it| it.contains_offset(offset))?)
}

/// ESLint's `getParentNodeOfToken`.
fn parent_of_comment<'a>(file: &'a File<'a>, offset: u32) -> Option<Parent> {
    match get_node_by_range_index(file, offset) {
        Node::Func(func) => parent_in_function(func, offset),
        Node::Member(member) if member.kind() == MemberKind::StaticBlock => {
            parent_in_function(member.func()?, offset)
        }
        Node::Class(class) => {
            let spans = [class.body_span(), class.estree_span()];
            Parent::new(CLASS_BODY, spans.into_iter().find(|it| it.contains_offset(offset))?)
        }
        Node::Case(case) => Parent::new(SWITCH_CASE, case.span()),
        Node::Pat(pat) => match pat.tag() {
            PatTag::Object => Parent::new(OBJECT, estree_span(pat.into())),
            PatTag::Array => Parent::new(ARRAY, estree_span(pat.into())),
            _ => None,
        },
        Node::Expr(e) => match e.kind() {
            ExprKind::Object(_) | ExprKind::Array(_) => Parent::new(type_of_expression(e), e.span()),
            ExprKind::Cond { yes, .. } => Parent::new(type_of_expression(yes), e.span()),
            _ => None,
        },
        Node::Stmt(statement) => match statement.kind() {
            StmtKind::Block(_) => Parent::new(BLOCK_STATEMENT, statement.span()),
            StmtKind::Switch { expr, .. } => {
                let brace = file.tokens_after(expr).find(is_opening_brace_token)?;
                Parent::new(SWITCH_STATEMENT, Span::new(brace.start(), statement.span().end))
            }
            StmtKind::If { yes: body, .. }
            | StmtKind::While { body, .. }
            | StmtKind::DoWhile { body, .. }
            | StmtKind::For { body, .. }
            | StmtKind::ForIn { body, .. }
            | StmtKind::ForOf { body, .. }
            | StmtKind::With { body, .. }
            | StmtKind::Labeled { body, .. } => {
                Parent::new(type_of_statement(body), statement.span())
            }
            // The `CatchClause`
            StmtKind::Try { .. } => Parent::new(
                BLOCK_STATEMENT,
                statement.catch_clause_span().filter(|it| it.contains_offset(offset))?,
            ),
            _ => None,
        },
        _ => None,
    }
}

/// ESLint's `codeAroundComment`: there is code on the line where the comment starts or on the line
/// where it ends.
fn is_code_around<'a>(file: &'a File<'a>, comment: Token<'a>) -> bool {
    file.token_before(comment).is_some_and(|it| is_token_on_same_line(file, it, comment))
        || file.token_after(comment).is_some_and(|it| is_token_on_same_line(file, comment, it))
}

/// Whether the line before `comment`, which is `line`, is empty, or a comment starts or ends on it.
fn is_free_before<'a>(file: &'a File<'a>, comment: Token<'a>, line: u32) -> bool {
    if is_blank(file.line_text(line)) {
        return true;
    }
    for other in file.comments_in(Span::new(0, comment.start())).rev() {
        let end = file.line_of(other.end());
        if end < line {
            break;
        }
        if end == line || file.line_of(other.start()) == line {
            return true;
        }
    }
    false
}

/// The same for the line after `comment`.
fn is_free_after<'a>(file: &'a File<'a>, comment: Token<'a>, line: u32) -> bool {
    if is_blank(file.line_text(line)) {
        return true;
    }
    for other in file.comments_in(Span::new(comment.end(), file.span().end)) {
        let start = file.line_of(other.start());
        if start > line {
            break;
        }
        if start == line || file.line_of(other.end()) == line {
            return true;
        }
    }
    false
}

impl LinesAroundComment {
    /// ESLint's `checkForEmptyLine`.
    fn check_comment<'a>(&self, comment: Token<'a>, before: bool, after: bool, cx: &Cx<'a, Self>) {
        let file = cx.file();
        let value = comment.comment_value();
        if (self.applies_default_ignore_patterns && matches_comments_ignore_pattern(value))
            || self.ignore_pattern.as_ref().is_some_and(|it| it.test(value))
        {
            return;
        }
        let (first_line, last_line) = (file.line_of(comment.start()), file.line_of(comment.end()));
        // Not at the top and at the bottom of the file.
        let before = before && first_line > 1;
        let after = after && last_line < file.line_count();
        if (!before && !after) || is_code_around(file, comment) {
            return;
        }
        let is_comment_beside = |other: Option<Token<'a>>| {
            other.is_some_and(|it| {
                it.is_comment()
                    && match it.start() < comment.start() {
                        true => is_token_on_same_line(file, it, comment),
                        false => is_token_on_same_line(file, comment, it),
                    }
            })
        };
        let mut lacks_before = before
            && !is_free_before(file, comment, first_line - 1)
            && !is_comment_beside(file.tokens_before(comment).with_comments().next());
        let mut lacks_after = after
            && !is_free_after(file, comment, last_line + 1)
            && !is_comment_beside(file.tokens_after(comment).with_comments().next());
        if !lacks_before && !lacks_after {
            return;
        }
        if (!self.at_start.is_empty() || !self.at_end.is_empty())
            && let Some(parent) = parent_of_comment(file, comment.start())
        {
            lacks_before &= !(first_line == file.line_of(parent.start) + 1
                && self.at_start.allow(parent.types));
            lacks_after &=
                !(file.line_of(parent.end) == last_line + 1 && self.at_end.allow(parent.types));
        }
        if lacks_before {
            let line_start = file.line_span(first_line).start;
            cx.report(comment, BEFORE)
                .fix(|fixer| fixer.insert_before(Span::empty(line_start), "\n"));
        }
        if lacks_after {
            cx.report(comment, AFTER).fix(|fixer| fixer.insert_after(comment, "\n"));
        }
    }
}

impl Rule for LinesAroundComment {
    const META: Meta = Meta::eslint("lines-around-comment", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let pattern = options.str("ignorePattern").filter(|it| !it.is_empty());
        LinesAroundComment {
            before_block_comment: options.bool_or("beforeBlockComment", true),
            after_block_comment: options.bool_or("afterBlockComment", false),
            before_line_comment: options.bool_or("beforeLineComment", false),
            after_line_comment: options.bool_or("afterLineComment", false),
            after_hashbang_comment: options.bool_or("afterHashbangComment", false),
            at_start: Exceptions::new(options, "Start"),
            at_end: Exceptions::new(options, "End"),
            ignore_pattern: pattern.and_then(|it| Regex::new(it, "u").ok()),
            applies_default_ignore_patterns: options.bool_or("applyDefaultIgnorePatterns", true),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.finish(|rule, cx| {
            for comment in cx.file().comments() {
                let (before, after) = match comment.kind() {
                    TokenKind::Line => (rule.before_line_comment, rule.after_line_comment),
                    TokenKind::Block => (rule.before_block_comment, rule.after_block_comment),
                    TokenKind::Shebang => (false, rule.after_hashbang_comment),
                    _ => continue,
                };
                if before || after {
                    rule.check_comment(comment, before, after, cx);
                }
            }
        });
    }
}
