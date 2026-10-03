// A file that stands alone: stand-ins with the shapes of ast/reader.rs, ast/open.rs, printer/{emittextwriter,singlelinestringwriter,semicolon_writer,factory,printer}.rs and checker/{nodebuilder,printer}.rs of src/typecheck, to ask rustc about lifetimes only. No file of the crate is part of it: fewer members, fewer methods, a number where the tree has a type or a signature id.
// Run from the worktree, for its toolchain: rustc --edition 2024 --crate-type lib --emit=metadata -o /tmp/printer-lifetimes-probe.rmeta <this file>
// With `--cfg one_lifetime --check-cfg 'cfg(one_lifetime)'` the printer has one lifetime for the tree and for its borrows, as before ea3e7925bb: rustc then rejects its two callers (7 errors).
#![deny(warnings)]
#![deny(unused_imports, unused_variables, unused_mut)]
#![allow(dead_code)]
use std::cell::RefCell;

#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub struct NodeId(pub u32);
impl NodeId {
    pub const NIL: Self = Self(0);
    pub const fn is_nil(self) -> bool {
        self.0 == 0
    }
}

// Invariant in 'a, as ast/open.rs: a RefCell of data with the lifetime of the tree.
pub struct Open<'a> {
    pub texts: RefCell<Vec<&'a [u8]>>,
}

pub struct Frozen<'a> {
    pub files: Vec<&'a u8>,
}

#[derive(Clone, Copy)]
pub struct Ast<'a> {
    pub frozen: &'a Frozen<'a>,
    pub open: &'a Open<'a>,
}

impl<'a> Ast<'a> {
    pub fn text(self, node: NodeId) -> &'a [u8] {
        self.open
            .texts
            .borrow()
            .get(node.0 as usize)
            .copied()
            .unwrap_or(b"")
    }
}

pub trait EmitTextWriter {
    fn write(&mut self, s: &[u8]);
    fn write_trailing_semicolon(&mut self, text: &[u8]);
    fn clear(&mut self);
    fn string(&self) -> &[u8];
}

impl<W: EmitTextWriter + ?Sized> EmitTextWriter for &mut W {
    fn write(&mut self, s: &[u8]) {
        (**self).write(s);
    }
    fn write_trailing_semicolon(&mut self, text: &[u8]) {
        (**self).write_trailing_semicolon(text);
    }
    fn clear(&mut self) {
        (**self).clear();
    }
    fn string(&self) -> &[u8] {
        (**self).string()
    }
}

#[derive(Default)]
pub struct SingleLineStringWriter {
    builder: Vec<u8>,
}

impl EmitTextWriter for SingleLineStringWriter {
    fn write(&mut self, s: &[u8]) {
        self.builder.extend_from_slice(s);
    }
    fn write_trailing_semicolon(&mut self, text: &[u8]) {
        self.builder.extend_from_slice(text);
    }
    fn clear(&mut self) {
        self.builder.clear();
    }
    fn string(&self) -> &[u8] {
        &self.builder
    }
}

pub fn get_single_line_string_writer() -> Box<dyn EmitTextWriter> {
    let mut w = SingleLineStringWriter::default();
    w.clear();
    Box::new(w)
}

pub fn new_text_writer(new_line: &[u8], _indent_size: isize) -> Box<dyn EmitTextWriter> {
    let mut w = SingleLineStringWriter {
        builder: new_line.to_vec(),
    };
    w.clear();
    Box::new(w)
}

pub struct TrailingSemicolonDeferringWriter<'w> {
    inner: Box<dyn EmitTextWriter + 'w>,
    has_pending_semicolon: bool,
}

pub fn get_trailing_semicolon_deferring_writer<'w>(
    writer: Box<dyn EmitTextWriter + 'w>,
) -> Box<dyn EmitTextWriter + 'w> {
    Box::new(TrailingSemicolonDeferringWriter {
        inner: writer,
        has_pending_semicolon: false,
    })
}

impl EmitTextWriter for TrailingSemicolonDeferringWriter<'_> {
    fn write(&mut self, s: &[u8]) {
        if self.has_pending_semicolon {
            self.inner.write_trailing_semicolon(b";");
            self.has_pending_semicolon = false;
        }
        self.inner.write(s);
    }
    fn write_trailing_semicolon(&mut self, _text: &[u8]) {
        self.has_pending_semicolon = true;
    }
    fn clear(&mut self) {
        self.has_pending_semicolon = false;
        self.inner.clear();
    }
    fn string(&self) -> &[u8] {
        self.inner.string()
    }
}

#[derive(Default)]
pub struct EmitContext {
    pub created: u32,
}

impl EmitContext {
    pub fn emit_flags(&self, node: NodeId) -> u32 {
        node.0 + self.created
    }
    pub fn add_emit_flags(&mut self, _node: NodeId, _flags: u32) {
        self.created += 1;
    }
}

#[derive(Clone, Copy, Default)]
pub struct PrinterOptions {
    pub remove_comments: bool,
    pub omit_trailing_semicolon: bool,
    pub never_ascii_escape: bool,
}

