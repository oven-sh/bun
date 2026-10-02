// internal/ast/diagnostic.go: a diagnostic, the arguments of its message, the store of the diagnostics that one parser, binder or checker makes, their comparison, and the collection that a checker keeps them in.
use crate::ast::ids::{DiagnosticId, NodeId, OPEN_BIT};
use crate::core::{ResolutionMode, TextRange, undefined_text_range};
use crate::diagnostics::{self, Category, Locale, MessageId};
use crate::stringutil::util::strings;
use std::collections::BTreeMap as MapImpl;

// What the collection, the comparison and the writers read from a source file.
pub trait SourceFiles {
    fn file_name(&self, file: NodeId) -> &[u8];
    fn path(&self, file: NodeId) -> &[u8];
    fn text(&self, file: NodeId) -> &[u8];
    fn ecma_line_map(&self, file: NodeId) -> &[i32];
}

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

// RepopulateDiagnosticKind indicates the kind of repopulation for a diagnostic chain entry.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct RepopulateDiagnosticKind(pub i32);

impl RepopulateDiagnosticKind {
    pub const MODE_MISMATCH: Self = Self(1);
    pub const MODULE_NOT_FOUND: Self = Self(2);
}

// RepopulateDiagnosticInfo stores information needed to recompute a diagnostic chain entry during incremental builds when the program state may have changed.
#[derive(Clone, PartialEq, Eq, Default, Debug)]
pub struct RepopulateDiagnosticInfo {
    pub kind: RepopulateDiagnosticKind,
    pub module_reference: Vec<u8>,
    pub mode: ResolutionMode,
    pub package_name: Vec<u8>,
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
    repopulate_info: Option<Box<RepopulateDiagnosticInfo>>,
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
    pub fn repopulate_info(&self) -> Option<&RepopulateDiagnosticInfo> {
        self.repopulate_info.as_deref()
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
    pub fn set_repopulate_info(&mut self, info: RepopulateDiagnosticInfo) {
        self.repopulate_info = Some(Box::new(info));
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

// How deep a message chain or related information is followed: upstream recurses without a bound.
const MAX_NESTING: u32 = 200;

// slices.Compare over string slices
fn compare_string_slices(a: &[Box<[u8]>], b: &[Box<[u8]>]) -> isize {
    for (x, y) in a.iter().zip(b) {
        let c = strings::compare(x, y);
        if c != 0 {
            return c;
        }
    }
    compare_lengths(a.len(), b.len())
}

fn compare_lengths(a: usize, b: usize) -> isize {
    (a as isize).wrapping_sub(b as isize)
}

// The diagnostics of one store together with the files that they name: what upstream reads through the pointers of a diagnostic.
pub struct Diagnostics<'a, F: ?Sized> {
    pub store: &'a DiagnosticStore,
    pub files: &'a F,
}

impl<F: ?Sized> Clone for Diagnostics<'_, F> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<F: ?Sized> Copy for Diagnostics<'_, F> {}

#[derive(PartialEq, Eq, PartialOrd, Ord)]
enum MessageIdentity<'a> {
    Text(&'a [u8]),
    Owned(Vec<u8>),
}

impl MessageIdentity<'_> {
    fn bytes(&self) -> &[u8] {
        match self {
            MessageIdentity::Text(text) => text,
            MessageIdentity::Owned(text) => text,
        }
    }
}

impl<'a, F: SourceFiles + ?Sized> Diagnostics<'a, F> {
    fn get_diagnostic_path(&self, d: DiagnosticId) -> &'a [u8] {
        let file = self.store[d].file;
        if !file.is_nil() {
            return self.files.file_name(file);
        }
        b""
    }

    pub fn equal_diagnostics(&self, d1: DiagnosticId, d2: DiagnosticId) -> bool {
        self.equal_diagnostics_at(d1, d2, 0)
    }

    fn equal_diagnostics_at(&self, d1: DiagnosticId, d2: DiagnosticId, depth: u32) -> bool {
        if d1 == d2 {
            return true;
        }
        if depth > MAX_NESTING {
            return false;
        }
        let (r1, r2) = (
            &self.store[d1].related_information,
            &self.store[d2].related_information,
        );
        self.equal_diagnostics_no_related_info(d1, d2)
            && r1.len() == r2.len()
            && r1
                .iter()
                .zip(r2)
                .all(|(a, b)| self.equal_diagnostics_at(*a, *b, depth + 1))
    }

