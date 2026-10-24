use crate::ir::generated::ProgramList;
use crate::ir::sections::{ListCounts, SectionWriter, WireSpan};

const FIRST_STRING: u64 = 7;
const FIRST_BYTE: u64 = 100;
const WORDS_PER_STRING: usize = ProgramList::Strings.element_size() / 4;

fn create_writer<'a>() -> SectionWriter<'a> {
    let mut first_indices: ListCounts = [0; ProgramList::COUNT];
    first_indices[ProgramList::Strings as usize] = FIRST_STRING;
    first_indices[ProgramList::Bytes as usize] = FIRST_BYTE;
    SectionWriter::new(first_indices)
}

fn string_records(count: usize) -> Vec<u32> {
    (0..(count * WORDS_PER_STRING) as u32).collect()
}

#[test]
fn next_index_starts_at_first_index() {
    let writer = create_writer();
    assert_eq!(writer.next_index(ProgramList::Strings), FIRST_STRING as u32);
    assert_eq!(writer.next_index(ProgramList::Bytes), FIRST_BYTE as u32);
    assert_eq!(writer.next_index(ProgramList::Words), 0);
    for list in ProgramList::ALL {
        assert_eq!(writer.count_of(list), 0);
        assert!(writer.words_of(list).is_empty());
    }
    assert!(writer.blobs().is_empty());
}

#[test]
fn push_records_returns_span_and_advances_by_count() {
    let mut writer = create_writer();
    let first = writer.push_records(ProgramList::Strings, &string_records(2), 2);
    let first_span = WireSpan {
        first: FIRST_STRING as u32,
        count: 2,
    };
    assert_eq!(first, first_span);
    assert_eq!(
        writer.next_index(ProgramList::Strings),
        FIRST_STRING as u32 + 2
    );
    assert_eq!(writer.count_of(ProgramList::Strings), 2);

    let second = writer.push_records(ProgramList::Strings, &string_records(1), 1);
    let second_span = WireSpan {
        first: FIRST_STRING as u32 + 2,
        count: 1,
    };
    assert_eq!(second, second_span);
    assert_eq!(writer.count_of(ProgramList::Strings), 3);
    let words = [string_records(2), string_records(1)].concat();
    assert_eq!(writer.words_of(ProgramList::Strings), words);
}

#[test]
fn empty_span_starts_at_next_index() {
    let mut writer = create_writer();
    let span = writer.push_records(ProgramList::Strings, &[], 0);
    let expected = WireSpan {
        first: FIRST_STRING as u32,
        count: 0,
    };
    assert_eq!(span, expected);
    assert_eq!(writer.next_index(ProgramList::Strings), FIRST_STRING as u32);
}

#[test]
fn lists_do_not_disturb_each_other() {
    let mut writer = create_writer();
    writer.push_records(ProgramList::Words, &[11, 12, 13], 3);
    writer.push_records(ProgramList::Strings, &string_records(1), 1);
    writer.push_records(ProgramList::Words, &[14], 1);
    assert_eq!(writer.words_of(ProgramList::Words), [11, 12, 13, 14]);
    assert_eq!(writer.words_of(ProgramList::Strings), string_records(1));
    assert_eq!(writer.next_index(ProgramList::Words), 4);
    assert_eq!(
        writer.next_index(ProgramList::Strings),
        FIRST_STRING as u32 + 1
    );
    assert_eq!(writer.count_of(ProgramList::Code), 0);
    assert_eq!(writer.next_index(ProgramList::Bytes), FIRST_BYTE as u32);
}

#[test]
fn push_bytes_borrows_and_counts_bytes() {
    let (first, second) = (b"first".to_vec(), b"second text".to_vec());
    let mut writer = create_writer();
    let first_span = writer.push_bytes(&first);
    let empty_span = writer.push_bytes(&[]);
    let second_span = writer.push_bytes(&second);
    let span = |first: usize, count: usize| WireSpan {
        first: FIRST_BYTE as u32 + first as u32,
        count: count as u32,
    };
    assert_eq!(first_span, span(0, first.len()));
    assert_eq!(empty_span, span(first.len(), 0));
    assert_eq!(second_span, span(first.len(), second.len()));
    assert_eq!(
        writer.count_of(ProgramList::Bytes),
        (first.len() + second.len()) as u64
    );
    assert!(writer.words_of(ProgramList::Bytes).is_empty());

    let blobs = writer.blobs();
    assert_eq!(blobs, [&first[..], &[], &second[..]]);
    assert!(core::ptr::eq(blobs[0], &first[..]));
    assert!(core::ptr::eq(blobs[2], &second[..]));
}

#[test]
fn reserve_adds_no_record() {
    let mut writer = create_writer();
    writer.reserve(ProgramList::Code, 64);
    assert_eq!(writer.count_of(ProgramList::Code), 0);
    assert!(writer.words_of(ProgramList::Code).is_empty());
    assert_eq!(writer.next_index(ProgramList::Code), 0);
}

#[cfg(debug_assertions)]
mod debug_assertions {
    use super::*;

    #[test]
    #[should_panic(expected = "left == right")]
    fn missing_record_word_panics() {
        let words = string_records(1);
        create_writer().push_records(ProgramList::Strings, &words[1..], 1);
    }

    #[test]
    #[should_panic(expected = "left == right")]
    fn count_above_pushed_records_panics() {
        create_writer().push_records(ProgramList::Strings, &string_records(1), 2);
    }

    #[test]
    #[should_panic(expected = "list != ProgramList::Bytes")]
    fn pushing_records_to_bytes_panics() {
        create_writer().push_records(ProgramList::Bytes, &[], 0);
    }
}
