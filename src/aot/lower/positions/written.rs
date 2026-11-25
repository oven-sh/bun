use bun_sema::bind::Parent;
use bun_sema::hir::{
    BinOp, Call, CallId, ExprId, ExprKind, PatId, PatKind, StmtId, StmtKind, end_of_expr,
};

use crate::builtins::BuiltinId;
use crate::lower::FileLowering;

impl FileLowering<'_, '_, '_, '_> {
    /// The engine reads a string that the program evaluates as it is. `bun run` prints the rest of the file anew.
    #[inline]
    pub(in crate::lower) fn is_in_known_evaluation(&self, expression: ExprId) -> bool {
        self.hir.is_in_known_evaluation(self.hir[expression].pos)
    }

    /// The end of the head of a loop in front of `in` or `of`.
    fn end_in_known_evaluation(&self, left: StmtId) -> Option<u32> {
        let hir = self.hir;
        let end = match hir[left].kind {
            StmtKind::Var(declarations) => hir[hir[declarations.iter().next()?].pat].end,
            StmtKind::Expr(target) => end_of_expr(hir, target),
            _ => return None,
        };
        hir.is_in_known_evaluation(end).then_some(end)
    }

    /// Where a read of a variable that fails is reported, and whatever else has no place of its own.
    #[inline]
    pub(in crate::lower) fn reported_position(&self, expression: ExprId) -> u32 {
        let written = self.hir[expression];
        match written.kind {
            ExprKind::Ident(_) if self.is_in_known_evaluation(expression) => written.end,
            _ => written.pos,
        }
    }

    pub(in crate::lower) fn last_token_position_of(&self, expression: ExprId) -> u32 {
        let hir = self.hir;
        if self.is_in_known_evaluation(expression) {
            return end_of_expr(hir, expression);
        }
        let mut last = self.skip_type_syntax(expression);
        loop {
            let next = match hir[last].kind {
                ExprKind::Dot { .. } => return hir.name_pos(last),
                ExprKind::Index { index, .. } => index,
                ExprKind::New(site)
                    if self.is_printed_without_parentheses(last, site)
                        && !self.is_printed_as_call(hir[site]) =>
                {
                    hir[site].callee
                }
                ExprKind::Call(site) | ExprKind::New(site) => match hir[site].close_pos {
                    u32::MAX => hir[site].callee,
                    close => return close,
                },
                ExprKind::Binary { right, .. } => right,
                ExprKind::Cond { branches, .. } => hir.branches(branches).no,
                ExprKind::Assign { value, .. } => value,
                ExprKind::Await(operand) | ExprKind::Unary { operand, .. } => operand,
                _ => return hir[last].pos,
            };
            last = self.skip_type_syntax(next);
        }
    }

    pub(in crate::lower) fn call_position(&self, site: Call) -> u32 {
        self.last_token_position_of(site.callee)
    }

    pub(in crate::lower) fn construct_position(&self, expression: ExprId) -> u32 {
        let hir = self.hir;
        let ExprKind::New(site) = hir[expression].kind else {
            return hir[expression].pos;
        };
        if self.is_in_known_evaluation(expression) {
            return match hir[site].close_pos {
                u32::MAX => hir[expression].pos,
                _ => self.call_position(hir[site]),
            };
        }
        let reports_as_call = self.is_printed_as_call(hir[site])
            || (hir[site].close_pos != u32::MAX
                && !self.is_printed_without_parentheses(expression, site));
        match reports_as_call {
            true => self.call_position(hir[site]),
            false => hir[expression].pos,
        }
    }

    /// Where an error that is printed places the construction: `bun run` moves it back to `new`, where its printed source has a `new`.
    pub(in crate::lower) fn construction_start(&self, expression: ExprId) -> Option<u32> {
        let hir = self.hir;
        match hir[expression].kind {
            ExprKind::New(site) if self.is_printed_as_call(hir[site]) => None,
            _ => Some(hir[expression].pos),
        }
    }

    /// `bun run` prints `new Error(x)` as `Error(x)`.
    fn is_printed_as_call(&self, site: Call) -> bool {
        let callee = self.skip_type_syntax(site.callee);
        matches!(self.hir[callee].kind, ExprKind::Ident(_))
            && !self.is_in_known_evaluation(callee)
            && self
                .builtins
                .global_path(self.hir, self.bound, callee)
                .is_some_and(|steps| {
                    matches!(
                        steps[0].id,
                        BuiltinId::Error
                            | BuiltinId::TypeError
                            | BuiltinId::SyntaxError
                            | BuiltinId::RangeError
                            | BuiltinId::ReferenceError
                            | BuiltinId::EvalError
                            | BuiltinId::URIError
                            | BuiltinId::AggregateError
                            | BuiltinId::Object
                            | BuiltinId::Array
                            | BuiltinId::Function
                    )
                })
    }

