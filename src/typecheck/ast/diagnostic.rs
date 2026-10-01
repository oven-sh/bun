// internal/ast/diagnostic.go: a diagnostic, the arguments of its message, and the store of the diagnostics that one parser, binder or checker makes.
use crate::ast::ids::{DiagnosticId, NodeId, OPEN_BIT};
use crate::core::{TextRange, undefined_text_range};
use crate::diagnostics::{self, Category, Locale, MessageId};

// One argument of a message, as `any` in upstream's variadic parameters.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Arg<'a> {
    Str(&'a [u8]),
    Int(i64),
    Bool(bool),
}

impl Default for Arg<'_> {
    fn default() -> Self {
        Arg::Str(b"")
    }
}

impl<'a> From<&'a [u8]> for Arg<'a> {
    fn from(value: &'a [u8]) -> Self {
        Arg::Str(value)
    }
}
impl<'a, const N: usize> From<&'a [u8; N]> for Arg<'a> {
    fn from(value: &'a [u8; N]) -> Self {
        Arg::Str(value)
    }
}
impl<'a> From<&'a str> for Arg<'a> {
    fn from(value: &'a str) -> Self {
        Arg::Str(value.as_bytes())
    }
}
impl From<i32> for Arg<'_> {
    fn from(value: i32) -> Self {
        Arg::Int(i64::from(value))
    }
}
impl From<isize> for Arg<'_> {
    fn from(value: isize) -> Self {
        Arg::Int(value as i64)
    }
}
impl From<usize> for Arg<'_> {
    fn from(value: usize) -> Self {
        Arg::Int(i64::try_from(value).unwrap_or(i64::MAX))
    }
}
impl From<bool> for Arg<'_> {
    fn from(value: bool) -> Self {
        Arg::Bool(value)
    }
}

// diagnostics.StringifyArgs: a string as it is, any other value as `%v` prints it.
pub fn stringify_args(args: &[Arg<'_>]) -> Vec<Box<[u8]>> {
    let mut result = Vec::with_capacity(args.len());
    for arg in args {
        let mut text: Vec<u8> = Vec::new();
        match *arg {
            Arg::Str(s) => text.extend_from_slice(s),
            Arg::Int(v) => diagnostics::write_decimal(&mut text, v),
            Arg::Bool(v) => text.extend_from_slice(if v { b"true" } else { b"false" }),
        }
        result.push(text.into_boxed_slice());
    }
    result
}

// ast.Diagnostic: the file is the root of a source file, and a chain or a related diagnostic is an id of the same store.
#[derive(Clone, Debug, Default)]
pub struct Diagnostic {
    file: NodeId,
    loc: TextRange,
    code: i32,
    category: Category,
    source: Box<[u8]>,
    message: MessageId,
    message_text: Box<[u8]>,
    message_key: Box<[u8]>,
    message_args: Vec<Box<[u8]>>,
    message_chain: Vec<DiagnosticId>,
    related_information: Vec<DiagnosticId>,
    reports_unnecessary: bool,
    reports_deprecated: bool,
    skipped_on_no_emit: bool,
}

impl Diagnostic {
    pub fn file(&self) -> NodeId {
        self.file
    }
    pub fn pos(&self) -> i32 {
        self.loc.pos()
    }
    pub fn end(&self) -> i32 {
        self.loc.end()
    }
    pub fn len(&self) -> i32 {
        self.loc.len()
    }
    pub fn loc(&self) -> TextRange {
        self.loc
    }
    pub fn code(&self) -> i32 {
        self.code
    }
    pub fn category(&self) -> Category {
        self.category
    }
    pub fn source(&self) -> &[u8] {
        &self.source
    }
    pub fn message(&self) -> MessageId {
        self.message
    }
    pub fn message_text(&self) -> &[u8] {
        &self.message_text
    }
    pub fn message_args(&self) -> &[Box<[u8]>] {
        &self.message_args
    }
    pub fn message_chain(&self) -> &[DiagnosticId] {
        &self.message_chain
    }
    pub fn related_information(&self) -> &[DiagnosticId] {
        &self.related_information
    }
    pub fn reports_unnecessary(&self) -> bool {
        self.reports_unnecessary
    }
    pub fn reports_deprecated(&self) -> bool {
        self.reports_deprecated
    }
    pub fn skipped_on_no_emit(&self) -> bool {
        self.skipped_on_no_emit
    }
    pub fn set_file(&mut self, file: NodeId) {
        self.file = file;
    }
    pub fn set_location(&mut self, loc: TextRange) {
        self.loc = loc;
    }
    pub fn set_category(&mut self, category: Category) {
        self.category = category;
    }
    pub fn set_skipped_on_no_emit(&mut self) {
        self.skipped_on_no_emit = true;
    }
    // The key is derived for a table message and stored for a deserialized one.
    pub fn message_key(&self) -> Vec<u8> {
        if !self.message_key.is_empty() || self.message.is_nil() {
            return self.message_key.to_vec();
        }
        self.message.key()
    }
    pub fn localize(&self, locale: Locale) -> Vec<u8> {
        if self.message.is_nil() && !self.message_text.is_empty() {
            return self.message_text.to_vec();
        }
        let args: Vec<&[u8]> = self.message_args.iter().map(|arg| &**arg).collect();
        diagnostics::localize(locale, self.message, &self.message_text, &args).0
    }
}

// A message that Format of upstream panics on: it has arguments, and fewer than its highest placeholder needs.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct InvalidPlaceholderFault {
    pub diagnostic: DiagnosticId,
    pub message: MessageId,
    pub argument_count: u32,
}

