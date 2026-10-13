//! Names that are keywords in some places, `eval` and `arguments`: oxc's `check_identifier`, `check_binding_identifier` and
//! `check_identifier_reference`, which the pass that builds its scopes runs on every identifier.
//!
//! The parser notes where such a name is an identifier. Few files have one, and no other file is looked at.

use super::{Stage, SyntaxError};
use crate::ast::{
    Class, Expr, ExprKind, File, Flags, FnKind, Func, Handle, MemberKind, Node, Pat, Stmt,
    StmtKind, TypeKind, TypeNode, TypeParam, UnOp, VarDecl, VarKind,
};
use crate::language::SourceType;
use crate::span::Span;
use crate::tokens::{skip_trivia, token_len};
use crate::utils::oxlint::{is_either, source_type};
use bun_sema::atom::{Atom, known};
use bun_sema::hir::{self, DiagnosticKind, PatKind, TypeNodeKind};

/// oxc's `BindingIdentifier`, `IdentifierReference` and `LabelIdentifier`
#[derive(Copy, Clone, PartialEq, Eq)]
enum Role {
    Binding,
    Reference,
    Label,
}

struct Checks<'a> {
    file: &'a File<'a>,
    is_module: bool,
    errors: Vec<SyntaxError>,
}

fn has_use_strict<'a>(statements: impl Iterator<Item = Stmt<'a>>) -> bool {
    let mut statements = statements;
    let mut directives = std::iter::from_fn(|| statements.next()?.directive());
    directives.any(|it| it == b"use strict")
}

/// Why the code at a name is strict. oxlint says so in a note.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Strict {
    No,
    Class,
    Module,
    Directive,
}

impl<'a> Checks<'a> {
    fn error(&self, at: u32, message: Vec<u8>) -> SyntaxError {
        let rest = self.file.text().get(at as usize..).unwrap_or_default();
        SyntaxError::of_oxc(Span::new(at, at + token_len(rest) as u32), message)
    }

    /// `ScopeFlags::is_strict_mode` where the name at `at` is, which is `node` or is in it. The decorators of a class are
    /// outside its scope, the name and the parameters of a function are in the scope of the function. For the note oxc goes up
    /// the tree, where the decorators are in the class.
    fn strictness(&self, node: Node<'a>, at: u32) -> Strict {
        let (mut is_in_class, mut is_in_scope_of_class, mut has_directive) = (false, false, false);
        for it in std::iter::once(node).chain(node.ancestors()) {
            match it {
                Node::Class(class) => {
                    is_in_class = true;
                    is_in_scope_of_class |= class.keyword_span().start <= at;
                }
                Node::Func(func) => {
                    let body = func.body_statements();
                    has_directive |= body.is_some_and(|it| has_use_strict(it.iter()));
                }
                Node::File(file) => has_directive |= has_use_strict(file.body().iter()),
                _ => {}
            }
        }
        if !is_in_scope_of_class && !self.is_module && !has_directive {
            return Strict::No;
        }
        match (is_in_class, self.is_module) {
            (true, _) => Strict::Class,
            (false, true) => Strict::Module,
            (false, false) => Strict::Directive,
        }
    }

    /// It is in a statement that starts with `declare`.
    fn is_ambient(node: Node<'a>) -> bool {
        std::iter::once(node)
            .chain(node.ancestors())
            .any(|it| matches!(it, Node::Stmt(it) if it.flags().contains(Flags::AMBIENT)))
    }

