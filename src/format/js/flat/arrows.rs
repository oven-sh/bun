//! Function expressions and arrow functions that are too wide for the line.

use super::*;
use crate::js::print::function::can_group_function_parameters;
use crate::js::utils::assignment_like::is_type_without_line_breaks;

impl<'a> Line<'_, 'a> {
    /// `async function* a`, `async `
    pub(super) fn function_keywords(&mut self, func: Func<'a>) -> Written {
        if func.is_async() {
            self.token("async ")?;
        }
        if func.is_arrow() {
            return Ok(());
        }
        self.token(match func.is_generator() {
            true => "function* ",
            false => "function ",
        })?;
        match func.name() {
            Some(name) => self.source(name.span()),
            None => Ok(()),
        }
    }

    /// The parameter of an arrow function that's written without parentheses.
    pub(super) fn lone_parameter(&mut self, func: Func<'a>) -> Written {
        let parameter = func.params().first().ok_or(Refused)?;
        // Flow's `readonly a`
        if !parameter.modifiers().is_empty() {
            return Err(Refused);
        }
        self.pattern(parameter.pat())
    }

    /// The parameters and the return type of a function expression or an arrow function, and the `=>`.
    fn signature_on_one_line(&mut self, func: Func<'a>) -> Written {
        if !func.is_arrow() {
            return self.signature(func);
        }
        if !func.type_params().is_empty() {
            return Err(Refused);
        }
        match can_avoid_parentheses(func, self.f) {
            true => self.lone_parameter(func)?,
            false => self.parameters(func)?,
        }
        self.type_annotation(func.return_type())?;
        self.token(" =>")
    }

    /// How wide what follows the signature of `func` is, up to where the line can break next.
    fn width_after_signature(&self, func: Func<'a>) -> Result<usize, Refused> {
        let FnBody::Expr(body) = func.body() else {
            let statements = func.body_statements().ok_or(Refused)?;
            return match statements.is_empty() {
                true => Ok(" {}".len() + self.tail),
                false => Ok(" {".len()),
            };
        };
        Ok(match body.kind() {
            ExprKind::Object(props) if props.is_empty() => " ({})".len() + self.tail,
            ExprKind::Object(_) => " ({".len(),
            ExprKind::Array(elements) if elements.is_empty() => " []".len() + self.tail,
            ExprKind::Array(_) => " [".len(),
            // [`Line::arrow_body`] doesn't write it.
            ExprKind::Cond { .. } if matches!(self.text_of(body.span()), [b'(' | b'{', ..]) => {
                return Err(Refused);
            }
            // The space counts.
            ExprKind::Cond { .. } => 1,
            _ => 0,
        })
    }

    /// True if there can be a line break before the body of `func`, which is hugged. Its parameters don't break. Its type
    /// parameters, its return type and a chain in a default value can.
    pub(super) fn hugged_head_can_break(&self, func: Func<'a>) -> bool {
        !func.type_params().is_empty()
            || (func.return_type()).is_some_and(|ty| !is_type_without_line_breaks(ty, self.f))
            || func.params().iter().any(|param| {
                param.pat().tag() != PatTag::Ident
                    || param.default().is_some_and(|it| !is_unbreakable(it.tag()))
            })
    }

    /// Refuses `func`, which is hugged, if there can be a call in a default value among its parameters. The printer
    /// chooses among variants for the arguments of a call, and of one in the head of a function that's hugged it measures
    /// the widest. A chain of calls breaks there.
    pub(super) fn check_parameters_of_hugged(&self, func: Func<'a>) -> Written {
        let can_have_call = func.params().iter().any(|param| {
            (param.pat().tag() != PatTag::Ident
                || param.default().is_some_and(|it| !is_unbreakable(it.tag())))
                && strings::contains_char(self.text_of(param.span()), b'(')
        });
        match can_have_call {
            true => Err(Refused),
            false => Ok(()),
        }
    }

    /// A function expression or an arrow function that's too wide for the line, with nothing but closing brackets after
    /// it. `is_hugged`: it's the last argument of a call, and the other arguments are on the line.
    pub(super) fn function_too_wide(&mut self, func: Func<'a>, is_hugged: bool) -> Written {
        if self.width != Width::Known {
            return Err(Refused);
        }
        let after = self.width_after_signature(func)?;
        let mark = self.spot();
        self.is_too_wide = false;
        let written = (self.function_keywords(func))
            .and_then(|()| self.signature_on_one_line(func))
            .and_then(|()| self.check_room_for(after));
        let is_signature_on_one_line = written.is_ok();
        if !is_signature_on_one_line {
            // It stays hugged if its head can break.
            if is_hugged && self.hugged_head_can_break(func) {
                self.is_too_wide = false;
            }
            if is_hugged || !self.is_first_line_too_wide(mark) {
                return Err(Refused);
            }
            self.back_to(mark);
            if !func.type_params().is_empty()
                || (!func.is_arrow() && can_group_function_parameters(func))
            {
                return Err(Refused);
            }
            self.function_keywords(func)?;
            self.parameters_each_on_a_line(func)?;
            self.type_annotation(func.return_type())?;
            if func.is_arrow() {
                self.token(" =>")?;
            }
            self.check_room_for(after)?;
        }
        let FnBody::Expr(body) = func.body() else {
            return self.body(func, true);
        };
        match is_signature_on_one_line {
            true => self.arrow_body(func, body, is_hugged),
            false => self.fits_or_breaks(self.tail, &|line| line.arrow_body(func, body, is_hugged)),
        }
    }

    /// The body of the arrow function `func` after the `=>`, with nothing but closing brackets after it.
    pub(super) fn arrow_body(
        &mut self,
        func: Func<'a>,
        body: Expr<'a>,
        is_hugged: bool,
    ) -> Written {
        match body.tag() {
            // A chain of arrow functions has a layout of its own.
            ExprTag::Fn => return Err(Refused),
            ExprTag::Binary if body.binary_op() == Some(BinOp::Comma) => return Err(Refused),
            ExprTag::Object => {
                let is_empty = body.as_object().is_none_or(|props| props.is_empty());
                if !is_empty && (self.breaks || self.is_broken_object(body)) {
                    // With its parentheses.
                    self.byte(b' ')?;
                    self.end_line_with(Part::Broken(body), body.span(), 2)?;
                    self.start_line(2);
                    return Ok(());
                }
                self.token(" (")?;
                self.nested(|line| line.object(body, false))?;
                return self.byte(b')');
            }
            ExprTag::Array => {
                self.byte(b' ')?;
                return self.nested(|line| line.array(body, true));
            }
            // In parentheses, unless it breaks or starts with an object.
            ExprTag::Cond if matches!(self.text_of(body.span()), [b'(' | b'{', ..]) => {
                return Err(Refused);
            }
            ExprTag::Cond if !self.breaks => {
                self.token(" (")?;
                self.expr(body, Place::Other)?;
                return self.byte(b')');
            }
            _ if !self.breaks => {
                self.byte(b' ')?;
                return self.expr(body, Place::Other);
            }
            // They start on the line of the `=>`.
            ExprTag::Template | ExprTag::TaggedTemplate | ExprTag::Jsx => return Err(Refused),
            _ => {}
        }
        let has_comma = is_hugged && self.has_trailing_comma(true);
        // The `)` of the call, or the `}` in JSX, is on a line of its own.
        let is_before_line_break = is_hugged
            || matches!(
                func.as_ast_nodes().parent(),
                AstNodes::JSXExpressionContainer(_)
            );
        let tail = match is_before_line_break {
            true => usize::from(has_comma),
            false => self.tail,
        };
        self.break_line(1)?;
        self.expr_in_place_before_line_break(body, Place::Other, tail)?;
        if !is_before_line_break {
            return self.outdent();
        }
        if has_comma {
            self.byte(b',')?;
        }
        self.break_line(-1)
    }
}
