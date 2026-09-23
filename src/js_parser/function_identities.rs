//! What a bytecode order file (`bun build --compile --bytecode-order`) names a function by: a hash of its syntax tree,
//! from a parse (no visit) of the text JavaScriptCore is given. In it: node kinds, numbers, property names; a binding as
//! the how-manieth declaration of which function around it; a module-level binding as the how-manieth one the function
//! mentions (a minifier renames those, in every build); any other identifier by its spelling; a label or private name
//! by its order; a nested function by its own name; the property a function is the value of. Not in it: what a string says (chunk paths and version stamps
//! change with every build). `start` is where JavaScriptCore says the function starts (`FunctionKind`).

use bun_ast::expr::Data;
use bun_ast::stmt::Data as StmtData;
use bun_ast::{self as ast, Expr, G, Ref, Stmt, StmtOrExpr, b::B};
use bun_collections::HashMap;
use bun_wyhash::Wyhash;

use crate::parse::parse_entry::ParsedOnly;

/// Which of the functions that may start at one place: JavaScriptCore's `OrderFunctionKind`.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
#[repr(u8)]
pub enum FunctionKind {
    Function = 0,
    /// What JavaScriptCore makes of the body of a generator, or of an async function that awaits.
    InnerBody = 1,
    /// Initializes a class's instance fields, or its static fields and static blocks.
    ClassFields = 2,
    /// Of a class that does not write one: named by what the class's members are called.
    DefaultConstructor = 3,
}

impl FunctionKind {
    pub fn from_u8(kind: u8) -> Option<Self> {
        Some(match kind {
            0 => Self::Function,
            1 => Self::InnerBody,
            2 => Self::ClassFields,
            3 => Self::DefaultConstructor,
            _ => return None,
        })
    }
}

/// `JSC::BytecodeOrderNames::Function`.
#[derive(Clone, Copy, Debug)]
#[repr(C)]
pub struct FunctionIdentity {
    /// In UTF-16 code units of the text, which is what JavaScriptCore counts in.
    pub start: u32,
    pub kind: FunctionKind,
    _padding: [u8; 3],
    pub identity: u64,
}

impl FunctionIdentity {
    fn new(start: u32, kind: FunctionKind, identity: u64) -> Self {
        Self {
            start,
            kind,
            _padding: [0; 3],
            identity,
        }
    }
}

#[derive(Default, Debug)]
pub struct FunctionIdentities {
    /// The top-level code. `None`: part of it is nested too deeply to walk.
    pub module: Option<u64>,
    /// Sorted by `(start, kind)`, each once.
    pub functions: Vec<FunctionIdentity>,
}

/// How JavaScriptCore is given the text.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Text {
    /// UTF-8, as a module.
    Module,
    /// UTF-8, as a script: a CommonJS chunk.
    Script,
    /// Latin-1 (a byte is a code unit), in JavaScriptCore's builtin syntax.
    Builtin,
}

impl FunctionIdentities {
    /// `chunk_paths`: the paths of the build's chunks as its texts import them, sorted. `None`: `text` does not parse.
    pub fn of_text(text: &[u8], kind: Text, chunk_paths: &[&[u8]]) -> Option<FunctionIdentities> {
        let first_non_ascii = bun_core::strings::first_non_ascii(text);
        // An internal module is Latin-1, and all of them are ASCII; any other text is UTF-8, or not the text
        // JavaScriptCore counts code units of.
        if first_non_ascii.is_some()
            && (kind == Text::Builtin || !bun_core::strings::is_valid_utf8(text))
        {
            return None;
        }
        let arena = bun_alloc::Arena::new();
        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
        let _ast_scope = ast_memory_allocator.enter();
        let source = bun_ast::Source::init_path_string(&b"chunk.js"[..], text);
        let mut options = crate::ParserOptions::init(Default::default(), bun_ast::Loader::Js);
        options.features.no_macros = true;
        options.features.top_level_await = kind == Text::Module;
        options.jsc_builtin_syntax = kind == Text::Builtin;
        options.suppress_warnings_about_weird_code = true;
        let define = crate::Define::default();
        let mut log = bun_ast::Log::init();
        let parser = crate::Parser::init(options, &mut log, &source, &define, &arena).ok()?;
        let mut identities = parser
            .parse_only(|parsed| Walker::run(parsed, kind, chunk_paths))
            .ok()?;
        if let Some(first_non_ascii) = first_non_ascii {
            starts_in_code_units(&mut identities.functions, text, first_non_ascii as usize);
        }
        Some(identities)
    }

    pub fn find(&self, start: u32, kind: FunctionKind) -> Option<u64> {
        self.functions
            .binary_search_by_key(&(start, kind), |function| (function.start, function.kind))
            .ok()
            .map(|index| self.functions[index].identity)
    }
}

/// `functions` is sorted by `start`, in bytes of `text`, which is ASCII up to `first_non_ascii`.
fn starts_in_code_units(functions: &mut [FunctionIdentity], text: &[u8], first_non_ascii: usize) {
    let (mut at, mut units) = (first_non_ascii, first_non_ascii);
    for function in functions {
        let start = (function.start as usize).min(text.len());
        if start > at {
            // A function starts at an ASCII character, so `at` and `start` are between characters.
            units += bun_core::strings::element_length_utf8_into_utf16(&text[at..start]);
            at = start;
        }
        if start >= first_non_ascii {
            function.start = units as u32;
        }
    }
}

/// One per function being hashed.
#[derive(Default)]
struct Frame<'a> {
    hasher: Wyhash,
    /// What the function declares, numbered in the order it declares it.
    declared: HashMap<&'a [u8], u32>,
    /// What the module declares, numbered in the order this function mentions it: there is no telling from one build
    /// to the next what else a module declares, or in what order.
    of_module: HashMap<&'a [u8], u32>,
    /// A minifier names labels apart from bindings.
    labels: HashMap<&'a [u8], u32>,
    /// The module, or the function a CommonJS chunk is wrapped in: what it declares is the module's.
    is_module: bool,
    /// For JavaScriptCore, which makes no inner function of the body of an async function that does not await.
    awaits: bool,
    /// Something in it could not be walked: it has no name, and nothing around it has.
    is_unnamed: bool,
    /// A class field's, which is gone when the functions in the field are walked: it declares nothing.
    is_field: bool,
}

