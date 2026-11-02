//! Types.

use super::*;

impl<'a> Line<'_, 'a> {
    /// `: T`
    #[inline]
    pub(super) fn type_annotation(&mut self, ty: Option<TypeNode<'a>>) -> Written {
        match ty {
            Some(ty) => {
                self.token(": ")?;
                self.ty(ty)
            }
            None => Ok(()),
        }
    }

    /// `<A, B>`
    #[inline]
    pub(super) fn type_arguments(&mut self, args: List<'a, TypeNode<'a>>) -> Written {
        if args.is_empty() {
            return Ok(());
        }
        self.byte(b'<')?;
        self.list(args.iter(), |line, ty| line.ty(ty))?;
        self.byte(b'>')
    }

    /// `<A, B extends C = D>`
    #[inline]
    pub(super) fn type_parameters(&mut self, params: List<'a, TypeParam<'a>>) -> Written {
        if params.is_empty() {
            return Ok(());
        }
        self.byte(b'<')?;
        self.list(params.iter(), |line, param| {
            // `const`, `in`, `out`
            if param.span().start != param.name().span().start {
                return Err(Refused);
            }
            line.source(param.name().span())?;
            if let Some(constraint) = param.constraint() {
                line.token(" extends ")?;
                line.ty(constraint)?;
            }
            if let Some(default) = param.default() {
                line.token(" = ")?;
                line.ty(default)?;
            }
            Ok(())
        })?;
        self.byte(b'>')
    }

    pub(super) fn ty(&mut self, ty: TypeNode<'a>) -> Written {
        match ty.tag() {
            TypeTag::Keyword | TypeTag::BoolLit => return self.source(ty.span()),
            TypeTag::Union | TypeTag::Keyof | TypeTag::Readonly | TypeTag::Typeof | TypeTag::Fn
                if crate::js::parentheses::ts_type::needs_parentheses(ty, self.f) =>
            {
                self.byte(b'(')?;
                self.nested(|line| line.type_without_parentheses(ty))?;
                return self.byte(b')');
            }
            _ => {}
        }
        self.nested(|line| line.type_without_parentheses(ty))
    }

    pub(super) fn type_without_parentheses(&mut self, ty: TypeNode<'a>) -> Written {
        match ty.kind() {
            TypeKind::Ref { name, args } => {
                for (index, part) in name.parts().enumerate() {
                    if index > 0 {
                        self.byte(b'.')?;
                    }
                    self.source(part.span())?;
                }
                self.type_arguments(args)
            }
            TypeKind::StringLit(_) => self.string(ty.span()),
            TypeKind::Array(element) => {
                self.ty(element)?;
                self.token("[]")
            }
            TypeKind::Union(types) => {
                for (index, member) in types.iter().enumerate() {
                    if index > 0 {
                        self.token(" | ")?;
                    }
                    self.ty(member)?;
                }
                Ok(())
            }
            TypeKind::Keyof(operand) => {
                self.token("keyof ")?;
                self.ty(operand)
            }
            TypeKind::Readonly(operand) => {
                self.token("readonly ")?;
                self.ty(operand)
            }
            TypeKind::IndexedAccess { obj, index } => {
                self.ty(obj)?;
                self.byte(b'[')?;
                self.ty(index)?;
                self.byte(b']')
            }
            TypeKind::Fn(func) if func.kind() == FnKind::FunctionType => {
                self.type_parameters(func.type_params())?;
                self.parameters(func)?;
                self.token(" => ")?;
                self.ty(func.return_type().ok_or(Refused)?)
            }
            _ => Err(Refused),
        }
    }
}