#[derive(Default)]
pub struct PrintHandlers {
    pub has_global_name: Option<Box<dyn Fn(&[u8]) -> bool>>,
    pub on_before_emit_node: Option<Box<dyn FnMut(NodeId)>>,
}

// The factory of printer/factory.rs, which the printer makes with its tree and a reborrow of its context.
pub struct NodeFactory<'a, 'c> {
    a: Ast<'a>,
    emit_context: &'c mut EmitContext,
}

pub fn new_node_factory<'a, 'c>(a: Ast<'a>, context: &'c mut EmitContext) -> NodeFactory<'a, 'c> {
    NodeFactory {
        a,
        emit_context: context,
    }
}

impl NodeFactory<'_, '_> {
    pub fn new_token(&mut self, kind: u32) -> NodeId {
        self.emit_context.created += 1;
        NodeId(kind + self.a.text(NodeId(kind)).len() as u32)
    }
}

#[cfg(not(one_lifetime))]
pub struct Printer<'a, 'p> {
    a: Ast<'a>,
    handlers: PrintHandlers,
    pub options: PrinterOptions,
    emit_context: &'p mut EmitContext,
    current_source_file: NodeId,
    writer: Option<Box<dyn EmitTextWriter + 'p>>,
    sink: SingleLineStringWriter,
}

#[cfg(not(one_lifetime))]
pub fn new_printer<'a, 'p>(
    a: Ast<'a>,
    options: PrinterOptions,
    handlers: PrintHandlers,
    emit_context: &'p mut EmitContext,
) -> Printer<'a, 'p> {
    Printer {
        a,
        handlers,
        options,
        emit_context,
        current_source_file: NodeId::NIL,
        writer: None,
        sink: SingleLineStringWriter::default(),
    }
}

#[cfg(one_lifetime)]
pub struct Printer<'p> {
    a: Ast<'p>,
    handlers: PrintHandlers,
    pub options: PrinterOptions,
    emit_context: &'p mut EmitContext,
    current_source_file: NodeId,
    writer: Option<Box<dyn EmitTextWriter + 'p>>,
    sink: SingleLineStringWriter,
}

#[cfg(one_lifetime)]
pub fn new_printer<'p>(
    a: Ast<'p>,
    options: PrinterOptions,
    handlers: PrintHandlers,
    emit_context: &'p mut EmitContext,
) -> Printer<'p> {
    Printer {
        a,
        handlers,
        options,
        emit_context,
        current_source_file: NodeId::NIL,
        writer: None,
        sink: SingleLineStringWriter::default(),
    }
}

macro_rules! printer_impls {
    ([$($named:tt)*], [$($anon:tt)*]) => {
        impl<'p> Printer<$($named)*> {
            // `p.writer`
            fn w(&mut self) -> &mut (dyn EmitTextWriter + 'p) {
                let Self { writer, sink, .. } = self;
                match writer.as_deref_mut() {
                    Some(writer) => writer,
                    None => sink,
                }
            }

            fn write(&mut self, text: &[u8]) {
                self.w().write(text);
            }

            fn should_emit_indented(&self, node: NodeId) -> bool {
                self.emit_context.emit_flags(node) != 0
            }
        }

        impl Printer<$($anon)*> {
            fn emit_identifier_name(&mut self, node: NodeId) {
                let a = self.a;
                if let Some(on_before_emit_node) = self.handlers.on_before_emit_node.as_mut() {
                    on_before_emit_node(node);
                }
                let token = new_node_factory(a, self.emit_context).new_token(7);
                self.emit_context.add_emit_flags(token, 1);
                if self.should_emit_indented(token) {
                    self.write(b" ");
                }
                self.write(a.text(node));
            }
        }

        // Entry points
        impl<'p> Printer<$($named)*> {
            fn set_source_file(&mut self, source_file: NodeId) {
                self.current_source_file = source_file;
            }

            pub fn write_exported(
                &mut self,
                node: NodeId,
                source_file: NodeId,
                writer: &'p mut (dyn EmitTextWriter + 'p),
            ) {
                let saved_current_source_file = self.current_source_file;
                let saved_writer = self.writer.take();

                self.set_source_file(source_file);
                let mut writer: Box<dyn EmitTextWriter + 'p> = Box::new(writer);
                if self.options.omit_trailing_semicolon {
                    writer = get_trailing_semicolon_deferring_writer(writer);
                }
                self.writer = Some(writer);
                self.w().clear();

                if !node.is_nil() {
                    self.emit_identifier_name(node);
                }

                self.current_source_file = saved_current_source_file;
                self.writer = saved_writer;
            }
        }
    };
}

#[cfg(not(one_lifetime))]
printer_impls!(['_, 'p], ['_, '_]);
#[cfg(one_lifetime)]
printer_impls!(['p], ['_]);

// ---- the checker side ----
#[derive(Clone, Copy, Default, Debug)]
pub struct VerbosityContext {
    pub max_truncation_length: isize,
    pub truncated: bool,
}

#[derive(Default)]
pub struct NodeBuilderImplState {
    pub e: EmitContext,
}

