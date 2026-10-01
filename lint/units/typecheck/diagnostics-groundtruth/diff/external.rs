// Appended to ast/diagnostic.rs of the scratch crate when it has no new_external_diagnostic.
impl DiagnosticStore {
    pub fn new_external_diagnostic(
        &mut self,
        file: NodeId,
        loc: TextRange,
        source: &[u8],
        category: Category,
        code: i32,
        message_text: &[u8],
    ) -> DiagnosticId {
        self.arena.alloc(Diagnostic {
            file,
            loc,
            code,
            category,
            source: source.into(),
            message_text: message_text.into(),
            ..Diagnostic::default()
        })
    }
}
