// Scratch stand-in for ast/diagnostic.rs: the shapes that the data model of the tree and the files of steps 6 to 8 name.
use crate::ast::NodeId;
use crate::core::ResolutionMode;
use crate::diagnostics::MessageId;

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
impl Default for Arg<'_> {
    fn default() -> Self { Arg::Str(b"") }
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
    pub node: NodeId,
    pub message: MessageId,
    pub args: Vec<Vec<u8>>,
    pub chain: DiagnosticId,
    related_information: Vec<DiagnosticId>,
    repopulate_info: Option<RepopulateDiagnosticInfo>,
}
impl Diagnostic {
    pub fn related_information(&self) -> &[DiagnosticId] { &self.related_information }
    pub fn set_repopulate_info(&mut self, info: RepopulateDiagnosticInfo) { self.repopulate_info = Some(info); }
    pub fn repopulate_info(&self) -> Option<&RepopulateDiagnosticInfo> { self.repopulate_info.as_ref() }
}

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
    pub fn new_for_node(&mut self, node: NodeId, message: MessageId, args: &[Arg<'_>], chain: DiagnosticId) -> DiagnosticId {
        if self.arena.is_empty() { self.arena.push(Diagnostic::default()); }
        let args = args.iter().map(|arg| match *arg {
            Arg::Str(s) => s.to_vec(),
            Arg::Int(v) => v.to_string().into_bytes(),
            Arg::Bool(v) => v.to_string().into_bytes(),
        }).collect();
        self.arena.push(Diagnostic { node, message, args, chain, ..Diagnostic::default() });
        DiagnosticId(self.arena.len() as u32 - 1)
    }
    pub fn add_related_info(&mut self, d: DiagnosticId, related_information: DiagnosticId) -> DiagnosticId {
        if !related_information.is_nil() { self[d].related_information.push(related_information); }
        d
    }
}

// The collection of the checker: the scratch keeps the order of the additions.
#[derive(Default)]
pub struct DiagnosticsCollection {
    pub added: Vec<DiagnosticId>,
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
        if d1 == d2 { return 0; }
        let (a, b) = (&self.store[d1], &self.store[d2]);
        match (a.node, a.message, &a.args).cmp(&(b.node, b.message, &b.args)) {
            std::cmp::Ordering::Less => -1,
            std::cmp::Ordering::Equal => 0,
            std::cmp::Ordering::Greater => 1,
        }
    }
}
