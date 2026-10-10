use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::tokens::next_token;
use bun_lint::utils::fix_tracker::FixTracker;

/// Require or disallow semicolons instead of ASI.
pub struct Semi {
    is_never: bool,
    except_one_line: bool,
    except_one_line_class_body: bool,
    before_statement_continuation_chars: Continuation,
}

/// `beforeStatementContinuationChars`
#[derive(PartialEq)]
enum Continuation {
    Always,
    Any,
    Never,
}

const MISSING_SEMI: Message = Message::new("missingSemi", "Missing semicolon.");
const EXTRA_SEMI: Message = Message::new("extraSemi", "Extra semicolon.");

/// Whether the token at `next` can continue the statement before it: it starts with one of
/// ``[(/+-` ``, and is not `++` or `--`.
fn maybe_asi_hazard_before(text: &[u8], next: u32) -> bool {
    let rest = text.get(next as usize..).unwrap_or_default();
    matches!(rest.first(), Some(b'-' | b'[' | b'(' | b'/' | b'+' | b'`'))
        && !rest.starts_with(b"++")
        && !rest.starts_with(b"--")
}

/// Whether the `}` at `brace`, which is in `node`, ends the body of an arrow function.
fn is_end_of_arrow_block(node: Node<'_>, brace: u32) -> bool {
    let mut innermost = node;
    loop {
        let mut inner = None;
        innermost.for_each_child(|child| {
            if inner.is_none() && child.span().contains_offset(brace) {
                inner = Some(child);
            }
        });
        match inner {
            Some(child) => innermost = child,
            None => break,
        }
    }
    matches!(innermost, Node::Func(func)
        if func.is_arrow() && func.body_span().is_some_and(|body| body.end == brace + 1))
}

/// Whether `node` can continue on the next line. `previous` is its last token but the `;`.
fn maybe_asi_hazard_after<'a>(node: Node<'a>, previous: Token<'a>) -> bool {
    let Node::Stmt(statement) = node else {
        return true;
    };
    match statement.kind() {
        StmtKind::DoWhile { .. }
        | StmtKind::Break(_)
        | StmtKind::Continue(_)
        | StmtKind::Debugger
        | StmtKind::Import(_)
        | StmtKind::ExportStar { .. }
        | StmtKind::ExportNamed(_) => false,
        StmtKind::Return(argument) => argument.is_some(),
        _ => !(previous.is_punctuator("}") && is_end_of_arrow_block(node, previous.start())),
    }
}

/// Whether the `;` after `field` keeps it from being read as something else: as the modifier
/// `get`, `set` or `static` of the next member, or as an operand of what follows.
fn maybe_class_field_asi_hazard(field: Member<'_>) -> bool {
    if let Some(KeyKind::Ident(name)) = field.key().map(Key::kind)
        && name.is_any(&["get", "set", "static"])
        && !(field.is_static() && name.is("static"))
        && field.init().is_none()
    {
        return true;
    }
    let file = field.file();
    let following = file.slice(next_token(file.text(), field.span().end));
    matches!(following, b"*" | b"in" | b"instanceof")
}

/// Whether `node` is followed by the `}` of its parent, which `braces_of` finds, and that is on
/// the same line as the `{`.
fn is_last_in_one_liner<'a>(node: Node<'a>, braces_of: fn(Node<'a>) -> Option<Span>) -> bool {
    let file = node.file();
    let next = skip_trivia(file.text(), node.span().end);
    file.text().get(next as usize) == Some(&b'}')
        && braces_of(node.parent()).is_some_and(|braces| !strings::contains_js_line_break(file.slice(braces)))
}

/// The braces of a `BlockStatement` or a `StaticBlock`.
fn braces_of_block(parent: Node<'_>) -> Option<Span> {
    match parent {
        Node::Stmt(block) if matches!(block.kind(), StmtKind::Block(_)) => Some(block.span()),
        Node::Func(func) => func.body_span(),
        _ => None,
    }
}

fn braces_of_class_body(parent: Node<'_>) -> Option<Span> {
    match parent {
        Node::Class(class) => Some(class.body_span()),
        _ => None,
    }
}

impl Semi {
    fn report_missing(&self, at: u32, cx: &Cx<'_, Self>) {
        let report = match ast_utils::get_next_location(cx.file(), cx.position(at)) {
            Some(next) => cx.report(Span::new(at, cx.offset(next)), MISSING_SEMI),
            None => cx.report_at(at, MISSING_SEMI),
        };
        report.fix(|fixer| fixer.insert_after(Span::empty(at), ";"));
    }

