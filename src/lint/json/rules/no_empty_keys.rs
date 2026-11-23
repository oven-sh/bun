use crate::Document;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow empty keys in JSON objects
pub struct NoEmptyKeys;

const EMPTY_KEY: &Message = &Message::new("emptyKey", "Empty key found.");

impl Rule for NoEmptyKeys {
    const META: Meta = Meta::plugin(Plugin::Json, "no-empty-keys", Kind::Problem)
        .recommended()
        .languages(crate::LANGUAGES);
    const ON: On = On::new().finish();
    type State<'a> = Document<'a>;

    fn new(_: &Options) -> Self {
        NoEmptyKeys
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Document<'a>> {
        Document::of(file)
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        for member in cx.state.members() {
            if strings::is_all_js_whitespace(member.key()) {
                cx.report(member.name, EMPTY_KEY).listened_on(member);
            }
        }
    }
}
