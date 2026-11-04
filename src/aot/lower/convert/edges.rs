use bun_sema::bind::FnOwner;
use bun_sema::check::aot::{FunctionRef, ShapeKind, TypeShape};
use bun_sema::fold::Constant;
use bun_sema::hir::{BinOp, Branches, ExprId, ExprKind, Flags, FnBody, FnKind};
use smallvec::{SmallVec, smallvec};

use crate::ir::generated::IllTypedCause;
use crate::ir::{DeclaredType, Primitives};
use crate::lower::{CheckerTypeId, FileLowering, expression};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum Construct {
    Flow,
    Assertion,
    CallResult {
        declaration: Option<FunctionRef>,
        is_instantiated: bool,
    },
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Numbers {
    None,
    Int32s,
    Any,
}

fn is_int32(number: f64) -> bool {
    number == f64::from(number as i32) && (number != 0.0 || number.is_sign_positive())
}

// A function has no layout and is no number. Mapping its type declares its function type, so whoever only asks about a type looks here first.
pub(super) fn find_function_shape<'c>(
    file: &mut FileLowering<'_, 'c, '_, '_>,
    ty: CheckerTypeId,
) -> Option<TypeShape<'c>> {
    let shape = file.queries.type_shape(ty).ok()?;
    let is_function = matches!(
        shape.kind,
        ShapeKind::Function(_) | ShapeKind::ClassConstructor(_)
    );
    is_function.then_some(shape)
}

impl FileLowering<'_, '_, '_, '_> {
    /// `None`: the code that runs is in the program, so the engine sees what it returns.
    pub(super) fn classify_call_result(&self, declaration: Option<FunctionRef>) -> IllTypedCause {
        let Some(declaration) = declaration else {
            return IllTypedCause::UnprovenCallee;
        };
        if !self.queries.file_trust(declaration.file).is_trusted() {
            return IllTypedCause::DeclarationWithoutBody;
        }
        let files = self.queries.files();
        let function = files.hir(declaration.file)[declaration.function];
        match function.body {
            FnBody::Block(_) | FnBody::Expr(_) => return IllTypedCause::None,
            FnBody::None => {}
        }
        match function.kind {
            FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::Constructor => {
                let bound = files.bound(declaration.file);
                let is_implemented_elsewhere = match bound.fns[declaration.function.idx()].owner {
                    FnOwner::Member(member) => {
                        let is_abstract = files.hir(declaration.file)[member]
                            .flags
                            .contains(Flags::ABSTRACT);
                        is_abstract || bound.member_class(member).is_none()
                    }
                    FnOwner::None | FnOwner::Expr(_) | FnOwner::Stmt(_) | FnOwner::Type(_) => false,
                };
                match is_implemented_elsewhere {
                    true => IllTypedCause::None,
                    false => IllTypedCause::DeclarationWithoutBody,
                }
            }
            FnKind::Decl | FnKind::Expr | FnKind::Arrow | FnKind::StaticBlock => {
                IllTypedCause::DeclarationWithoutBody
            }
            _ => IllTypedCause::None,
        }
    }

    fn is_non_null_assertion(&self, mut expression: ExprId) -> bool {
        while let ExprKind::Satisfies { expr: operand, .. } = self.hir[expression].kind {
            expression = operand;
        }
        matches!(self.hir[expression].kind, ExprKind::NonNull(_))
    }

    /// The numbers in the checker's type of the expression.
    fn find_numbers(&mut self, expression: ExprId) -> Numbers {
        let Ok(ty) = self.queries.expression_type(expression) else {
            return Numbers::Any;
        };
        // Every member that checked code reads is asked about, the callee of `counter.bump()` too.
        if let Some(shape) = find_function_shape(self, ty) {
            return match shape.trust.is_trusted() {
                true => Numbers::None,
                false => Numbers::Any,
            };
        }
        let mapped = self.map_type_at(ty);
        let ty = self.fragment.types.get(mapped.ty);
        if !mapped.is_checked || ty.primitives.contains(Primitives::NUMBER) {
            return Numbers::Any;
        }
        match ty.integer_range() {
            None => Numbers::None,
            Some((minimum, maximum)) => {
                match i64::from(i32::MIN) <= minimum && maximum <= i64::from(i32::MAX) {
                    true => Numbers::Int32s,
                    false => Numbers::Any,
                }
            }
        }
    }

    // What lies in a position whose numbers are all `int32`s was judged where it entered, and the members of a numeric enum and whole literals are taken for `int32`s.
    // So what is only read out of such positions breaks no promise, whatever the engine finds to arrive there, and neither does a value with no number in its type. A cast proves nothing: its operand is asked.
    pub(in crate::lower) fn breaks_no_int32_promise(&mut self, source: ExprId) -> bool {
        let hir = self.hir;
        let mut pending: SmallVec<[ExprId; 4]> = smallvec![source];
        while let Some(flowing) = pending.pop() {
            match expression::find_constant(self, flowing) {
                Some(Constant::Number(number)) if !is_int32(number) => return false,
                Some(_) => continue,
                None => {}
            }
            if let Some(operand) = hir.type_assertion_operand(flowing) {
                pending.push(operand);
                continue;
            }
            let is_read = match hir[flowing].kind {
                ExprKind::Cond { branches, .. } => {
                    let Branches { yes, no } = hir.branches(branches);
                    pending.extend([yes, no]);
                    continue;
                }
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Or | BinOp::Nullish,
                    left,
                    right,
                } => {
                    pending.extend([left, right]);
                    continue;
                }
                ExprKind::Binary {
                    op: BinOp::Comma,
                    right,
                    ..
                } => {
                    pending.push(right);
                    continue;
                }
                ExprKind::Ident(_)
                | ExprKind::Dot { .. }
                | ExprKind::Index { .. }
                | ExprKind::Call(_)
                | ExprKind::TaggedTemplate(_)
                | ExprKind::Await(_)
                | ExprKind::Yield { .. } => true,
                _ => false,
            };
            match self.find_numbers(flowing) {
                Numbers::None => {}
                Numbers::Int32s if is_read => {}
                Numbers::Int32s | Numbers::Any => return false,
            }
        }
        true
    }

    /// What `--explain` prints. It claims nothing: the engine tests the value whatever the cause is, `None` too.
    pub(super) fn find_cause(
        &self,
        position: DeclaredType,
        source: Option<ExprId>,
        construct: Construct,
    ) -> IllTypedCause {
        if position.is_expected() {
            return IllTypedCause::None;
        }
        // `x!` takes the programmer's word for what the checker could not show.
        if source.is_some_and(|source| self.is_non_null_assertion(source)) {
            return IllTypedCause::Assertion;
        }
        match construct {
            Construct::Flow => IllTypedCause::None,
            Construct::Assertion => IllTypedCause::Assertion,
            // The result of a generic function comes out of a type parameter.
            Construct::CallResult {
                is_instantiated: true,
                ..
            } => IllTypedCause::FromLooseType,
            Construct::CallResult {
                declaration,
                is_instantiated: false,
            } => self.classify_call_result(declaration),
        }
    }
}
