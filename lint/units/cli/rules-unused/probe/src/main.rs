//! Research probe of "rules-unused": no-unused-private-class-members as it is planned for src/lint, on the tree of
//! `Parser::parse_for_lint`, by one top-down walk: no parent of a node is read. What ESLint reads of the parents of a
//! `PrivateIdentifier` is decided by the node that holds the member, before the walk reaches the member.
//! usage: nupcm [--dump] <file>...     one line per report: `<line>:<column> <message>`; `--dump` lists the class members.
mod shims;

use std::collections::{HashMap, HashSet};

use bun_ast::flags::Property as Flag;
use bun_ast::walk::{self, Visitor};
use bun_ast::{E, Expr, ExprData, G, OpCode, Stmt, StmtData};
use bun_js_parser::parse::erased::{ErasedData, ErasedFlags, ErasedMemberData};
use bun_js_parser::parse::parse_entry::ParsedForLint;
use bun_js_parser::parse::wrappers::{ExprId, WrapperData};

/// A private name that a class body declares: ESLint's entry of `privateMembers`.
struct Member<'a> {
    name: &'a [u8],
    /// The key of the last declaration of the name.
    at: i32,
    /// That declaration is a getter or a setter.
    is_accessor: bool,
    used: bool,
}

/// A class whose body the walk is in, or whose heritage and decorators it is in.
struct Frame<'a> {
    /// Where the `{` of the body is: what stands before it is outside the body.
    body: i32,
    members: Vec<Member<'a>>,
}

struct Walker<'p, 'a> {
    parsed: &'p ParsedForLint<'p, 'a>,
    is_typescript: bool,
    /// Operands with `as`, `satisfies`, `!` or `<T>` around them: typescript-eslint has a TypeScript node there.
    ts_wrapped: HashSet<ExprId>,
    /// Operands with parentheses around them.
    parenthesized: HashSet<ExprId>,
    /// The erased members of each class, by `G::Class::body_loc`.
    erased_members: HashMap<u32, Vec<usize>>,
    classes: Vec<Frame<'a>>,
    /// Members (`E::Index`) that the node above them only writes.
    write_only: HashSet<usize>,
    /// Array and object literals that are assignment targets.
    patterns: HashSet<usize>,
    /// The assignment or update that is the whole expression of the statement being entered.
    statement_value: usize,
    dump: bool,
    out: Vec<(i32, Vec<u8>)>,
}

fn is_assign(op: OpCode) -> bool {
    (op as u8) >= (OpCode::BinAssign as u8)
}

fn is_update(op: OpCode) -> bool {
    matches!(op, OpCode::UnPreDec | OpCode::UnPreInc | OpCode::UnPostDec | OpCode::UnPostInc)
}

/// The address of the node that holds a private name: a member `a.#b`, or `#b in a`. It is ESLint's `privateIdentifierNode.parent`.
fn private_member(expr: &Expr) -> Option<usize> {
    match &expr.data {
        ExprData::EIndex(index) if matches!(index.index.data, ExprData::EPrivateIdentifier(_)) => {
            Some(core::ptr::from_ref::<E::Index>(index).addr())
        }
        ExprData::EBinary(binary) if binary.op == OpCode::BinIn && matches!(binary.left.data, ExprData::EPrivateIdentifier(_)) => {
            Some(core::ptr::from_ref::<E::Binary>(binary).addr())
        }
        _ => None,
    }
}

impl<'p, 'a> Walker<'p, 'a> {
    fn has_ts(&self, expr: &Expr) -> bool {
        !self.ts_wrapped.is_empty() && self.ts_wrapped.contains(&ExprId::of(expr))
    }

    fn is_wrapped(&self, expr: &Expr) -> bool {
        self.has_ts(expr) || (!self.parenthesized.is_empty() && self.parenthesized.contains(&ExprId::of(expr)))
    }