struct Walker<'p, 'a> {
    parsed: &'p ParsedOnly<'p, 'a>,
    /// What the path of another chunk starts with: a chunk's name is a hash of its contents.
    chunk_paths: &'p [&'p [u8]],
    /// A script that is one function expression: a CommonJS chunk.
    is_all_one_function: bool,
    frames: Vec<Frame<'a>>,
    spare_frames: Vec<Frame<'a>>,
    /// The private names of each class being walked, innermost last, numbered in the order the class declares them:
    /// a minifier renames them like bindings.
    private_names: Vec<std::rc::Rc<HashMap<&'a [u8], u32>>>,
    /// The functions being walked, outermost first, one for each of `frames` that is a function's or the module's.
    open: Vec<Open<'p, 'a>>,
    /// The property the function walked next is the value of, and what kind of property.
    key_of_next_function: Option<(&'p Expr, u8)>,
    /// For each class, where in `out` the functions that initialize its instance's and its own fields are.
    fields: Vec<[Option<usize>; 2]>,
    /// The class (in `fields`) and which of its two groups: of the field being walked, of the function opened next.
    fields_being_walked: Option<(usize, usize)>,
    fields_of_next_function: Option<(usize, usize)>,
    out: Vec<FunctionIdentity>,
    /// How deeply nested what is being walked is. The limit is a count, so that every thread names the same code.
    depth: u32,
    stack_check: bun_core::StackCheck,
}

/// Of one function's own code: fits the smallest stack this runs on (a bundler thread's, in a debug build) with room to
/// spare.
const MAX_DEPTH: u32 = 512;