// The diagnostics of one parser, one binder or one checker. Index 0 is the nil diagnostic: it reads as the zero value, where upstream dereferences nil.
#[derive(Debug)]
pub struct DiagnosticStore {
    items: Vec<Diagnostic>,
    // A write through nil or through an id that names nothing lands here, where upstream panics.
    sink: Diagnostic,
    faults: Vec<InvalidPlaceholderFault>,
    fault_count: u32,
}

impl Default for DiagnosticStore {
    fn default() -> Self {
        Self {
            items: vec![Diagnostic::default()],
            sink: Diagnostic::default(),
            faults: Vec::new(),
            fault_count: 0,
        }
    }
}

impl std::ops::Index<DiagnosticId> for DiagnosticStore {
    type Output = Diagnostic;
    fn index(&self, id: DiagnosticId) -> &Diagnostic {
        let index = id.0 as usize;
        match self.items.get(index) {
            Some(diagnostic) if index != 0 => diagnostic,
            _ => self.items.first().unwrap_or(&self.sink),
        }
    }
}
impl std::ops::IndexMut<DiagnosticId> for DiagnosticStore {
    fn index_mut(&mut self, id: DiagnosticId) -> &mut Diagnostic {
        let index = id.0 as usize;
        match self.items.get_mut(index) {
            Some(diagnostic) if index != 0 => diagnostic,
            _ => {
                self.sink = Diagnostic::default();
                &mut self.sink
            }
        }
    }
}

impl DiagnosticStore {
    pub const MAX_KEPT_FAULTS: usize = 64;

    pub fn fault_count(&self) -> u32 {
        self.fault_count
    }
    // The owner turns each fault into an internal diagnostic.
    pub fn take_faults(&mut self) -> Vec<InvalidPlaceholderFault> {
        std::mem::take(&mut self.faults)
    }

    // The id of the new diagnostic: nil once the id space is used up.
    fn alloc(&mut self, diagnostic: Diagnostic) -> DiagnosticId {
        match u32::try_from(self.items.len()) {
            Ok(index) if index < OPEN_BIT => {
                self.items.push(diagnostic);
                DiagnosticId(index)
            }
            _ => DiagnosticId::NIL,
        }
    }

    pub fn new_diagnostic(
        &mut self,
        file: NodeId,
        loc: TextRange,
        message: MessageId,
        args: &[Arg<'_>],
    ) -> DiagnosticId {
        let d = self.new_diagnostic_unchecked(file, loc, message, args);
        if !args.is_empty() && args.len() < message.argument_count() {
            self.fault_count = self.fault_count.saturating_add(1);
            if self.faults.len() < Self::MAX_KEPT_FAULTS {
                self.faults.push(InvalidPlaceholderFault {
                    diagnostic: d,
                    message,
                    argument_count: u32::try_from(args.len()).unwrap_or(u32::MAX),
                });
            }
        }
        d
    }

    fn new_diagnostic_unchecked(
        &mut self,
        file: NodeId,
        loc: TextRange,
        message: MessageId,
        args: &[Arg<'_>],
    ) -> DiagnosticId {
        self.alloc(Diagnostic {
            file,
            loc,
            code: message.code(),
            category: message.category(),
            message,
            message_args: stringify_args(args),
            reports_unnecessary: message.reports_unnecessary(),
            reports_deprecated: message.reports_deprecated(),
            ..Diagnostic::default()
        })
    }
    pub fn new_diagnostic_chain(
        &mut self,
        chain: DiagnosticId,
        message: MessageId,
        args: &[Arg<'_>],
    ) -> DiagnosticId {
        if !chain.is_nil() {
            let (file, loc) = (self[chain].file, self[chain].loc);
            let related_information = self[chain].related_information.clone();
            let d = self.new_diagnostic(file, loc, message, args);
            self.add_message_chain(d, chain);
            return self.set_related_info(d, related_information);
        }
        self.new_diagnostic(NodeId::NIL, TextRange::default(), message, args)
    }
    pub fn new_compiler_diagnostic(
        &mut self,
        message: MessageId,
        args: &[Arg<'_>],
    ) -> DiagnosticId {
        self.new_diagnostic(NodeId::NIL, undefined_text_range(), message, args)
    }
    // NewCompilerDiagnostic(diagnostics.NewAdHocMessage(text)).
    pub fn new_ad_hoc_diagnostic(
        &mut self,
        file: NodeId,
        loc: TextRange,
        text: &[u8],
    ) -> DiagnosticId {
        self.alloc(Diagnostic {
            file,
            loc,
            code: -1,
            category: Category::Error,
            message: MessageId::AD_HOC,
            message_text: text.into(),
            message_key: (*b"-1").into(),
            ..Diagnostic::default()
        })
    }
    pub fn add_message_chain(
        &mut self,
        d: DiagnosticId,
        message_chain: DiagnosticId,
    ) -> DiagnosticId {
        if !message_chain.is_nil() {
            self[d].message_chain.push(message_chain);
        }
        d
    }
    pub fn set_message_chain(
        &mut self,
        d: DiagnosticId,
        message_chain: Vec<DiagnosticId>,
    ) -> DiagnosticId {
        self[d].message_chain = message_chain;
        d
    }
    pub fn add_related_info(
        &mut self,
        d: DiagnosticId,
        related_information: DiagnosticId,
    ) -> DiagnosticId {
        if !related_information.is_nil() {
            self[d].related_information.push(related_information);
        }
        d
    }
    pub fn set_related_info(
        &mut self,
        d: DiagnosticId,
        related_information: Vec<DiagnosticId>,
    ) -> DiagnosticId {
        self[d].related_information = related_information;
        d
    }
    pub fn clone_diagnostic(&mut self, d: DiagnosticId) -> DiagnosticId {
        let copy = self[d].clone();
        self.alloc(copy)
    }
}
