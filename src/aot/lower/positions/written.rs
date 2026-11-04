use bun_sema::hir::{Call, ExprId, ExprKind};

use crate::lower::FileLowering;

impl FileLowering<'_, '_, '_, '_> {
    /// The start of the last token of `expression`, from the tree alone. For `a[i]` that is the last token of `i`.
    pub(in crate::lower) fn last_token_position_of(&self, expression: ExprId) -> u32 {
        let hir = self.hir;
        let mut last = self.skip_type_syntax(expression);
        loop {
            let next = match hir[last].kind {
                // A build parses `a["b"]` into such a node too, and the position of its name is where the literal starts.
                ExprKind::Dot { .. } => return hir.name_pos(last),
                ExprKind::Index { index, .. } => index,
                ExprKind::Call(site) | ExprKind::New(site) => match hir[site].close_pos {
                    // `new F`
                    u32::MAX => hir[site].callee,
                    close => return close,
                },
                ExprKind::Binary { right, .. } => right,
                ExprKind::Cond { branches, .. } => hir.branches(branches).no,
                ExprKind::Assign { value, .. } => value,
                ExprKind::Await(operand) | ExprKind::Unary { operand, .. } => operand,
                // A tagged template is among them: its `close_pos` is no position.
                _ => return hir[last].pos,
            };
            last = self.skip_type_syntax(next);
        }
    }

    /// A call reports at the end of its callee.
    pub(in crate::lower) fn call_position(&self, site: Call) -> u32 {
        self.last_token_position_of(site.callee)
    }

    /// `new F(..)` reports as a call does, `new F` at the `new`.
    pub(in crate::lower) fn construct_position(&self, expression: ExprId) -> u32 {
        let hir = self.hir;
        let ExprKind::New(site) = hir[expression].kind else {
            return hir[expression].pos;
        };
        match hir[site].close_pos {
            u32::MAX => hir[expression].pos,
            _ => self.call_position(hir[site]),
        }
    }

    /// A call that loads a module reports where any call of its callee does.
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

    // Where the operations with `opcode` report, in the order of the code.
    fn reported_positions(source: &str, opcode: Opcode) -> Vec<u32> {
        let options = LoweringOptions {
            platform: host_platform(),
            embeds_function_text: false,
            removable: Default::default(),
            minifies_identifiers: false,
            obfuscates: false,
            counts_executions: false,
            runs_tests: false,
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
  new (new a.Inner)();
}
";
        let texts = ["new a.Plain", "Called", "new a.Inner", "Inner"];
        let expected = texts.map(|text| offset_of(source, text));
        assert_eq!(reported_positions(source, Opcode::Construct), expected);
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
