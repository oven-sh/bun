// Scratch: the part of internal/ast/diagnostic.go that flow.rs names.
pub use crate::tscore::ids::DiagnosticId;
use crate::ast::NodeId;
use crate::core::TextRange;
use crate::diagnostics::MessageId;

#[derive(Clone, Copy, Debug)]
pub enum Arg<'a> {
    Str(&'a [u8]),
    Int(i64),
    Bool(bool),
}

#[derive(Default)]
pub struct DiagnosticStore {}

impl DiagnosticStore {
    pub fn new_diagnostic(
        &mut self,
        file: NodeId,
        loc: TextRange,
        message: MessageId,
        args: &[Arg<'_>],
    ) -> DiagnosticId {
        unimplemented!()
    }
    pub fn add_related_info(&mut self, d: DiagnosticId, info: DiagnosticId) {
        unimplemented!()
    }
}