    pub fn equal_diagnostics_no_related_info(&self, d1: DiagnosticId, d2: DiagnosticId) -> bool {
        if d1 == d2 {
            return true;
        }
        let (a, b) = (&self.store[d1], &self.store[d2]);
        self.get_diagnostic_path(d1) == self.get_diagnostic_path(d2)
            && a.loc == b.loc
            && a.code == b.code
            && a.category == b.category
            && a.source == b.source
            && self.compare_message_identity(d1, d2) == 0
            && a.message_args == b.message_args
            && a.message_chain.len() == b.message_chain.len()
            && a.message_chain
                .iter()
                .zip(&b.message_chain)
                .all(|(x, y)| self.equal_message_chain(*x, *y, 0))
    }

    fn get_diagnostic_message_identity(&self, d: DiagnosticId) -> MessageIdentity<'a> {
        let diagnostic = &self.store[d];
        if !diagnostic.message_text.is_empty() {
            return MessageIdentity::Text(&diagnostic.message_text);
        }
        // message.String() of a message made by NewAdHocMessage: its text is the message text of the diagnostic.
        if !diagnostic.message.is_nil() && diagnostic.code == -1 {
            return MessageIdentity::Text(&diagnostic.message_text);
        }
        MessageIdentity::Owned(diagnostic.message_key())
    }

    // Two table messages with one code have one key, so the keys are only built when something else is compared.
    fn compare_message_identity(&self, d1: DiagnosticId, d2: DiagnosticId) -> isize {
        let (a, b) = (&self.store[d1], &self.store[d2]);
        if a.message == b.message
            && a.message.is_valid()
            && a.message_text.is_empty()
            && b.message_text.is_empty()
            && a.message_key.is_empty()
            && b.message_key.is_empty()
        {
            return 0;
        }
        strings::compare(
            self.get_diagnostic_message_identity(d1).bytes(),
            self.get_diagnostic_message_identity(d2).bytes(),
        )
    }

    fn equal_message_chain(&self, c1: DiagnosticId, c2: DiagnosticId, depth: u32) -> bool {
        if c1 == c2 {
            return true;
        }
        if depth > MAX_NESTING {
            return false;
        }
        let (a, b) = (&self.store[c1], &self.store[c2]);
        a.code == b.code
            && a.message_args == b.message_args
            && a.message_chain.len() == b.message_chain.len()
            && a.message_chain
                .iter()
                .zip(&b.message_chain)
                .all(|(x, y)| self.equal_message_chain(*x, *y, depth + 1))
    }

    fn compare_message_chain_size(
        &self,
        c1: &[DiagnosticId],
        c2: &[DiagnosticId],
        depth: u32,
    ) -> isize {
        let c = compare_lengths(c2.len(), c1.len());
        if c != 0 || depth > MAX_NESTING {
            return c;
        }
        for (a, b) in c1.iter().zip(c2) {
            let c = self.compare_message_chain_size(
                &self.store[*a].message_chain,
                &self.store[*b].message_chain,
                depth + 1,
            );
            if c != 0 {
                return c;
            }
        }
        0
    }

    fn compare_message_chain_content(
        &self,
        c1: &[DiagnosticId],
        c2: &[DiagnosticId],
        depth: u32,
    ) -> isize {
        if depth > MAX_NESTING {
            return 0;
        }
        for (a, b) in c1.iter().zip(c2) {
            let (a, b) = (&self.store[*a], &self.store[*b]);
            let c = compare_string_slices(&a.message_args, &b.message_args);
            if c != 0 {
                return c;
            }
            if !a.message_chain.is_empty() {
                let c = self.compare_message_chain_content(
                    &a.message_chain,
                    &b.message_chain,
                    depth + 1,
                );
                if c != 0 {
                    return c;
                }
            }
        }
        0
    }

    fn compare_related_info(&self, r1: &[DiagnosticId], r2: &[DiagnosticId], depth: u32) -> isize {
        let c = compare_lengths(r2.len(), r1.len());
        if c != 0 {
            return c;
        }
        for (a, b) in r1.iter().zip(r2) {
            let c = self.compare_diagnostics_at(*a, *b, depth + 1);
            if c != 0 {
                return c;
            }
        }
        0
    }

    pub fn compare_diagnostics(&self, d1: DiagnosticId, d2: DiagnosticId) -> isize {
        self.compare_diagnostics_at(d1, d2, 0)
    }

    fn compare_diagnostics_at(&self, d1: DiagnosticId, d2: DiagnosticId, depth: u32) -> isize {
        if d1 == d2 || depth > MAX_NESTING {
            return 0;
        }
        let (a, b) = (&self.store[d1], &self.store[d2]);
        let c = strings::compare(self.get_diagnostic_path(d1), self.get_diagnostic_path(d2));
        if c != 0 {
            return c;
        }
        let c = (a.loc.pos() as isize) - (b.loc.pos() as isize);
        if c != 0 {
            return c;
        }
        let c = (a.loc.end() as isize) - (b.loc.end() as isize);
        if c != 0 {
            return c;
        }
        let c = (a.code as isize) - (b.code as isize);
        if c != 0 {
            return c;
        }
        let c = (a.category as isize) - (b.category as isize);
        if c != 0 {
            return c;
        }
        let c = strings::compare(&a.source, &b.source);
        if c != 0 {
            return c;
        }
        let c = self.compare_message_identity(d1, d2);
        if c != 0 {
            return c;
        }
        let c = compare_string_slices(&a.message_args, &b.message_args);
        if c != 0 {
            return c;
        }
        let c = self.compare_message_chain_size(&a.message_chain, &b.message_chain, 0);
        if c != 0 {
            return c;
        }
        let c = self.compare_message_chain_content(&a.message_chain, &b.message_chain, 0);
        if c != 0 {
            return c;
        }
        self.compare_related_info(&a.related_information, &b.related_information, depth)
    }
}

