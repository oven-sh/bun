use bun_sema::messages::Category;

use crate::statistics::Stage;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Severity {
    Error,
    Warning,
    Note,
}

impl Severity {
    pub fn category(self) -> Category {
        match self {
            Severity::Error => Category::Error,
            Severity::Warning | Severity::Note => Category::Warning,
        }
    }
}

#[derive(Debug)]
pub struct InternalError {
    pub stage: Stage,
    pub message: Vec<u8>,
}
