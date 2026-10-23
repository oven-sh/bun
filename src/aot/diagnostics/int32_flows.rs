use super::{Diagnostics, Int32Flow, Int32FlowValue, ProgramView};
use crate::engine::{Position, UserDiagnosticRecord, position_of};
use crate::ir::generated::{Int32ProofFailure, TypeSiteKind, UserDiagnosticKind};
use crate::link::ProgramNames;

const INT32_RANGE: &str = "an int32 is a whole number from -2147483648 to 2147483647";
const ANY_NUMBER: &str =
    "it is a 'number', which can have a fraction, be out of range, or be NaN or -0";

#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub(super) struct Int32FlowKey {
    display_path: Vec<u8>,
    position: u32,
    site: Option<(u32, TypeSiteKind)>,
}

fn describe_constant(failure: Int32ProofFailure) -> &'static str {
    match failure {
        Int32ProofFailure::NotANumber => "it is NaN",
        Int32ProofFailure::NegativeZero => "it is -0",
        Int32ProofFailure::Fraction => "it has a fraction",
        _ => INT32_RANGE,
    }
}

fn describe_failure(
    record: &UserDiagnosticRecord,
    failure: Int32ProofFailure,
    is_any: bool,
) -> String {
    let text = match failure {
        Int32ProofFailure::OutOfRange => {
            let (minimum, maximum) = (record.minimum as i64, record.maximum as i64);
            return format!("it can be anything from {minimum} to {maximum}");
        }
        Int32ProofFailure::Product => "a product can be too large to be exact, and it can be -0",
        Int32ProofFailure::Quotient => "a division can produce a fraction",
        Int32ProofFailure::NegatedZero => "the negative of 0 is -0, which is not an int32",
        Int32ProofFailure::Remainder => "a remainder can be -0 or NaN",
        Int32ProofFailure::Power => "a power can be out of range or have a fraction",
        Int32ProofFailure::WorkLimit => "the expression is too large to check",
        _ => match is_any {
            true => "its type is 'any'",
            false => ANY_NUMBER,
        },
    };
    text.to_owned()
}

fn write_message(record: &UserDiagnosticRecord, flow: &Int32Flow) -> Vec<u8> {
    let failure = Int32ProofFailure::from_wire(record.count).unwrap_or(Int32ProofFailure::Unknown);
    let mut message = flow.subject.clone();
    message.extend_from_slice(b" is declared 'int32', but ");
    match &flow.value {
        Int32FlowValue::Expression { text, .. }
            if record.kind == UserDiagnosticKind::ConstantNotInt32 =>
        {
            let parts: [&[u8]; 5] = [
                b"'",
                text,
                b"' is not an int32: ",
                describe_constant(failure).as_bytes(),
                b".",
            ];
            message.extend(parts.concat());
        }
        Int32FlowValue::Expression {
            text,
            advice,
            is_any,
            ..
        } => {
            let reason = describe_failure(record, failure, *is_any);
            let parts: [&[u8]; 7] = [
                b"'",
                text,
                b"' might not be an int32: ",
                reason.as_bytes(),
                b". Write '",
                advice,
                b"'.",
            ];
            message.extend(parts.concat());
        }
        Int32FlowValue::PatternTarget(target) => {
            let parts: [&[u8]; 3] = [
                b"the value assigned to '",
                target,
                b"' might not be an int32: a value assigned by destructuring, or by a 'for...of' or 'for...in' loop, cannot be checked. Assign it to a 'number' variable first, then convert that with '| 0'.",
            ];
            message.extend(parts.concat());
        }
        Int32FlowValue::SpreadArgument => message.extend_from_slice(
            b"the value passed by this spread might not be an int32: the elements of a spread argument cannot be checked. Pass it as a separate argument.",
        ),
    }
    message
}

