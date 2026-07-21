use core::fmt;

use bun_core::{OwnedString, String};

use super::field_type::FieldType;
use super::new_reader::NewReader;
use crate::postgres::AnyPostgresError;

/// Each variant owns a +1 `WTFStringImpl` ref from `String::clone_utf8` in
/// `init()`; `OwnedString` releases it on drop.
pub enum FieldMessage {
    Severity(OwnedString),
    LocalizedSeverity(OwnedString),
    Code(OwnedString),
    Message(OwnedString),
    Detail(OwnedString),
    Hint(OwnedString),
    Position(OwnedString),
    InternalPosition(OwnedString),
    Internal(OwnedString),
    Where(OwnedString),
    Schema(OwnedString),
    Table(OwnedString),
    Column(OwnedString),
    Datatype(OwnedString),
    Constraint(OwnedString),
    File(OwnedString),
    Line(OwnedString),
    Routine(OwnedString),
}

impl fmt::Display for FieldMessage {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.payload())
    }
}

impl FieldMessage {
    /// Every variant carries a single `bun.String` payload.
    pub fn payload(&self) -> &String {
        match self {
            FieldMessage::Severity(s)
            | FieldMessage::LocalizedSeverity(s)
            | FieldMessage::Code(s)
            | FieldMessage::Message(s)
            | FieldMessage::Detail(s)
            | FieldMessage::Hint(s)
            | FieldMessage::Position(s)
            | FieldMessage::InternalPosition(s)
            | FieldMessage::Internal(s)
            | FieldMessage::Where(s)
            | FieldMessage::Schema(s)
            | FieldMessage::Table(s)
            | FieldMessage::Column(s)
            | FieldMessage::Datatype(s)
            | FieldMessage::Constraint(s)
            | FieldMessage::File(s)
            | FieldMessage::Line(s)
            | FieldMessage::Routine(s) => s,
        }
    }

    pub fn decode_list<Context: super::new_reader::ReaderContext>(
        mut reader: NewReader<Context>,
    ) -> Result<Vec<FieldMessage>, AnyPostgresError> {
        let mut messages: Vec<FieldMessage> = Vec::new();
        loop {
            let field_int: u8 = reader.int::<u8>()?;
            if field_int == 0 {
                break;
            }
            let field: FieldType = FieldType::from(field_int);

            let message = reader.read_z()?;
            if message.slice().is_empty() {
                break;
            }

            let Ok(field_msg) = FieldMessage::init(field, message.slice()) else {
                continue;
            };
            messages.push(field_msg);
        }

        Ok(messages)
    }

    pub fn init(tag: FieldType, message: &[u8]) -> crate::Result<FieldMessage> {
        let s = || OwnedString::new(String::clone_utf8(message));
        Ok(match tag {
            FieldType::SEVERITY => FieldMessage::Severity(s()),
            // Ignore this one for now.
            // FieldType::LOCALIZED_SEVERITY => FieldMessage::LocalizedSeverity(s()),
            FieldType::CODE => FieldMessage::Code(s()),
            FieldType::MESSAGE => FieldMessage::Message(s()),
            FieldType::DETAIL => FieldMessage::Detail(s()),
            FieldType::HINT => FieldMessage::Hint(s()),
            FieldType::POSITION => FieldMessage::Position(s()),
            FieldType::INTERNAL_POSITION => FieldMessage::InternalPosition(s()),
            FieldType::INTERNAL => FieldMessage::Internal(s()),
            FieldType::WHERE => FieldMessage::Where(s()),
            FieldType::SCHEMA => FieldMessage::Schema(s()),
            FieldType::TABLE => FieldMessage::Table(s()),
            FieldType::COLUMN => FieldMessage::Column(s()),
            FieldType::DATATYPE => FieldMessage::Datatype(s()),
            FieldType::CONSTRAINT => FieldMessage::Constraint(s()),
            FieldType::FILE => FieldMessage::File(s()),
            FieldType::LINE => FieldMessage::Line(s()),
            FieldType::ROUTINE => FieldMessage::Routine(s()),
            _ => return Err(crate::Error::UnknownFieldType),
        })
    }
}
