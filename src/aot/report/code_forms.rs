use core::cmp::Reverse;

use bun_options_types::aot_options::ExplainSet;
use bun_sema::util::SharedSort;

use super::format::{write_count, write_counted, write_parts};
use super::wording::form_label;
use super::{ReportEntry, ReportInput};
use crate::engine::FormBytesRecord;
use crate::ir::generated::CodeForm;

#[derive(Copy, Clone, Default)]
struct CodeSize {
    sites: u64,
    bytes: u64,
}

impl CodeSize {
    fn of(record: &FormBytesRecord) -> CodeSize {
        CodeSize {
            sites: u64::from(record.count),
            bytes: record.bytes,
        }
    }

    fn add(&mut self, other: CodeSize) {
        self.sites += other.sites;
        self.bytes += other.bytes;
    }
}

fn form_entry(operation: &[u8], form: CodeForm, size: CodeSize) -> ReportEntry {
    let mut line = Vec::new();
    let label = form_label(form).as_bytes();
    write_parts(&mut line, &[b"forms: ", operation, b" ", label, b": "]);
    write_counted(&mut line, size.sites, "site", "sites");
    line.extend_from_slice(b", ");
    write_counted(&mut line, size.bytes, "byte", "bytes");
    if size.sites > 0 {
        line.extend_from_slice(b", ");
        write_count(&mut line, size.bytes / size.sites);
        line.extend_from_slice(b" a site");
    }
    ReportEntry::line(ExplainSet::FORMS, line)
}

fn sizes_by_form(records: &[FormBytesRecord]) -> [CodeSize; CodeForm::COUNT] {
    let mut sizes = [CodeSize::default(); CodeForm::COUNT];
    for record in records {
        sizes[record.form as usize].add(CodeSize::of(record));
    }
    sizes
}

pub(super) fn collect(input: &ReportInput<'_>, out: &mut Vec<ReportEntry>) {
    let engine = input.engine;
    let records = engine.bytes_by_form();
    if records.is_empty() {
        let text = b"forms: none".to_vec();
        out.push(ReportEntry::line(ExplainSet::FORMS, text));
        return;
    }

    let mut largest_first: Vec<&FormBytesRecord> = records.iter().collect();
    largest_first.shared_sort_by_key(|record| {
        let operation = engine.text(record.operation);
        (Reverse(record.bytes), operation, record.form)
    });
    for record in largest_first {
        let operation = engine.text(record.operation);
        out.push(form_entry(operation, record.form, CodeSize::of(record)));
    }
    for (form, total) in CodeForm::ALL.into_iter().zip(sizes_by_form(records)) {
        out.push(form_entry(b"total", form, total));
    }
}

#[cfg(test)]
mod tests {
    use bstr::BString;

    use super::*;
    use crate::engine::testing::ResultRecords;
    use crate::engine::TextRange;
    use crate::report::testing::ReportFixture;

    const TEXT: &[u8] = b"CallGetSlotPutSlot";
    const CALL: TextRange = range(0, 4);
    const GET_SLOT: TextRange = range(4, 7);
    const PUT_SLOT: TextRange = range(11, 7);

    const fn range(offset: u32, length: u32) -> TextRange {
        TextRange { offset, length }
    }

    fn record(operation: TextRange, form: CodeForm, count: u32, bytes: u64) -> FormBytesRecord {
        FormBytesRecord {
            operation,
            form,
            count,
            bytes,
        }
    }

    fn lines(records: &[FormBytesRecord]) -> Vec<BString> {
        let records = ResultRecords {
            text: TEXT,
            bytes_by_form: records,
            ..ResultRecords::default()
        };
        let mut entries = Vec::new();
        ReportFixture::new(records).with_input(|input| collect(input, &mut entries));
        entries
            .into_iter()
            .map(|entry| {
                assert_eq!(entry.kind, ExplainSet::FORMS);
                assert_eq!(entry.position, None);
                assert!(entry.notes.is_empty());
                BString::from(entry.text)
            })
            .collect()
    }

    fn operation_lines(records: &[FormBytesRecord]) -> Vec<BString> {
        let mut lines = lines(records);
        lines.truncate(records.len());
        lines
    }

    fn total_lines(records: &[FormBytesRecord]) -> Vec<BString> {
        lines(records).split_off(records.len())
    }

    #[test]
    fn most_bytes_come_first() {
        let records = [
            record(CALL, CodeForm::Closed, 3, 30),
            record(GET_SLOT, CodeForm::Open, 1204, 72_240),
            record(GET_SLOT, CodeForm::Generic, 2, 20),
            record(PUT_SLOT, CodeForm::Open, 5, 300),
        ];
        assert_eq!(
            operation_lines(&records),
            [
                "forms: GetSlot open: 1,204 sites, 72,240 bytes, 60 a site",
                "forms: PutSlot open: 5 sites, 300 bytes, 60 a site",
                "forms: Call closed: 3 sites, 30 bytes, 10 a site",
                "forms: GetSlot generic: 2 sites, 20 bytes, 10 a site",
            ]
        );
    }

    #[test]
    fn equal_bytes_are_ordered_by_operation_then_form() {
        let records = [
            record(PUT_SLOT, CodeForm::Open, 1, 40),
            record(GET_SLOT, CodeForm::Generic, 2, 40),
            record(GET_SLOT, CodeForm::Closed, 3, 40),
            record(GET_SLOT, CodeForm::Open, 4, 40),
            record(CALL, CodeForm::Generic, 5, 40),
        ];
        assert_eq!(
            operation_lines(&records),
            [
                "forms: Call generic: 5 sites, 40 bytes, 8 a site",
                "forms: GetSlot open: 4 sites, 40 bytes, 10 a site",
                "forms: GetSlot closed: 3 sites, 40 bytes, 13 a site",
                "forms: GetSlot generic: 2 sites, 40 bytes, 20 a site",
                "forms: PutSlot open: 1 site, 40 bytes, 40 a site",
            ]
        );
    }

    #[test]
    fn each_form_has_its_total() {
        let records = [
            record(CALL, CodeForm::Closed, 3, 30),
            record(GET_SLOT, CodeForm::Open, 1204, 72_240),
            record(PUT_SLOT, CodeForm::Open, 5, 300),
            record(PUT_SLOT, CodeForm::Closed, 4, 40),
        ];
        assert_eq!(
            total_lines(&records),
            [
                "forms: total open: 1,209 sites, 72,540 bytes, 60 a site",
                "forms: total closed: 7 sites, 70 bytes, 10 a site",
                "forms: total generic: 0 sites, 0 bytes",
            ]
        );
    }

    #[test]
    fn totals_exceed_32_bits() {
        let records = [
            record(CALL, CodeForm::Generic, u32::MAX, 1 << 32),
            record(GET_SLOT, CodeForm::Generic, u32::MAX, 1 << 32),
        ];
        assert_eq!(
            total_lines(&records)[CodeForm::Generic as usize],
            "forms: total generic: 8,589,934,590 sites, 8,589,934,592 bytes, 1 a site"
        );
    }

    #[test]
    fn empty_section_is_one_line() {
        assert_eq!(lines(&[]), ["forms: none"]);
    }
}
