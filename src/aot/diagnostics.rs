mod engine_records;
mod front_end;
mod int32_flows;
#[cfg(test)]
mod shared;
mod sink;
mod spans;
#[cfg(test)]
mod tests;

#[cfg(not(test))]
use bun_aot_interface::diagnostics::shared;
use bun_ast::{Log, Msg};
use bun_sema::check::aot::{DiagnosticClass, DiagnosticSubject, FileOrigin};
use bun_sema::hir::File;
use bun_sema::messages::Category;
use bun_sema::node::NodeData;
use bun_sema::program::{FileId, Files};
use bun_sema_driver::host::to_native;
use bun_sema_driver::{self as driver, LoadedProgram, Locator};
use bun_threading::Guarded;
use rustc_hash::FxHashMap;

use self::int32_flows::Int32FlowKey;
pub use self::shared::{InternalError, Severity};
pub(crate) use self::sink::log_diagnostic_at;
pub use self::sink::{log_diagnostic, log_internal_error};
pub(crate) use self::spans::range_of_node;
use crate::diagnostic_codes::Code;
use crate::ir::generated::TypeSiteKind;
use crate::load::Sources;
use crate::statistics::Stage;

// The row of `effect_of` for a `Code`: the source cannot be compiled as written, in any file.
pub(crate) const COMPILER_DIAGNOSTIC_CLASS: DiagnosticClass = DiagnosticClass::EarlyError;

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct Span {
    pub file: FileId,
    pub start: u32,
    pub end: u32,
}

impl Span {
    pub fn of_node(hir: &File<'_>, file: FileId, node: NodeData) -> Span {
        let (start, end) = range_of_node(hir, node);
        Span { file, start, end }
    }
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct SourcePosition {
    pub path: Vec<u8>,
    pub line: u32,
    pub column: u32,
}

/// A position with the text of its line, for a message that is written when the texts of the build are gone.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct ShownPosition {
    pub position: SourcePosition,
    pub line_text: Vec<u8>,
}

#[derive(Clone, Debug)]
pub struct Diagnostic {
    pub code: Code,
    pub severity: Severity,
    pub span: Option<Span>,
    pub arguments: Vec<Vec<u8>>,
    pub related: Vec<Diagnostic>,
}

impl Diagnostic {
    pub fn new(code: Code, span: Option<Span>, arguments: &[&[u8]]) -> Diagnostic {
        Diagnostic {
            code,
            severity: code.severity(),
            span,
            arguments: to_owned_arguments(arguments),
            related: Vec::new(),
        }
    }
}

fn to_owned_arguments(arguments: &[&[u8]]) -> Vec<Vec<u8>> {
    arguments.iter().map(|argument| argument.to_vec()).collect()
}

#[derive(Clone, Debug)]
pub enum Int32FlowValue {
    Expression {
        /// Where the expression starts in its file. A message about the flow points there.
        start: u32,
        text: Vec<u8>,
        advice: Vec<u8>,
        is_any: bool,
    },
    PatternTarget(Vec<u8>),
    SpreadArgument,
}

/// What the front end knows about a flow into an `int32` position.
#[derive(Clone, Debug)]
pub struct Int32Flow {
    pub file: FileId,
    /// The position of the request in the program that the engine reads.
    pub position: u32,
    /// The position and the kind of the type site of the request.
    pub site: Option<(u32, TypeSiteKind)>,
    pub subject: Vec<u8>,
    pub value: Int32FlowValue,
}

#[derive(Default, Debug)]
pub struct DiagnosticBuffer {
    diagnostics: Vec<Diagnostic>,
    int32_flows: Vec<Int32Flow>,
}

impl DiagnosticBuffer {
    pub fn report(&mut self, code: Code, span: Span, arguments: &[&[u8]]) {
        self.push(Diagnostic::new(code, Some(span), arguments));
    }

    pub fn push(&mut self, diagnostic: Diagnostic) {
        self.diagnostics.push(diagnostic);
    }

    pub fn add_int32_flow(&mut self, flow: Int32Flow) {
        self.int32_flows.push(flow);
    }

    pub fn append(&mut self, mut other: DiagnosticBuffer) {
        self.diagnostics.append(&mut other.diagnostics);
        self.int32_flows.append(&mut other.int32_flows);
    }

    pub fn has_errors(&self) -> bool {
        self.iter()
            .any(|diagnostic| diagnostic.severity == Severity::Error)
    }

    pub fn is_empty(&self) -> bool {
        self.diagnostics.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = &Diagnostic> + '_ {
        self.diagnostics.iter()
    }
}

#[derive(Clone, Debug)]
pub(crate) struct FileDiagnostic {
    pub code: Code,
    pub severity: Severity,
    pub start: u32,
    pub end: u32,
    pub arguments: Vec<Vec<u8>>,
}