// diagnosticLocationKey: the root of the file stands for its path.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug, Default)]
struct DiagnosticLocationKey {
    file: NodeId,
    pos: i32,
    end: i32,
    code: i32,
}

// ast.DiagnosticsCollection without its mutex: a collection belongs to one checker, and its diagnostics are ids of the store of the view that each method takes.
#[derive(Default)]
pub struct DiagnosticsCollection {
    count: usize,
    // The files in the order of their first diagnostic: get_diagnostics walks them in it, where upstream ranges over a map.
    file_order: Vec<NodeId>,
    file_diagnostics: MapImpl<NodeId, Vec<DiagnosticId>>,
    file_diagnostics_sorted: MapImpl<NodeId, ()>,
    non_file_diagnostics: Vec<DiagnosticId>,
    non_file_diagnostics_sorted: bool,
    diagnostic_index: MapImpl<DiagnosticLocationKey, DiagnosticId>,
    diagnostic_collisions: MapImpl<DiagnosticLocationKey, Vec<DiagnosticId>>,
}

fn get_diagnostic_location_key(diagnostic: &Diagnostic) -> DiagnosticLocationKey {
    DiagnosticLocationKey {
        file: diagnostic.file,
        pos: diagnostic.loc.pos(),
        end: diagnostic.loc.end(),
        code: diagnostic.code,
    }
}

impl DiagnosticsCollection {
    pub fn add<F: SourceFiles + ?Sized>(
        &mut self,
        d: Diagnostics<'_, F>,
        diagnostic: DiagnosticId,
    ) -> DiagnosticId {
        // A nil diagnostic is not collected: upstream dereferences it.
        if diagnostic.is_nil() {
            return diagnostic;
        }
        let key = get_diagnostic_location_key(&d.store[diagnostic]);
        let existing = self.diagnostic_index.get(&key).copied();
        if let Some(existing) = existing {
            if d.equal_diagnostics(existing, diagnostic) {
                return existing;
            }
            if let Some(collisions) = self.diagnostic_collisions.get(&key) {
                for &collision in collisions {
                    if d.equal_diagnostics(collision, diagnostic) {
                        return collision;
                    }
                }
            }
            self.diagnostic_collisions
                .entry(key)
                .or_default()
                .push(diagnostic);
        } else {
            self.diagnostic_index.insert(key, diagnostic);
        }
        self.count += 1;
        let file = d.store[diagnostic].file;
        if !file.is_nil() {
            if !self.file_diagnostics.contains_key(&file) {
                self.file_order.push(file);
            }
            self.file_diagnostics
                .entry(file)
                .or_default()
                .push(diagnostic);
            self.file_diagnostics_sorted.remove(&file);
        } else {
            self.non_file_diagnostics.push(diagnostic);
            self.non_file_diagnostics_sorted = false;
        }
        diagnostic
    }

