use crate::{Document, NodeKind};
use bun_core::strings::{self, NormalizationForm};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use std::borrow::Cow;

/// Disallow JSON keys that are not normalized
pub struct NoUnnormalizedKeys {
    form: NormalizationForm,
}

const UNNORMALIZED_KEY: &Message =
    &Message::new("unnormalizedKey", "Unnormalized key '{{key}}' found.");

impl Rule for NoUnnormalizedKeys {
    const META: Meta = Meta::plugin(Plugin::Json, "no-unnormalized-keys", Kind::Problem)
        .fixable(Fixable::Code)
        .recommended()
        .languages(crate::LANGUAGES);
    const ON: On = On::new().finish();
    type State<'a> = Document<'a>;

    fn new(options: &Options) -> Self {
        NoUnnormalizedKeys {
            form: match options.object(0).str("form") {
                Some("NFD") => NormalizationForm::Nfd,
                Some("NFKC") => NormalizationForm::Nfkc,
                Some("NFKD") => NormalizationForm::Nfkd,
                _ => NormalizationForm::Nfc,
            },
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Document<'a>> {
        Document::of(file)
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        for member in cx.state.members() {
            let (key, raw_key) = (member.key(), member.raw_key());
            let Cow::Owned(normalized) = strings::normalize(key, self.form) else {
                continue;
            };
            cx.report(member.name, UNNORMALIZED_KEY)
                .data("key", raw_key)
                .listened_on(member)
                .fix(|fixer| {
                    // No fix for a key that's written with escape sequences.
                    if key != raw_key {
                        return None;
                    }
                    let name = member.name.span();
                    if member.name.kind() != NodeKind::String {
                        return Some(fixer.replace(name, normalized));
                    }
                    let quote = member.name.text().get(..1).unwrap_or_default();
                    let escaped = strings::replace_owned(&normalized, b"\\", b"\\\\");
                    let escaped = strings::replace_owned(&escaped, quote, &[b"\\", quote].concat());
                    Some(fixer.replace(name.shrink(1, 1), escaped))
                });
        }
    }
}