impl FileDiagnostic {
    pub(crate) fn new(code: Code, range: (u32, u32), arguments: &[&[u8]]) -> FileDiagnostic {
        FileDiagnostic {
            code,
            severity: code.severity(),
            start: range.0,
            end: range.1,
            arguments: to_owned_arguments(arguments),
        }
    }

    pub(crate) fn into_diagnostic(self, file: FileId) -> Diagnostic {
        Diagnostic {
            code: self.code,
            severity: self.severity,
            span: Some(Span {
                file,
                start: self.start,
                end: self.end,
            }),
            arguments: self.arguments,
            related: Vec::new(),
        }
    }
}

struct LoadMessageLists {
    log: Log,
    internal_errors: Vec<InternalError>,
}

impl Default for LoadMessageLists {
    fn default() -> LoadMessageLists {
        LoadMessageLists {
            log: Log::init(),
            internal_errors: Vec::new(),
        }
    }
}

#[derive(Default)]
pub(crate) struct LoadMessages {
    lists: Guarded<LoadMessageLists>,
}

impl LoadMessages {
    pub(crate) fn report_internal_error(&self, message: Vec<u8>) {
        let stage = Stage::Load;
        let error = InternalError { stage, message };
        self.lists.lock().internal_errors.push(error);
    }

    pub(crate) fn has_errors(&self) -> bool {
        let lists = self.lists.lock();
        lists.log.has_errors() || !lists.internal_errors.is_empty()
    }

    pub(crate) fn with_log<R>(&self, call: impl FnOnce(&mut Log) -> R) -> R {
        let mut log = Log::init();
        let result = call(&mut log);
        // `true` copies every string, so no message points into memory of the call.
        log.append_to_with_recycled(&mut self.lists.lock().log, true);
        result
    }
}

#[derive(Copy, Clone)]
pub(crate) struct ProgramView<'a, 's> {
    pub loaded: &'a LoadedProgram<'s>,
    pub sources: &'a Sources,
}

impl<'s> ProgramView<'_, 's> {
    pub(crate) fn files(self) -> &'s Files<'s> {
        self.loaded.files()
    }

    pub(crate) fn origin(self, file: FileId) -> FileOrigin {
        self.loaded.origin(file)
    }
}

pub(crate) struct SpanLocator<'a, 's> {
    view: ProgramView<'a, 's>,
    last_file: Option<Locator<'a, 's>>,
}

impl<'a, 's> SpanLocator<'a, 's> {
    pub(crate) fn new(view: ProgramView<'a, 's>) -> SpanLocator<'a, 's> {
        SpanLocator {
            view,
            last_file: None,
        }
    }

    pub(crate) fn view(&self) -> ProgramView<'a, 's> {
        self.view
    }

    pub(crate) fn locate(
        &mut self,
        span: Span,
        reported: driver::Diagnostic,
    ) -> driver::Diagnostic {
        let (files, last_file) = (self.view.files(), &mut self.last_file);
        last_file.take_if(|locator| locator.file() != span.file);
        let locator = last_file.get_or_insert_with(|| Locator::new(files, span.file));
        locator.locate(span.start, span.end, reported)
    }

    pub(crate) fn position_of(&mut self, span: Span) -> SourcePosition {
        let unlocated = new_driver_diagnostic(0, Category::Message, Vec::new(), &[]);
        position_of_diagnostic(&self.locate(span, unlocated))
    }
}

pub(crate) fn position_of_diagnostic(located: &driver::Diagnostic) -> SourcePosition {
    SourcePosition {
        path: to_native(&located.path).to_vec(),
        line: located.line,
        column: located.column,
    }
}

pub(crate) fn new_driver_diagnostic(
    code: u32,
    category: Category,
    text: Vec<u8>,
    arguments: &[Vec<u8>],
) -> driver::Diagnostic {
    driver::Diagnostic {
        path: Vec::new(),
        start: 0,
        end: 0,
        has_undefined_range: true,
        line: 0,
        column: 0,
        end_line: 0,
        end_column: 0,
        code,
        category,
        text,
        args: arguments
            .iter()
            .map(|argument| Box::from(argument.as_slice()))
            .collect(),
        message_chain: Vec::new(),
        source: Vec::new(),
        source_line: 0,
        related: Vec::new(),
        project: 0,
        class: COMPILER_DIAGNOSTIC_CLASS,
        subject: DiagnosticSubject::None,
        file: None,
    }
}

struct Entry {
    key: (bool, Vec<u8>, i64, i64, u32, Vec<u8>),
    message: Msg,
}

pub(crate) struct Diagnostics {
    entries: Vec<Entry>,
    owned_strings: Vec<Box<[u8]>>,
    internal_errors: Vec<InternalError>,
    int32_flows: FxHashMap<Int32FlowKey, Int32Flow>,
    error_count: u32,
}
