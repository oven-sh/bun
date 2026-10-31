use bun_ast::{Log, Msg};
use bun_options_types::aot_options::ExplainSet;

const LINE_LABEL: &[u8] = b"aot: ";

pub struct ReportMessage {
    pub kind: ExplainSet,
    pub message: Msg,
}

pub fn is_json_report(kind: ExplainSet) -> bool {
    kind.intersects(ExplainSet::JSON | ExplainSet::CHECKS_JSON)
}

pub fn is_message_report(kind: ExplainSet) -> bool {
    kind.intersects(ExplainSet::TEXT | ExplainSet::CHECKS)
}

pub(super) fn has_line_label(kind: ExplainSet) -> bool {
    kind.intersects(
        ExplainSet::RUNTIME_USE
            | ExplainSet::DECLINES
            | ExplainSet::ALLOCATIONS
            | ExplainSet::ONLY_UNKNOWN_CODE
            | ExplainSet::ONLY_UNPROVEN_TYPE
            | ExplainSet::ONLY_MUTATION
            | ExplainSet::ONLY_LIMIT,
    )
}

pub fn write_lines<'m>(
    messages: impl IntoIterator<Item = &'m ReportMessage>,
    is_json: bool,
    out: &mut Vec<u8>,
) {
    for ReportMessage { kind, message } in messages {
        if is_message_report(*kind) || is_json_report(*kind) != is_json {
            continue;
        }
        if has_line_label(*kind) {
            out.extend_from_slice(LINE_LABEL);
        }
        out.extend_from_slice(&message.data.text);
        out.push(b'\n');
    }
}

pub fn add_messages_to_log(messages: impl IntoIterator<Item = ReportMessage>, log: &mut Log) {
    for ReportMessage { kind, message } in messages {
        if is_message_report(kind) {
            log.add_msg(message);
        }
    }
}
