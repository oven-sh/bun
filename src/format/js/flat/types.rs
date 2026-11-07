//! Types.

use super::holes::Hole;
use super::*;
use crate::js::utils::typescript::{
    is_object_like_type, is_simple_type, should_hug_type, without_lone_operator,
};

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
        if !self.is_typescript {
            return self.flow_type_parameters(params);
        }
        self.byte(b'<')?;
        self.list(params.iter(), |line, param| line.type_parameter(param))?;
        self.byte(b'>')
    }

    /// `const in out A extends B = C`
    fn type_parameter(&mut self, param: TypeParam<'a>) -> Written {
        let flags = param.flags();
        if !flags.is_empty() {
            let mut known = Flags::empty();
            for (flag, keyword) in [
                (Flags::CONST, "const "),
                (Flags::IN, "in "),
                (Flags::OUT, "out "),
            ] {
                known |= flag;
                if flags.contains(flag) {
                    self.token(keyword)?;
                }
            }
            if !known.contains(flags) {
                return Err(Refused);
            }
        }
        self.source(param.name().span())?;
        if let Some(constraint) = param.constraint() {
            self.token(" extends ")?;
            self.ty(constraint)?;
        }
        if let Some(default) = param.default() {
            self.token(" = ")?;
            self.ty(default)?;
        }
        Ok(())
    }

    pub(super) fn ty(&mut self, ty: TypeNode<'a>) -> Written {
        if !self.is_typescript {
            return self.flow_type(ty);
        }
        match ty.tag() {
            TypeTag::Keyword | TypeTag::BoolLit => return self.source(ty.span()),
            TypeTag::Union
            | TypeTag::Intersection
            | TypeTag::Keyof
            | TypeTag::Readonly
            | TypeTag::UniqueSymbol
            | TypeTag::Typeof
            | TypeTag::Import
            | TypeTag::Fn
            | TypeTag::Cond
            | TypeTag::Infer
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

    /// True if the type literal `ty` is certain to break: its first member is on a new line, or all of this is too wide.
    fn is_broken_type_literal(&self, ty: TypeNode<'a>, first: Member<'a>) -> bool {
        self.breaks
            || (self.f.options().expand == Expand::Auto
                && self.has_line_break_in(Span::new(ty.span().start, first.span().start)))
    }

    /// `mark`, which is `:` or ` =`, and a type. Nothing before them can break, and nothing but a `;` follows.
    pub(super) fn last_type_after(&mut self, mark: &'static str, ty: TypeNode<'a>) -> Written {
        self.token(mark)?;
        if !self.is_typescript {
            self.byte(b' ')?;
            return self.flow_type(ty);
        }
        let ty = without_lone_operator(ty);
        match ty.kind() {
            TypeKind::Union(types) if self.breaks && !should_hug_type(types, self.f) => {
                // Where its comments are printed is another matter, and oxfmt has no line for all of it.
                if self.has_comments_in(ty.span()) || self.f.options().flavor.is_oxfmt() {
                    return Err(Refused);
                }
                // The blank before the line break counts where decorators ask whether the line fits.
                self.end_text(Some(1))?;
                self.union_after_line_break(types)
            }
            _ => {
                self.byte(b' ')?;
                self.last_type(ty)
            }
        }
    }

    /// A union that's too wide for the line of what's before it: on the next line, or each type on a line. A `;`
    /// follows.
    fn union_after_line_break(&mut self, types: List<'a, TypeNode<'a>>) -> Written {
        self.breaks = false;
        self.break_line(1)?;
        let mark = self.mark();
        let limit = self.limit;
        (self.limit, self.is_too_wide) = (limit.saturating_sub(1), false);
        let written = self.types_between(types, " | ");
        if written.is_ok() && !self.has_parts_since(mark) {
            self.limit = self.limit_since(mark);
            self.end_indent();
            return Ok(());
        }
        if !self.is_too_wide {
            return Err(Refused);
        }
        self.go_back_to(mark);
        // Without semicolons it's too wide only if it is without one.
        if !self.has_semicolons {
            self.is_too_wide = false;
            if self.types_between(types, " | ").is_ok() || !self.is_too_wide {
                return Err(Refused);
            }
            self.go_back_to(mark);
        }
        let count = types.len();
        for (index, member) in types.iter().enumerate() {
            if index > 0 {
                self.break_line(0)?;
            }
            self.token("| ")?;
            let after = usize::from(index + 1 == count);
            let hole = Hole::UnionMember(member);
            self.on_own_line(member.outer_span(), after, hole, |line| line.ty(member))?;
        }
        self.end_indent();
        Ok(())
    }

    /// A type with nothing but closing brackets and `;` after it, and nothing before it that can break, so that it can
    /// end the line.
    pub(super) fn last_type(&mut self, ty: TypeNode<'a>) -> Written {
        if !self.is_typescript {
            return self.flow_type(ty);
        }
        match ty.kind() {
            TypeKind::Mapped(_)
                if self.breaks
                    || (self.f.options().expand == Expand::Auto
                        && (self.f.source_text())
                            .has_line_terminator_after_skipping_comments(ty.span().start + 1)) =>
            {
                // Without semicolons, one that's ignored is on the next line.
                if !self.has_semicolons && self.has_comments_in(ty.span()) {
                    return Err(Refused);
                }
                self.end_line_with_hole(Hole::Type(ty), ty.span(), 1)
            }
            TypeKind::Fn(func) if self.breaks => self.function_type(func, true),
            // Nothing can break between an object type and what's next to it.
            TypeKind::Intersection(types) if types.len() == 2 => {
                let (Some(first), Some(second)) = (types.first(), types.last()) else {
                    return Err(Refused);
                };
                if !is_object_like_type(first) && !is_object_like_type(second) {
                    return self.ty(ty);
                }
                // What is too wide can break in the second type as well.
                if self.breaks && !is_object_like_type(second) && !is_simple_type(second) {
                    return Err(Refused);
                }
                self.nested(|line| match is_object_like_type(first) {
                    true => line.last_type(first),
                    false => line.ty(first),
                })?;
                self.token(" & ")?;
                self.nested(|line| match is_object_like_type(second) {
                    true => line.last_type(second),
                    false => line.ty(second),
                })
            }
            TypeKind::Object(members) => match members.first() {
                Some(first) if self.is_broken_type_literal(ty, first) => {
                    self.end_line_with_hole(Hole::Type(ty), ty.span(), 1)
                }
                _ => self.ty(ty),
            },
            // The only argument is hugged.
            TypeKind::Ref { name, args } if args.len() == 1 => match args.first() {
                Some(only) if only.tag() == TypeTag::Object => {
                    self.entity_name(name)?;
                    self.byte(b'<')?;
                    self.nested(|line| line.last_type(only))?;
                    self.byte(b'>')
                }
                _ => self.ty(ty),
            },
            TypeKind::Array(element) if element.tag() == TypeTag::Object => {
                self.nested(|line| line.last_type(element))?;
                self.token("[]")
            }
            // `{ .. } | null`
            TypeKind::Union(types)
                if types.len() > 1
                    && types.iter().any(|it| it.tag() == TypeTag::Object)
                    && should_hug_type(types, self.f) =>
            {
                for (index, member) in types.iter().enumerate() {
                    if index > 0 {
                        self.token(" | ")?;
                    }
                    self.nested(|line| line.last_type(member))?;
                }
                Ok(())
            }
            _ => self.ty(ty),
        }
    }

    /// `A.B.C`
    pub(super) fn entity_name(&mut self, name: EntityName<'a>) -> Written {
        for (index, part) in name.parts().enumerate() {
            if index > 0 {
                self.byte(b'.')?;
            }
            self.source(part.span())?;
        }
        Ok(())
    }

    pub(super) fn type_without_parentheses(&mut self, ty: TypeNode<'a>) -> Written {
        match ty.kind() {
            TypeKind::Ref { name, args } => {
                // oxfmt keeps the parentheses of `type A = (intrinsic)`.
                if ty.span().len() == 9
                    && name.is("intrinsic")
                    && self.f.options().flavor.is_oxfmt()
                {
                    return Err(Refused);
                }
                self.entity_name(name)?;
                self.type_arguments(args)
            }
            TypeKind::StringLit(_) => match self.text_of(ty.span()) {
                // A template without substitutions.
                text @ [b'`', ..] => match text.iter().all(|byte| *byte >= b' ') {
                    true => self.long_bytes(text),
                    false => Err(Refused),
                },
                _ => self.string(ty.span()),
            },
            TypeKind::Array(element) => {
                self.ty(element)?;
                self.token("[]")
            }
            TypeKind::Union(types) => self.types_between(types, " | "),
            TypeKind::Object(members) => {
                let Some(first) = members.first() else {
                    return self.token("{}");
                };
                // Whether the names are quoted then depends on all of them.
                if self.f.options().quote_properties.is_consistent()
                    || (self.f.options().expand == Expand::Auto
                        && self.has_line_break_in(Span::new(ty.span().start, first.span().start)))
                {
                    return Err(Refused);
                }
                self.open_brace()?;
                for (index, member) in members.iter().enumerate() {
                    if index > 0 {
                        self.token("; ")?;
                    }
                    self.type_member(member, false)?;
                }
                self.close_brace()
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
            TypeKind::Fn(func) => self.function_type(func, false),
            _ => self.less_common_type(ty),
        }
    }

    /// `(a: A) => B`, `new (a: A) => B`
    fn function_type(&mut self, func: Func<'a>, can_break: bool) -> Written {
        match func.kind() {
            FnKind::FunctionType => {}
            FnKind::ConstructorType => {
                if func.flags().contains(Flags::ABSTRACT) {
                    self.token("abstract ")?;
                }
                self.token("new ")?;
            }
            _ => return Err(Refused),
        }
        if func.return_type().is_none() {
            return Err(Refused);
        }
        self.head(func, can_break)
    }

    /// `types`, with `operator` between them.
    fn types_between(&mut self, types: List<'a, TypeNode<'a>>, operator: &'static str) -> Written {
        for (index, member) in types.iter().enumerate() {
            if index > 0 {
                self.token(operator)?;
            }
            self.ty(member)?;
        }
        Ok(())
    }

    #[inline(never)]
    fn less_common_type(&mut self, ty: TypeNode<'a>) -> Written {
        match ty.kind() {
            TypeKind::Intersection(types) => self.types_between(types, " & "),
            TypeKind::Tuple(elements) => {
                self.byte(b'[')?;
                self.list(elements.iter(), |line, element| {
                    if element.is_rest() {
                        line.token("...")?;
                    }
                    let optional = |line: &mut Self| match element.is_optional() {
                        true => line.byte(b'?'),
                        false => Ok(()),
                    };
                    match element.name() {
                        Some(label) => {
                            line.source(label.span())?;
                            optional(line)?;
                            line.token(": ")?;
                            line.ty(element.ty())
                        }
                        None => {
                            line.ty(element.ty())?;
                            optional(line)
                        }
                    }
                })?;
                self.byte(b']')
            }
            TypeKind::NumberLit(_) => {
                let text = self.text_of(ty.span());
                let digits = match text.strip_prefix(b"-") {
                    Some(rest) => {
                        self.byte(b'-')?;
                        rest.trim_ascii_start()
                    }
                    None => text,
                };
                self.long_bytes(&format_trimmed_number(digits))
            }
            TypeKind::BigIntLit { .. } => {
                let text = self.text_of(ty.span());
                match text
                    .iter()
                    .any(|byte| byte.is_ascii_uppercase() || byte.is_ascii_whitespace())
                {
                    true => Err(Refused),
                    false => self.long_bytes(text),
                }
            }
            TypeKind::Template(_) => {
                let template = ty.as_template().ok_or(Refused)?;
                if !self.text_of(ty.span()).iter().all(|byte| *byte >= b' ') {
                    return Err(Refused);
                }
                let types = template.types();
                self.byte(b'`')?;
                for i in 0..template.quasi_count() {
                    self.long_bytes(template.raw(i))?;
                    if let Some(ty) = types.get(i) {
                        self.token("${")?;
                        self.ty(ty)?;
                        self.byte(b'}')?;
                    }
                }
                self.byte(b'`')
            }
            TypeKind::Cond {
                check,
                extends,
                yes,
                no,
            } => {
                self.ty(check)?;
                self.token(" extends ")?;
                self.ty(extends)?;
                self.token(" ? ")?;
                match yes.tag() {
                    TypeTag::Cond => {
                        self.byte(b'(')?;
                        self.ty(yes)?;
                        self.byte(b')')?;
                    }
                    _ => self.ty(yes)?,
                }
                self.token(" : ")?;
                self.ty(no)
            }
            TypeKind::Infer(param) => {
                self.token("infer ")?;
                self.type_parameter(param)
            }
            TypeKind::Mapped(mapped) => self.mapped_type(ty, mapped),
            TypeKind::UniqueSymbol => self.token("unique symbol"),
            TypeKind::Typeof { expr, args } => {
                self.token("typeof ")?;
                self.qualified_name(expr)?;
                self.type_arguments(args)
            }
            TypeKind::Import {
                name,
                args,
                is_typeof,
                ..
            } => {
                if ty.import_attributes().is_some() {
                    return Err(Refused);
                }
                if is_typeof {
                    self.token("typeof ")?;
                }
                self.token("import(")?;
                self.string(ty.import_source_span().ok_or(Refused)?)?;
                self.byte(b')')?;
                if !name.is_empty() {
                    self.byte(b'.')?;
                    self.entity_name(name)?;
                }
                self.type_arguments(args)
            }
            TypeKind::Predicate {
                ty: asserted,
                asserts,
                ..
            } => {
                if asserts {
                    self.token("asserts ")?;
                }
                self.source(ty.predicate_param().ok_or(Refused)?.span())?;
                match asserted {
                    Some(asserted) => {
                        self.token(" is ")?;
                        self.ty(asserted)
                    }
                    None => Ok(()),
                }
            }
            _ => Err(Refused),
        }
    }

    /// `a.b.c` after `typeof`
    fn qualified_name(&mut self, name: Expr<'a>) -> Written {
        match name.kind() {
            ExprKind::Dot {
                obj, name: right, ..
            } => {
                if name.is_parenthesized() || !matches!(name.as_dot(), Some((_, _, Chain::No))) {
                    return Err(Refused);
                }
                self.nested(|line| line.qualified_name(obj))?;
                self.byte(b'.')?;
                self.source(right.span())
            }
            ExprKind::Ident(_) | ExprKind::This => self.source(name.span()),
            _ => Err(Refused),
        }
    }

    /// `{ readonly [K in T as N]?: V }`
    fn mapped_type(&mut self, ty: TypeNode<'a>, mapped: Mapped<'a>) -> Written {
        if self.f.options().expand == Expand::Auto
            && (self.f.source_text())
                .has_line_terminator_after_skipping_comments(ty.span().start + 1)
        {
            return Err(Refused);
        }
        self.open_brace()?;
        match mapped.readonly() {
            MappedModifier::None => {}
            MappedModifier::Add if mapped.is_readonly_with_plus() => self.token("+readonly ")?,
            MappedModifier::Add => self.token("readonly ")?,
            MappedModifier::Remove => self.token("-readonly ")?,
        }
        let param = mapped.param();
        self.byte(b'[')?;
        self.source(param.name().span())?;
        self.token(" in ")?;
        self.ty(param.constraint().ok_or(Refused)?)?;
        if let Some(name_type) = mapped.name_type() {
            self.token(" as ")?;
            self.ty(name_type)?;
        }
        self.byte(b']')?;
        match mapped.optional() {
            MappedModifier::None => {}
            MappedModifier::Add if mapped.is_optional_with_plus() => self.token("+?")?,
            MappedModifier::Add => self.byte(b'?')?,
            MappedModifier::Remove => self.token("-?")?,
        }
        self.type_annotation(mapped.ty())?;
        self.close_brace()
    }
}