    /// `expr` stands where ESLint has a pattern or the left side of an assignment.
    fn target(&mut self, expr: &Expr) {
        if self.has_ts(expr) {
            return;
        }
        match &expr.data {
            ExprData::EIndex(_) => {
                if let Some(address) = private_member(expr) {
                    self.write_only.insert(address);
                }
            }
            ExprData::EBinary(node) if node.op == OpCode::BinIn => {
                if let Some(address) = private_member(expr) {
                    self.write_only.insert(address);
                }
            }
            ExprData::EArray(node) => {
                if !(self.is_typescript && self.is_wrapped(expr)) {
                    self.patterns.insert(core::ptr::from_ref::<E::Array>(node).addr());
                }
            }
            ExprData::EObject(node) => {
                if !(self.is_typescript && self.is_wrapped(expr)) {
                    self.patterns.insert(core::ptr::from_ref::<E::Object>(node).addr());
                }
            }
            // A rest element: its argument is a target.
            ExprData::ESpread(node) => self.target(&node.value),
            _ => {}
        }
    }

    /// A private name is read or written at `at`. `reads`: the place is not one that only writes.
    fn reference(&mut self, name: &[u8], at: i32, reads: bool) {
        for frame in self.classes.iter_mut().rev() {
            if at < frame.body {
                continue;
            }
            if let Some(member) = frame.members.iter_mut().find(|member| member.name == name) {
                if member.is_accessor || reads {
                    member.used = true;
                }
                return;
            }
        }
    }

    /// What ESLint collects of one member: a `PropertyDefinition` or a `MethodDefinition` with a private key.
    /// `Err`: a private key of another node (`AccessorProperty`, `TSAbstract...`), which ESLint takes for a use of the name.
    fn declared(&self, property: &G::Property, flags: ErasedFlags) -> Option<Result<(&'a [u8], i32, bool), (&'a [u8], i32)>> {
        let key = property.key.as_ref()?;
        let ExprData::EPrivateIdentifier(private) = &key.data else {
            return None;
        };
        let name = self.parsed.name_of(private.ref_);
        let is_accessor = match property.kind {
            G::PropertyKind::Normal | G::PropertyKind::Declare => false,
            G::PropertyKind::Get | G::PropertyKind::Set => true,
            _ => return Some(Err((name, key.loc.start))),
        };
        if flags.contains(ErasedFlags::ABSTRACT) {
            return Some(Err((name, key.loc.start)));
        }
        Some(Ok((name, key.loc.start, is_accessor)))
    }