    fn report_extra(&self, semi: Span, cx: &Cx<'_, Self>) {
        // The range of the fix includes the tokens around, so that `no-extra-semi` does not remove
        // the next `;` in the same pass.
        cx.report(semi, EXTRA_SEMI)
            .fix(|fixer| FixTracker::new(fixer).retain_surrounding_tokens(semi).remove(semi));
    }

    /// Whether `node` means the same without `semi`, its last token.
    fn can_remove_semicolon<'a>(&self, node: Node<'a>, semi: Span, cx: &Cx<'a, Self>) -> bool {
        let (file, text) = (cx.file(), cx.text());
        let next = skip_trivia(text, semi.end);
        if matches!(text.get(next as usize), None | Some(b'}' | b';')) {
            return true;
        }
        let field = match node {
            Node::Member(field) => Some(field),
            _ => None,
        };
        if field.is_some_and(maybe_class_field_asi_hazard) {
            return false;
        }
        let Some(previous) = file.token_before(semi) else {
            return false;
        };
        if ast_utils::is_token_on_same_line(file, previous, Span::empty(next)) {
            return false;
        }
        field.is_none()
            && self.before_statement_continuation_chars == Continuation::Never
            && !maybe_asi_hazard_after(node, previous)
            || !maybe_asi_hazard_before(text, next)
    }

    fn check_for_semicolon<'a>(&self, node: Node<'a>, cx: &Cx<'a, Self>) {
        let end = node.span().end;
        let semi = Span::new(end.saturating_sub(1), end);
        let is_semi = cx.slice(semi) == b";";
        if self.is_never {
            if is_semi {
                if self.can_remove_semicolon(node, semi, cx) {
                    self.report_extra(semi, cx);
                }
            } else if self.before_statement_continuation_chars == Continuation::Always
                && !matches!(node, Node::Member(_))
                && maybe_asi_hazard_before(cx.text(), skip_trivia(cx.text(), end))
            {
                self.report_missing(end, cx);
            }
            return;
        }
        let is_one_liner = self.except_one_line && is_last_in_one_liner(node, braces_of_block)
            || self.except_one_line_class_body && is_last_in_one_liner(node, braces_of_class_body);
        if is_semi && is_one_liner {
            self.report_extra(semi, cx);
        } else if !is_semi && !is_one_liner {
            self.report_missing(end, cx);
        }
    }
}

impl Rule for Semi {
    const META: Meta = Meta::eslint("semi", Kind::Layout).fixable(Fixable::Code).deprecated();
    const ON: On = On::new()
        .stmts(&[
            StmtTag::Var,
            StmtTag::Expr,
            StmtTag::Return,
            StmtTag::Throw,
            StmtTag::DoWhile,
            StmtTag::Debugger,
            StmtTag::Break,
            StmtTag::Continue,
            StmtTag::Import,
            StmtTag::ExportStar,
            StmtTag::ExportNamed,
            StmtTag::ExportDefault,
            StmtTag::Interface,
            StmtTag::Fn,
        ])
        .members();
    no_state!();

    fn new(options: &Options) -> Self {
        let object = options.object(1);
        Semi {
            is_never: options.str(0) == Some("never"),
            except_one_line: object.bool_or("omitLastInOneLineBlock", false),
            except_one_line_class_body: object.bool_or("omitLastInOneLineClassBody", false),
            before_statement_continuation_chars: match object.str("beforeStatementContinuationChars") {
                Some("always") => Continuation::Always,
                Some("never") => Continuation::Never,
                _ => Continuation::Any,
            },
        }
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let is_checked = match statement.kind() {
            StmtKind::Var(_) => !utils::is_for_init(statement),
            StmtKind::Expr(_) => !statement.is_wrapper(),
            // After `export default`, all but a `ClassDeclaration` and a `FunctionDeclaration`.
            StmtKind::Interface(_) => statement.is_default_export(),
            StmtKind::Fn(func) => !func.has_body() && statement.is_default_export(),
            _ => true,
        };
        if is_checked {
            self.check_for_semicolon(statement.into(), cx);
        }
    }

    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        if member.kind() == MemberKind::Property
            && !member.flags().intersects(Flags::ABSTRACT | Flags::ACCESSOR)
            && !member.is_signature()
        {
            self.check_for_semicolon(member.into(), cx);
        }
    }
}
