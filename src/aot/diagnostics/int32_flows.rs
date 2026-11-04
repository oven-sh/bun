use super::{Int32Flow, Int32FlowValue};
use crate::engine::UserDiagnosticRecord;
use crate::ir::generated::{Int32ProofFailure, UserDiagnosticKind};

const INT32_RANGE: &str = "an int32 is a whole number from -2147483648 to 2147483647";
const ANY_NUMBER: &str =
    "it is a 'number', which can have a fraction, be out of range, or be NaN or -0";
const ADVICE: &str = " Write '| 0' to make it one.";
const NO_NUMBER: &str = "it is not a number";
const ADVICE_AT_SPREAD: &str =
    " If it is a spread argument, pass its elements as separate arguments.";

fn bounds_of(record: &UserDiagnosticRecord) -> (i64, i64) {
    (record.minimum as i64, record.maximum as i64)
}

// `| 0` turns a number that is out of range into another number, so a constant is never told to write it.
fn is_constant(record: &UserDiagnosticRecord, failure: Int32ProofFailure) -> bool {
    let (minimum, maximum) = bounds_of(record);
    record.kind == UserDiagnosticKind::ConstantNotInt32
        || (failure == Int32ProofFailure::OutOfRange && minimum == maximum)
}

fn describe_constant(failure: Int32ProofFailure) -> &'static str {
    match failure {
        Int32ProofFailure::NotANumber => "it is NaN",
        Int32ProofFailure::NegativeZero => "it is -0",
        Int32ProofFailure::Fraction => "it has a fraction",
        Int32ProofFailure::Unknown
        | Int32ProofFailure::OutOfRange
        | Int32ProofFailure::AnyNumber
        | Int32ProofFailure::Untyped
        | Int32ProofFailure::Product
        | Int32ProofFailure::Quotient
        | Int32ProofFailure::NegatedZero
        | Int32ProofFailure::Remainder
        | Int32ProofFailure::Power
        | Int32ProofFailure::WorkLimit => INT32_RANGE,
    }
}

fn describe_failure(record: &UserDiagnosticRecord, failure: Int32ProofFailure) -> String {
    let text = match failure {
        Int32ProofFailure::OutOfRange => {
            let (minimum, maximum) = bounds_of(record);
            return format!("it can be anything from {minimum} to {maximum}");
        }
        Int32ProofFailure::Product => "a product can be too large to be exact, and it can be -0",
        Int32ProofFailure::Quotient => "a division can produce a fraction",
        Int32ProofFailure::NegatedZero => "the negative of 0 is -0, which is not an int32",
        Int32ProofFailure::Remainder => "a remainder can be -0 or NaN",
        Int32ProofFailure::Power => "a power can be out of range or have a fraction",
        Int32ProofFailure::Unknown => NO_NUMBER,
        Int32ProofFailure::AnyNumber
        | Int32ProofFailure::Untyped
        | Int32ProofFailure::NotANumber
        | Int32ProofFailure::NegativeZero
        | Int32ProofFailure::Fraction
        | Int32ProofFailure::WorkLimit => ANY_NUMBER,
    };
    text.to_owned()
}

// The list of a spread argument arrives in place of its elements, and `...list | 0` is nothing to write.
fn advice_for(failure: Int32ProofFailure) -> &'static str {
    if failure == Int32ProofFailure::Unknown {
        ADVICE_AT_SPREAD
    } else {
        ADVICE
    }
}

fn failure_of(record: &UserDiagnosticRecord) -> Int32ProofFailure {
    Int32ProofFailure::from_wire(record.count).unwrap_or(Int32ProofFailure::AnyNumber)
}

fn write_message_without_flow(record: &UserDiagnosticRecord) -> Vec<u8> {
    let failure = failure_of(record);
    let message = if is_constant(record, failure) {
        let reason = describe_constant(failure);
        format!("The value is declared 'int32', but it is not an int32: {reason}.")
    } else {
        let reason = describe_failure(record, failure);
        let advice = advice_for(failure);
        format!("The value is declared 'int32', but it might not be an int32: {reason}.{advice}")
    };
    message.into_bytes()
}

fn is_untyped(failure: Int32ProofFailure) -> bool {
    matches!(
        failure,
        Int32ProofFailure::AnyNumber | Int32ProofFailure::Untyped
    )
}