    fn class<'ast>(&mut self, class: &'ast G::Class, walk: impl FnOnce(&mut Self)) {
        let mut found: Vec<(&'a [u8], i32, bool)> = Vec::new();
        let mut keys_only: Vec<(&'a [u8], i32)> = Vec::new();
        for property in class.properties.slice() {
            match self.declared(property, ErasedFlags::empty()) {
                Some(Ok(member)) => found.push(member),
                Some(Err(key)) => keys_only.push(key),
                None => {}
            }
        }
        let erased = &self.parsed.sidecar.erased.members;
        let own: Vec<usize> = self.erased_members.get(&(class.body_loc.start as u32)).cloned().unwrap_or_default();
        for index in &own {
            if let ErasedMemberData::Property(property) = &erased[*index].data {
                match self.declared(property, erased[*index].flags) {
                    Some(Ok(member)) => found.push(member),
                    Some(Err(key)) => keys_only.push(key),
                    None => {}
                }
            }
        }
        // The last declaration of a name is the one ESLint keeps.
        found.sort_by_key(|(_, at, _)| *at);
        let mut members: Vec<Member<'a>> = Vec::new();
        for (name, at, is_accessor) in found {
            match members.iter_mut().find(|member| member.name == name) {
                Some(member) => {
                    member.at = at;
                    member.is_accessor = is_accessor;
                }
                None => members.push(Member { name, at, is_accessor, used: false }),
            }
        }
        if self.dump {
            for member in &members {
                println!("  member {} at {} accessor={}", String::from_utf8_lossy(member.name), member.at, member.is_accessor);
            }
        }
        self.classes.push(Frame { body: class.body_loc.start, members });
        // ESLint's handler skips a key only under a `PropertyDefinition` or a `MethodDefinition`: any other private key reads the name.
        for (name, at) in keys_only {
            self.reference(name, at, true);
        }
        walk(self);
        // What a member that leaves no node holds is inside the body of the class all the same.
        for index in &own {
            if let ErasedMemberData::Property(property) = &erased[*index].data {
                // SAFETY: the property is in the arena of the parse, which lives until the closure of the parse returns.
                let property: &'ast G::Property = unsafe { &*core::ptr::from_ref::<G::Property>(property) };
                for decorator in property.ts_decorators.iter() {
                    self.visit_expr(decorator);
                }
                for expr in [&property.key, &property.value, &property.initializer].into_iter().flatten() {
                    self.visit_expr(expr);
                }
            }
        }
        if let Some(frame) = self.classes.pop() {
            for member in frame.members {
                if !member.used {
                    let mut text = b"'".to_vec();
                    text.extend_from_slice(member.name);
                    text.extend_from_slice(b"' is defined but never used.");
                    self.out.push((member.at, text));
                }
            }
        }
    }
}

impl<'ast> Visitor<'ast> for Walker<'_, '_> {
    fn visit_stmt(&mut self, stmt: &'ast Stmt) {
        match &stmt.data {
            StmtData::SExpr(node) => {
                // An expression statement: the head of a `for` is an `S::SExpr` too and does not come through here.
                self.statement_value = match &node.value.data {
                    ExprData::EBinary(binary) if !self.has_ts(&node.value) => core::ptr::from_ref::<E::Binary>(binary).addr(),
                    ExprData::EUnary(unary) if !self.has_ts(&node.value) => core::ptr::from_ref::<E::Unary>(unary).addr(),
                    _ => 0,
                };
                self.visit_expr(&node.value);
                self.statement_value = 0;
            }
            StmtData::SFor(node) => {
                if let Some(init) = &node.init {
                    if let StmtData::SExpr(head) = &init.data {
                        self.statement_value = 0;
                        self.visit_expr(&head.value);
                    } else {
                        self.visit_stmt(init);
                    }
                }
                if let Some(test) = &node.test {
                    self.visit_expr(test);
                }
                if let Some(update) = &node.update {
                    self.visit_expr(update);
                }
                self.visit_stmt(&node.body);
            }
            StmtData::SForIn(_) | StmtData::SForOf(_) => {
                let (init, value, body) = match &stmt.data {
                    StmtData::SForIn(node) => (&node.init, &node.value, &node.body),
                    StmtData::SForOf(node) => (&node.init, &node.value, &node.body),
                    _ => return,
                };
                if let StmtData::SExpr(head) = &init.data {
                    self.statement_value = 0;
                    self.target(&head.value);
                    self.visit_expr(&head.value);
                } else {
                    self.visit_stmt(init);
                }
                self.visit_expr(value);
                self.visit_stmt(body);
            }
            _ => walk::walk_stmt(self, stmt),
        }
    }

    fn visit_s_class(&mut self, node: &'ast bun_ast::S::Class, _: bun_ast::Loc) {
        self.class(&node.class, |walker| walk::walk_s_class(walker, node));
    }

    fn visit_e_class(&mut self, node: &'ast E::Class, _: bun_ast::Loc) {
        self.class(node, |walker| walk::walk_e_class(walker, node));
    }

    fn visit_e_binary(&mut self, node: &'ast E::Binary, _: bun_ast::Loc) -> Option<&'ast Expr> {
        let address = core::ptr::from_ref::<E::Binary>(node).addr();
        if node.op == OpCode::BinAssign {
            // An assignment, or the default of a pattern: the left side is written.
            self.target(&node.left);
        } else if is_assign(node.op) {
            // `a.#b += 1` reads the member unless the value of the assignment is dropped.
            if self.statement_value == address
                && !self.has_ts(&node.left)
                && let Some(member) = private_member(&node.left)
            {
                self.write_only.insert(member);
            }
        } else if node.op == OpCode::BinIn
            && let ExprData::EPrivateIdentifier(private) = &node.left.data
        {
            let write_only = self.write_only.remove(&address);
            let name = self.parsed.name_of(private.ref_);
            self.reference(name, node.left.loc.start, !write_only);
        }
        walk::walk_e_binary(self, node)
    }

    fn visit_e_unary(&mut self, node: &'ast E::Unary, _: bun_ast::Loc) {
        let address = core::ptr::from_ref::<E::Unary>(node).addr();
        if is_update(node.op)
            && self.statement_value == address
            && !self.has_ts(&node.value)
            && let Some(member) = private_member(&node.value)
        {
            self.write_only.insert(member);
        }
        walk::walk_e_unary(self, node);
    }

    fn visit_e_array(&mut self, node: &'ast E::Array, _: bun_ast::Loc) {
        if self.patterns.remove(&core::ptr::from_ref::<E::Array>(node).addr()) {
            for item in node.items.as_slice().iter() {
                self.target(item);
            }
        }
        walk::walk_e_array(self, node);
    }

    fn visit_e_object(&mut self, node: &'ast E::Object, _: bun_ast::Loc) {
        if self.patterns.remove(&core::ptr::from_ref::<E::Object>(node).addr()) {
            for property in node.properties.as_slice().iter() {
                if let Some(value) = &property.value {
                    self.target(value);
                }
            }
        }
        walk::walk_e_object(self, node);
    }

    fn visit_e_index(&mut self, node: &'ast E::Index, _: bun_ast::Loc) {
        if let ExprData::EPrivateIdentifier(private) = &node.index.data {
            let write_only = self.write_only.remove(&core::ptr::from_ref::<E::Index>(node).addr());
            let name = self.parsed.name_of(private.ref_);
            self.reference(name, node.index.loc.start, !write_only);
        }
        walk::walk_e_index(self, node);
    }
}

fn line_column(text: &[u8], at: i32) -> (usize, usize) {
    let at = (at.max(0) as usize).min(text.len());
    let line_start = text[..at].iter().rposition(|&b| b == b'\n').map_or(0, |i| i + 1);
    let line = text[..at].iter().filter(|&&b| b == b'\n').count() + 1;
    let column = String::from_utf8_lossy(&text[line_start..at]).encode_utf16().count() + 1;
    (line, column)
}

fn check(path: &str, dump: bool) -> Option<String> {
    let text: &'static [u8] = std::fs::read(path).ok()?.leak();
    let arena = bun_alloc::Arena::new();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();
    let source = bun_ast::Source::init_path_string(path.as_bytes().to_vec().leak() as &'static [u8], text);
    let loader = if path.ends_with(".tsx") {
        bun_ast::Loader::Tsx
    } else if path.ends_with("ts") {
        bun_ast::Loader::Ts
    } else if path.ends_with(".mjs") || path.ends_with(".cjs") || path.ends_with(".js") {
        bun_ast::Loader::Js
    } else {
        bun_ast::Loader::Jsx
    };
    let is_typescript = matches!(loader, bun_ast::Loader::Ts | bun_ast::Loader::Tsx);
    let mut options = bun_js_parser::ParserOptions::init(Default::default(), loader);
    options.features.no_macros = true;
    options.features.is_macro_runtime = true;
    options.features.top_level_await = true;
    options.features.standard_decorators = true;
    let define = bun_js_parser::Define::default();
    let mut log = bun_ast::Log::init();
    let parser = bun_js_parser::Parser::init(options, &mut log, &source, &define, &arena).ok()?;
    let result = parser.parse_for_lint(|parsed| {
        let mut ts_wrapped = HashSet::new();
        let mut parenthesized = HashSet::new();
        for record in &parsed.sidecar.wrappers.records {
            if matches!(record.data, WrapperData::Parenthesized) {
                parenthesized.insert(ExprId::of(&record.operand));
            } else {
                ts_wrapped.insert(ExprId::of(&record.operand));
            }
        }
        let mut erased_members: HashMap<u32, Vec<usize>> = HashMap::new();
        for (index, member) in parsed.sidecar.erased.members.iter().enumerate() {
            erased_members.entry(member.class_body).or_default().push(index);
            if dump {
                let what = match &member.data {
                    ErasedMemberData::Property(property) => format!("property kind={} static={} method={} computed={}", property.kind as u8, property.flags.contains(Flag::IsStatic), property.flags.contains(Flag::IsMethod), property.flags.contains(Flag::IsComputed)),
                    ErasedMemberData::IndexSignature => String::from("index signature"),
                };
                println!("  erased member {}..{} class_body={} index={} {:?} {}", member.start, member.end, member.class_body, member.index, member.flags, what);
                if let ErasedMemberData::Property(property) = &member.data {
                    let attached = &parsed.sidecar.attached;
                    if let Some(key) = &property.key {
                        println!("    key@{} annotation={}", key.loc.start, attached.annotation_of(key.loc).is_some_and(|a| a.type_node.is_some()));
                    }
                    if let Some(Expr { data: ExprData::EFunction(function), .. }) = &property.value {
                        let owner = bun_js_parser::parse::attached::Owner::function(function.func.open_parens_loc);
                        println!("    function open_parens={} return_type={} type_parameters={}", function.func.open_parens_loc.start, attached.return_type_of(owner).is_some(), attached.type_parameters_of(owner).is_some());
                        for arg in function.func.args.slice() {
                            println!("    arg@{} annotation={}", arg.binding.loc.start, attached.annotation_of(arg.binding.loc).is_some_and(|a| a.type_node.is_some()));
                        }
                    }
                }
            }
        }
        if dump {
            let attached = &parsed.sidecar.attached;
            println!("  attached: annotations={} this={} type_parameters={} return_types={} heritage={} specifiers={}", attached.annotations.len(), attached.this_parameters.len(), attached.type_parameters.len(), attached.return_types.len(), attached.heritage.len(), attached.specifiers.len());
            for record in &parsed.sidecar.erased.statements {
                let what = match &record.data {
                    ErasedData::Interface(name) => format!("interface {}", String::from_utf8_lossy(name.text.slice())),
                    ErasedData::TypeAlias(name) => format!("type alias {}", String::from_utf8_lossy(name.text.slice())),
                    ErasedData::Declaration(_) => String::from("declaration"),
                    ErasedData::Module(_) => String::from("module"),
                    ErasedData::NamespaceExport(_) => String::from("namespace export"),
                    ErasedData::Import(import) => match &import.clause {
                        bun_js_parser::parse::erased::ImportClause::Named(items) => format!("import named items={}", items.slice().len()),
                        _ => String::from("import default or namespace"),
                    },
                    ErasedData::ImportEquals(_) => String::from("import equals"),
                    ErasedData::Export(export) => match &export.clause {
                        bun_js_parser::parse::erased::ExportClause::Named(items) => format!("export named items={} from={}", items.slice().len(), export.module_specifier.is_some()),
                        _ => String::from("export star"),
                    },
                };
                println!("  erased statement {}..{} {:?} {:?} {}", record.start, record.end, record.place, record.flags, what);
            }
        }
        let mut walker = Walker {
            parsed,
            is_typescript,
            ts_wrapped,
            parenthesized,
            erased_members,
            classes: Vec::new(),
            write_only: HashSet::new(),
            patterns: HashSet::new(),
            statement_value: 0,
            dump,
            out: Vec::new(),
        };
        for stmt in parsed.stmts {
            // SAFETY: the statement is in the arena of the parse, which lives until the closure returns.
            let stmt: &Stmt = unsafe { &*core::ptr::from_ref(stmt) };
            walker.visit_stmt(stmt);
        }
        // What leaves no statement: a declaration after `declare`, an overload, the body of a namespace without a value.
        for record in &parsed.sidecar.erased.statements {
            match &record.data {
                ErasedData::Declaration(stmt) => {
                    // SAFETY: as above.
                    let stmt: &Stmt = unsafe { &*core::ptr::from_ref(stmt) };
                    walker.visit_stmt(stmt);
                }
                ErasedData::Module(module) => {
                    if let Some(body) = &module.body {
                        for stmt in body.slice() {
                            // SAFETY: as above.
                            let stmt: &Stmt = unsafe { &*core::ptr::from_ref(stmt) };
                            walker.visit_stmt(stmt);
                        }
                    }
                }
                _ => {}
            }
        }
        walker.out.sort();
        let mut out = String::new();
        for (at, message) in &walker.out {
            let (line, column) = line_column(text, *at);
            out.push_str(&format!("{line}:{column} {}\n", String::from_utf8_lossy(message)));
        }
        out
    });
    match result {
        Ok(out) => Some(out),
        Err(_) => Some(String::from("PARSE_ERROR\n")),
    }
}

fn run() {
    let mut dump = false;
    for path in std::env::args().skip(1) {
        if path == "--dump" {
            dump = true;
            continue;
        }
        println!("== {path}");
        match check(&path, dump) {
            Some(out) => print!("{out}"),
            None => println!("CANNOT_READ_OR_INIT"),
        }
    }
}

fn main() {
    // A deep tree is walked by recursion: the thread has the stack for it.
    let child = std::thread::Builder::new().stack_size(1 << 30).spawn(run);
    if let Ok(handle) = child {
        let _ = handle.join();
    }
}
