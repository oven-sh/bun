//! Flow. Its tree is made of the nodes of TypeScript (`flow.rs` in `bun_sema_parser` has the table), so a node can stand
//! for something that's printed in another way. What only Flow has is refused here, but for the types that most
//! annotations are made of.

use super::*;
use crate::js::print::flow::needs_parentheses as type_needs_parentheses;

impl<'a> Line<'_, 'a> {
    /// Refuses the statements that stand for a declaration of Flow.
    pub(super) fn check_flow_statement(&self, statement: Stmt<'a>) -> Written {
        // `declare`, and the words that have no flag: `opaque`, `component`, `hook`, `record`.
        if (statement.modifiers().iter())
            .any(|it| it.flag().is_empty() || it.flag() == Flags::AMBIENT)
        {
            return Err(Refused);
        }
        match statement.kind() {
            StmtKind::Import(import) => {
                let is_typeof = |start: u32| {
                    (self.source.get(start as usize..)).is_some_and(|it| it.starts_with(b"typeof"))
                };
                if (import.is_type_only() && is_typeof(import.clause_span().start))
                    || (import.named().iter())
                        .any(|it| it.is_type_only() && is_typeof(it.span().start))
                {
                    return Err(Refused);
                }
            }
            // `declare module.exports: T`
            StmtKind::TypeAlias(alias) if alias.name().span().len() > 13 => {
                if alias.name().name().is("module.exports") {
                    return Err(Refused);
                }
            }
            // In `declare module` they're declared without the word.
            StmtKind::Class(class) if class.flags().contains(Flags::AMBIENT) => {
                return Err(Refused);
            }
            StmtKind::Fn(func) if !func.has_body() => return Err(Refused),
            // `opaque type`, `enum A of string`, `declare module`, `match`
            StmtKind::Interface(_)
            | StmtKind::Enum(_)
            | StmtKind::Module(_)
            | StmtKind::Switch { .. }
            | StmtKind::ImportEquals(_)
            | StmtKind::ExportAssign(_)
            | StmtKind::ExportAsNamespace(_) => return Err(Refused),
            _ => {}
        }
        Ok(())
    }

    /// Refuses what's printed in another way in a file that isn't TypeScript, whatever it is.
    pub(super) fn only_in_typescript(&self) -> Written {
        match self.is_typescript {
            true => Ok(()),
            false => Err(Refused),
        }
    }

    /// Refuses a member with a word that has no flag, `proto`, and the members of an object type.
    pub(super) fn check_flow_member(&self, member: Member<'a>) -> Written {
        match member.modifiers().iter().any(|it| it.flag().is_empty())
            || member.kind() == MemberKind::IndexSignature
            || member.func().is_some_and(|func| !func.has_body())
        {
            true => Err(Refused),
            false => Ok(()),
        }
    }

    /// Refuses `match (a) { }` and `R { a: 1 }`, which are `new` expressions that don't start with `new`.
    pub(super) fn check_flow_new(&self, e: Expr<'a>, callee: Expr<'a>) -> Written {
        match self.is_flow && callee.span().start == e.span().start {
            true => Err(Refused),
            false => Ok(()),
        }
    }

    /// `(e: T)`
    pub(super) fn flow_type_cast(&mut self, expr: Expr<'a>, ty: TypeNode<'a>) -> Written {
        self.byte(b'(')?;
        self.expr(expr, Place::Other)?;
        self.token(": ")?;
        self.flow_type(ty)?;
        self.byte(b')')
    }

    /// `<A, B: C = D>`
    pub(super) fn flow_type_parameters(&mut self, params: List<'a, TypeParam<'a>>) -> Written {
        if !self.is_flow {
            return Err(Refused);
        }
        self.byte(b'<')?;
        self.list(params.iter(), |line, param| {
            // A variance, `const`
            if param.span().start != param.name().span().start {
                return Err(Refused);
            }
            line.source(param.name().span())?;
            if let Some(bound) = param.constraint() {
                line.token(match param.flow_token_after_name() == b":" {
                    true => ": ",
                    false => " extends ",
                })?;
                line.flow_type(bound)?;
            }
            if let Some(default) = param.default() {
                line.token(" = ")?;
                line.flow_type(default)?;
            }
            Ok(())
        })?;
        self.byte(b'>')
    }

    /// A keyword, a name with arguments, a string, and `?T`, `T[]` and `A | B` of those. None of them has a function
    /// type in it, which is what puts parentheses around the return type of an arrow function.
    pub(super) fn flow_type(&mut self, ty: TypeNode<'a>) -> Written {
        // A type in JavaScript is an error.
        if !self.is_flow {
            return Err(Refused);
        }
        match ty.tag() {
            TypeTag::Keyword | TypeTag::BoolLit => return self.source(ty.span()),
            TypeTag::Ref | TypeTag::StringLit => {}
            TypeTag::JSDoc | TypeTag::Array | TypeTag::Union if !type_needs_parentheses(ty) => {}
            _ => return Err(Refused),
        }
        self.nested(|line| match ty.kind() {
            TypeKind::Ref { name, args } => {
                let mut end = ty.span().start;
                for (index, part) in name.parts().enumerate() {
                    if index > 0 {
                        line.byte(b'.')?;
                    }
                    line.source(part.span())?;
                    end = part.span().end;
                }
                // `A<>` keeps its brackets, and `bool` is printed as `boolean`.
                if args.is_empty() && (end != ty.span().end || line.text_of(ty.span()) == b"bool") {
                    return Err(Refused);
                }
                line.type_arguments(args)
            }
            TypeKind::StringLit(_) => line.string(ty.span()),
            TypeKind::Array(element) => {
                line.flow_type(element)?;
                line.token("[]")
            }
            TypeKind::Union(types) if types.len() > 1 => {
                for (index, member) in types.iter().enumerate() {
                    if index > 0 {
                        line.token(" | ")?;
                    }
                    line.flow_type(member)?;
                }
                Ok(())
            }
            _ => {
                let operand = ty.flow_nullable_operand().ok_or(Refused)?;
                line.byte(b'?')?;
                line.flow_type(operand)
            }
        })
    }
}
