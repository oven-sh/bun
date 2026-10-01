// checker.go 14075-14105 (c21_resolved_symbols_diagnostics, layer D-SINK) and utilities.go 22-30: the deferred callbacks, addDiagnostic, error.
use crate::ast::reader::Ast;
use crate::ast_diagnostic::{Arg, Diagnostics, SourceFiles};
use crate::checker::c01_data::MAX_SERIALIZATION_LEVEL;
use crate::checker::checker::{Checker, DeferredDiagnosticCallback};
use crate::diagnostics::MessageId;
use crate::tscore::ids::{DiagnosticId, NodeId};
use crate::tscore::text::TextRange;

// What the diagnostics read of a file, answered by the node table. The line map belongs to the program layer.
pub struct ProgramFiles<'a> {
    pub ast: Ast<'a>,
}

impl SourceFiles for ProgramFiles<'_> {
    fn file_name(&self, file: NodeId) -> &[u8] {
        match self.find(file) {
            Some(f) => &f.source_file.file_name,
            None => b"",
        }
    }
    fn path(&self, file: NodeId) -> &[u8] {
        self.file_name(file)
    }
    fn text(&self, file: NodeId) -> &[u8] {
        match self.find(file) {
            Some(f) => f.source_text(),
            None => b"",
        }
    }
    fn ecma_line_map(&self, _: NodeId) -> &[i32] {
        &[]
    }
}

impl<'a> ProgramFiles<'a> {
    fn find(&self, file: NodeId) -> Option<&'a crate::ast::file::File> {
        self.ast
            .frozen()
            .files()
            .iter()
            .copied()
            .find(|f| f.source_file.root == file)
    }
}

impl<'a> Checker<'a> {
    pub fn add_deferred_diagnostic(&mut self, callback: DeferredDiagnosticCallback<'a>) {
        self.deferred_diagnostic_callbacks.push(callback);
    }

    pub fn produce_deferred_diagnostics(&mut self) {
        // `range` reads the slice header once: a callback that a callback adds is not run, and the assignment below drops it.
        let callbacks = std::mem::take(&mut self.deferred_diagnostic_callbacks);
        for cb in callbacks {
            cb(self);
        }
        self.deferred_diagnostic_callbacks = Vec::new();
    }

    pub fn add_diagnostic(&mut self, diagnostic: DiagnosticId) -> DiagnosticId {
        // Discard diagnostics created while at the maximum number of recursive TypeToString invocations.
        if self.serialization_level < MAX_SERIALIZATION_LEVEL {
            let files = ProgramFiles { ast: self.ast };
            let view = Diagnostics {
                store: &self.diagnostic_store,
                files: &files,
            };
            return self.diagnostics.add(view, diagnostic);
        }
        diagnostic
    }

    pub fn error(
        &mut self,
        location: NodeId,
        message: MessageId,
        args: &[Arg<'_>],
    ) -> DiagnosticId {
        let diagnostic = self.new_diagnostic_for_node(location, message, args);
        self.add_diagnostic(diagnostic)
    }

    // utilities.go 22: NewDiagnosticForNode. It is a free function upstream; here it needs the store of the checker.
    pub fn new_diagnostic_for_node(
        &mut self,
        node: NodeId,
        message: MessageId,
        args: &[Arg<'_>],
    ) -> DiagnosticId {
        let mut file = NodeId::NIL;
        let mut loc = TextRange::default();
        if !node.is_nil() {
            file = self.ast.source_file_of(node);
            loc = self.get_error_range_for_node(file, node);
        }
        self.diagnostic_store
            .new_diagnostic(file, loc, message, args)
    }
}