    /// `check_identifier`
    fn identifier(&mut self, name: Atom, at: u32, node: Node<'a>) {
        if name == known::eval || name == known::arguments || Self::is_ambient(node) {
            return;
        }
        let text = self.file.text().get(at as usize..).unwrap_or_default();
        let text = text.get(..token_len(text)).unwrap_or_default();
        let reserved = [b"The keyword '", text, b"' is reserved"].concat();
        let error = if name != known::r#await {
            let note = match self.strictness(node, at) {
                Strict::No => return,
                Strict::Class => "Classes are always strict mode code",
                Strict::Module => "Modules are always strict mode code",
                Strict::Directive => "This identifier is reserved in strict mode code",
            };
            self.error(at, reserved).note(note)
        } else if self.is_module {
            let note = "The identifier `await` is reserved in module code";
            self.error(at, reserved).note(note)
        } else if is_directly_in_static_block(node) {
            let message = b"Cannot use await in class static initialization block";
            self.error(at, message.to_vec())
        } else {
            return;
        };
        self.errors.push(error);
    }

    fn cannot_assign(&mut self, name: Atom, at: u32, why: Strict) {
        let name: &[u8] = match name == known::eval {
            true => b"eval",
            false => b"arguments",
        };
        let message = [b"Cannot assign to '", name, b"' in strict mode"].concat();
        let error = self.error(at, message).note(match why {
            Strict::Class => "Classes are always strict mode code",
            Strict::Module => "Modules are always strict mode code",
            Strict::Directive | Strict::No => "This is strict mode code",
        });
        self.errors.push(error);
    }

    /// `check_binding_identifier`
    fn binding(&mut self, name: Atom, at: u32, node: Node<'a>) {
        if name == known::eval || name == known::arguments {
            // As in tsc's binder, what is only declared passes, but for a variable and a name in a pattern.
            let is_variable_or_in_pattern = match node {
                Node::Pat(pat) => match pat.parent() {
                    Node::VarDecl(it) => !is_catch_parameter(it),
                    Node::Param(_) => false,
                    _ => true,
                },
                _ => false,
            };
            let why = self.strictness(node, at);
            if why != Strict::No && (is_variable_or_in_pattern || !Self::is_ambient(node)) {
                self.cannot_assign(name, at, why);
            }
        } else if name == known::let_ && self.strictness(node, at) == Strict::No {
            let declarator = node.ancestors().find_map(|it| match it {
                Node::VarDecl(it) if !is_catch_parameter(it) => Some(Some(it.var_kind())),
                Node::Func(func) if func.kind() != FnKind::Arrow => Some(None),
                _ => None,
            });
            let keyword = match declarator.flatten() {
                None | Some(VarKind::Var) => return,
                Some(VarKind::Let) => "let",
                Some(VarKind::Const) => "const",
                Some(VarKind::Using) => "using",
                Some(VarKind::AwaitUsing) => "await using",
            };
            let message = format!(
                "`let` cannot be declared as a variable name inside of a `{keyword}` declaration"
            );
            let error = self.error(at, message.into_bytes());
            self.errors.push(error);
        }
    }

    /// `check_identifier_reference`
    fn reference(&mut self, name: Atom, at: u32, node: Node<'a>) {
        if name != known::eval && name != known::arguments {
            return;
        }
        if let Node::Expr(it) = node
            && is_assigned_to(it, name)
        {
            match self.strictness(node, at) {
                Strict::No => {}
                why => return self.cannot_assign(name, at, why),
            }
        }
        if name != known::arguments {
            return;
        }
        let mut below = node;
        for above in node.ancestors() {
            let place = match above {
                Node::Func(func) if func.kind() == FnKind::StaticBlock => {
                    "static initialization block"
                }
                Node::Func(func) if func.kind() != FnKind::Arrow => return,
                Node::Member(member)
                    if member.kind() == MemberKind::Property
                        && !member.flags().contains(Flags::ACCESSOR)
                        && member.init().map(Node::Expr) == Some(below) =>
                {
                    "class field initializer"
                }
                _ => {
                    below = above;
                    continue;
                }
            };
            let message = format!("'arguments' is not allowed in {place}");
            let help = "Assign the 'arguments' variable to a temporary variable outside";
            let error = self.error(at, message.into_bytes()).help(help);
            return self.errors.push(error);
        }
    }

    /// `export { static }`, which oxc's parser reports.
    fn exported_without_from(&mut self, spec: &hir::ExportSpec) {
        let local = self
            .file
            .text()
            .get(spec.local_pos as usize..)
            .unwrap_or_default();
        let local = local.get(..token_len(local)).unwrap_or_default();
        let names = match spec.local_pos == spec.pos {
            true => [local, b" as ", local].concat(),
            false => self
                .file
                .slice(Span::new(spec.local_pos, spec.end))
                .to_vec(),
        };
        let names: String = bstr::ByteSlice::chars(&names[..]).collect();
        let message = b"A reserved word cannot be used as an exported binding without `from`";
        let error = self.error(spec.local_pos, message.to_vec());
        let help = format!("Did you mean `export {{ {names} }} from 'some-module'`?");
        self.errors.push(error.help(help).stage(Stage::Parser));
    }

    fn check(&mut self, role: Role, name: Atom, at: u32, node: Node<'a>) {
        if self.file.is_in_jsdoc(at) {
            return;
        }
        self.identifier(name, at, node);
        match role {
            Role::Binding => self.binding(name, at, node),
            Role::Reference => self.reference(name, at, node),
            Role::Label => {}
        }
    }
}