    pub fn lookup<F: SourceFiles + ?Sized>(
        &mut self,
        d: Diagnostics<'_, F>,
        diagnostic: DiagnosticId,
    ) -> DiagnosticId {
        let file = d.store[diagnostic].file;
        let diagnostics = if !file.is_nil() {
            self.get_diagnostics_for_file(d, file)
        } else {
            self.get_global_diagnostics(d)
        };
        let (i, ok) = slices::binary_search_func(&diagnostics, diagnostic, |a, b| {
            d.compare_diagnostics(a, b)
        });
        if ok {
            return diagnostics.get(i).copied().unwrap_or_default();
        }
        DiagnosticId::NIL
    }

    pub fn get_global_diagnostics<F: SourceFiles + ?Sized>(
        &mut self,
        d: Diagnostics<'_, F>,
    ) -> Vec<DiagnosticId> {
        if !self.non_file_diagnostics_sorted {
            slices::sort_stable_func(&mut self.non_file_diagnostics, |a, b| {
                d.compare_diagnostics(a, b)
            });
            self.non_file_diagnostics_sorted = true;
        }
        self.non_file_diagnostics.clone()
    }

    pub fn get_diagnostics_for_file<F: SourceFiles + ?Sized>(
        &mut self,
        d: Diagnostics<'_, F>,
        file: NodeId,
    ) -> Vec<DiagnosticId> {
        let Some(list) = self.file_diagnostics.get_mut(&file) else {
            return Vec::new();
        };
        if self.file_diagnostics_sorted.insert(file, ()).is_none() {
            slices::sort_stable_func(list, |a, b| d.compare_diagnostics(a, b));
        }
        list.clone()
    }

    pub fn get_diagnostics<F: SourceFiles + ?Sized>(
        &self,
        d: Diagnostics<'_, F>,
    ) -> Vec<DiagnosticId> {
        let mut diagnostics = Vec::with_capacity(self.count);
        diagnostics.extend_from_slice(&self.non_file_diagnostics);
        for file in &self.file_order {
            if let Some(list) = self.file_diagnostics.get(file) {
                diagnostics.extend_from_slice(list);
            }
        }
        slices::sort_func(&mut diagnostics, |a, b| d.compare_diagnostics(a, b));
        diagnostics
    }
}

// Go's `slices` sorting, statement for statement, so that the sequence of comparator calls is upstream's.
mod slices {
    pub(super) fn binary_search_func<E: Copy, T: Copy>(
        x: &[E],
        target: T,
        mut cmp: impl FnMut(E, T) -> isize,
    ) -> (usize, bool) {
        let n = x.len();
        let (mut i, mut j) = (0usize, n);
        while i < j {
            let h = (i + j) >> 1;
            let Some(&probe) = x.get(h) else { break };
            if cmp(probe, target) < 0 {
                i = h + 1;
            } else {
                j = h;
            }
        }
        let found = match x.get(i) {
            Some(&probe) => cmp(probe, target) == 0,
            None => false,
        };
        (i, found)
    }

    fn insertion_sort_cmp_func<E: Copy>(
        data: &mut [E],
        a: usize,
        b: usize,
        cmp: &mut impl FnMut(E, E) -> isize,
    ) {
        let mut i = a + 1;
        while i < b {
            let mut j = i;
            while j > a {
                let (Some(&x), Some(&y)) = (data.get(j), data.get(j - 1)) else {
                    break;
                };
                if !(cmp(x, y) < 0) {
                    break;
                }
                data.swap(j, j - 1);
                j -= 1;
            }
            i += 1;
        }
    }

    fn swap_range<E: Copy>(data: &mut [E], a: usize, b: usize, n: usize) {
        for i in 0..n {
            if a + i < data.len() && b + i < data.len() {
                data.swap(a + i, b + i);
            }
        }
    }

    fn rotate<E: Copy>(data: &mut [E], a: usize, m: usize, b: usize) {
        let mut i = m - a;
        let mut j = b - m;
        while i != j {
            if i > j {
                swap_range(data, m - i, m, j);
                i -= j;
            } else {
                swap_range(data, m - i, m + j - i, i);
                j -= i;
            }
        }
        swap_range(data, m - i, m, i);
    }