    /// `bun run` prints `new A()` as `new A` where nothing reads or calls the result in place.
    fn is_printed_without_parentheses(&self, expression: ExprId, site: CallId) -> bool {
        let hir = self.hir;
        if hir.ids(hir[site].args).next().is_some() || self.is_in_known_evaluation(expression) {
            return false;
        }
        let mut operand = expression;
        while let Parent::Expr(around) = self.bound.parent_of_expr(operand) {
            match hir[around].kind {
                _ if hir.type_assertion_operand(around) == Some(operand) => operand = around,
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => return obj != operand,
                ExprKind::Call(site) | ExprKind::New(site) | ExprKind::TaggedTemplate(site) => {
                    return hir[site].callee != operand;
                }
                _ => break,
            }
        }
        true
    }

    /// Where a pattern reports that the value of `expression` is null or undefined: `bun run` reports at the last place that the expression can fail at.
    pub(in crate::lower) fn destructured_position(&self, expression: ExprId) -> Option<u32> {
        let hir = self.hir;
        let mut last = self.skip_type_syntax(expression);
        loop {
            let next = match hir[last].kind {
                ExprKind::Ident(_) | ExprKind::ImportCall { .. } => return Some(hir[last].pos),
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => {
                    return Some(self.last_token_position_of(obj));
                }
                ExprKind::Call(site) => return Some(self.call_position(hir[site])),
                ExprKind::New(_) => return Some(self.construct_position(last)),
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma,
                    right,
                    ..
                } => right,
                ExprKind::Cond { branches, .. } => hir.branches(branches).no,
                ExprKind::Assign { value, .. } => value,
                ExprKind::Await(operand) => operand,
                _ => return None,
            };
            last = self.skip_type_syntax(next);
        }
    }

    /// The position of the async frame that awaits `operand`: `bun run` reports the last place that the operand can fail at.
    pub(in crate::lower) fn awaited_position(&self, operand: ExprId) -> Option<u32> {
        let hir = self.hir;
        let mut last = self.skip_type_syntax(operand);
        loop {
            let next = match hir[last].kind {
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => {
                    return Some(self.last_token_position_of(obj));
                }
                ExprKind::Call(site) => return Some(self.call_position(hir[site])),
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma,
                    right,
                    ..
                } => right,
                ExprKind::Cond { branches, .. } => hir.branches(branches).no,
                ExprKind::Await(operand) => operand,
                _ => return None,
            };
            last = self.skip_type_syntax(next);
        }
    }

    /// Whether the member or the call around `expression` reports at its last token too. One position quotes one expression.
    pub(in crate::lower) fn shares_last_token(&self, expression: ExprId) -> bool {
        let hir = self.hir;
        let mut last = expression;
        while let Parent::Expr(around) = self.bound.parent_of_expr(last) {
            match hir[around].kind {
                _ if hir.type_assertion_operand(around) == Some(last) => {}
                ExprKind::Dot { .. } => return true,
                ExprKind::Index { obj, .. } if obj == last => return true,
                ExprKind::Call(site) | ExprKind::New(site) | ExprKind::TaggedTemplate(site) => {
                    return hir[site].callee == last;
                }
                ExprKind::Binary { right, .. } if right == last => {}
                ExprKind::Cond { branches, .. } if hir.branches(branches).no == last => {}
                ExprKind::Assign { value, .. } if value == last => {}
                ExprKind::Index { .. } | ExprKind::Await(_) | ExprKind::Unary { .. } => {}
                _ => return false,
            }
            last = around;
        }
        false
    }

    /// The last name that a pattern binds, where nothing stands behind it.
    fn last_name_of_pattern(&self, pattern: PatId) -> Option<PatId> {
        let hir = self.hir;
        let mut last = pattern;
        loop {
            let (inner, default) = match hir[last].kind {
                PatKind::Ident(_) => return Some(last),
                PatKind::Object(list) => {
                    let property = hir[list.iter().next_back()?];
                    (property.value, property.default)
                }
                PatKind::Array(list) => {
                    let element = hir[list.iter().next_back()?];
                    (element.pat, element.default)
                }
                PatKind::Missing => return None,
            };
            if default.is_some() {
                return None;
            }
            last = inner;
        }
    }

    /// Where a `for`-`of` loop reports what its subject refuses: at the last name in what the head declares or assigns to.
    pub(in crate::lower) fn loop_head_position(&self, statement: StmtId, left: StmtId) -> u32 {
        let hir = self.hir;
        if let Some(end) = self.end_in_known_evaluation(left) {
            let rest = &hir.text[end as usize..];
            let blanks = rest.iter().take_while(|byte| byte.is_ascii_whitespace());
            return end + blanks.count() as u32;
        }
        match hir[left].kind {
            StmtKind::Var(declarations) => match declarations.iter().next() {
                Some(declaration) => match self.last_name_of_pattern(hir[declaration].pat) {
                    Some(name) => hir[name].pos,
                    None => hir[statement].start,
                },
                None => hir[statement].start,
            },
            StmtKind::Expr(target) => match hir[self.skip_type_syntax(target)].kind {
                ExprKind::Ident(_) | ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                    self.last_token_position_of(target)
                }
                _ => hir[statement].start,
            },
            _ => hir[statement].start,
        }
    }

    pub(in crate::lower) fn load_position(&self, call: ExprId) -> u32 {
        let hir = self.hir;
        let ExprKind::Call(site) = hir[call].kind else {
            return hir[call].pos;
        };
        self.call_position(hir[site])
    }
}