/// The `e` of `catch (e)` is a declaration here, and none to oxc.
fn is_catch_parameter(it: VarDecl) -> bool {
    matches!(it.parent(), Node::Stmt(it) if matches!(it.kind(), StmtKind::Try { .. }))
}

/// The scope that oxc is in at `node` is that of a static block. The name of a function or a class is in the scope of that, the
/// name of an enum, an interface, a type alias or a namespace is outside.
fn is_directly_in_static_block<'a>(node: Node<'a>) -> bool {
    let is_scope = |it: &Node<'a>| match it {
        Node::Func(_) | Node::Class(_) => true,
        Node::Stmt(it) => match it.kind() {
            StmtKind::Block(_)
            | StmtKind::For { .. }
            | StmtKind::ForIn { .. }
            | StmtKind::ForOf { .. }
            | StmtKind::Switch { .. }
            | StmtKind::Try { .. } => true,
            StmtKind::Enum(_)
            | StmtKind::Interface(_)
            | StmtKind::TypeAlias(_)
            | StmtKind::Module(_) => Node::Stmt(*it) != node,
            _ => false,
        },
        Node::Type(it) => matches!(it.kind(), TypeKind::Mapped(_) | TypeKind::Cond { .. }),
        _ => false,
    };
    let scope = std::iter::once(node).chain(node.ancestors()).find(is_scope);
    matches!(scope, Some(Node::Func(func)) if func.kind() == FnKind::StaticBlock)
}

/// oxc goes up from the name, past functions too, until it meets a member expression: a pattern that is assigned to or a `++`
/// anywhere above counts, and an assignment to the same name.
fn is_assigned_to(it: Expr, name: Atom) -> bool {
    for above in Node::Expr(it).ancestors() {
        let Node::Expr(above) = above else {
            continue;
        };
        match above.kind() {
            ExprKind::Dot { .. } | ExprKind::Index { .. } => return false,
            ExprKind::Array(_) | ExprKind::Object(_) if above.is_assignment_target() => {
                return true;
            }
            ExprKind::Unary {
                op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                ..
            } => return true,
            // A default in a pattern is no assignment to oxc.
            ExprKind::Assign { target, .. }
                if matches!(target.try_raw().map(|it| it.kind), Some(hir::ExprKind::Ident(it)) if it == name)
                    && !above.is_assignment_target() =>
            {
                return true;
            }
            _ => {}
        }
    }
    false
}

