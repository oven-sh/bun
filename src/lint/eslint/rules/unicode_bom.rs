use bun_lint::prelude::*;

/// Require or disallow Unicode byte order mark (BOM).
pub struct UnicodeBom {
    is_required: bool,
}

const EXPECTED: Message = Message::new("expected", "Expected Unicode BOM (Byte Order Mark).");
const UNEXPECTED: Message = Message::new("unexpected", "Unexpected Unicode BOM (Byte Order Mark).");

const BOM: &str = "\u{FEFF}";

impl Rule for UnicodeBom {
    const META: Meta = Meta::eslint("unicode-bom", Kind::Layout).fixable(Fixable::Whitespace);
    const ON: On = On::new().finish();
    no_state!();

    fn new(options: &Options) -> Self {
        UnicodeBom {
            is_required: options.str(0) == Some("always"),
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        // TODO(api): replace by ast::File::has_bom
        let has_bom = cx.text().starts_with(BOM.as_bytes());
        if !has_bom && self.is_required {
            cx.report_at(0, EXPECTED)
                .fix(|fixer| fixer.insert_before(Span::empty(0), BOM));
        } else if has_bom && !self.is_required {
            cx.report_at(0, UNEXPECTED)
                .fix(|fixer| fixer.remove(Span::new(0, BOM.len() as u32)));
        }
    }
}
