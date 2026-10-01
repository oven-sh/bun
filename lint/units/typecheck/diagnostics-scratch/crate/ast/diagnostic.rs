// Port of internal/ast/diagnostic.go.
use crate::arena::Arena;
use crate::core::TextRange;
use crate::diagnostics::{self, Category, Locale, MessageId};
use crate::ids::{DiagnosticId, NodeId};
use crate::slices::{binary_search_func, sort_func, sort_stable_func};
use core::cmp::Ordering;
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

pub struct DiagnosticStore {
    arena: Arena<DiagnosticId, Diagnostic>,
    faults: Vec<InvalidPlaceholderFault>,
    fault_count: u32,
}

impl Default for DiagnosticStore {
    fn default() -> Self {
        Self {
            arena: Arena::new(),
            faults: Vec::new(),
            fault_count: 0,
        }
    }
}

impl core::ops::Index<DiagnosticId> for DiagnosticStore {
    type Output = Diagnostic;
    fn index(&self, id: DiagnosticId) -> &Diagnostic {
        self.arena.get(id)
    }
}
impl core::ops::IndexMut<DiagnosticId> for DiagnosticStore {
    fn index_mut(&mut self, id: DiagnosticId) -> &mut Diagnostic {
        self.arena.get_mut(id)
    }
}

impl DiagnosticStore {
    pub const MAX_KEPT_FAULTS: usize = 64;

    pub fn fault_count(&self) -> u32 {
        self.fault_count
    }
    // The owner turns each fault into an internal diagnostic.
    pub fn take_faults(&mut self) -> Vec<InvalidPlaceholderFault> {
        core::mem::take(&mut self.faults)
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
        self.arena.alloc(Diagnostic {
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
        self.new_diagnostic(NodeId::NIL, TextRange::undefined(), message, args)
    }
    // NewCompilerDiagnostic(diagnostics.NewAdHocMessage(text)).
    pub fn new_ad_hoc_diagnostic(
        &mut self,
        file: NodeId,
        loc: TextRange,
        text: &[u8],
    ) -> DiagnosticId {
        self.arena.alloc(Diagnostic {
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
        self.arena.alloc(copy)
    }
}

const MAX_NESTING: u32 = 200;

// strings.Compare
fn compare_strings(a: &[u8], b: &[u8]) -> isize {
    match a.cmp(b) {
        Ordering::Less => -1,
        Ordering::Equal => 0,
        Ordering::Greater => 1,
    }
}

// slices.Compare over string slices
fn compare_string_slices(a: &[Box<[u8]>], b: &[Box<[u8]>]) -> isize {
    for (x, y) in a.iter().zip(b) {
        let c = compare_strings(x, y);
        if c != 0 {
            return c;
        }
    }
    compare_lengths(a.len(), b.len())
}

fn compare_lengths(a: usize, b: usize) -> isize {
    (a as isize).wrapping_sub(b as isize)
}

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
        compare_strings(
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
        let c = compare_strings(self.get_diagnostic_path(d1), self.get_diagnostic_path(d2));
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
        let c = compare_strings(&a.source, &b.source);
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

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug, Default)]
struct DiagnosticLocationKey {
    file: NodeId,
    pos: i32,
    end: i32,
    code: i32,
}

#[derive(Default)]
pub struct DiagnosticsCollection {
    count: usize,
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
        let (i, ok) =
            binary_search_func(&diagnostics, diagnostic, |a, b| d.compare_diagnostics(a, b));
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
            sort_stable_func(&mut self.non_file_diagnostics, |a, b| {
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
            sort_stable_func(list, |a, b| d.compare_diagnostics(a, b));
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
        sort_func(&mut diagnostics, |a, b| d.compare_diagnostics(a, b));
        diagnostics
    }
}
