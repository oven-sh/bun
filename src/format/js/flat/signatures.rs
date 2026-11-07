//! The heads of function declarations, methods and signatures: type parameters, parameters, return type.

use super::holes::Hole;
use super::*;
use crate::js::print::parameters::should_hug_function_parameters;

impl<'a> Line<'_, 'a> {
    /// A function declaration, which the modifiers have been written of. Without the `;` of one that has no body.
    pub(super) fn function_declaration(&mut self, func: Func<'a>) -> Written {
        if func.is_async() {
            self.token("async ")?;
        }
        self.token(match func.is_generator() {
            true => "function* ",
            false => "function ",
        })?;
        if let Some(name) = func.name() {
            self.source(name.span())?;
        }
        self.head(func, true)?;
        match func.has_body() {
            true => self.body(func, true),
            false => Ok(()),
        }
    }

    /// `(a: A, b: B)`
    pub(super) fn parameters_on_one_line(&mut self, func: Func<'a>) -> Written {
        self.byte(b'(')?;
        let mut has_modifier = false;
        self.list(func.params_with_this(), |line, param| {
            has_modifier |= param.modifiers().iter().any(|it| it.decorator().is_none());
            line.parameter(param)
        })?;
        // An accessibility modifier puts each parameter on a line.
        if has_modifier && func.params().len() + usize::from(func.this_param().is_some()) > 1 {
            return Err(Refused);
        }
        self.byte(b')')
    }

    /// `<T>(a: A): B`. `can_break`: nothing before it on its line can break, and nothing but ` {` or `;` follows.
    pub(super) fn head(&mut self, func: Func<'a>, can_break: bool) -> Written {
        self.type_parameters(func.type_params())?;
        let params = func.params();
        let count = params.len() + usize::from(func.this_param().is_some());
        let has_modifier = count > 1
            && params.iter().any(|param| {
                let mut modifiers = param.modifiers().iter();
                modifiers.any(|it| it.decorator().is_none())
            });
        if !can_break || !(has_modifier || self.breaks) {
            self.parameters_on_one_line(func)?;
            return self.return_type(func);
        }
        if count == 0 || should_hug_function_parameters(func, false, self.f) {
            return Err(Refused);
        }
        // With one parameter, a return type that has an object type in it can break in its place.
        if count == 1
            && (func.return_type())
                .is_some_and(|ty| strings::contains_char(self.text_of(ty.span()), b'{'))
        {
            return Err(Refused);
        }
        self.breaks = false;
        self.byte(b'(')?;
        let has_last_comma =
            !params.last().is_some_and(Param::is_rest) && self.has_trailing_comma(true);
        self.lines(
            count,
            func.params_with_this(),
            has_last_comma,
            |line, param| {
                line.on_own_line(param.span(), 1, Hole::Param(param), |line| {
                    line.parameter(param)
                })
            },
        )?;
        self.byte(b')')?;
        self.return_type(func)
    }

    /// `: T`, or ` => T` in a function type
    fn return_type(&mut self, func: Func<'a>) -> Written {
        let Some(ty) = func.return_type() else {
            return Ok(());
        };
        self.token(match func.kind() {
            FnKind::FunctionType | FnKind::ConstructorType => " => ",
            _ => ": ",
        })?;
        self.ty(ty)
    }

    /// `@a private b?: T = 1`, `...a: T`, `this: T`
    pub(super) fn parameter(&mut self, param: Param<'a>) -> Written {
        if matches!(param.as_ast_nodes(), AstNodes::TSThisParameter(_)) {
            self.token("this")?;
            return self.type_annotation(param.ty());
        }
        let modifiers = param.modifiers();
        if !modifiers.is_empty() {
            let mut present = Flags::empty();
            for modifier in modifiers {
                match modifier.decorator() {
                    Some(decorator) => {
                        self.decorator(decorator, false)?;
                        self.byte(b' ')?;
                    }
                    None => present |= modifier.flag(),
                }
            }
            // A rest parameter is printed without them.
            if param.is_rest() && !present.is_empty() {
                return Err(Refused);
            }
            let mut known = Flags::empty();
            for (flag, keyword) in [
                (Flags::PUBLIC, "public "),
                (Flags::PROTECTED, "protected "),
                (Flags::PRIVATE, "private "),
                (Flags::STATIC, "static "),
                (Flags::OVERRIDE, "override "),
                (Flags::READONLY, "readonly "),
            ] {
                known |= flag;
                if present.contains(flag) {
                    self.token(keyword)?;
                }
            }
            if !known.contains(present) {
                return Err(Refused);
            }
        }
        if param.is_rest() {
            self.token("...")?;
            self.pattern(param.pat())?;
            if param.is_optional() || param.default().is_some() {
                return Err(Refused);
            }
            return self.type_annotation(param.ty());
        }
        self.pattern(param.pat())?;
        if param.is_optional() {
            self.byte(b'?')?;
        }
        self.type_annotation(param.ty())?;
        self.default_value(param.default())
    }

    /// `@a`, `@a.b`, `@a.b(c)`, after which the source has no line break unless it `is_last` on its line.
    pub(super) fn decorator(&mut self, decorator: Expr<'a>, is_last: bool) -> Written {
        let mut name = match decorator.as_ast_nodes() {
            AstNodes::CallExpression(call) => call.callee().ok_or(Refused)?,
            _ => decorator,
        };
        // Anything else is in parentheses.
        loop {
            name = match name.as_ast_nodes() {
                AstNodes::IdentifierReference(_) => break,
                AstNodes::StaticMemberExpression(member) => member.object().ok_or(Refused)?,
                _ => return Err(Refused),
            };
        }
        if decorator.is_parenthesized() {
            return Err(Refused);
        }
        self.byte(b'@')?;
        if is_last {
            return self.last_expr(decorator, Place::Other);
        }
        if self.ends_its_line(decorator) {
            return Err(Refused);
        }
        self.expr(decorator, Place::Other)
    }

    /// True if the source has a line break after `decorator`.
    pub(super) fn ends_its_line(&self, decorator: Expr<'a>) -> bool {
        (self.f.source_text()).has_line_terminator_after(decorator.outer_span().end)
    }
}
