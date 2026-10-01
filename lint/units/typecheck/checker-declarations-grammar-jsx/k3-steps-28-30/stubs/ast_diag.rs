// Scratch stand-in for ast/diagnostic.rs (shapes of the data model contract, plus the repopulate info of upstream).
use crate::core::ResolutionMode;
use crate::ast::NodeId;

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
pub struct DiagnosticId(pub u32);
impl DiagnosticId {
    pub const NIL: Self = Self(0);
    pub const fn is_nil(self) -> bool { self.0 == 0 }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Arg<'a> {
    Str(&'a [u8]),
    Int(i64),
    Bool(bool),
}

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct RepopulateDiagnosticKind(pub i32);
impl RepopulateDiagnosticKind {
    pub const MODE_MISMATCH: Self = Self(1);
    pub const MODULE_NOT_FOUND: Self = Self(2);
}

#[derive(Clone, Default, Debug)]
pub struct RepopulateDiagnosticInfo {
    pub kind: RepopulateDiagnosticKind,
    pub module_reference: Vec<u8>,
    pub mode: ResolutionMode,
    pub package_name: Vec<u8>,
}

#[derive(Clone, Debug, Default)]
pub struct Diagnostic {
    related_information: Vec<DiagnosticId>,
    repopulate_info: Option<RepopulateDiagnosticInfo>,
}
impl Diagnostic {
    pub fn related_information(&self) -> &[DiagnosticId] { &self.related_information }
    pub fn set_repopulate_info(&mut self, info: RepopulateDiagnosticInfo) { self.repopulate_info = Some(info); }
}

impl Default for Arg<'_> {
    fn default() -> Self { Arg::Str(b"") }
}

#[derive(Default)]
pub struct DiagnosticsCollection;

#[derive(Default)]
pub struct DiagnosticStore {
    arena: Vec<Diagnostic>,
}
impl core::ops::Index<DiagnosticId> for DiagnosticStore {
    type Output = Diagnostic;
    fn index(&self, id: DiagnosticId) -> &Diagnostic { &self.arena[id.0 as usize] }
}
impl core::ops::IndexMut<DiagnosticId> for DiagnosticStore {
    fn index_mut(&mut self, id: DiagnosticId) -> &mut Diagnostic { &mut self.arena[id.0 as usize] }
}
impl DiagnosticStore {
    pub fn new_diagnostic(&mut self, _file: NodeId, _loc: crate::core::TextRange, _message: crate::diagnostics::MessageId, _args: &[Arg<'_>]) -> DiagnosticId { DiagnosticId::NIL }
    pub fn new_diagnostic_chain(&mut self, _chain: DiagnosticId, _message: crate::diagnostics::MessageId, _args: &[Arg<'_>]) -> DiagnosticId { DiagnosticId::NIL }
    pub fn add_related_info(&mut self, d: DiagnosticId, related_information: DiagnosticId) -> DiagnosticId {
        if !related_information.is_nil() { self[d].related_information.push(related_information); }
        d
    }
}

pub trait SourceFiles {
    fn file_name(&self, file: NodeId) -> &[u8];
}

pub struct Diagnostics<'a, F: ?Sized> {
    pub store: &'a DiagnosticStore,
    pub files: &'a F,
}
impl<'a, F: SourceFiles + ?Sized> Diagnostics<'a, F> {
    pub fn compare_diagnostics(&self, d1: DiagnosticId, d2: DiagnosticId) -> isize {
        let _ = self.files.file_name(NodeId::NIL);
        let _ = &self.store[d1];
        (d1.0 as isize) - (d2.0 as isize)
    }
}
