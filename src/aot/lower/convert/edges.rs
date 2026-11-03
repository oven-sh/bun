use bun_sema::bind::FnOwner;
use bun_sema::check::aot::{FunctionRef, ShapeKind};
use bun_sema::hir::{ExprId, ExprKind, Flags, FnBody, FnKind};
use smallvec::{SmallVec, smallvec};

use crate::ir::generated::IllTypedCause;
use crate::ir::{DeclaredType, Primitives, TypeTable};
use crate::lower::{CheckerTypeId, FileLowering};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum Construct {
    Flow,
    Assertion,
    ContentsRead,
    IndexSignatureRead,
    CallResult {
        declaration: Option<FunctionRef>,
        is_instantiated: bool,
    },
}

impl FileLowering<'_, '_, '_, '_> {
    fn compute_is_loose(&mut self, ty: CheckerTypeId) -> bool {
        let mut pending: SmallVec<[CheckerTypeId; 4]> = smallvec![ty];
        while let Some(ty) = pending.pop() {
            let Ok(shape) = self.queries.type_shape(ty) else {
                return true;
            };
            match shape.kind {
                ShapeKind::Anything(_)
                | ShapeKind::AnyObject
                | ShapeKind::Function(&[])
                | ShapeKind::TypeVariable {
                    constraint: None, ..
                } => return true,
                ShapeKind::TypeVariable {
                    constraint: Some(constraint),
                    ..
                } => pending.push(constraint),
                ShapeKind::Union(members) => pending.extend_from_slice(members),
                ShapeKind::Int32 { base } => pending.push(base),
                ShapeKind::Never
                | ShapeKind::Undefined
                | ShapeKind::Null
                | ShapeKind::Boolean
                | ShapeKind::BooleanLiteral(_)
                | ShapeKind::Number
                | ShapeKind::NumberLiteral(_)
                | ShapeKind::NumericEnumMember(_)
                | ShapeKind::BigInt
                | ShapeKind::BigIntLiteral { .. }
                | ShapeKind::String
                | ShapeKind::StringLiteral(_)
                | ShapeKind::TemplateLiteral { .. }
                | ShapeKind::Symbol
                | ShapeKind::Function(_)
                | ShapeKind::ClassConstructor(_)
                | ShapeKind::Array { .. }
                | ShapeKind::Tuple { .. }
                | ShapeKind::Builtin { .. }
                | ShapeKind::Class(_)
                | ShapeKind::Object => {}
            }
        }
        false
    }

    fn is_never(&mut self, ty: CheckerTypeId) -> bool {
        self.queries
            .type_shape(ty)
            .is_ok_and(|shape| shape.kind == ShapeKind::Never)
    }

    fn is_inside_position(&mut self, source: CheckerTypeId, position: DeclaredType) -> bool {
        let source = self.map_type_at(source, 0).ty;
        source != TypeTable::ANYTHING
            && self.fragment.types.union(position.ty, source) == position.ty
    }

    // What a function with a body returns was converted to its result.
    fn classify_call_result(&self, declaration: Option<FunctionRef>) -> IllTypedCause {
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

    /// Whether the checker's type of the expression has no number in it.
    pub(super) fn has_no_number(&mut self, expression: ExprId) -> bool {
        let Ok(ty) = self.queries.expression_type(expression) else {
            return false;
        };
        let mapped = self.map_type_at(ty, self.hir[expression].pos);
        let ty = self.fragment.types.get(mapped.ty);
        mapped.is_checked
            && !ty.primitives.contains(Primitives::NUMBER)
            && ty.integer_range().is_none()
    }

    pub(super) fn find_cause(
        &mut self,
        position: DeclaredType,
        source: Option<ExprId>,
        target: Option<CheckerTypeId>,
        construct: Construct,
    ) -> IllTypedCause {
        if position.is_expected() {
            return IllTypedCause::None;
        }
        // `x!` takes the programmer's word for what the checker could not show.
        if source.is_some_and(|source| self.is_non_null_assertion(source)) {
            return IllTypedCause::Assertion;
        }
        let source_position = source.map_or(0, |source| self.hir[source].pos);
        let source = source.and_then(|source| self.queries.expression_type(source).ok());
        if let (Some(source), Construct::Flow) = (source, construct)
            && !target.is_some_and(|target| self.flows_into_container(source, target))
        {
            let source = self.map_type_at(source, source_position).ty;
            self.fragment
                .family_facts
                .record_conversion(source, position.ty);
        }
        let refused = match construct {
            Construct::Flow => IllTypedCause::SuppressedError,
            // `never` goes into every type, and no value is one: an assertion has taken the type of this value away.
            Construct::Assertion if source.is_some_and(|source| self.is_never(source)) => {
                return IllTypedCause::Assertion;
            }
            Construct::Assertion => IllTypedCause::Assertion,
            Construct::ContentsRead => return IllTypedCause::ContainerWriterUnseen,
            // The result of a generic function comes out of a type parameter.
            Construct::IndexSignatureRead
            | Construct::CallResult {
                is_instantiated: true,
                ..
            } => return IllTypedCause::FromLooseType,
            Construct::CallResult {
                declaration,
                is_instantiated: false,
            } => return self.classify_call_result(declaration),
        };
        let Some(source) = source else {
            return IllTypedCause::FromLooseType;
        };
        if is_loose(self, source) {
            return IllTypedCause::FromLooseType;
        }
        let Some(target) = target else {
            return match self.is_inside_position(source, position) {
                true => IllTypedCause::None,
                false => IllTypedCause::FromLooseType,
            };
        };
        if source == target {
            return IllTypedCause::None;
        }
        match self.queries.is_assignable(source, target) {
            Ok(true) => IllTypedCause::None,
            // `x?: T` is written `T`, and the position takes `undefined` too.
            Ok(false) if self.is_inside_position(source, position) => IllTypedCause::None,
            Ok(false) => refused,
            Err(_) => IllTypedCause::FromLooseType,
        }
    }
}

// `any`, `unknown`, `object`, `{}`, `Function` and a bare type parameter say nothing about the value they hold.
fn is_loose(file: &mut FileLowering<'_, '_, '_, '_>, ty: CheckerTypeId) -> bool {
    if let Some(&is_loose) = file.types.conversions.loose_types.get(&ty) {
        return is_loose;
    }
    let is_loose = file.compute_is_loose(ty);
    file.types.conversions.loose_types.insert(ty, is_loose);
    is_loose
}
