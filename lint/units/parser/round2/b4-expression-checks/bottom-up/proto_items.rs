/// The offset of the first token of `expr` as it is written: the parentheses and the type assertions around it, and around what it starts with, count.
fn first_token(wrappers: &Wrappers, expr: &Expr) -> u32 {
    let mut first = u32::MAX;
    let mut current = *expr;
    // A chain of accesses, calls and operators is as deep as it is long: a loop, no recursion.
    loop {
        first = first.min(u32::try_from(current.loc.start).unwrap_or(u32::MAX));
        for record in &wrappers.records {
            if is_prefix_wrapper(&record.data) && record.wraps(&current) {
                first = first.min(record.op);
            }
        }
        current = match &current.data {
            ExprData::EDot(dot) => dot.target,
            ExprData::EIndex(index) => index.target,
            ExprData::ECall(call) => call.target,
            ExprData::EBinary(binary) => binary.left,
            ExprData::EIf(conditional) => conditional.test,
            ExprData::ETemplate(template) => match template.tag {
                Some(tag) => tag,
                None => break,
            },
            ExprData::EUnary(unary)
                if matches!(unary.op, OpCode::UnPostDec | OpCode::UnPostInc) =>
            {
                unary.value
            }
            _ => break,
        };
    }
    first
}

/// `(x)` and `<T>x`: the wrappers whose first token is before their operand.
fn is_prefix_wrapper(data: &WrapperData) -> bool {
    matches!(
        data,
        WrapperData::Parenthesized | WrapperData::TypeAssertion(_)
    )
}

/// What the walk of `P::lint_check_expressions` found.
enum Finding {
    /// `a?.#b`, `a?.b.#c`: the range of the private name.
    PrivateNameInOptionalChain(Range),
    /// `new a?.b()`: the member expression before the first "?." of the target, and where that "?." is.
    OptionalChainFromNew { receiver: Expr, question_dot: u32 },
}

impl Finding {
    fn start(&self) -> u32 {
        match self {
            Finding::PrivateNameInOptionalChain(range) => {
                u32::try_from(range.loc.start).unwrap_or(0)
            }
            Finding::OptionalChainFromNew { question_dot, .. } => *question_dot,
        }
    }
}

/// The walk of `P::lint_check_expressions`.
struct ExpressionChecks<'p, 'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> {
    p: &'p P<'a, TYPESCRIPT, SCAN_ONLY>,
    found: Vec<Finding>,
}

impl<'p, 'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool>
    ExpressionChecks<'p, 'a, TYPESCRIPT, SCAN_ONLY>
{
    /// parseNewExpressionOrNewDotTarget: `new` reads a member expression without "?.". The parse pass takes the chain into `target`.
    fn new_target(&mut self, target: &Expr) {
        let Some(starts) = &self.p.starts_for_parse_only else {
            return;
        };
        let wrappers = &starts.wrappers;
        let lexer = &self.p.lexer;
        let mut first: Option<Expr> = None;
        let mut current = *target;
        loop {
            // What parentheses or a type assertion hold is a primary expression for `new`.
            let is_wrapped = wrappers
                .records
                .iter()
                .any(|record| is_prefix_wrapper(&record.data) && record.wraps(&current));
            if is_wrapped {
                break;
            }
            current = match &current.data {
                ExprData::EDot(dot) => {
                    if dot.optional_chain == Some(OptionalChain::Start) {
                        first = Some(current);
                    }
                    dot.target
                }
                ExprData::EIndex(index) => {
                    if index.optional_chain == Some(OptionalChain::Start) {
                        first = Some(current);
                    }
                    index.target
                }
                ExprData::ETemplate(template) => match template.tag {
                    Some(tag) => tag,
                    None => break,
                },
                _ => break,
            };
        }
        let Some(access) = first else {
            return;
        };
        let full_start =
            |offset: u32| ts::full_start(lexer.contents, &lexer.all_comments, offset);
        let offset = |loc: Loc| u32::try_from(loc.start).unwrap_or(0);
        // The token after the "?.": the name, or the "[".
        let (receiver, after) = match &access.data {
            ExprData::EDot(dot) => (dot.target, offset(dot.name_loc)),
            ExprData::EIndex(index) => match index.index.data {
                ExprData::EPrivateIdentifier(_) => (index.target, offset(index.index.loc)),
                _ => {
                    let bracket_end = full_start(first_token(wrappers, &index.index));
                    (index.target, bracket_end.saturating_sub(1))
                }
            },
            _ => return,
        };
        let Some(question_dot) = full_start(after).checked_sub(2) else {
            return;
        };
        let is_question_dot =
            lexer.contents.get(question_dot as usize..question_dot as usize + 2) == Some(b"?.");
        if is_question_dot {
            self.found.push(Finding::OptionalChainFromNew {
                receiver,
                question_dot,
            });
        }
    }
}

impl<'ast, 'p, 'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> Visitor<'ast>
    for ExpressionChecks<'p, 'a, TYPESCRIPT, SCAN_ONLY>
{
    fn visit_stmt(&mut self, stmt: &'ast Stmt) {
        if self.p.stack_check.is_safe_to_recurse() {
            walk::walk_stmt(self, stmt);
        }
    }

    fn visit_expr(&mut self, expr: &'ast Expr) {
        if self.p.stack_check.is_safe_to_recurse() {
            walk::walk_expr(self, expr);
        }
    }

    fn visit_e_new(&mut self, node: &'ast E::New, _loc: Loc) {
        self.new_target(&node.target);
        walk::walk_e_new(self, node);
    }

    fn visit_e_index(&mut self, node: &'ast E::Index, _loc: Loc) {
        // parsePropertyAccessExpressionRest
        if node.optional_chain.is_some()
            && matches!(node.index.data, ExprData::EPrivateIdentifier(_))
        {
            let range = js_lexer::range_of_identifier(self.p.source, node.index.loc);
            self.found.push(Finding::PrivateNameInOptionalChain(range));
        }
        walk::walk_e_index(self, node);
    }
}