    fn less<E: Copy>(data: &[E], x: usize, y: usize, cmp: &mut impl FnMut(E, E) -> isize) -> bool {
        match (data.get(x), data.get(y)) {
            (Some(&p), Some(&q)) => cmp(p, q) < 0,
            _ => false,
        }
    }

    fn sym_merge<E: Copy>(
        data: &mut [E],
        a: usize,
        m: usize,
        b: usize,
        cmp: &mut impl FnMut(E, E) -> isize,
    ) {
        if m - a == 1 {
            let (mut i, mut j) = (m, b);
            while i < j {
                let h = (i + j) >> 1;
                if less(data, h, a, cmp) {
                    i = h + 1;
                } else {
                    j = h;
                }
            }
            let mut k = a;
            while k + 1 < i {
                data.swap(k, k + 1);
                k += 1;
            }
            return;
        }
        if b - m == 1 {
            let (mut i, mut j) = (a, m);
            while i < j {
                let h = (i + j) >> 1;
                if !less(data, m, h, cmp) {
                    i = h + 1;
                } else {
                    j = h;
                }
            }
            let mut k = m;
            while k > i {
                data.swap(k, k - 1);
                k -= 1;
            }
            return;
        }
        let mid = (a + b) >> 1;
        let n = mid + m;
        let (mut start, mut r) = if m > mid { (n - b, mid) } else { (a, m) };
        let p = n - 1;
        while start < r {
            let c = (start + r) >> 1;
            if !less(data, p - c, c, cmp) {
                start = c + 1;
            } else {
                r = c;
            }
        }
        let end = n - start;
        if start < m && m < end {
            rotate(data, start, m, end);
        }
        if a < start && start < mid {
            sym_merge(data, a, start, mid, cmp);
        }
        if mid < end && end < b {
            sym_merge(data, mid, end, b, cmp);
        }
    }

    pub(super) fn sort_stable_func<E: Copy>(data: &mut [E], mut cmp: impl FnMut(E, E) -> isize) {
        let n = data.len();
        let mut block_size = 20usize;
        let (mut a, mut b) = (0usize, block_size);
        while b <= n {
            insertion_sort_cmp_func(data, a, b, &mut cmp);
            a = b;
            b += block_size;
        }
        insertion_sort_cmp_func(data, a, n, &mut cmp);
        while block_size < n {
            a = 0;
            b = 2 * block_size;
            while b <= n {
                sym_merge(data, a, a + block_size, b, &mut cmp);
                a = b;
                b += 2 * block_size;
            }
            let m = a + block_size;
            if m < n {
                sym_merge(data, a, m, n, &mut cmp);
            }
            block_size *= 2;
        }
    }

    // slices.SortFunc: pdqsortCmpFunc of zsortanyfunc.go, statement for statement.
    pub(super) fn sort_func<E: Copy>(data: &mut [E], mut cmp: impl FnMut(E, E) -> isize) {
        let n = data.len();
        let limit = (usize::BITS - n.leading_zeros()) as usize;
        pdqsort_cmp_func(data, 0, n, limit, &mut cmp);
    }

    fn swap_at<E: Copy>(data: &mut [E], i: usize, j: usize) {
        if i < data.len() && j < data.len() {
            data.swap(i, j);
        }
    }

    fn sift_down_cmp_func<E: Copy>(
        data: &mut [E],
        lo: usize,
        hi: usize,
        first: usize,
        cmp: &mut impl FnMut(E, E) -> isize,
    ) {
        let mut root = lo;
        loop {
            let mut child = 2 * root + 1;
            if child >= hi {
                break;
            }
            if child + 1 < hi && less(data, first + child, first + child + 1, cmp) {
                child += 1;
            }
            if !less(data, first + root, first + child, cmp) {
                return;
            }
            swap_at(data, first + root, first + child);
            root = child;
        }
    }

    fn heap_sort_cmp_func<E: Copy>(
        data: &mut [E],
        a: usize,
        b: usize,
        cmp: &mut impl FnMut(E, E) -> isize,
    ) {
        let first = a;
        let lo = 0;
        let hi = b - a;
        let mut i = hi.saturating_sub(1) / 2 + 1;
        while i > 0 {
            i -= 1;
            sift_down_cmp_func(data, i, hi, first, cmp);
        }
        let mut i = hi;
        while i > 0 {
            i -= 1;
            swap_at(data, first, first + i);
            sift_down_cmp_func(data, lo, i, first, cmp);
        }
    }

