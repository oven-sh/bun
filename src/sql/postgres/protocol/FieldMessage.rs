use core::fmt;

use bun_core::String;

use super::field_type::FieldType;
use super::new_reader::NewReader;
use crate::postgres::AnyPostgresError;

pub enum FieldMessage {
    Severity(String),
    Code(String),
    Message(String),
    Detail(String),
    Hint(String),
    Position(String),
    InternalPosition(String),
    Internal(String),
    Where(String),
    Schema(String),
    Table(String),
    Column(String),
    Datatype(String),
    Constraint(String),
    File(String),
    Line(String),
    Routine(String),
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
        mut remaining: usize,
    ) -> Result<Vec<FieldMessage>, AnyPostgresError> {
        let mut messages: Vec<FieldMessage> = Vec::new();
        while remaining > 0 {
            let field_int: u8 = reader.int::<u8>()?;
            remaining -= 1;
            if field_int == 0 {
                break;
            }
            let field: FieldType = FieldType::from(field_int);

            let (message, consumed) = reader.string_within(remaining)?;
            remaining -= consumed;

            let Ok(field_msg) = FieldMessage::init(field, message.slice()) else {
                continue;
            };
            messages.push(field_msg);
        }

        Ok(messages)
    }

    pub fn init(tag: FieldType, message: &[u8]) -> crate::Result<FieldMessage> {
        Ok(match tag {
            FieldType::SEVERITY => FieldMessage::Severity(String::clone_utf8(message)),
            // Ignore this one for now.
            // FieldType::LOCALIZED_SEVERITY => FieldMessage::LocalizedSeverity(String::clone_utf8(message)),
            FieldType::CODE => FieldMessage::Code(String::clone_utf8(message)),
            FieldType::MESSAGE => FieldMessage::Message(String::clone_utf8(message)),
            FieldType::DETAIL => FieldMessage::Detail(String::clone_utf8(message)),
            FieldType::HINT => FieldMessage::Hint(String::clone_utf8(message)),
            FieldType::POSITION => FieldMessage::Position(String::clone_utf8(message)),
            FieldType::INTERNAL_POSITION => {
                FieldMessage::InternalPosition(String::clone_utf8(message))
            }
            FieldType::INTERNAL => FieldMessage::Internal(String::clone_utf8(message)),
            FieldType::WHERE => FieldMessage::Where(String::clone_utf8(message)),
            FieldType::SCHEMA => FieldMessage::Schema(String::clone_utf8(message)),
            FieldType::TABLE => FieldMessage::Table(String::clone_utf8(message)),
            FieldType::COLUMN => FieldMessage::Column(String::clone_utf8(message)),
            FieldType::DATATYPE => FieldMessage::Datatype(String::clone_utf8(message)),
            FieldType::CONSTRAINT => FieldMessage::Constraint(String::clone_utf8(message)),
            FieldType::FILE => FieldMessage::File(String::clone_utf8(message)),
            FieldType::LINE => FieldMessage::Line(String::clone_utf8(message)),
            FieldType::ROUTINE => FieldMessage::Routine(String::clone_utf8(message)),
            _ => return Err(crate::Error::UnknownFieldType),
        })
    }
}
