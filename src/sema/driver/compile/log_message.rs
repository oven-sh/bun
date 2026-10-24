use crate::format::metadata_of;
use crate::host::to_native;
use crate::{Category, Diagnostic, MAX_SHOWN_LINE};
use std::borrow::Cow;
use std::io::Write;

pub fn log_message(diagnostic: &Diagnostic) -> Option<bun_ast::Msg> {
    let kind = match diagnostic.category {
        Category::Error => bun_ast::Kind::Err,
        Category::Warning => bun_ast::Kind::Warn,
        Category::Suggestion | Category::Message => return None,
    };
    Some(bun_ast::Msg {
        kind,
        data: log_data_of(diagnostic),
        metadata: metadata_of(diagnostic),
        notes: diagnostic.related.iter().map(log_data_of).collect(),
        ..Default::default()
    })
}

fn log_data_of(reported: &Diagnostic) -> bun_ast::Data {
    let mut text = Vec::with_capacity(reported.text.len() + 8);
    if reported.code != 0 {
        let _ = write!(text, "TS{}: ", reported.code);
    }
    text.extend_from_slice(&reported.text);
    let line_text = || {
        let index = reported.line.checked_sub(reported.source_line)?;
        let line = reported.source.get(index as usize)?;
        (line.len() <= MAX_SHOWN_LINE).then(|| Cow::Owned(line.clone()))
    };
    bun_ast::Data {
        text: Cow::Owned(text),
        location: (!reported.path.is_empty()).then(|| bun_ast::Location {
            file: Cow::Owned(to_native(&reported.path).to_vec()),
            line_text: line_text(),
            length: reported.end.saturating_sub(reported.start) as usize,
            offset: reported.start as usize,
            line: reported.line as i32,
            column: reported.column as i32,
            ..Default::default()
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEXT: &str = "Type 'string' is not assignable to type 'number'.";
    const LINE: &str = "const wrong: number = \"\";";

    fn utf8(bytes: &[u8]) -> &str {
        std::str::from_utf8(bytes).unwrap()
    }

    fn type_error(category: Category) -> Diagnostic {
        Diagnostic {
            path: b"/project/main.ts".to_vec(),
            start: 21,
            end: 26,
            line: 2,
            column: 7,
            code: 2322,
            category,
            text: TEXT.into(),
            source: vec![b"let first = 1;".to_vec(), LINE.into()],
            source_line: 1,
            ..crate::global(0, &[""; 0])
        }
    }

    #[test]
    fn kind_follows_category() {
        let kind_of = |category| log_message(&type_error(category)).map(|message| message.kind);
        assert_eq!(kind_of(Category::Error), Some(bun_ast::Kind::Err));
        assert_eq!(kind_of(Category::Warning), Some(bun_ast::Kind::Warn));
        assert_eq!(kind_of(Category::Suggestion), None);
        assert_eq!(kind_of(Category::Message), None);
    }

    #[test]
    fn every_code_but_zero_is_printed() {
        use bun_ast::Metadata;
        let mut reported = type_error(Category::Error);
        let message = log_message(&reported).unwrap();
        assert_eq!(utf8(&message.data.text), format!("TS2322: {TEXT}"));
        let has_code = matches!(message.metadata, Metadata::TypeScript { code: 2322, .. });
        assert!(has_code);
        reported.code = 0;
        let message = log_message(&reported).unwrap();
        assert_eq!(utf8(&message.data.text), TEXT);
        assert!(matches!(message.metadata, Metadata::Build));
    }

    #[test]
    fn location_has_one_source_line() {
        let mut reported = type_error(Category::Error);
        let location = log_message(&reported).unwrap().data.location.unwrap();
        assert_eq!(utf8(&location.file), "/project/main.ts");
        assert_eq!(location.line_text.as_deref().map(utf8), Some(LINE));
        assert_eq!((location.line, location.column), (2, 7));
        assert_eq!((location.offset, location.length), (21, 5));
        reported.path.clear();
        assert!(log_message(&reported).unwrap().data.location.is_none());
    }

    #[test]
    fn overlong_source_line_is_omitted() {
        let line_length = |length: usize| {
            let mut reported = type_error(Category::Error);
            reported.source[1] = vec![b'a'; length];
            let location = log_message(&reported).unwrap().data.location.unwrap();
            location.line_text.map(|line| line.len())
        };
        assert_eq!(line_length(MAX_SHOWN_LINE), Some(MAX_SHOWN_LINE));
        assert_eq!(line_length(MAX_SHOWN_LINE + 1), None);
    }

    #[test]
    fn related_information_becomes_notes() {
        let mut reported = type_error(Category::Error);
        assert!(log_message(&reported).unwrap().notes.is_empty());
        reported.related.push(Diagnostic {
            code: 2728,
            ..type_error(Category::Message)
        });
        let message = log_message(&reported).unwrap();
        assert_eq!(message.notes.len(), 1);
        assert_eq!(utf8(&message.notes[0].text), format!("TS2728: {TEXT}"));
        assert!(message.notes[0].location.is_some());
    }
}