    #[derive(Clone, Copy, PartialEq, Eq)]
    enum SortedHint {
        Unknown,
        Increasing,
        Decreasing,
    }

    fn pdqsort_cmp_func<E: Copy>(
        data: &mut [E],
        mut a: usize,
        mut b: usize,
        mut limit: usize,
        cmp: &mut impl FnMut(E, E) -> isize,
    ) {
        const MAX_INSERTION: usize = 12;
        let mut was_balanced = true;
        let mut was_partitioned = true;
        loop {
            let length = b - a;
            if length <= MAX_INSERTION {
                insertion_sort_cmp_func(data, a, b, cmp);
                return;
            }
            // Fall back to heapsort if too many bad choices were made.
            if limit == 0 {
                heap_sort_cmp_func(data, a, b, cmp);
                return;
            }
            // If the last partitioning was imbalanced, we need to breaking patterns.
            if !was_balanced {
                break_patterns_cmp_func(data, a, b);
                limit -= 1;
            }
            let (mut pivot, mut hint) = choose_pivot_cmp_func(data, a, b, cmp);
            if hint == SortedHint::Decreasing {
                reverse_range_cmp_func(data, a, b);
                pivot = (b - 1) - (pivot - a);
                hint = SortedHint::Increasing;
            }
            // The slice is likely already sorted.
            if was_balanced
                && was_partitioned
                && hint == SortedHint::Increasing
                && partial_insertion_sort_cmp_func(data, a, b, cmp)
            {
                return;
            }
            // Probably the slice contains many duplicate elements.
            if a > 0 && !less(data, a - 1, pivot, cmp) {
                let mid = partition_equal_cmp_func(data, a, b, pivot, cmp);
                a = mid;
                continue;
            }
            let (mid, already_partitioned) = partition_cmp_func(data, a, b, pivot, cmp);
            was_partitioned = already_partitioned;
            let (left_len, right_len) = (mid - a, b - mid);
            let balance_threshold = length / 8;
            if left_len < right_len {
                was_balanced = left_len >= balance_threshold;
                pdqsort_cmp_func(data, a, mid, limit, cmp);
                a = mid + 1;
            } else {
                was_balanced = right_len >= balance_threshold;
                pdqsort_cmp_func(data, mid + 1, b, limit, cmp);
                b = mid;
            }
        }
    }

    fn partition_cmp_func<E: Copy>(
        data: &mut [E],
        a: usize,
        b: usize,
        pivot: usize,
        cmp: &mut impl FnMut(E, E) -> isize,
    ) -> (usize, bool) {
        swap_at(data, a, pivot);
        // i and j are inclusive of the elements remaining to be partitioned
        let (mut i, mut j) = (a as isize + 1, b as isize - 1);
        while i <= j && less(data, i as usize, a, cmp) {
            i += 1;
        }
        while i <= j && !less(data, j as usize, a, cmp) {
            j -= 1;
        }
        if i > j {
            swap_at(data, j as usize, a);
            return (j as usize, true);
        }
        swap_at(data, i as usize, j as usize);
        i += 1;
        j -= 1;
        loop {
            while i <= j && less(data, i as usize, a, cmp) {
                i += 1;
            }
            while i <= j && !less(data, j as usize, a, cmp) {
                j -= 1;
            }
            if i > j {
                break;
            }
            swap_at(data, i as usize, j as usize);
            i += 1;
            j -= 1;
        }
        swap_at(data, j as usize, a);
        (j as usize, false)
    }

    fn partition_equal_cmp_func<E: Copy>(
        data: &mut [E],
        a: usize,
        b: usize,
        pivot: usize,
        cmp: &mut impl FnMut(E, E) -> isize,
    ) -> usize {
        swap_at(data, a, pivot);
        let (mut i, mut j) = (a as isize + 1, b as isize - 1);
        loop {
            while i <= j && !less(data, a, i as usize, cmp) {
                i += 1;
            }
            while i <= j && less(data, a, j as usize, cmp) {
                j -= 1;
            }
            if i > j {
                break;
            }
            swap_at(data, i as usize, j as usize);
            i += 1;
            j -= 1;
        }
        i as usize
    }

