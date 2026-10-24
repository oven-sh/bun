use bun_sema::atom::Atom;
use bun_sema::check::Checker;
use bun_sema::check::aot::{Queries, QueryInputs};
use bun_sema::hir::{self, ExprId, ExprKind, NodeData};
use bun_sema::program::FileId;
use rustc_hash::FxHashMap;

use super::expected_result::{FindsValidatedResults, ValidatingFunction};
use super::{ValidatedFile, ValidationError, ValidationState};
use crate::builtins::ResolvedBuiltins;
use crate::builtins::id::BuiltinId;
use crate::diagnostic_codes::Code;
use crate::diagnostics::{DiagnosticBuffer, Span};
use crate::ir::generated::{ExpectedResult, LimitId, ValidationNode};
use crate::ir::{
    ExpectedResultId, Id, LayoutId, Program, PropertyKey, PropertyKeyId, StringId, TypeId,
    TypeTable,
};
use crate::lower::CheckerTypeId;
use crate::statistics::LimitValues;
use crate::validation_plans::skip_blanks_and_comments;

#[derive(Copy, Clone)]
pub struct PlanInputs<'a> {
    pub queries: QueryInputs<'a>,
    pub builtins: &'a ResolvedBuiltins,
    pub limits: &'a LimitValues,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct PlannedCall {
    /// Where the first type argument begins in the text of the file.
    pub type_argument: u32,
    pub function: ValidatingFunction,
    pub expected: ExpectedResultId,
}

/// The calls of a file that validate by a type argument, for a program that is not compiled: nothing of the file is lowered.
pub struct PlannedFile {
    /// It holds the nodes of each call and the names that they mention.
    pub program: Program,
    pub calls: Vec<PlannedCall>,
    pub diagnostics: DiagnosticBuffer,
}

const fn assert_send<T: Send>() {}

const _: () = assert_send::<PlannedFile>();

struct FileToPlan<'a, 'c, 'p, 's> {
    inputs: PlanInputs<'a>,
    file: FileId,
    hir: &'p hir::File<'s>,
    queries: &'a mut Queries<'c, 'p, 's>,
    program: Program,
    diagnostics: DiagnosticBuffer,
    validation: ValidationState,
    atoms: FxHashMap<Atom, StringId>,
}

// Code that is not compiled has no layouts, and it knows nothing of a value.
impl<'c, 'p: 'c, 's: 'p> ValidatedFile<'c, 'p, 's> for FileToPlan<'_, 'c, 'p, 's> {
    fn queries(&mut self) -> &mut Queries<'c, 'p, 's> {
        self.queries
    }

    fn hir(&self) -> &'p hir::File<'s> {
        self.hir
    }

    fn limit(&self, limit: LimitId) -> u64 {
        self.inputs.limits.get(limit)
    }

    fn gave_up(&mut self, _: LimitId, _: u32) {}

    fn validation(&mut self) -> &mut ValidationState {
        &mut self.validation
    }

    fn intern_atom(&mut self, atom: Atom) -> StringId {
        if let Some(&id) = self.atoms.get(&atom) {
            return id;
        }
        let id = self.program.strings.intern(self.queries.atom_bytes(atom));
        self.atoms.insert(atom, id);
        id
    }

    fn intern_bytes(&mut self, bytes: &[u8]) -> StringId {
        self.program.strings.intern(bytes)
    }

    fn name_key(&mut self, name: Atom) -> PropertyKeyId {
        let text = self.intern_atom(name);
        let key = PropertyKey::from_text(text);
        self.program.property_keys.intern(key)
    }

    fn result_type(&mut self, _: CheckerTypeId, _: u32) -> TypeId {
        TypeTable::ANYTHING
    }

    fn object_type_layout(&mut self, _: CheckerTypeId) -> Option<LayoutId> {
        None
    }

    fn find_field(&mut self, _: LayoutId, _: PropertyKeyId) -> Option<u32> {
        None
    }

    fn calls_parse_of_bun(&self, callee: ExprId) -> bool {
        self.find_function(callee) == Some(ValidatingFunction::Parse)
    }

    fn report_at(&mut self, expression: ExprId, code: Code, arguments: &[&[u8]]) {
        let span = Span::of_node(self.hir, self.file, NodeData::Expr(expression));
        self.diagnostics.report(code, span, arguments);
    }

    fn add_expected_result(
        &mut self,
        _: ExprId,
        _: CheckerTypeId,
        validation: Vec<ValidationNode>,
    ) -> Result<ExpectedResultId, ValidationError> {
        let id = ExpectedResultId::new(self.program.expected_results.len());
        self.program.expected_results.push(ExpectedResult {
            ty: TypeTable::ANYTHING,
            layouts: Vec::new(),
            site: None,
            validation,
        });
        Ok(id)
    }
}

impl FileToPlan<'_, '_, '_, '_> {
    // The type argument of the global `JSON.parse` is erased.
    fn find_function(&self, callee: ExprId) -> Option<ValidatingFunction> {
        let callee = self.hir.skip_type_assertions(callee);
        match self.inputs.builtins.builtin_of_expression(callee)? {
            BuiltinId::BunJSONParse => Some(ValidatingFunction::Parse),
            BuiltinId::BunBundleValidate => Some(ValidatingFunction::Validate),
            _ => None,
        }
    }

    fn plan_call(&mut self, call: ExprId) -> Option<PlannedCall> {
        let hir = self.hir;
        let ExprKind::Call(id) = hir[call].kind else {
            return None;
        };
        let site = hir[id];
        let argument = hir.ids(hir.list_at(site.type_args)).next()?;
        let function = self.find_function(site.callee)?;
        let expected = self.find_validated_result(call, &site, function)?;
        Some(PlannedCall {
            type_argument: skip_blanks_and_comments(&hir.text, hir[argument].pos),
            function,
            expected,
        })
    }
}

/// `None`: the checker's task was discarded on the way, so the file is asked about again.
pub fn plan_validated_calls<'s>(
    inputs: &PlanInputs<'_>,
    checker: &mut Checker<'_, 's>,
    file: FileId,
) -> Option<PlannedFile> {
    checker.with_queries(file, inputs.queries, |queries| {
        let hir = queries.hir();
        let compiled = queries.files().compiled(file);
        let decisions = &compiled.expect("the file holds code").analysis.decisions;
        let mut plan = FileToPlan {
            inputs: *inputs,
            file,
            hir,
            queries,
            program: Program::new(),
            diagnostics: DiagnosticBuffer::default(),
            validation: ValidationState::default(),
            atoms: FxHashMap::default(),
        };
        let mut calls = Vec::new();
        for expression in (0..hir.exprs.len() as u32).map(ExprId) {
            if decisions.is_dead_expr(expression) {
                continue;
            }
            calls.extend(plan.plan_call(expression));
            if plan.queries.is_discarded() {
                return None;
            }
        }
        Some(PlannedFile {
            program: plan.program,
            calls,
            diagnostics: plan.diagnostics,
        })
    })
}