#[cfg(test)]
mod tests {
    use bun_core::strings::index_of;

    use crate::compile::testing::lower_program;
    use crate::ir::Opcode;
    use crate::load::host_platform;
    use crate::lower::LoweringOptions;

    fn reported_positions(source: &str, opcode: Opcode) -> Vec<u32> {
        let options = LoweringOptions {
            platform: host_platform(),
            embeds_function_source: false,
            reparses_function_sources: false,
            removable: Default::default(),
            minifies_identifiers: false,
            obfuscates: false,
            counts_executions: false,
            runs_tests: false,
            divides_small_files: false,
        };
        let lowered = lower_program(&[("main.ts", source)], options);
        let fragments = lowered.iter().map(|(_, lowered)| &lowered.fragment);
        let functions = fragments.flat_map(|fragment| &fragment.functions);
        let blocks = functions.flat_map(|(_, function)| function.body.blocks());
        let values = blocks.flat_map(|block| block.values());
        let reporting = values.filter(|value| value.opcode == opcode);
        reporting.filter_map(|value| value.position).collect()
    }

    #[track_caller]
    fn offset_of(source: &str, text: &str) -> u32 {
        let offset = index_of(source.as_bytes(), text.as_bytes());
        offset.expect("the source has the text") as u32
    }

    #[test]
    fn call_reports_at_the_last_name_of_its_callee() {
        let source = "export function probe(a: any, x: any) {
  a.first.second(
    x,
  );
}
";
        let expected = [offset_of(source, "second")];
        assert_eq!(reported_positions(source, Opcode::Call), expected);
    }

    #[test]
    fn call_of_a_computed_member_reports_at_the_innermost_key() {
        let source = "export function probe(a: any, b: any, c: any, key: any) {
  a[b[c[key!]]]();
  a[\"name\"]();
}
";
        let expected = ["key!", "\"name\""].map(|text| offset_of(source, text));
        assert_eq!(reported_positions(source, Opcode::Call), expected);
    }

    #[test]
    fn call_of_a_result_reports_at_the_closing_parenthesis() {
        let source = "export function probe(f: any, x: any) {
  f(x)(
    x,
  );
}
";
        let expected = ["f(x)", ")("].map(|text| offset_of(source, text));
        assert_eq!(reported_positions(source, Opcode::Call), expected);
    }

    #[test]
    fn type_syntax_around_a_callee_is_skipped() {
        let source = "export function probe(a: any) {
  (a.member as any)!();
}
";
        let expected = [offset_of(source, "member")];
        assert_eq!(reported_positions(source, Opcode::Call), expected);
    }

    #[test]
    fn construction_reports_as_a_call_only_where_it_has_parentheses() {
        let source = "export function probe(a: any, x: any) {
  new a.Plain;
  new a.Called(
    x,
  );
  new (new a.Inner)(x);
}
";
        let texts = ["new a.Plain", "Called", "new a.Inner", "Inner"];
        let expected = texts.map(|text| offset_of(source, text));
        assert_eq!(reported_positions(source, Opcode::Construct), expected);
    }

    #[test]
    fn bare_construction_reports_printed_form() {
        let source = "export function probe(a: any) {
  new a.First();
  new a.Second().run;
  new a.Third()[0];
  new a.Fourth()();
  new (new a.Fifth())(a);
  (new a.Sixth() as any).run;
  a(new a.Seventh()).run;
}
";
        let texts = [
            "new a.First",
            "Second",
            "Third",
            "Fourth",
            "Fifth",
            "))(a)",
            "Sixth",
            "new a.Seventh",
        ];
        let expected = texts.map(|text| offset_of(source, text));
        assert_eq!(reported_positions(source, Opcode::Construct), expected);
    }

    #[test]
    fn object_pattern_reports_initializer_position() {
        let source = "export function probe(a: any, x: any) {
  const { first } = a.call(x);
  const { second } = a.member.last;
  const { third: { inner } } = x;
  const { fourth } = a || x.other;
  const { fifth: { deep } = x[0] } = new a.Made(x);
}
";
        let texts = [
            "call(x)",
            "member.last",
            "x;",
            "x;",
            "x.other",
            "Made",
            "x[0]",
        ];
        let expected = texts.map(|text| offset_of(source, text));
        assert_eq!(
            reported_positions(source, Opcode::NewRuntimeError),
            expected
        );
    }

    #[test]
    fn call_of_a_tagged_template_reports_where_the_template_begins() {
        let source = "export function probe(a: any) {
  a.tag`text`();
}
";
        let expected = ["tag`", "a.tag"].map(|text| offset_of(source, text));
        assert_eq!(reported_positions(source, Opcode::Call), expected);
    }
}
