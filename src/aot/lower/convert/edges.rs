use bun_sema::bind::FnOwner;
use bun_sema::check::aot::{FunctionRef, ShapeKind};
use bun_sema::hir::{Flags, FnBody, FnKind};
use smallvec::{SmallVec, smallvec};

use crate::ir::generated::IllTypedCause;
use crate::ir::{DeclaredType, TypeTable};
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

#[derive(Copy, Clone)]
pub(super) struct Edge {
    pub(super) source: Option<CheckerTypeId>,
    pub(super) target: Option<CheckerTypeId>,
    pub(super) position: DeclaredType,
    pub(super) construct: Construct,
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
                ShapeKind::Constrained { base, .. } => pending.push(base),
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

    fn classify_flow(&mut self, edge: Edge, refused: IllTypedCause) -> IllTypedCause {
        let Some(source) = edge.source else {
            return IllTypedCause::FromLooseType;
        };
        if is_loose(self, source) {
            return IllTypedCause::FromLooseType;
        }
        let Some(target) = edge.target else {
            return match self.is_inside_position(source, edge.position) {
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
            Ok(false) if self.is_inside_position(source, edge.position) => IllTypedCause::None,
            Ok(false) => refused,
            Err(_) => IllTypedCause::FromLooseType,
        }
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

    pub(super) fn classify_edge(&mut self, edge: Edge) -> IllTypedCause {
        match edge.construct {
            Construct::Flow => self.classify_flow(edge, IllTypedCause::SuppressedError),
            // `never` goes into every type, and no value is one: an assertion has taken the type of this value away.
            Construct::Assertion if edge.source.is_some_and(|source| self.is_never(source)) => {
                IllTypedCause::Assertion
            }
            Construct::Assertion => self.classify_flow(edge, IllTypedCause::Assertion),
            Construct::ContentsRead => IllTypedCause::ContainerWriterUnseen,
            // The result of a generic function comes out of a type parameter.
            Construct::IndexSignatureRead
            | Construct::CallResult {
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

// `any`, `unknown`, `object`, `{}`, `Function` and a bare type parameter say nothing about the value they hold.
fn is_loose(file: &mut FileLowering<'_, '_, '_, '_>, ty: CheckerTypeId) -> bool {
    if let Some(&is_loose) = file.types.conversions.loose_types.get(&ty) {
        return is_loose;
    }
    let is_loose = file.compute_is_loose(ty);
    file.types.conversions.loose_types.insert(ty, is_loose);
    is_loose
}