pub(super) fn errors<'a>(file: &'a File<'a>) -> Vec<SyntaxError> {
    let hir = &file.hir;
    if hir.keyword_identifier_positions.is_empty() || file.is_declaration_file() {
        return Vec::new();
    }
    let mut checks = Checks {
        file,
        is_module: source_type(file) == SourceType::Module,
        errors: Vec::new(),
    };
    let is_keyword = |name: Atom| name.is_keyword_identifier();
    for (i, raw) in hir.exprs.iter().enumerate() {
        if let hir::ExprKind::Ident(name) = raw.kind
            && is_keyword(name)
            && file.expr_in_tree(i).is_some()
        {
            let it = Expr::from_raw(file, i as u32);
            if !it.is_jsx_tag_name() {
                checks.check(Role::Reference, name, raw.pos, Node::Expr(it));
            }
        }
    }
    for (i, raw) in hir.pats.iter().enumerate() {
        if let PatKind::Ident(name) = raw.kind
            && is_keyword(name)
            && file.pat_in_tree(i).is_some()
        {
            let node = Node::Pat(Pat::from_raw(file, i as u32));
            // The key of an index signature is no binding to oxc.
            let owner = node.ancestors().nth(1);
            if !matches!(owner, Some(Node::Func(it)) if it.kind() == FnKind::IndexSignature) {
                checks.check(Role::Binding, name, raw.pos, node);
            }
        }
    }
    for (i, raw) in hir.fns.iter().enumerate() {
        let func = Func::from_raw(file, i as u32);
        if is_keyword(raw.name)
            && matches!(raw.kind, FnKind::Decl | FnKind::Expr)
            && func.is_in_tree()
        {
            checks.check(Role::Binding, raw.name, raw.name_pos, Node::Func(func));
        }
    }
    for (i, raw) in hir.classes.iter().enumerate() {
        if is_keyword(raw.name) {
            let node = Node::Class(Class::from_raw(file, i as u32));
            checks.check(Role::Binding, raw.name, raw.name_pos, node);
        }
    }
    for (i, raw) in hir.type_params.iter().enumerate() {
        if is_keyword(raw.name) {
            let node = Node::TypeParam(TypeParam::from_raw(file, i as u32));
            checks.check(Role::Binding, raw.name, raw.pos, node);
        }
    }
    for (i, raw) in hir.types.iter().enumerate() {
        if let TypeNodeKind::Ref { name, .. } = raw.kind
            && let Some(first) = hir.names.get(name.start as usize)
            && is_keyword(first.text)
        {
            let node = Node::Type(TypeNode::from_raw(file, i as u32));
            checks.check(Role::Reference, first.text, first.pos(), node);
        }
    }
    let statement = |id: hir::StmtId| Node::Stmt(Stmt::new(file, id));
    for raw in hir.imports {
        for (name, at) in [
            (raw.default, raw.default_pos),
            (raw.namespace, raw.namespace_pos),
        ] {
            if is_keyword(name) {
                checks.check(Role::Binding, name, at, statement(raw.stmt));
            }
        }
        for spec in hir.import_specs.get(raw.named.range()).unwrap_or_default() {
            if is_keyword(spec.local) {
                checks.check(Role::Binding, spec.local, spec.pos, statement(raw.stmt));
            }
        }
    }
    for raw in hir.exports.iter().filter(|it| !it.has_module_specifier) {
        for spec in hir.export_specs.get(raw.items.range()).unwrap_or_default() {
            if spec.local == known::let_ {
                checks.check(Role::Label, spec.local, spec.local_pos, statement(raw.stmt));
            } else if is_keyword(spec.local)
                && spec.local != known::eval
                && spec.local != known::arguments
            {
                checks.exported_without_from(spec);
            }
        }
    }
    let named = (hir
        .import_equals
        .iter()
        .map(|it| (it.name, it.name_pos, it.stmt)))
    .chain(hir.aliases.iter().map(|it| (it.name, it.name_pos, it.stmt)))
    .chain(
        hir.interfaces
            .iter()
            .map(|it| (it.name, it.name_pos, it.stmt)),
    )
    .chain(hir.enums.iter().map(|it| (it.name, it.name_pos, it.stmt)))
    .chain(hir.modules.iter().filter_map(|it| match it.name {
        hir::ModuleName::Ident(name) => Some((name, it.name_pos, it.stmt)),
        _ => None,
    }));
    for (name, at, id) in named {
        if is_keyword(name) {
            checks.check(Role::Binding, name, at, statement(id));
        }
    }
    for (i, raw) in hir.stmts.iter().enumerate() {
        let (label, at) = match raw.kind {
            hir::StmtKind::Labeled { label, .. } => (label, raw.start),
            hir::StmtKind::Break(label) | hir::StmtKind::Continue(label) => {
                let keyword = file.text().get(raw.start as usize..).unwrap_or_default();
                let after = raw.start + token_len(keyword) as u32;
                (label, skip_trivia(file.text(), after))
            }
            _ => continue,
        };
        if label.is_some() && is_keyword(label) {
            checks.check(Role::Label, label, at, statement(hir::StmtId(i as u32)));
        }
    }
    // What the parser has noted: see `note_keyword_identifier`.
    let is_module_by_name = checks.is_module && !is_either(file);
    for it in hir.diagnostics.iter() {
        let is_in_context = match it.code {
            1359 => true,
            // At the top level, after and before the first `import` or `export`.
            1262 => checks.is_module,
            1214 => is_module_by_name,
            _ => false,
        };
        if it.kind != DiagnosticKind::Grammar || !is_in_context {
            continue;
        }
        let message: &[u8] = match file.text().get(it.start as usize) {
            Some(b'y') => b"Cannot use `yield` as an identifier in a generator context",
            _ => b"Cannot use `await` as an identifier in an async context",
        };
        let error = SyntaxError::of_oxc(Span::new(it.start, it.end), message.to_vec());
        checks.errors.push(error.stage(Stage::Parser));
    }
    checks.errors
}
