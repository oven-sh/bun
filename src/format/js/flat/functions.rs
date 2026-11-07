//! Patterns and parameters.

use super::*;
use crate::js::print::parameters::{can_break_between_parameters, should_hug_function_parameters};
use crate::js::utils::assignment_like::is_type_without_line_breaks;

impl<'a> Line<'_, 'a> {
    pub(super) fn default_value(&mut self, default: Option<Expr<'a>>) -> Written {
        match default {
            Some(default) => {
                self.token(" = ")?;
                self.expr(default, Place::Other)
            }
            None => Ok(()),
        }
    }

    pub(super) fn pattern(&mut self, pattern: Pat<'a>) -> Written {
        match pattern.kind() {
            PatKind::Ident(_) => self.source(pattern.span()),
            PatKind::Object(props) => {
                if props.is_empty() {
                    return self.token("{}");
                }
                self.open_brace()?;
                self.nested(|line| {
                    line.list(props.iter(), |line, prop| line.pattern_property(prop))
                })?;
                self.close_brace()
            }
            PatKind::Array(elements) => {
                self.byte(b'[')?;
                self.nested(|line| {
                    line.list(elements.iter(), |line, element| {
                        let pattern = element.pat().ok_or(Refused)?;
                        if element.is_rest() {
                            // `[...a = 1]` is an error that the parser lets pass.
                            if element.default().is_some() {
                                return Err(Refused);
                            }
                            line.token("...")?;
                        }
                        line.pattern(pattern)?;
                        line.default_value(element.default())
                    })
                })?;
                self.byte(b']')
            }
            PatKind::Missing => Err(Refused),
        }
    }

    pub(super) fn pattern_property(&mut self, prop: PatProp<'a>) -> Written {
        if prop.is_rest() {
            self.token("...")?;
            return self.pattern(prop.value());
        }
        // A pattern in a pattern can force a line break.
        if prop.value().tag() != PatTag::Ident {
            return Err(Refused);
        }
        if !prop.is_shorthand() {
            self.key(prop.key())?;
            self.token(": ")?;
        }
        self.source(prop.value().span())?;
        self.default_value(prop.default())
    }

    /// `(a, b: T, c = 1, ...d)`
    pub(super) fn parameters(&mut self, func: Func<'a>) -> Written {
        self.byte(b'(')?;
        self.list(func.params_with_this(), |line, param| {
            line.parameter_without_modifiers(param)
        })?;
        self.byte(b')')
    }

    fn parameter_without_modifiers(&mut self, param: Param<'a>) -> Written {
        // A decorator, or an accessibility modifier, which puts each parameter on a line.
        match param.modifiers().is_empty() {
            true => self.parameter(param),
            false => Err(Refused),
        }
    }

    /// The parameters of `func`, which are too wide for the line.
    pub(super) fn parameters_each_on_a_line(&mut self, func: Func<'a>) -> Written {
        let params = func.params();
        // The only parameter is an object pattern, which breaks in place of the parentheses.
        if let (1, Some(only), None) = (params.len(), params.first(), func.this_param())
            && let PatKind::Object(props) = only.pat().kind()
            && !props.is_empty()
            && should_hug_function_parameters(func, false, self.f)
        {
            if !only.modifiers().is_empty()
                || only.default().is_some()
                || !(only.ty()).is_none_or(|ty| is_type_without_line_breaks(ty, self.f))
            {
                return Err(Refused);
            }
            // Nothing can follow a rest element.
            let has_last_comma =
                self.has_trailing_comma(false) && !props.last().is_some_and(PatProp::is_rest);
            self.token("({")?;
            self.lines(props.len(), props.iter(), has_last_comma, |line, prop| {
                line.pattern_property(prop)
            })?;
            self.byte(b'}')?;
            if only.is_optional() {
                self.byte(b'?')?;
            }
            self.type_annotation(only.ty())?;
            return self.byte(b')');
        }
        if !can_break_between_parameters(func, self.f) {
            return Err(Refused);
        }
        // Nothing can follow a rest parameter.
        let has_last_comma =
            self.has_trailing_comma(true) && !params.last().is_some_and(Param::is_rest);
        let count = params.len() + usize::from(func.this_param().is_some());
        self.byte(b'(')?;
        self.lines(
            count,
            func.params_with_this(),
            has_last_comma,
            |line, param| line.parameter_without_modifiers(param),
        )?;
        self.byte(b')')
    }
}
