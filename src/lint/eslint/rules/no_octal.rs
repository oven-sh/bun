use bun_lint::prelude::*;

/// Disallow octal literals.
pub struct NoOctal;

const NO_OCTAL: Message = Message::new("noOctal", "Octal literals should not be used.");

impl Rule for NoOctal {
    const META: Meta = Meta::eslint("no-octal", Kind::Suggestion).recommended().hints();
    const ON: On = On::new().number_literals();
    no_state!();

    fn new(_: &Options) -> Self {
        NoOctal
    }

    fn number_literal<'a>(&self, literal: Literal<'a>, cx: &mut Cx<'a, Self>) {
        if matches!(literal.text(), [b'0', b'0'..=b'9', ..]) {
            cx.report(literal, NO_OCTAL).hint_with(|| {
                let text = std::str::from_utf8(literal.text()).ok()?;
                Some(match u64::from_str_radix(text, 8) {
                    Ok(value) => {
                        format!("The leading 0 makes it octal, so {text} is {value}. Write 0o{value:o} to make that clear.")
                    }
                    Err(_) => "The leading zero does nothing here. Remove it.".to_owned(),
                })
            });
        }
    }
}