fn write_message_without_flow(record: &UserDiagnosticRecord) -> Vec<u8> {
    let failure = Int32ProofFailure::from_wire(record.count).unwrap_or(Int32ProofFailure::Unknown);
    let message = if record.kind == UserDiagnosticKind::ConstantNotInt32 {
        let reason = describe_constant(failure);
        format!("The value is declared 'int32', but it is not an int32: {reason}.")
    } else {
        let reason = describe_failure(record, failure, false);
        format!("The value is declared 'int32', but it might not be an int32: {reason}.")
    };
    message.into_bytes()
}

impl Diagnostics {
    pub(super) fn add_int32_flow(&mut self, view: ProgramView<'_, '_>, flow: Int32Flow) {
        let key = Int32FlowKey {
            display_path: view.sources.module_paths(flow.file).display_path.to_vec(),
            position: flow.position,
            site: flow.site,
        };
        self.int32_flows.insert(key, flow);
    }

    /// The message, and where it points: at the expression that flows, where there is one, in place of the statement around it.
    pub(super) fn write_int32_message(
        &self,
        record: &UserDiagnosticRecord,
        names: &ProgramNames,
    ) -> Option<(Vec<u8>, Option<Position>)> {
        let is_about_flow = matches!(
            record.kind,
            UserDiagnosticKind::UnprovenInt32 | UserDiagnosticKind::ConstantNotInt32
        );
        if !is_about_flow {
            return None;
        }
        let flow = position_of(record.location).and_then(|position| {
            self.int32_flows.get(&Int32FlowKey {
                display_path: names.module_path(position.module).to_vec(),
                position: position.offset,
                site: position_of(record.origin).map(|origin| (origin.offset, record.site_kind)),
            })
        });
        let shown = match (position_of(record.location), flow.map(|flow| &flow.value)) {
            (Some(position), Some(&Int32FlowValue::Expression { start, .. })) => Some(Position {
                offset: start,
                ..position
            }),
            (position, _) => position,
        };
        let message = match flow {
            Some(flow) => write_message(record, flow),
            None => write_message_without_flow(record),
        };
        Some((message, shown))
    }
}

#[cfg(test)]
mod tests {
    use bstr::BStr;
    use bun_sema::program::FileId;

    use super::*;
    use crate::engine::{SourceLocation, TextRange};
    use crate::ir::generated::LimitId;
    use crate::ir::ids::ABSENT_WORD;

    fn record(kind: UserDiagnosticKind, failure: Int32ProofFailure) -> UserDiagnosticRecord {
        let location = SourceLocation {
            module: 0,
            position: 4,
        };
        UserDiagnosticRecord {
            kind,
            function: ABSENT_WORD,
            block: ABSENT_WORD,
            value: ABSENT_WORD,
            layout: ABSENT_WORD,
            limit: LimitId::None,
            count: failure as u32,
            location,
            message: TextRange {
                offset: 0,
                length: 0,
            },
            origin: location,
            site_kind: TypeSiteKind::Variable,
            minimum: -4294967296.0,
            maximum: 4294967294.0,
        }
    }

    fn flow(value: Int32FlowValue) -> Int32Flow {
        Int32Flow {
            file: FileId(0),
            position: 4,
            site: Some((4, TypeSiteKind::Variable)),
            subject: b"'kept'".to_vec(),
            value,
        }
    }

    fn expression(is_any: bool) -> Int32FlowValue {
        Int32FlowValue::Expression {
            start: 11,
            text: b"a + b".to_vec(),
            advice: b"(a + b) | 0".to_vec(),
            is_any,
        }
    }

    fn unproven(failure: Int32ProofFailure, value: Int32FlowValue) -> String {
        let record = record(UserDiagnosticKind::UnprovenInt32, failure);
        BStr::new(&write_message(&record, &flow(value))).to_string()
    }

    fn constant(failure: Int32ProofFailure) -> String {
        let record = record(UserDiagnosticKind::ConstantNotInt32, failure);
        BStr::new(&write_message(&record, &flow(expression(false)))).to_string()
    }

