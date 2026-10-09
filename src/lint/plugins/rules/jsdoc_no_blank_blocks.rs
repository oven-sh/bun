use crate::oxlint::jsdoc::JSDocFinder;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Reports and optionally removes blocks with whitespace only.
pub struct NoBlankBlocks {
    enable_fixer: bool,
}

const NO_BLANK_BLOCKS: Message = Message::new("", "No empty blocks");

impl Rule for NoBlankBlocks {
    const META: Meta = Meta::oxlint(Plugin::Jsdoc, "no-blank-blocks", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = JSDocFinder<'a>;

    fn new(options: &Options) -> Self {
        NoBlankBlocks { enable_fixer: options.object(0).bool_or("enableFixer", false) }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> JSDocFinder<'a> {
        let finder = JSDocFinder::new(file);
        if !finder.is_empty() {
            on.finish(|rule, cx| {
                let file = cx.file();
                for jsdoc_span in cx.state.iter_all().map(|it| it.span()).filter(|it| is_blank_jsdoc(file.slice(*it))) {
                    let report = cx.report(jsdoc_span, NO_BLANK_BLOCKS);
                    if rule.enable_fixer {
                        report.fix(|fixer| fix_span(jsdoc_span, file.text()).map(|span| fixer.remove(span)));
                    }
                }
            });
        }
        finder
    }
}

fn is_blank_jsdoc(content: &[u8]) -> bool {
    strings::split(content, b"\n").enumerate().all(|(index, line)| match strings::trim_unicode_whitespace(line) {
        [] => true,
        [b'*'] => index > 0,
        _ => false,
    })
}

/// The lines of the comment, if there is nothing else on them.
fn fix_span(jsdoc_span: Span, source_text: &[u8]) -> Option<Span> {
    let is_blank = |byte: &&u8| matches!(byte, b' ' | b'\t');
    let comment_span = Span::new(jsdoc_span.start.checked_sub(3)?, jsdoc_span.end + 2);
    let prefix = source_text.get(..comment_span.start as usize)?;
    let line_start = prefix.len() - prefix.iter().rev().take_while(is_blank).count();
    let suffix = source_text.get(comment_span.end as usize..)?;
    let line_end = suffix.iter().take_while(is_blank).count();
    if !matches!(prefix.get(..line_start)?.last(), None | Some(b'\n')) || !matches!(suffix.get(line_end), None | Some(b'\r' | b'\n')) {
        return None;
    }
    let line_ending_len = if suffix.get(line_end..)?.starts_with(b"\r\n") { 2 } else { usize::from(line_end < suffix.len()) };
    Some(Span::new(line_start as u32, comment_span.end + (line_end + line_ending_len) as u32))
}