/// A function met in the code around it. It is walked after that code, from `Walker::run`, so that neither the stack
/// nor the depth count grows with how deeply functions are nested.
struct Pending<'p, 'a> {
    function: PendingFunction<'p>,
    key: Option<(&'p Expr, u8)>,
    private_names: Vec<std::rc::Rc<HashMap<&'a [u8], u32>>>,
    fields: Option<(usize, usize)>,
}

#[derive(Clone, Copy)]
enum PendingFunction<'p> {
    Function(&'p G::Fn, /* is_expression */ bool),
    Arrow(&'p ast::E::Arrow, ast::Loc),
    StaticBlock(&'p G::ClassStaticBlock),
}

/// A function whose own code was walked, and whose functions are being.
struct Open<'p, 'a> {
    /// Last first.
    pending: Vec<Pending<'p, 'a>>,
    start: Option<i32>,
    body_start: Option<i32>,
    inner_body: InnerBody,
    /// The class fields it is in (`Walker::fields`), whose function is named with it.
    fields: Option<(usize, usize)>,
}

// Node tags, and how enums are hashed: spelled out, so that a name does not depend on how an enum happens to be laid out.
mod tag {
    pub(super) const FUNCTION: u8 = 1;
    pub(super) const ARROW: u8 = 2;
    pub(super) const CLASS: u8 = 3;
    pub(super) const LOCAL: u8 = 4;
    pub(super) const STRING: u8 = 5;
    pub(super) const NUMBER: u8 = 6;
    pub(super) const END: u8 = 7;
    pub(super) const NONE: u8 = 8;
    pub(super) const BODY: u8 = 9;
    pub(super) const FIELDS: u8 = 10;
    pub(super) const CONSTRUCTOR: u8 = 11;
    pub(super) const OF_MODULE: u8 = 12;
    pub(super) const FREE: u8 = 13;
    pub(super) const LABEL: u8 = 14;
    pub(super) const TOO_DEEP: u8 = 15;
    pub(super) const STMT: u8 = 0x40;
    pub(super) const EXPR: u8 = 0x80;
    pub(super) const BINDING: u8 = 0xc0;
}

fn property_kind(kind: G::PropertyKind) -> u8 {
    match kind {
        G::PropertyKind::Normal => 0,
        G::PropertyKind::Get => 1,
        G::PropertyKind::Set => 2,
        G::PropertyKind::Spread => 3,
        G::PropertyKind::Declare => 4,
        G::PropertyKind::Abstract => 5,
        G::PropertyKind::ClassStaticBlock => 6,
        G::PropertyKind::AutoAccessor => 7,
    }
}

fn local_kind(kind: ast::S::Kind) -> u8 {
    match kind {
        ast::S::Kind::KVar => 0,
        ast::S::Kind::KLet => 1,
        ast::S::Kind::KConst => 2,
        ast::S::Kind::KUsing => 3,
        ast::S::Kind::KAwaitUsing => 4,
    }
}

fn optional_chain(chain: Option<ast::OptionalChain>) -> u8 {
    match chain {
        None => 0,
        Some(ast::OptionalChain::Start) => 1,
        Some(ast::OptionalChain::Continuation) => 2,
    }
}

/// Whether JavaScriptCore makes an inner function of a function's body.
#[derive(Clone, Copy)]
enum InnerBody {
    None,
    /// A generator's.
    Always,
    /// An async function's: not of a body that does not await.
    IfItAwaits,
}

impl<'p, 'a> Walker<'p, 'a> {
    fn run(
        parsed: &'p ParsedOnly<'p, 'a>,
        kind: Text,
        chunk_paths: &'p [&'p [u8]],
    ) -> FunctionIdentities {
        let mut walker = Walker {
            parsed,
            chunk_paths,
            is_all_one_function: kind == Text::Script
                && matches!(parsed.stmts, [Stmt { data: StmtData::SExpr(only), .. }] if matches!(only.value.data, Data::EFunction(_))),
            frames: Vec::new(),
            spare_frames: Vec::new(),
            private_names: Vec::new(),
            open: Vec::new(),
            key_of_next_function: None,
            fields: Vec::new(),
            fields_being_walked: None,
            fields_of_next_function: None,
            out: Vec::new(),
            depth: 0,
            stack_check: bun_core::StackCheck::init(),
        };
        walker.push_frame(true);
        walker.open_function(None, None, InnerBody::None);
        walker.declare_stmts(parsed.stmts);
        walker.stmts(parsed.stmts);
        walker.opened();
        // Each function's functions after its own code, the module's first.
        let module = loop {
            let open = walker.open.last_mut().expect("the module");
            if let Some(pending) = open.pending.pop() {
                walker.walk(pending);
                continue;
            }
            let open = walker.open.pop().expect("the module");
            if walker.open.is_empty() {
                break walker.pop_frame().0;
            }
            walker.end_function(&open);
        };
        let mut functions = walker.out;
        functions.sort_by_key(|function| (function.start, function.kind));
        // JavaScriptCore looks a function up by this key, and so does a recording: functions with one key (which there
        // should not be) are functions without a name.
        let key = |function: &FunctionIdentity| (function.start, function.kind);
        let mut kept = 0;
        let mut at = 0;
        while at < functions.len() {
            let run = functions[at..]
                .iter()
                .take_while(|function| key(function) == key(&functions[at]))
                .count();
            debug_assert_eq!(run, 1, "functions with one start and kind");
            if run == 1 {
                functions[kept] = functions[at];
                kept += 1;
            }
            at += run;
        }
        functions.truncate(kept);
        FunctionIdentities { module, functions }
    }

    fn open_function(
        &mut self,
        start: Option<i32>,
        body_start: Option<i32>,
        inner_body: InnerBody,
    ) {
        let fields = self.fields_of_next_function.take();
        self.open.push(Open {
            pending: Vec::new(),
            start,
            body_start,
            inner_body,
            fields,
        });
    }

    /// The code of the function opened last was walked.
    fn opened(&mut self) {
        self.open
            .last_mut()
            .expect("an open function")
            .pending
            .reverse();
    }

    /// In the code around it a function is that there is one; the functions' names follow the code's hash in the
    /// order they are written (`end_function`).
    fn defer(&mut self, function: PendingFunction<'p>) {
        let key = self.key_of_next_function.take();
        let fields = self.fields_being_walked;
        self.byte(tag::FUNCTION);
        let private_names = self.private_names.clone();
        self.open
            .last_mut()
            .expect("an open function")
            .pending
            .push(Pending {
                function,
                key,
                private_names,
                fields,
            });
    }

    fn walk(&mut self, pending: Pending<'p, 'a>) {
        self.private_names = pending.private_names;
        self.fields_of_next_function = pending.fields;
        self.fields_being_walked = None;
        self.depth = 0;
        let is_arrow = matches!(pending.function, PendingFunction::Arrow(..));
        self.push_frame(false);
        self.byte(if is_arrow { tag::ARROW } else { tag::FUNCTION });
        // A minifier does not rename properties: the functions `{ a: () => a, b: () => b }` have in it are not one.
        match pending.key {
            Some((key, kind)) => {
                self.byte(kind);
                self.key(key);
            }
            None => self.byte(tag::NONE),
        }
        match pending.function {
            PendingFunction::Function(func, is_expression) => self.func(func, is_expression),
            PendingFunction::Arrow(arrow, loc) => self.arrow(arrow, loc),
            PendingFunction::StaticBlock(block) => {
                // To JavaScriptCore a function, which the function that initializes the static fields calls.
                self.open_function(Some(block.loc.start), None, InnerBody::None);
                self.declare_stmts(block.stmts.as_slice());
                self.stmts(block.stmts.as_slice());
            }
        }
        self.opened();
    }

    fn push_frame(&mut self, is_module: bool) {
        let mut frame = self.spare_frames.pop().unwrap_or_default();
        frame.hasher = Wyhash::init(0);
        frame.is_module = is_module;
        self.frames.push(frame);
    }

    /// The hash of what the frame saw, if all of it could be walked, and whether it awaited.
    fn pop_frame(&mut self) -> (Option<u64>, bool) {
        let mut frame = self.frames.pop().expect("a frame");
        let result = (!frame.is_unnamed).then(|| frame.hasher.final_());
        let awaits = frame.awaits;
        frame.declared.clear();
        frame.of_module.clear();
        frame.labels.clear();
        frame.awaits = false;
        frame.is_unnamed = false;
        frame.is_field = false;
        self.spare_frames.push(frame);
        (result, awaits)
    }

    #[inline]
    fn frame(&mut self) -> &mut Frame<'a> {
        self.frames.last_mut().expect("a frame")
    }
    #[inline]
    fn byte(&mut self, value: u8) {
        self.frame().hasher.update(&[value]);
    }
    #[inline]
    fn number(&mut self, value: u64) {
        self.frame().hasher.update(&value.to_le_bytes());
    }
    fn bytes(&mut self, value: &[u8]) {
        self.byte(tag::STRING);
        self.number(value.len() as u64);
        self.frame().hasher.update(value);
    }

    /// Nothing the function being hashed is in can be named: part of it is not in its hash.
    fn cannot_name(&mut self) {
        self.frame().is_unnamed = true;
    }

    /// Every `enter` that says yes is followed by a `leave`. What is nested deeper than `MAX_DEPTH` is one tag in its
    /// function's hash, on whichever thread: an edit down there does not rename the function, and that is all.
    fn enter(&mut self) -> bool {
        if self.depth >= MAX_DEPTH {
            self.byte(tag::TOO_DEEP);
            // (There may be an `await` down there: a row too many is harmless, one too few is a function without a name.)
            self.frame().awaits = true;
            return false;
        }
        // How much stack is left is not the same on every thread: nothing the code is in can be named.
        if !self.stack_check.is_safe_to_recurse() {
            self.cannot_name();
            return false;
        }
        self.depth += 1;
        true
    }
    #[inline]
    fn leave(&mut self) {
        self.depth -= 1;
    }

    fn declare(&mut self, r#ref: Ref) {
        if r#ref.is_valid() {
            let name = self.parsed.name_of(r#ref);
            let frame = self
                .frames
                .iter_mut()
                .rev()
                .find(|frame| !frame.is_field)
                .expect("the module's frame");
            let next = frame.declared.len() as u32;
            frame.declared.entry(name).or_insert_with(|| next);
        }
    }

    fn declare_binding(&mut self, binding: &ast::Binding) {
        // (What is declared deeper than is walked is not mentioned where it is walked either.)
        if self.depth >= MAX_DEPTH || !self.enter() {
            return;
        }
        self.declare_binding_at_depth(binding);
        self.leave();
    }

    fn declare_binding_at_depth(&mut self, binding: &ast::Binding) {
        match &binding.data {
            B::BIdentifier(id) => self.declare(id.r#ref),
            B::BArray(array) => {
                for item in array.items() {
                    self.declare_binding(&item.binding);
                }
            }
            B::BObject(object) => {
                for property in object.properties() {
                    self.declare_binding(&property.value);
                }
            }
            B::BMissing(_) => {}
        }
    }

    /// What these statements declare for the function they are in (or the module), wherever in it: a `var` and a
    /// function are there before they are written, and what a block declares is numbered with the rest.
    fn declare_stmts(&mut self, stmts: &[Stmt]) {
        for stmt in stmts {
            self.declare_stmt(stmt);
        }
    }

    fn declare_stmt(&mut self, stmt: &Stmt) {
        // (What is declared deeper than is walked is not mentioned where it is walked either.)
        if self.depth < MAX_DEPTH && self.enter() {
            self.declare_stmt_at_depth(stmt);
            self.leave();
        }
    }

    fn declare_stmt_at_depth(&mut self, stmt: &Stmt) {
        let mut stmt = stmt;
        loop {
            match &stmt.data {
                StmtData::SLocal(local) => {
                    for decl in local.decls.iter() {
                        self.declare_binding(&decl.binding);
                    }
                }
                StmtData::SFunction(s) => {
                    if let Some(name) = &s.func.name {
                        self.declare(name.ref_);
                    }
                }
                StmtData::SClass(s) => {
                    if let Some(name) = &s.class.class_name {
                        self.declare(name.ref_);
                    }
                }
                StmtData::SImport(s) => {
                    if let Some(name) = &s.default_name {
                        self.declare(name.ref_);
                    }
                    if s.star_name_loc != ast::Loc::EMPTY {
                        self.declare(s.namespace_ref);
                    }
                    for item in s.items.slice() {
                        self.declare(item.name.ref_);
                    }
                }
                StmtData::SExportDefault(s) => {
                    if let StmtOrExpr::Stmt(inner) = &s.value {
                        self.declare_stmt(inner);
                    }
                }
                StmtData::SBlock(s) => self.declare_stmts(s.stmts.slice()),
                StmtData::SIf(s) => {
                    self.declare_stmt(&s.yes);
                    // `else if` after `else if` is as deep as it is long.
                    if let Some(no) = &s.no {
                        stmt = no;
                        continue;
                    }
                }
                StmtData::SFor(s) => {
                    if let Some(init) = &s.init {
                        self.declare_stmt(init);
                    }
                    self.declare_stmt(&s.body);
                }
                StmtData::SForIn(s) => {
                    self.declare_stmt(&s.init);
                    self.declare_stmt(&s.body);
                }
                StmtData::SForOf(s) => {
                    self.declare_stmt(&s.init);
                    self.declare_stmt(&s.body);
                }
                StmtData::SWhile(s) => self.declare_stmt(&s.body),
                StmtData::SDoWhile(s) => self.declare_stmt(&s.body),
                StmtData::SLabel(s) => self.declare_stmt(&s.stmt),
                StmtData::SWith(s) => self.declare_stmt(&s.body),
                StmtData::SSwitch(s) => {
                    for case in s.cases.slice() {
                        self.declare_stmts(case.body.slice());
                    }
                }
                StmtData::STry(s) => {
                    self.declare_stmts(s.body.slice());
                    if let Some(catch) = &s.catch {
                        if let Some(binding) = &catch.binding {
                            self.declare_binding(binding);
                        }
                        self.declare_stmts(catch.body.slice());
                    }
                    if let Some(finally) = &s.finally {
                        self.declare_stmts(finally.stmts.slice());
                    }
                }
                StmtData::SBreak(_)
                | StmtData::SComment(_)
                | StmtData::SContinue(_)
                | StmtData::SDirective(_)
                | StmtData::SEnum(_)
                | StmtData::SExportClause(_)
                | StmtData::SExportEquals(_)
                | StmtData::SExportFrom(_)
                | StmtData::SExportStar(_)
                | StmtData::SExpr(_)
                | StmtData::SNamespace(_)
                | StmtData::SReturn(_)
                | StmtData::SThrow(_)
                | StmtData::STypeScript(_)
                | StmtData::SEmpty(_)
                | StmtData::SDebugger(_)
                | StmtData::SLazyExport(_) => {}
            }
            return;
        }
    }

    /// What an identifier stands for (see the top of the file).
    fn name(&mut self, r#ref: Ref) {
        if !r#ref.is_valid() {
            return self.byte(tag::NONE);
        }
        let name = self.parsed.name_of(r#ref);
        let declared = self
            .frames
            .iter()
            .rev()
            .enumerate()
            .find_map(|(depth, frame)| Some((depth, *frame.declared.get(&name)?, frame.is_module)));
        match declared {
            Some((depth, index, false)) => {
                self.byte(tag::LOCAL);
                self.number(depth as u64);
                self.number(u64::from(index));
            }
            Some((_, _, true)) => {
                let frame = self.frame();
                let next = frame.of_module.len() as u32;
                let index = *frame.of_module.entry(name).or_insert_with(|| next);
                self.byte(tag::OF_MODULE);
                self.number(u64::from(index));
            }
            None => {
                self.byte(tag::FREE);
                self.bytes(name);
            }
        }
    }

    /// The how-manieth private name of the how-manieth class around.
    fn private_name(&mut self, r#ref: Ref) {
        let name = self.parsed.name_of(r#ref);
        let declared = self
            .private_names
            .iter()
            .rev()
            .enumerate()
            .find_map(|(depth, names)| Some((depth, *names.get(&name)?)));
        match declared {
            Some((depth, index)) => {
                self.number(depth as u64);
                self.number(u64::from(index));
            }
            None => self.bytes(name),
        }
    }

    fn label(&mut self, r#ref: Ref) {
        if !r#ref.is_valid() {
            return self.byte(tag::NONE);
        }
        let name = self.parsed.name_of(r#ref);
        let frame = self.frame();
        let next = frame.labels.len() as u32;
        let index = *frame.labels.entry(name).or_insert_with(|| next);
        self.byte(tag::LABEL);
        self.number(u64::from(index));
    }

    fn string(&mut self, string: &ast::E::EString) {
        let mut part = Some(string);
        while let Some(string) = part {
            if string.is_utf8() {
                self.bytes(string.slice8());
            } else {
                self.bytes(bytemuck::cast_slice::<u16, u8>(string.slice16()));
            }
            part = string.next.as_deref();
        }
    }

    /// Records the function at `start`, and its inner function at `body_start` if JavaScriptCore makes one, and
    /// leaves its name in the function around it. `None`: there is no telling where JavaScriptCore says it starts.
    fn end_function(&mut self, open: &Open<'p, 'a>) {
        let (start, body_start, inner_body) = (open.start, open.body_start, open.inner_body);
        let (identity, awaits) = self.pop_frame();
        // The function that initializes the fields it is in is named with it.
        if let Some(row) = open
            .fields
            .and_then(|(class, group)| self.fields[class][group])
        {
            let mut named = Wyhash::init(0);
            named.update(&self.out[row].identity.to_le_bytes());
            named.update(&identity.unwrap_or(u64::MAX).to_le_bytes());
            // (Not a name: `BytecodeOrderNames::nameOf`.)
            self.out[row].identity = identity.map_or(u64::MAX, |_| named.final_());
        }
        let Some(identity) = identity else {
            return self.cannot_name();
        };
        if let Some(Ok(start)) = start.map(u32::try_from) {
            self.out.push(FunctionIdentity::new(
                start,
                FunctionKind::Function,
                identity,
            ));
        }
        let has_inner_body = match inner_body {
            InnerBody::None => false,
            InnerBody::Always => true,
            InnerBody::IfItAwaits => awaits,
        };
        if let (true, Some(Ok(start))) = (has_inner_body, body_start.map(u32::try_from)) {
            let mut body = Wyhash::init(0);
            body.update(&[tag::BODY]);
            body.update(&identity.to_le_bytes());
            self.out.push(FunctionIdentity::new(
                start,
                FunctionKind::InnerBody,
                body.final_(),
            ));
        }
        self.byte(tag::FUNCTION);
        self.number(identity);
    }

    fn func(&mut self, func: &'p G::Fn, is_expression: bool) {
        let is_async = func.flags.contains(ast::flags::Function::IsAsync);
        let is_generator = func.flags.contains(ast::flags::Function::IsGenerator);
        self.open_function(
            Some(func.open_parens_loc.start),
            Some(func.body.loc.start),
            if is_generator {
                InnerBody::Always
            } else if is_async {
                InnerBody::IfItAwaits
            } else {
                InnerBody::None
            },
        );
        self.byte(u8::from(is_async) | u8::from(is_generator) << 1);
        // A function expression's name is its own; a declaration's is the function's around it.
        if let (true, Some(name)) = (is_expression, &func.name) {
            self.declare(name.ref_);
        }
        self.declare_args(func.args.slice());
        self.declare_stmts(func.body.stmts.slice());
        self.byte(u8::from(func.name.is_some()));
        self.args(func.args.slice());
        self.stmts(func.body.stmts.slice());
    }

    fn arrow(&mut self, arrow: &'p ast::E::Arrow, loc: ast::Loc) {
        // JavaScriptCore's start is the parameters: past `async`. Its inner function, if it makes one, starts at the
        // body: the block, or the expression past the `=>`.
        let start = if arrow.is_async {
            self.parsed.async_arrow_parameters(loc)
        } else {
            Some(loc.start)
        };
        let body_start = if arrow.prefer_expr {
            self.parsed.arrow_expression_body(arrow.body.loc)
        } else {
            Some(arrow.body.loc.start)
        };
        self.open_function(
            start,
            body_start,
            if arrow.is_async {
                InnerBody::IfItAwaits
            } else {
                InnerBody::None
            },
        );
        self.byte(u8::from(arrow.is_async));
        self.declare_args(arrow.args.slice());
        self.declare_stmts(arrow.body.stmts.slice());
        self.args(arrow.args.slice());
        self.stmts(arrow.body.stmts.slice());
    }

    fn declare_args(&mut self, args: &[G::Arg]) {
        // What the function a CommonJS chunk is wrapped in declares is the module's.
        if self.is_all_one_function && self.frames.len() == 2 {
            self.frame().is_module = true;
        }
        for arg in args {
            self.declare_binding(&arg.binding);
        }
    }

    fn args(&mut self, args: &'p [G::Arg]) {
        self.number(args.len() as u64);
        for arg in args {
            self.binding(&arg.binding);
            self.optional_expr(arg.default.as_ref());
        }
    }

    fn class(&mut self, class: &'p G::Class, is_expression: bool) {
        self.byte(tag::CLASS);
        // A class expression's name is its own; a declaration's is already the function's around it.
        if let (true, Some(name)) = (is_expression, &class.class_name) {
            self.declare(name.ref_);
        }
        self.byte(u8::from(class.class_name.is_some()));
        self.optional_expr(class.extends.as_ref());
        let class_index = self.fields.len();
        self.fields.push([None, None]);
        let fields_around = self.fields_being_walked;
        let mut private_names = HashMap::<&'a [u8], u32>::default();
        for property in class.properties.slice() {
            if let Some(Data::EPrivateIdentifier(name)) = property.key.as_ref().map(|key| &key.data)
            {
                let next = private_names.len() as u32;
                private_names
                    .entry(self.parsed.name_of(name.ref_))
                    .or_insert_with(|| next);
            }
        }
        self.private_names.push(std::rc::Rc::new(private_names));
        let mut constructor = Wyhash::init(0);
        constructor.update(&[tag::CONSTRUCTOR, u8::from(class.extends.is_some())]);
        // The two functions that initialize fields (the instance's; the class's own, with its static blocks): named by
        // the fields, recorded where the first of them starts.
        let mut fields: [Option<(Option<i32>, Wyhash)>; 2] = [None, None];
        let mut are_fields_unnamed = false;
        let mut has_constructor = false;
        self.number(class.properties.slice().len() as u64);
        for property in class.properties.slice() {
            let is_static = property.flags.contains(ast::flags::Property::IsStatic);
            let is_computed = property.flags.contains(ast::flags::Property::IsComputed);
            let is_method = property.flags.contains(ast::flags::Property::IsMethod);
            let block = property.class_static_block_ref();
            let is_field = block.is_some() || (property.value.is_none() && !is_method);
            has_constructor |= is_method
                && !is_static
                && !is_computed
                && matches!(property.key.as_ref().map(|key| &key.data), Some(Data::EString(name)) if name.eql_comptime(b"constructor"));
            // A field is hashed on its own, for the class's code and for its group's name.
            if is_field {
                self.push_frame(false);
                self.frame().is_field = true;
                self.fields_being_walked =
                    Some((class_index, usize::from(is_static || block.is_some())));
            }
            self.byte(property_kind(property.kind));
            self.byte(u8::from(is_static) | u8::from(is_computed) << 1);
            constructor.update(&[
                property_kind(property.kind),
                u8::from(is_static) | u8::from(is_computed) << 1,
            ]);
            if let (false, Some(Data::EString(name))) =
                (is_computed, property.key.as_ref().map(|key| &key.data))
            {
                if name.is_utf8() {
                    constructor.update(name.slice8());
                } else {
                    constructor.update(bytemuck::cast_slice::<u16, u8>(name.slice16()));
                }
            }
            if let Some(block) = block {
                self.defer(PendingFunction::StaticBlock(block));
            } else {
                self.optional_key(property.key.as_ref());
                self.value_of_property(property);
            }
            if !is_field {
                continue;
            }
            // All that may await in a field is its computed name, which is the code around the class's.
            let (field, awaits) = self.pop_frame();
            self.fields_being_walked = fields_around;
            self.frame().awaits |= awaits;
            let Some(field) = field else {
                are_fields_unnamed = true;
                self.cannot_name();
                continue;
            };
            self.byte(tag::FIELDS);
            self.number(field);
            let (_, group) =
                fields[usize::from(is_static || block.is_some())].get_or_insert_with(|| {
                    let named_at = block
                        .map(|block| block.loc)
                        .or_else(|| property.key.map(|key| key.loc));
                    let start = named_at.and_then(|at| self.parsed.class_element(at));
                    (start, Wyhash::init(0))
                });
            group.update(&field.to_le_bytes());
        }
        self.byte(tag::END);
        self.private_names.pop();
        if !has_constructor {
            if let Ok(start) = u32::try_from(class.class_keyword.loc.start) {
                self.out.push(FunctionIdentity::new(
                    start,
                    FunctionKind::DefaultConstructor,
                    constructor.final_(),
                ));
            }
        }
        if are_fields_unnamed {
            return;
        }
        for (group, fields) in fields.into_iter().enumerate() {
            let Some((start, hasher)) = fields else {
                continue;
            };
            if let Some(Ok(start)) = start.map(u32::try_from) {
                self.fields[class_index][group] = Some(self.out.len());
                let mut named = Wyhash::init(0);
                named.update(&[tag::FIELDS]);
                named.update(&hasher.final_().to_le_bytes());
                self.out.push(FunctionIdentity::new(
                    start,
                    FunctionKind::ClassFields,
                    named.final_(),
                ));
            }
        }
    }

    fn binding(&mut self, binding: &'p ast::Binding) {
        if !self.enter() {
            return;
        }
        self.binding_at_depth(binding);
        self.leave();
    }

    fn binding_at_depth(&mut self, binding: &'p ast::Binding) {
        match &binding.data {
            B::BIdentifier(id) => {
                self.byte(tag::BINDING);
                self.name(id.r#ref);
            }
            B::BArray(array) => {
                self.byte(tag::BINDING | 1);
                self.byte(u8::from(array.has_spread));
                self.number(array.items().len() as u64);
                for item in array.items() {
                    self.binding(&item.binding);
                    self.optional_expr(item.default_value.as_ref());
                }
            }
            B::BObject(object) => {
                self.byte(tag::BINDING | 2);
                self.number(object.properties().len() as u64);
                for property in object.properties() {
                    self.byte(
                        u8::from(property.flags.contains(ast::flags::Property::IsComputed))
                            | u8::from(property.flags.contains(ast::flags::Property::IsSpread))
                                << 1,
                    );
                    self.key(&property.key);
                    self.binding(&property.value);
                    self.optional_expr(property.default_value.as_ref());
                }
            }
            B::BMissing(_) => self.byte(tag::BINDING | 3),
        }
    }

    fn stmts(&mut self, stmts: &'p [Stmt]) {
        // (Not how many: some say nothing.)
        for stmt in stmts {
            self.stmt(stmt);
        }
        self.byte(tag::END);
    }

    fn optional_stmt(&mut self, stmt: Option<&'p Stmt>) {
        match stmt {
            Some(stmt) => self.stmt(stmt),
            None => self.byte(tag::NONE),
        }
    }

    fn optional_expr(&mut self, expr: Option<&'p Expr>) {
        match expr {
            Some(expr) => self.expr(expr),
            None => self.byte(tag::NONE),
        }
    }

    fn is_path_of_a_chunk(&self, path: &[u8]) -> bool {
        self.chunk_paths.binary_search(&path).is_ok()
    }

    /// Whether it is not another chunk that is imported from: then what is imported goes by its own names, which
    /// are part of this module's.
    fn import_path(&mut self, import_record_index: u32) -> bool {
        let path = self.parsed.import_path(import_record_index);
        if self.is_path_of_a_chunk(path) {
            return false;
        }
        self.bytes(path);
        true
    }

    fn stmt(&mut self, stmt: &'p Stmt) {
        if self.enter() {
            self.stmt_at_depth(stmt);
            self.leave();
        }
    }

    fn stmt_at_depth(&mut self, stmt: &'p Stmt) {
        let t = tag::STMT;
        // `else if` after `else if` is as deep as it is long.
        let mut stmt = stmt;
        while let StmtData::SIf(s) = &stmt.data {
            self.byte(t | 5);
            self.expr(&s.test);
            self.stmt(&s.yes);
            match &s.no {
                Some(no) => stmt = no,
                None => return self.byte(tag::NONE),
            }
        }
        match &stmt.data {
            StmtData::SIf(_) => unreachable!("the loop above ends at what is not one"),
            StmtData::SBlock(block) => {
                self.byte(t);
                self.stmts(block.stmts.slice());
            }
            StmtData::SExpr(e) => {
                self.byte(t | 1);
                self.expr(&e.value);
            }
            StmtData::SLocal(local) => {
                self.byte(t | 2);
                self.byte(local_kind(local.kind));
                self.frame().awaits |= local.kind == ast::S::Kind::KAwaitUsing;
                self.number(local.decls.len() as u64);
                for decl in local.decls.iter() {
                    self.binding(&decl.binding);
                    self.optional_expr(decl.value.as_ref());
                }
            }
            StmtData::SReturn(ret) => {
                self.byte(t | 3);
                self.optional_expr(ret.value.as_ref());
            }
            StmtData::SThrow(throw) => {
                self.byte(t | 4);
                self.expr(&throw.value);
            }
            StmtData::SFor(s) => {
                self.byte(t | 6);
                self.optional_stmt(s.init.as_ref());
                self.optional_expr(s.test.as_ref());
                self.optional_expr(s.update.as_ref());
                self.stmt(&s.body);
            }
            StmtData::SForIn(s) => {
                self.byte(t | 7);
                self.stmt(&s.init);
                self.expr(&s.value);
                self.stmt(&s.body);
            }
            StmtData::SForOf(s) => {
                self.byte(t | 8);
                self.byte(u8::from(s.is_await));
                self.frame().awaits |= s.is_await;
                self.stmt(&s.init);
                self.expr(&s.value);
                self.stmt(&s.body);
            }
            StmtData::SWhile(s) => {
                self.byte(t | 9);
                self.expr(&s.test);
                self.stmt(&s.body);
            }
            StmtData::SDoWhile(s) => {
                self.byte(t | 10);
                self.stmt(&s.body);
                self.expr(&s.test);
            }
            StmtData::SSwitch(s) => {
                self.byte(t | 11);
                self.expr(&s.test);
                self.number(s.cases.slice().len() as u64);
                for case in s.cases.slice() {
                    self.optional_expr(case.value.as_ref());
                    self.stmts(case.body.slice());
                }
            }
            StmtData::STry(s) => {
                self.byte(t | 12);
                self.stmts(s.body.slice());
                match &s.catch {
                    Some(catch) => {
                        self.byte(1);
                        match &catch.binding {
                            Some(binding) => self.binding(binding),
                            None => self.byte(tag::NONE),
                        }
                        self.stmts(catch.body.slice());
                    }
                    None => self.byte(tag::NONE),
                }
                match &s.finally {
                    Some(finally) => self.stmts(finally.stmts.slice()),
                    None => self.byte(tag::NONE),
                }
            }
            StmtData::SLabel(s) => {
                self.byte(t | 13);
                self.label(s.name.ref_);
                self.stmt(&s.stmt);
            }
            StmtData::SWith(s) => {
                self.byte(t | 14);
                self.expr(&s.value);
                self.stmt(&s.body);
            }
            StmtData::SFunction(s) => {
                self.byte(t | 15);
                self.defer(PendingFunction::Function(&s.func, false));
            }
            StmtData::SClass(s) => {
                self.byte(t | 16);
                self.class(&s.class, false);
            }
            StmtData::SExportDefault(s) => {
                self.byte(t | 17);
                match &s.value {
                    StmtOrExpr::Stmt(stmt) => self.stmt(stmt),
                    StmtOrExpr::Expr(expr) => self.expr(expr),
                }
            }
            StmtData::SExportEquals(s) => {
                self.byte(t | 18);
                self.expr(&s.value);
            }
            StmtData::SBreak(s) => {
                self.byte(t | 19);
                if let Some(label) = &s.label {
                    self.label(label.ref_);
                }
            }
            StmtData::SContinue(s) => {
                self.byte(t | 20);
                if let Some(label) = &s.label {
                    self.label(label.ref_);
                }
            }
            StmtData::SDirective(s) => {
                self.byte(t | 21);
                self.bytes(s.value.slice());
            }
            StmtData::SDebugger(_) => self.byte(t | 22),
            // What a chunk imports from and exports to other chunks changes with what the build put where, not with
            // the chunk's code: only what comes from a package or a builtin module is part of the module's name.
            StmtData::SImport(s) => {
                if self.import_path(s.import_record_index) {
                    self.byte(t | 25);
                    self.byte(
                        u8::from(s.default_name.is_some())
                            | u8::from(s.star_name_loc != ast::Loc::EMPTY) << 1,
                    );
                    self.number(s.items.slice().len() as u64);
                    for item in s.items.slice() {
                        self.bytes(item.alias.slice());
                    }
                }
            }
            StmtData::SExportFrom(s) => {
                if self.import_path(s.import_record_index) {
                    self.byte(t | 27);
                    self.number(s.items.slice().len() as u64);
                    for item in s.items.slice() {
                        self.bytes(item.original_name.slice());
                        self.bytes(item.alias.slice());
                    }
                }
            }
            StmtData::SExportStar(s) => {
                if self.import_path(s.import_record_index) {
                    self.byte(t | 28);
                    self.byte(u8::from(s.alias.is_some()));
                }
            }
            StmtData::SExportClause(_) => {}
            // TypeScript's, and what only a visit makes.
            StmtData::SNamespace(_)
            | StmtData::SEnum(_)
            | StmtData::SComment(_)
            | StmtData::SEmpty(_)
            | StmtData::STypeScript(_)
            | StmtData::SLazyExport(_) => {}
        }
    }

    fn expr(&mut self, expr: &'p Expr) {
        if self.enter() {
            self.expr_at_depth(expr);
            self.leave();
        }
    }

    #[allow(
        clippy::large_stack_frames,
        reason = "expr::Data variants are arena-backed StoreRef; live residency is bounded"
    )]
    fn expr_at_depth(&mut self, expr: &'p Expr) {
        let t = tag::EXPR;
        // A long `a + b + c + ...` is as deep to the left as it is long, and `a.b().c()...` at its target: what each
        // link adds, then what is left of it.
        let mut expr = expr;
        loop {
            expr = match &expr.data {
                Data::EBinary(e) => {
                    self.byte(t | 1);
                    self.bytes(ast::op::TABLE.get_ptr_const(e.op).text);
                    self.expr(&e.right);
                    &e.left
                }
                Data::EDot(e) => {
                    self.byte(t | 7);
                    self.byte(optional_chain(e.optional_chain));
                    self.bytes(e.name.slice());
                    &e.target
                }
                Data::EIndex(e) => {
                    self.byte(t | 8);
                    self.byte(optional_chain(e.optional_chain));
                    self.key(&e.index);
                    &e.target
                }
                Data::ECall(e) => {
                    self.byte(t | 9);
                    self.byte(optional_chain(e.optional_chain));
                    self.number(e.args.len() as u64);
                    for arg in e.args.iter() {
                        self.expr(arg);
                    }
                    &e.target
                }
                _ => break,
            };
        }
        match &expr.data {
            Data::EBinary(_) | Data::EDot(_) | Data::EIndex(_) | Data::ECall(_) => {
                unreachable!("the loop above ends at what is none of these")
            }
            Data::EIdentifier(e) => self.name(e.ref_),
            Data::EImportIdentifier(e) => self.name(e.ref_),
            Data::EPrivateIdentifier(e) => {
                self.byte(t);
                self.private_name(e.ref_);
            }
            Data::ECommonjsExportIdentifier(e) => self.name(e.ref_),
            Data::ENameOfSymbol(e) => self.name(e.ref_),
            Data::EUnary(e) => {
                self.byte(t | 2);
                self.byte(u8::from(ast::op::Code::is_prefix(e.op)));
                self.bytes(ast::op::TABLE.get_ptr_const(e.op).text);
                self.expr(&e.value);
            }
            Data::EArrow(e) => self.defer(PendingFunction::Arrow(e, expr.loc)),
            Data::EFunction(e) => self.defer(PendingFunction::Function(&e.func, true)),
            Data::EClass(e) => self.class(e, true),
            Data::EArray(e) => {
                self.byte(t | 3);
                self.number(e.items.len() as u64);
                for item in e.items.iter() {
                    self.expr(item);
                }
            }
            Data::EObject(e) => {
                self.byte(t | 4);
                self.number(e.properties.len() as u64);
                for property in e.properties.iter() {
                    self.byte(property_kind(property.kind));
                    self.byte(
                        u8::from(property.flags.contains(ast::flags::Property::IsComputed))
                            | u8::from(property.flags.contains(ast::flags::Property::IsMethod))
                                << 1
                            | u8::from(property.flags.contains(ast::flags::Property::WasShorthand))
                                << 2,
                    );
                    self.optional_key(property.key.as_ref());
                    self.value_of_property(property);
                }
            }
            Data::ESpread(e) => {
                self.byte(t | 5);
                self.expr(&e.value);
            }
            Data::EIf(e) => {
                // `a ? b : c ? d : ...` is as deep to the right as it is long.
                let mut e = e;
                loop {
                    self.byte(t | 6);
                    self.expr(&e.test);
                    self.expr(&e.yes);
                    match &e.no.data {
                        Data::EIf(no) => e = no,
                        _ => break self.expr(&e.no),
                    }
                }
            }
            Data::ENew(e) => {
                self.byte(t | 10);
                self.expr(&e.target);
                self.number(e.args.len() as u64);
                for arg in e.args.iter() {
                    self.expr(arg);
                }
            }
            Data::EImport(e) => {
                self.byte(t | 11);
                // What is imported is a name, unless it is a chunk's path: that is a name a build gave it.
                match &e.expr.data {
                    Data::EString(path)
                        if path.is_utf8() && self.is_path_of_a_chunk(path.slice8()) => {}
                    _ => self.key(&e.expr),
                }
                self.expr(&e.options);
            }
            Data::EAwait(e) => {
                self.byte(t | 12);
                self.frame().awaits = true;
                self.expr(&e.value);
            }
            Data::EYield(e) => {
                self.byte(t | 13);
                self.byte(u8::from(e.is_star));
                self.optional_expr(e.value.as_ref());
            }
            Data::ETemplate(e) => {
                self.byte(t | 14);
                self.optional_expr(e.tag.as_ref());
                self.number(e.parts().len() as u64);
                for part in e.parts() {
                    self.expr(&part.value);
                }
            }
            Data::EString(_) => self.byte(tag::STRING),
            Data::ENumber(e) => {
                self.byte(tag::NUMBER);
                self.number(e.value().to_bits());
            }
            Data::EBigInt(e) => {
                self.byte(t | 15);
                self.bytes(e.value.slice());
            }
            Data::ERegExp(e) => {
                self.byte(t | 16);
                self.bytes(e.value.slice());
            }
            Data::EBoolean(e) | Data::EBranchBoolean(e) => {
                self.byte(t | 17);
                self.byte(u8::from(e.value));
            }
            Data::EInlinedEnum(e) => self.expr(&e.value),
            Data::EThis(_) => self.byte(t | 18),
            Data::ESuper(_) => self.byte(t | 19),
            Data::ENull(_) => self.byte(t | 20),
            Data::EUndefined(_) => self.byte(t | 21),
            Data::ENewTarget(_) => self.byte(t | 22),
            Data::EImportMeta(_) => self.byte(t | 23),
            Data::EMissing(_) => self.byte(t | 24),
            // Made by the visit pass or by other loaders; not in what is parsed here.
            Data::EJsxElement(_)
            | Data::EObjectJSON(_)
            | Data::EArrayJSON(_)
            | Data::ERequireString(_)
            | Data::ERequireResolveString(_)
            | Data::ERequireCallTarget
            | Data::ERequireResolveCallTarget
            | Data::EImportMetaMain(_)
            | Data::ERequireMain
            | Data::ESpecial(_) => self.byte(t | 25),
        }
    }

    /// The value of a property and what a field is initialized to: a function there is named with the property.
    fn value_of_property(&mut self, property: &'p G::Property) {
        for value in [&property.value, &property.initializer] {
            if let (Some(key), Some(value)) = (&property.key, value) {
                if !property.flags.contains(ast::flags::Property::IsComputed)
                    && matches!(value.data, Data::EArrow(_) | Data::EFunction(_))
                {
                    self.key_of_next_function = Some((
                        key,
                        property_kind(property.kind)
                            | u8::from(property.flags.contains(ast::flags::Property::IsStatic))
                                << 4,
                    ));
                }
            }
            self.optional_expr(value.as_ref());
            // (Too deep to have been walked.)
            self.key_of_next_function = None;
        }
    }

    /// The name of a property: a string there is a name, and says what it says.
    fn key(&mut self, key: &'p Expr) {
        match &key.data {
            Data::EString(name) => self.string(name),
            _ => self.expr(key),
        }
    }

    fn optional_key(&mut self, key: Option<&'p Expr>) {
        match key {
            Some(key) => self.key(key),
            None => self.byte(tag::NONE),
        }
    }
}