    #[test]
    fn range_is_printed_in_whole_numbers() {
        assert_eq!(
            unproven(Int32ProofFailure::OutOfRange, expression(false)),
            "'kept' is declared 'int32', but 'a + b' might not be an int32: it can be anything from -4294967296 to 4294967294. Write '(a + b) | 0'."
        );
    }

    #[test]
    fn untyped_value_is_any_only_where_checker_says_so() {
        let expected_number = unproven(Int32ProofFailure::AnyNumber, expression(true));
        assert!(
            expected_number.contains("might not be an int32: its type is 'any'. Write"),
            "{expected_number}"
        );
        let any = unproven(Int32ProofFailure::Untyped, expression(true));
        assert!(
            any.contains("might not be an int32: its type is 'any'. Write"),
            "{any}"
        );
        let unknown = unproven(Int32ProofFailure::Untyped, expression(false));
        assert!(
            unknown.contains("might not be an int32: it is a 'number', which"),
            "{unknown}"
        );
    }

    #[test]
    fn each_operator_has_its_reason() {
        let reasons = [
            (
                Int32ProofFailure::Product,
                "a product can be too large to be exact, and it can be -0",
            ),
            (
                Int32ProofFailure::Quotient,
                "a division can produce a fraction",
            ),
            (
                Int32ProofFailure::NegatedZero,
                "the negative of 0 is -0, which is not an int32",
            ),
            (Int32ProofFailure::Remainder, "a remainder can be -0 or NaN"),
            (
                Int32ProofFailure::Power,
                "a power can be out of range or have a fraction",
            ),
            (
                Int32ProofFailure::WorkLimit,
                "the expression is too large to check",
            ),
        ];
        for (failure, reason) in reasons {
            let message = unproven(failure, expression(false));
            assert!(
                message.contains(&format!("int32: {reason}. Write '")),
                "{message}"
            );
        }
    }

    #[test]
    fn constant_says_what_it_is() {
        assert_eq!(
            constant(Int32ProofFailure::Fraction),
            "'kept' is declared 'int32', but 'a + b' is not an int32: it has a fraction."
        );
        assert!(constant(Int32ProofFailure::NotANumber).ends_with(": it is NaN."));
        assert!(constant(Int32ProofFailure::NegativeZero).ends_with(": it is -0."));
        assert!(
            constant(Int32ProofFailure::OutOfRange)
                .ends_with(": an int32 is a whole number from -2147483648 to 2147483647.")
        );
    }

    #[test]
    fn flow_that_was_not_described_keeps_its_reason() {
        let unproven = record(
            UserDiagnosticKind::UnprovenInt32,
            Int32ProofFailure::Quotient,
        );
        assert_eq!(
            BStr::new(&write_message_without_flow(&unproven)).to_string(),
            "The value is declared 'int32', but it might not be an int32: a division can produce a fraction."
        );
        let constant = record(
            UserDiagnosticKind::ConstantNotInt32,
            Int32ProofFailure::NotANumber,
        );
        assert_eq!(
            BStr::new(&write_message_without_flow(&constant)).to_string(),
            "The value is declared 'int32', but it is not an int32: it is NaN."
        );
    }

    #[test]
    fn value_without_expression_is_described() {
        let target = Int32FlowValue::PatternTarget(b"kept".to_vec());
        assert_eq!(
            unproven(Int32ProofFailure::AnyNumber, target),
            "'kept' is declared 'int32', but the value assigned to 'kept' might not be an int32: a value assigned by destructuring, or by a 'for...of' or 'for...in' loop, cannot be checked. Assign it to a 'number' variable first, then convert that with '| 0'."
        );
        assert_eq!(
            unproven(Int32ProofFailure::AnyNumber, Int32FlowValue::SpreadArgument),
            "'kept' is declared 'int32', but the value passed by this spread might not be an int32: the elements of a spread argument cannot be checked. Pass it as a separate argument."
        );
    }
}
