//! Patterns and parameters.

use super::*;

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
                let Some(first) = props.first() else {
                    return self.token("{}");
                };
                // Like an object, it stays broken if it's written that way.
                if self.has_line_break_in(Span::new(pattern.span().start, first.span().start)) {
                    return Err(Refused);
                }
                self.open_brace()?;
                self.nested(|line| {
                    line.list(props.iter(), |line, prop| {
                        if prop.is_rest() {
                            line.token("...")?;
                            return line.pattern(prop.value());
                        }
                        // A pattern in a pattern can force a line break.
                        if prop.value().tag() != PatTag::Ident {
                            return Err(Refused);
                        }
                        if !prop.is_shorthand() {
                            line.key(prop.key())?;
                            line.token(": ")?;
                        }
                        line.source(prop.value().span())?;
                        line.default_value(prop.default())
                    })
                })?;
                self.close_brace()
            }
            PatKind::Array(elements) => {
                self.byte(b'[')?;
                self.nested(|line| {
                    line.list(elements.iter(), |line, element| {
                        let pattern = element.pat().ok_or(Refused)?;
                        if element.is_rest() {
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

    /// `(a, b: T, c = 1, ...d)`
    pub(super) fn parameters(&mut self, func: Func<'a>) -> Written {
        if func.this_param().is_some() {
            return Err(Refused);
        }
        self.byte(b'(')?;
        self.list(func.params().iter(), |line, param| {
            // A decorator, or an accessibility modifier, which puts each parameter on a line.
            if !param.modifiers().is_empty() {
                return Err(Refused);
            }
            if param.is_rest() {
                line.token("...")?;
            }
            line.pattern(param.pat())?;
            if param.is_optional() {
                line.byte(b'?')?;
            }
            line.type_annotation(param.ty())?;
            line.default_value(param.default())
        })?;
        self.byte(b')')
    }
}
