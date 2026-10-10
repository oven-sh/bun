use bun_lint::prelude::*;

/// Require spacing around infix operators.
pub struct SpaceInfixOps {
    int32_hint: bool,
}

const MISSING_SPACE: Message = Message::new("missingSpace", "Operator '{{operator}}' must be spaced.");

/// ESLint's `isSpaceBetween` for the end of a token and the start of the next.
fn is_space_between<'a>(file: &'a File<'a>, end: u32, start: u32) -> bool {
    match file.text().get(end as usize..start as usize) {
        None | Some([]) => false,
        Some([b'/', ..]) => file.is_space_between(Span::empty(end), Span::empty(start)),
        Some(_) => true,
    }
}

impl SpaceInfixOps {
    /// Checks `operator`, which is the token after the one that ends at `left_end`. `node_end`: where
    /// the node ends, if it is one that `int32Hint` applies to.
    fn check<'a>(&self, cx: &Cx<'a, Self>, left_end: u32, operator: &str, node_end: Option<u32>) {
        let (file, text) = (cx.file(), cx.text());
        let start = skip_trivia(text, left_end);
        let token = Span::new(start, start + operator.len() as u32);
        if file.slice(token) != operator.as_bytes() {
            return;
        }
        let next = skip_trivia(text, token.end);
        if is_space_between(file, left_end, token.start) && is_space_between(file, token.end, next) {
            return;
        }
        if self.int32_hint
            && node_end.and_then(|end| text.get(..end as usize)).is_some_and(|it| it.ends_with(b"|0"))
        {
            return;
        }
        cx.report(token, MISSING_SPACE).data("operator", file.slice(token)).fix(|fixer| {
            let mut spaced = Vec::with_capacity(token.len() as usize + 2);
            if left_end == token.start {
                spaced.push(b' ');
            }
            spaced.extend_from_slice(file.slice(token));
            if next == token.end {
                spaced.push(b' ');
            }
            fixer.replace(token, spaced)
        });
    }

    /// An `AssignmentPattern` in a declaration or a parameter: the `=` after `left_end`.
    fn check_default<'a>(&self, cx: &Cx<'a, Self>, left_end: u32, default: Option<Expr<'a>>) {
        if let Some(default) = default {
            self.check(cx, left_end, "=", Some(default.outer_span().end));
        }
    }
}

impl Rule for SpaceInfixOps {
    const META: Meta = Meta::eslint("space-infix-ops", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    const ON: On = On::new()
        .exprs(&[ExprTag::Binary, ExprTag::Assign, ExprTag::Cond])
        .pats(&[PatTag::Object, PatTag::Array])
        .params()
        .var_decls()
        .members();
    no_state!();

    fn new(options: &Options) -> Self {
        SpaceInfixOps {
            int32_hint: options.object(0).bool_or("int32Hint", false),
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.kind() {
            ExprKind::Binary { op: BinOp::Comma, .. } => {}
            ExprKind::Binary { op, left, .. } => {
                self.check(cx, left.outer_span().end, bin_op_text(op), Some(e.span().end));
            }
            ExprKind::Assign { op, target, .. } => {
                self.check(cx, target.outer_span().end, assign_op_text(op), Some(e.span().end));
            }
            ExprKind::Cond { test, yes, .. } => {
                self.check(cx, test.outer_span().end, "?", None);
                self.check(cx, yes.outer_span().end, ":", None);
            }
            _ => {}
        }
    }

    fn pat<'a>(&self, pat: Pat<'a>, cx: &mut Cx<'a, Self>) {
        match pat.kind() {
            PatKind::Object(props) => {
                for prop in props {
                    self.check_default(cx, prop.value().span().end, prop.default());
                }
            }
            PatKind::Array(elements) => {
                for element in elements {
                    if let Some(pat) = element.pat() {
                        self.check_default(cx, pat.span().end, element.default());
                    }
                }
            }
            _ => {}
        }
    }

    /// A `PropertyDefinition`.
    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        if member.init().is_none()
            || member.kind() != MemberKind::Property
            || member.flags().intersects(Flags::ACCESSOR | Flags::ABSTRACT)
            || member.is_signature()
        {
            return;
        }
        let Some(key) = member.key() else {
            return;
        };
        let left_end = match member.ty() {
            Some(ty) => ty.outer_span().end,
            None if member.flags().intersects(Flags::OPTIONAL | Flags::DEFINITE) => {
                skip_trivia(cx.text(), key.span(cx.file()).end) + 1
            }
            None => key.span(cx.file()).end,
        };
        self.check(cx, left_end, "=", None);
    }

    fn param<'a>(&self, param: Param<'a>, cx: &mut Cx<'a, Self>) {
        if param.default().is_some() {
            self.check_default(cx, param.binding_span().end, param.default());
        }
    }

    fn var_decl<'a>(&self, declaration: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        if declaration.init().is_some() {
            self.check(cx, declaration.binding_span().end, "=", None);
        }
    }
}