#[derive(Default)]
pub struct NodeBuilderState {
    pub impl_: NodeBuilderImplState,
    pub verbosity: Option<VerbosityContext>,
    pub created: bool,
}

pub struct Checker<'a> {
    pub ast: Ast<'a>,
    pub node_builder: NodeBuilderState,
    pub serialization_level: u32,
    pub unresolved_type: u32,
}

#[derive(Clone, Copy, Default)]
pub struct NodeBuilder;

impl NodeBuilder {
    pub fn emit_context<'c>(self, c: &'c mut Checker<'_>) -> &'c mut EmitContext {
        &mut c.node_builder.impl_.e
    }

    pub fn type_to_type_node(self, c: &mut Checker<'_>, typ: u32) -> NodeId {
        c.serialization_level += 0;
        NodeId(typ)
    }
}

impl Checker<'_> {
    pub fn get_node_builder(&mut self) -> NodeBuilder {
        self.node_builder.created = true;
        NodeBuilder
    }
}

pub fn get_source_file_of_node(a: Ast<'_>, node: NodeId) -> NodeId {
    NodeId(a.text(node).len() as u32)
}

#[cfg(not(one_lifetime))]
fn create_printer_with_defaults<'a, 'p>(
    a: Ast<'a>,
    emit_context: &'p mut EmitContext,
) -> Printer<'a, 'p> {
    new_printer(
        a,
        PrinterOptions::default(),
        PrintHandlers::default(),
        emit_context,
    )
}

#[cfg(not(one_lifetime))]
fn create_printer_with_remove_comments_omit_trailing_semicolon<'a, 'p>(
    a: Ast<'a>,
    emit_context: &'p mut EmitContext,
) -> Printer<'a, 'p> {
    new_printer(
        a,
        PrinterOptions {
            remove_comments: true,
            omit_trailing_semicolon: true,
            ..PrinterOptions::default()
        },
        PrintHandlers::default(),
        emit_context,
    )
}

#[cfg(one_lifetime)]
fn create_printer_with_defaults<'p>(a: Ast<'p>, emit_context: &'p mut EmitContext) -> Printer<'p> {
    new_printer(
        a,
        PrinterOptions::default(),
        PrintHandlers::default(),
        emit_context,
    )
}

#[cfg(one_lifetime)]
fn create_printer_with_remove_comments_omit_trailing_semicolon<'p>(
    a: Ast<'p>,
    emit_context: &'p mut EmitContext,
) -> Printer<'p> {
    new_printer(
        a,
        PrinterOptions {
            remove_comments: true,
            omit_trailing_semicolon: true,
            ..PrinterOptions::default()
        },
        PrintHandlers::default(),
        emit_context,
    )
}

impl<'a> Checker<'a> {
    // The shape of type_to_string_ex: a writer made first, two printers in the arms of an `if`, the text read after the block.
    pub fn type_to_string_ex(
        &mut self,
        t: u32,
        enclosing_declaration: NodeId,
        mut vc: Option<&mut VerbosityContext>,
    ) -> Vec<u8> {
        let mut writer = new_text_writer(b"\n", 0);
        let node_builder = self.get_node_builder();
        let old_verbosity = self.node_builder.verbosity;
        self.node_builder.verbosity = vc.as_deref().copied();
        self.serialization_level += 1;
        let type_node = node_builder.type_to_type_node(self, t);
        self.serialization_level -= 1;
        if let (Some(vc), Some(used)) = (vc.as_deref_mut(), self.node_builder.verbosity) {
            *vc = used;
        }
        self.node_builder.verbosity = old_verbosity;
        let a = self.ast;
        let is_unresolved = t == self.unresolved_type;
        let mut source_file = NodeId::NIL;
        if !enclosing_declaration.is_nil() {
            source_file = get_source_file_of_node(a, enclosing_declaration);
        }
        {
            let emit_context = node_builder.emit_context(self);
            let mut p = if is_unresolved {
                create_printer_with_defaults(a, emit_context)
            } else {
                create_printer_with_remove_comments_omit_trailing_semicolon(a, emit_context)
            };
            p.write_exported(type_node, source_file, &mut *writer);
        }
        let result = writer.string();
        if result.len() > 3 {
            if let Some(vc) = vc.as_deref_mut() {
                vc.truncated = true;
            }
            let mut truncated = result.get(..3).unwrap_or(result).to_vec();
            truncated.extend_from_slice(b"...");
            return truncated;
        }
        result.to_vec()
    }

    // The shape of signature_to_string_ex: the writer picked between two kinds, one printer, the text as the tail expression.
    pub fn signature_to_string_ex(&mut self, sig: NodeId, multiline: bool) -> Vec<u8> {
        let node_builder = self.get_node_builder();
        let a = self.ast;
        let source_file = NodeId::NIL;
        let mut writer = if multiline {
            new_text_writer(b"\n", 0)
        } else {
            get_single_line_string_writer()
        };
        {
            let emit_context = node_builder.emit_context(self);
            let mut p = create_printer_with_remove_comments_omit_trailing_semicolon(a, emit_context);
            p.write_exported(sig, source_file, &mut *writer);
        }
        self.serialization_level += 0;
        writer.string().to_vec()
    }
}
