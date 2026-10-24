use super::resolver::{ExprState, Resolver};
use super::{EvaluatedText, EvaluatedTextForm};
use crate::builtins::table::{self, BuiltinFlags, BuiltinId};
use bun_sema::atom::Atom;
use bun_sema::fold::{Constant, FoldedValue};
use bun_sema::hir::{CallId, ExprId, ExprKind};
use smallvec::SmallVec;

fn evaluates_text(id: BuiltinId) -> bool {
    table::entry(id)
        .flags
        .contains(BuiltinFlags::EVALUATES_TEXT)
}

fn evaluated_text_form(id: BuiltinId) -> Option<EvaluatedTextForm> {
    debug_assert!(evaluates_text(BuiltinId::Function) && evaluates_text(BuiltinId::Eval));
    if id == BuiltinId::Function {
        Some(EvaluatedTextForm::FunctionBody)
    } else if id == BuiltinId::Eval {
        Some(EvaluatedTextForm::Script)
    } else {
        None
    }
}

impl Resolver<'_, '_> {
    fn constant_text(&self, argument: ExprId) -> Option<Atom> {
        let input = self.input;
        let constant = match input.decisions.constant(input.hir, argument) {
            FoldedValue::Constant(constant) | FoldedValue::ConstantOutsideDeadZone(constant) => {
                constant
            }
            FoldedValue::Unknown => return None,
        };
        match constant {
            Constant::String(text) => Some(text),
            _ => None,
        }
    }

    fn constant_texts(&self, form: EvaluatedTextForm, call: CallId) -> Option<SmallVec<[Atom; 2]>> {
        let hir = self.input.hir;
        let mut arguments = hir.ids(hir[call].args);
        match form {
            EvaluatedTextForm::FunctionBody => arguments
                .map(|argument| self.constant_text(argument))
                .collect(),
            EvaluatedTextForm::Script => {
                let text = self.constant_text(arguments.next()?)?;
                Some(SmallVec::from_slice(&[text]))
            }
        }
    }

    #[rustfmt::skip]
    fn find_evaluated_text(&self, expr: ExprId) -> Option<EvaluatedText> {
        let input = self.input;
        match self.state(expr) {
            ExprState::NotEvaluated => return None,
            ExprState::Unvisited
            | ExprState::InProgress | ExprState::Unresolved | ExprState::Builtin(_)
            | ExprState::Held(_) | ExprState::DynamicGlobal(_) | ExprState::Intrinsic(_) => {}
        }
        let (call, is_construct) = match input.hir[expr].kind {
            ExprKind::Call(call) => (call, false),
            ExprKind::New(call) => (call, true),
            _ => return None,
        };
        let callee = self.value_of(input.hir[call].callee)?;
        let form = evaluated_text_form(callee.path.id)?;
        let is_direct_eval = input.bound.eval_scope(expr).is_some();
        if is_direct_eval || (form == EvaluatedTextForm::Script && is_construct) {
            return None;
        }
        let texts = self.constant_texts(form, call)?;
        Some(EvaluatedText { call: expr, form, callee: callee.path, texts })
    }

    pub(super) fn collect_evaluated_texts(&mut self) {
        for expr in self.evaluated_exprs() {
            if let Some(text) = self.find_evaluated_text(expr) {
                self.output.evaluated_texts.push(text);
            }
        }
    }
}