    fn partial_insertion_sort_cmp_func<E: Copy>(
        data: &mut [E],
        a: usize,
        b: usize,
        cmp: &mut impl FnMut(E, E) -> isize,
    ) -> bool {
        const MAX_STEPS: usize = 5;
        const SHORTEST_SHIFTING: usize = 50;
        let mut i = a + 1;
        for _ in 0..MAX_STEPS {
            while i < b && !less(data, i, i - 1, cmp) {
                i += 1;
            }
            if i == b {
                return true;
            }
            if b - a < SHORTEST_SHIFTING {
                return false;
            }
            swap_at(data, i, i - 1);
            // Shift the smaller one to the left.
            if i - a >= 2 {
                let mut j = i - 1;
                while j >= 1 {
                    if !less(data, j, j - 1, cmp) {
                        break;
                    }
                    swap_at(data, j, j - 1);
                    j -= 1;
                }
            }
            // Shift the greater one to the right.
            if b - i >= 2 {
                let mut j = i + 1;
                while j < b {
                    if !less(data, j, j - 1, cmp) {
                        break;
                    }
                    swap_at(data, j, j - 1);
                    j += 1;
                }
            }
        }
        false
    }

    fn break_patterns_cmp_func<E: Copy>(data: &mut [E], a: usize, b: usize) {
        let length = b - a;
        if length >= 8 {
            let mut random = length as u64;
            let modulus = 1usize << (usize::BITS - length.leading_zeros());
            let mut idx = a + (length / 4) * 2 - 1;
            while idx <= a + (length / 4) * 2 + 1 {
                random ^= random << 13;
                random ^= random >> 7;
                random ^= random << 17;
                let mut other = (random as usize) & (modulus - 1);
                if other >= length {
                    other -= length;
                }
                swap_at(data, idx, a + other);
                idx += 1;
            }
        }
    }

    fn choose_pivot_cmp_func<E: Copy>(
        data: &[E],
        a: usize,
        b: usize,
        cmp: &mut impl FnMut(E, E) -> isize,
    ) -> (usize, SortedHint) {
        const SHORTEST_NINTHER: usize = 50;
        const MAX_SWAPS: usize = 4 * 3;
        let l = b - a;
        let mut swaps = 0usize;
        let mut i = a + l / 4;
        let mut j = a + l / 4 * 2;
        let mut k = a + l / 4 * 3;
        if l >= 8 {
            if l >= SHORTEST_NINTHER {
                // Tukey ninther method, the idea came from Rust's implementation.
                i = median_adjacent_cmp_func(data, i, &mut swaps, cmp);
                j = median_adjacent_cmp_func(data, j, &mut swaps, cmp);
                k = median_adjacent_cmp_func(data, k, &mut swaps, cmp);
            }
            // Find the median among i, j, k and stores it into j.
            j = median_cmp_func(data, i, j, k, &mut swaps, cmp);
        }
        match swaps {
            0 => (j, SortedHint::Increasing),
            MAX_SWAPS => (j, SortedHint::Decreasing),
            _ => (j, SortedHint::Unknown),
        }
    }

    fn order2_cmp_func<E: Copy>(
        data: &[E],
        a: usize,
        b: usize,
        swaps: &mut usize,
        cmp: &mut impl FnMut(E, E) -> isize,
    ) -> (usize, usize) {
        if less(data, b, a, cmp) {
            *swaps += 1;
            return (b, a);
        }
        (a, b)
    }

    fn median_cmp_func<E: Copy>(
        data: &[E],
        a: usize,
        b: usize,
        c: usize,
        swaps: &mut usize,
        cmp: &mut impl FnMut(E, E) -> isize,
    ) -> usize {
        let (a, b) = order2_cmp_func(data, a, b, swaps, cmp);
        let (b, _c) = order2_cmp_func(data, b, c, swaps, cmp);
        let (_a, b) = order2_cmp_func(data, a, b, swaps, cmp);
        b
    }

    fn median_adjacent_cmp_func<E: Copy>(
        data: &[E],
        a: usize,
        swaps: &mut usize,
        cmp: &mut impl FnMut(E, E) -> isize,
    ) -> usize {
        median_cmp_func(data, a - 1, a, a + 1, swaps, cmp)
    }

    fn reverse_range_cmp_func<E: Copy>(data: &mut [E], a: usize, b: usize) {
        let mut i = a;
        let mut j = b - 1;
        while i < j {
            swap_at(data, i, j);
            i += 1;
            j -= 1;
        }
    }
}