fn write_message(record: &UserDiagnosticRecord, flow: &Int32Flow) -> Vec<u8> {
    let failure = failure_of(record);
    let mut message = flow.subject.clone();
    message.extend_from_slice(b" is declared 'int32', but ");
    match &flow.value {
        Int32FlowValue::Expression { text, .. } if is_constant(record, failure) => {
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
            let reason = match *is_any && is_untyped(failure) {
                true => "its type is 'any'".to_owned(),
                false => describe_failure(record, failure),
            };
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

/// The message, and the offset at which it points in place of the conversion's: at the expression that flows, where there is one, and not at the statement around it.
pub(super) fn write_int32_message(
    record: &UserDiagnosticRecord,
    flow: Option<&Int32Flow>,
) -> Option<(Vec<u8>, Option<u32>)> {
    let is_int32_error = matches!(
        record.kind,
        UserDiagnosticKind::UnprovenInt32 | UserDiagnosticKind::ConstantNotInt32
    );
    if !is_int32_error {
        return None;
    }
    let shown = match flow.map(|flow| &flow.value) {
        Some(&Int32FlowValue::Expression { start, .. }) => Some(start),
        Some(Int32FlowValue::PatternTarget(_) | Int32FlowValue::SpreadArgument) | None => None,
    };
    let message = match flow {
        Some(flow) => write_message(record, flow),
        None => write_message_without_flow(record),
    };
    Some((message, shown))
}

#[cfg(test)]
mod tests {
    use bstr::BStr;
    use bun_sema::program::FileId;

    use super::*;
    use crate::engine::{SourceLocation, TextRange};
    use crate::ir::generated::{LimitId, TypeSiteKind};
    use crate::ir::ids::ABSENT_WORD;

    fn record(kind: UserDiagnosticKind, failure: Int32ProofFailure) -> UserDiagnosticRecord {
        UserDiagnosticRecord {
            kind,
            function: ABSENT_WORD,
            block: ABSENT_WORD,
            value: ABSENT_WORD,
            layout: ABSENT_WORD,
            limit: LimitId::None,
            count: failure.to_wire(),
            location: SourceLocation {
                module: 0,
                position: 4,
            },
            message: TextRange {
                offset: 0,
                length: 0,
            },
            origin: SourceLocation {
                module: ABSENT_WORD,
                position: 0,
            },
            site_kind: TypeSiteKind::Unknown,
            minimum: -4294967296.0,
            maximum: 4294967294.0,
        }
    }

    fn message_of(record: &UserDiagnosticRecord) -> String {
        let (written, shown) = write_int32_message(record, None).expect("an error about an int32");
        assert_eq!(shown, None);
        BStr::new(&written).to_string()
    }

    fn flow(value: Int32FlowValue) -> Int32Flow {
        Int32Flow {
            file: FileId(0),
            position: 4,
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

    fn described(
        kind: UserDiagnosticKind,
        failure: Int32ProofFailure,
        value: Int32FlowValue,
    ) -> (String, Option<u32>) {
        let (written, shown) = write_int32_message(&record(kind, failure), Some(&flow(value)))
            .expect("an error about an int32");
        (BStr::new(&written).to_string(), shown)
    }

    #[test]
    fn described_flow_names_the_position_quotes_the_expression_and_says_what_to_write() {
        let kind = UserDiagnosticKind::UnprovenInt32;
        assert_eq!(
            described(kind, Int32ProofFailure::OutOfRange, expression(false)),
            (
                "'kept' is declared 'int32', but 'a + b' might not be an int32: it can be anything from -4294967296 to 4294967294. Write '(a + b) | 0'.".to_owned(),
                Some(11)
            )
        );
        let (any, _) = described(kind, Int32ProofFailure::Untyped, expression(true));
        assert!(
            any.contains("might not be an int32: its type is 'any'. Write"),
            "{any}"
        );
        let (unknown, _) = described(kind, Int32ProofFailure::Untyped, expression(false));
        assert!(
            unknown.contains("might not be an int32: it is a 'number', which"),
            "{unknown}"
        );
    }

    #[test]
    fn described_constant_is_not_told_what_to_write() {
        let kind = UserDiagnosticKind::ConstantNotInt32;
        let (message, _) = described(kind, Int32ProofFailure::Fraction, expression(false));
        assert_eq!(
            message,
            "'kept' is declared 'int32', but 'a + b' is not an int32: it has a fraction."
        );
    }

    #[test]
    fn value_without_expression_is_described() {
        let kind = UserDiagnosticKind::UnprovenInt32;
        let target = Int32FlowValue::PatternTarget(b"kept".to_vec());
        assert_eq!(
            described(kind, Int32ProofFailure::AnyNumber, target),
            (
                "'kept' is declared 'int32', but the value assigned to 'kept' might not be an int32: a value assigned by destructuring, or by a 'for...of' or 'for...in' loop, cannot be checked. Assign it to a 'number' variable first, then convert that with '| 0'.".to_owned(),
                None
            )
        );
        assert_eq!(
            described(kind, Int32ProofFailure::Unknown, Int32FlowValue::SpreadArgument).0,
            "'kept' is declared 'int32', but the value passed by this spread might not be an int32: the elements of a spread argument cannot be checked. Pass it as a separate argument."
        );
    }

    fn unproven(failure: Int32ProofFailure) -> String {
        message_of(&record(UserDiagnosticKind::UnprovenInt32, failure))
    }

    fn constant(failure: Int32ProofFailure) -> String {
        message_of(&record(UserDiagnosticKind::ConstantNotInt32, failure))
    }

    #[test]
    fn range_is_printed_in_whole_numbers() {
        assert_eq!(
            unproven(Int32ProofFailure::OutOfRange),
            "The value is declared 'int32', but it might not be an int32: it can be anything from -4294967296 to 4294967294. Write '| 0' to make it one."
        );
    }

    #[test]
    fn every_unproven_value_is_told_what_to_write() {
        for failure in Int32ProofFailure::ALL {
            if failure == Int32ProofFailure::Unknown {
                continue;
            }
            let message = unproven(failure);
            assert!(
                message.ends_with(". Write '| 0' to make it one."),
                "{message}"
            );
        }
    }

    #[test]
    fn value_that_is_no_number_is_not_told_to_write_or_zero() {
        assert_eq!(
            unproven(Int32ProofFailure::Unknown),
            "The value is declared 'int32', but it might not be an int32: it is not a number. If it is a spread argument, pass its elements as separate arguments."
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
        ];
        for (failure, reason) in reasons {
            let message = unproven(failure);
            assert!(
                message.contains(&format!("might not be an int32: {reason}. ")),
                "{message}"
            );
        }
    }

    #[test]
    fn failure_without_reason_of_its_own_is_any_number() {
        let any_number = unproven(Int32ProofFailure::AnyNumber);
        assert!(
            any_number.contains("might not be an int32: it is a 'number', which"),
            "{any_number}"
        );
        assert_eq!(unproven(Int32ProofFailure::Untyped), any_number);
        assert_eq!(unproven(Int32ProofFailure::WorkLimit), any_number);
        let undeclared = UserDiagnosticRecord {
            count: u32::MAX,
            ..record(
                UserDiagnosticKind::UnprovenInt32,
                Int32ProofFailure::Unknown,
            )
        };
        assert_eq!(message_of(&undeclared), any_number);
    }

    #[test]
    fn constant_says_what_it_is() {
        assert_eq!(
            constant(Int32ProofFailure::NotANumber),
            "The value is declared 'int32', but it is not an int32: it is NaN."
        );
        assert!(constant(Int32ProofFailure::NegativeZero).ends_with(": it is -0."));
        assert!(constant(Int32ProofFailure::Fraction).ends_with(": it has a fraction."));
        assert!(
            constant(Int32ProofFailure::OutOfRange)
                .ends_with(": an int32 is a whole number from -2147483648 to 2147483647.")
        );
    }

    #[test]
    fn single_number_out_of_range_is_a_constant() {
        let single = UserDiagnosticRecord {
            minimum: 4294967296.0,
            maximum: 4294967296.0,
            ..record(
                UserDiagnosticKind::UnprovenInt32,
                Int32ProofFailure::OutOfRange,
            )
        };
        let expected = constant(Int32ProofFailure::OutOfRange);
        assert_eq!(message_of(&single), expected);
    }

    #[test]
    fn other_kinds_keep_the_words_of_the_engine() {
        for kind in [
            UserDiagnosticKind::Int32OfDependencyNotProven,
            UserDiagnosticKind::InvalidRegExpLiteral,
        ] {
            let record = record(kind, Int32ProofFailure::AnyNumber);
            assert_eq!(write_int32_message(&record, None), None);
        }
    }
}
