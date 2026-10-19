//! Checks for contextual keywords used as identifiers, and for `eval` and `arguments`. Covers oxc's `check_identifier`,
//! `check_binding_identifier` and `check_identifier_reference`, which its semantic pass runs on every identifier, and
//! its parser's errors for such names.
//!
//! Our parser records where such a name is used as an identifier. Few files have one, and the other files are skipped.

use super::{Stage, SyntaxError};
use crate::ast::{
    self, Class, Expr, ExprKind, File, Flags, FnKind, Func, Handle, MemberKind, Node, Pat, Stmt,
    StmtKind, StmtTag, TypeKind, TypeNode, TypeParam, UnOp, VarDecl, VarKind,
};
use crate::language::SourceType;
use crate::span::Span;
use crate::tokens::{skip_trivia, token_len};
use crate::utils::oxlint::{can_be_script_or_module, source_type};
use bun_sema::atom::{Atom, known};
use bun_sema::hir::{self, DiagnosticKind, PatKind, TypeNodeKind};
use smallvec::SmallVec;
use std::cell::OnceCell;

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
    /// In a declaration file, only oxc's parser reports errors about these names.
    is_declaration_file: bool,
    /// The offsets the parser recorded, sorted, each with a flag that's set once the name there has been checked.
    recorded: SmallVec<[(u32, bool); 8]>,
    /// How many of `recorded` haven't been checked yet.
    unchecked: usize,
    /// The offsets of names that already have an error from oxc's parser. It reports at most one per name.
    reported_by_parser: SmallVec<[u32; 4]>,
    reparsed: OnceCell<Vec<Span>>,
    errors: Vec<SyntaxError>,
}

fn has_use_strict<'a>(statements: impl Iterator<Item = Stmt<'a>>) -> bool {
    let mut statements = statements;
    let mut directives = std::iter::from_fn(|| statements.next()?.directive());
    directives.any(|it| it == b"use strict")
}

/// Why the code at a name is strict. oxlint prints the reason in a note.
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
        SyntaxError::oxc_error(Span::new(at, at + token_len(rest) as u32), message)
    }

    /// Marks the name at `at` as checked.
    fn mark_checked(&mut self, at: u32) {
        if let Ok(index) = self.recorded.binary_search_by_key(&at, |it| it.0)
            && let Some(it) = self.recorded.get_mut(index)
            && !it.1
        {
            it.1 = true;
            self.unchecked -= 1;
        }
    }

    /// The token after `at`: its start, its text (empty at the end of the file), and whether it's on the same line as
    /// `at`.
    fn token_after(&self, at: u32) -> (u32, &'a [u8], bool) {
        let file = self.file;
        let next = skip_trivia(file.text(), at);
        let rest = file.text().get(next as usize..).unwrap_or_default();
        let between = file.slice(Span::new(at, next));
        (
            next,
            rest.get(..token_len(rest)).unwrap_or_default(),
            !bun_core::strings::contains_js_line_break(between),
        )
    }

    /// oxc's `Kind::is_after_await_or_yield` for the token after `end`, if it's on the same line. True for an
    /// identifier, a keyword or a literal, but not for an operator.
    fn has_operand_after(&self, end: u32) -> bool {
        let (_, token, is_on_line) = self.token_after(end);
        is_on_line
            && match token {
                b"in" | b"instanceof" => false,
                [b'"' | b'\'' | b'.' | b'0'..=b'9', ..] => token != b"." && token != b"...",
                [first, ..] => {
                    first.is_ascii_alphabetic() || matches!(first, b'_' | b'$' | b'\\' | 0x80..)
                }
                [] => false,
            }
    }

    /// True if oxc's parser already treats the file as a module when it reaches `at`, which is outside any function. It
    /// does so because of the file extension, or from the first module-only statement on. It only knows after that
    /// statement, except for an `export`, where it knows from the keyword on.
    fn is_module_at(&self, at: u32) -> bool {
        if !self.is_module || !can_be_script_or_module(self.file) {
            return self.is_module;
        }
        let file = self.file;
        let is_export = |it: Stmt<'a>| {
            matches!(
                it.tag(),
                StmtTag::ExportNamed
                    | StmtTag::ExportStar
                    | StmtTag::ExportDefault
                    | StmtTag::ExportAssign
                    | StmtTag::ExportAsNamespace
            )
        };
        let mut start = at;
        for it in file.body() {
            let span = it.span();
            if span.end <= at {
                if it.tag() == StmtTag::Import || is_export(it) || it.is_exported() {
                    return true;
                }
                continue;
            }
            let is_after_export = match it.export_span() {
                Some(export) => export.start <= at,
                None => is_export(it),
            };
            if is_after_export {
                return true;
            }
            if self.is_in_reparsed_statement(at) {
                return true;
            }
            start = span.start.min(at);
            break;
        }
        // `import.meta`, or an `await` that can only be the operator.
        file.hir.exprs.iter().enumerate().any(|(i, raw)| {
            raw.pos < start
                && match raw.kind {
                    hir::ExprKind::ImportMeta => true,
                    hir::ExprKind::Await(_) => {
                        self.has_operand_after(raw.pos + 5)
                            && !matches!(self.token_after(raw.pos + 5).1, b"of" | b"using")
                            && Node::Expr(Expr::from_raw(file, i as u32))
                                .enclosing_function()
                                .is_none()
                    }
                    _ => false,
                }
                && file.expr_in_tree(i).is_some()
        })
    }

    /// True if `at` is in one of the [statements that oxc reparses](super::reparsed_statements) with `await` as the
    /// operator. oxc doesn't reparse after a fatal error.
    fn is_in_reparsed_statement(&self, at: u32) -> bool {
        let again = || super::reparsed_statements(self.file);
        !self.file.has_parse_errors()
            && (self.reparsed.get_or_init(again).iter()).any(|it| it.contains_offset(at))
    }

    /// True if oxc's parser is in the await context at `node`, which is at `at`.
    fn is_in_async(&self, node: Node<'a>, at: u32) -> bool {
        Self::is_in_async_function(node).unwrap_or_else(|| self.is_module_at(at))
    }

    /// Like [`Checks::is_in_async`]. Returns `None` if `node` is outside any function, where the answer depends on the
    /// source type.
    fn is_in_async_function(node: Node<'a>) -> Option<bool> {
        let mut below = node;
        for above in node.ancestors() {
            match above {
                // An arrow function's head is also in the enclosing context.
                Node::Func(func) if func.kind() == FnKind::Arrow => {
                    let is_head =
                        matches!(below, Node::Param(_) | Node::Type(_) | Node::TypeParam(_));
                    if func.is_async() || !is_head {
                        return Some(func.is_async());
                    }
                }
                Node::Func(func) if has_own_context(func) => {
                    return Some(func.is_async() || func.kind() == FnKind::StaticBlock);
                }
                Node::Member(member) if member.init().map(Node::Expr) == Some(below) => {
                    return Some(false);
                }
                Node::Stmt(it) if leaves_await_context(it) => return Some(false),
                _ => {}
            }
            below = above;
        }
        None
    }

    /// `async await => 1`, where `at` is the `await`. oxc parses what follows `async` as an expression, so in the await
    /// context it looks for an operand and finds the `=>`. A statement outside any function is reparsed that way once
    /// the file turns out to be a module. Returns true if oxc gives up there.
    fn await_before_arrow(&mut self, func: Func<'a>, at: u32) -> bool {
        let (arrow, token, _) = self.token_after(at + 5);
        let is_keyword = || Self::is_in_async_function(Node::Func(func)).unwrap_or(self.is_module);
        if token != b"=>" || !is_keyword() {
            return false;
        }
        self.reported_by_parser.push(at);
        let error = SyntaxError::oxc_error(Span::new(arrow, arrow + 2), "Unexpected token");
        self.errors.push(error.stage(Stage::Fatal));
        true
    }

    /// oxc's error for `pattern` when it parses it as a type: an object pattern as a type literal, an array pattern as
    /// a tuple.
    fn pattern_as_type(&self, pattern: Pat<'a>) -> Option<SyntaxError> {
        let semicolon = |after: u32| {
            let message =
                "Expected a semicolon or an implicit semicolon after a statement, but found none";
            SyntaxError::oxc_error(Span::empty(after), message)
                .help("Try inserting a semicolon here")
        };
        let unexpected = |at: u32| self.error(at, b"Unexpected token".to_vec());
        match pattern.kind() {
            ast::PatKind::Object(properties) => properties.iter().find_map(|it| {
                if it.is_rest() {
                    return Some(unexpected(it.span().start));
                }
                let value = it.value();
                let default = || it.default().map(|_| semicolon(value.span().end));
                self.pattern_as_type(value).or_else(default)
            }),
            ast::PatKind::Array(elements) => elements.iter().find_map(|it| {
                let Some(element) = it.pat() else {
                    return Some(unexpected(skip_trivia(self.file.text(), it.span().start)));
                };
                let default = || {
                    it.default()?;
                    let (equals, ..) = self.token_after(element.span().end);
                    let error = self.error(equals, b"Expected `,` or `]` but found `=`".to_vec());
                    let opening = Span::new(pattern.span().start, pattern.span().start + 1);
                    Some(
                        error
                            .label_text("`,` or `]` expected")
                            .and(opening, "Opened here"),
                    )
                };
                self.pattern_as_type(element).or_else(default)
            }),
            _ => None,
        }
    }

    /// `({ await }: T) => void` where `await` is a keyword and `at` is its offset, and the same for `yield`. oxc tells
    /// a function type from a parenthesized type by what follows the `(`. A pattern with an error doesn't count as a
    /// pattern, so oxc parses a type instead. Returns true if oxc gives up on that.
    fn function_type_as_type(&mut self, func: Func<'a>, at: u32) -> bool {
        let Some(first) = func.params().first().filter(|it| {
            it.pat().span().contains_offset(at)
                && !it.is_rest()
                && func.kind() == FnKind::FunctionType
                && func.type_params().is_empty()
                && func.this_param().is_none()
        }) else {
            return false;
        };
        let pattern = first.pat();
        self.reported_by_parser.push(at);
        // Another name in the same pattern has already reported this.
        if self.reported_by_parser.contains(&pattern.span().start) {
            return true;
        }
        let after_pattern = || {
            let (mut next, mut token, _) = self.token_after(pattern.span().end);
            if token == b"?" {
                (next, token, _) = self.token_after(next + 1);
            }
            let message = [b"Expected `)` but found `", token, b"`"].concat();
            (token != b")").then(|| self.error(next, message).label_text("`)` expected"))
        };
        let Some(error) = self.pattern_as_type(pattern).or_else(after_pattern) else {
            self.reported_by_parser.pop();
            return false;
        };
        self.reported_by_parser.push(pattern.span().start);
        self.errors.push(error.stage(Stage::Fatal));
        true
    }

    /// `check_identifier` in oxc's parser: `await` or `yield` is used as an identifier where it's a keyword. The parser
    /// continues.
    fn keyword_as_identifier(&mut self, name: Atom, at: u32) {
        if self.reported_by_parser.contains(&at) {
            return;
        }
        self.reported_by_parser.push(at);
        let error = match name == known::r#yield {
            true => {
                let message = b"Cannot use `yield` as an identifier in a generator context";
                let rest = self.file.text().get(at as usize..).unwrap_or_default();
                let error = self.error(at, message.to_vec());
                match self.has_operand_after(at + token_len(rest) as u32) {
                    true => error.help(
                        "Wrap this in parentheses if you want to use a `yield` expression here",
                    ),
                    false => error,
                }
            }
            false => {
                let message = b"Cannot use `await` as an identifier in an async context";
                self.error(at, message.to_vec())
            }
        };
        self.errors.push(error.stage(Stage::Parser));
    }

    /// oxc's parser accepts any word as an import specifier's local name and checks it afterwards.
    fn reserved_word_in_import(&mut self, name: Atom, at: u32) {
        self.mark_checked(at);
        self.reported_by_parser.push(at);
        let word = match name == known::r#yield {
            true => "yield",
            false => "await",
        };
        let message =
            format!("Identifier expected. '{word}' is a reserved word that cannot be used here.");
        let error = self.error(at, message.into_bytes());
        self.errors.push(error.stage(Stage::Parser));
    }

    /// oxc's `parse_let`, for the statements that start at one of `lets`, where our parser parsed `let` as an
    /// identifier.
    fn let_statements(&mut self, lets: &[u32]) {
        let file = self.file;
        for tag in [StmtTag::Expr, StmtTag::Labeled] {
            for it in file.stmts_of_kind(tag) {
                let start = it.span().start;
                if lets.contains(&start) {
                    self.let_statement(it, start + 3);
                }
            }
        }
    }

    /// At the start of a statement `let` begins a declaration, unless the next token is a binary operator, a `.`, a `(`
    /// or a `;`. `after` is the end of the `let`.
    fn let_statement(&mut self, statement: Stmt<'a>, after: u32) {
        let (next, token, is_on_line) = self.token_after(after);
        let continues_expression = match token {
            b"=>" | b"++" | b"--" | b"||" | b"&&" | b"??" | b"?" | b"!" | b"..." => false,
            b"in" | b"instanceof" | b"." | b"(" | b";" => true,
            [first, ..] => bun_core::strings::contains_char(b"=+-*/%<>|&^!?", *first),
            [] => false,
        };
        if continues_expression {
            return;
        }
        // In a single-statement position, which doesn't allow a declaration, `let` is an identifier and the statement
        // ends after it.
        let is_single_statement_position = matches!(statement.parent(), Node::Stmt(it) if matches!(
            it.kind(),
            StmtKind::If { .. }
                | StmtKind::For { .. }
                | StmtKind::ForIn { .. }
                | StmtKind::ForOf { .. }
                | StmtKind::While { .. }
                | StmtKind::DoWhile { .. }
                | StmtKind::With { .. }
                | StmtKind::Labeled { .. }
        ));
        let error = match is_single_statement_position {
            true if !is_on_line || matches!(token, b"" | b"}") => return,
            true => {
                let message = "Expected a semicolon or an implicit semicolon after a statement, but found none";
                SyntaxError::oxc_error(Span::empty(after), message)
                    .help("Try inserting a semicolon here")
            }
            // oxc's lexer treats any escape, even a malformed one, as part of an identifier, and has already reported
            // it.
            false if token.starts_with(b"\\") => return,
            false => {
                let label = Span::new(next, next + token.len() as u32);
                SyntaxError::oxc_error(label, "Unexpected token")
            }
        };
        self.errors.push(error.stage(Stage::Fatal));
    }

    /// `ScopeFlags::is_strict_mode` for the name at `at`, which is `node` or inside it. A class's decorators are
    /// outside its scope, and a function's name and parameters are inside the function's scope. To pick the note, oxc
    /// walks up the tree, where decorators are inside the class.
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

    /// True if `node` is in a statement that starts with `declare`.
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
        // The decoded name, even if the source has an escape: `yi\u0065ld`
        let text = self.file.name(name).bytes();
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
            // As in tsc's binder, ambient declarations are allowed, except for a variable or a name in a pattern.
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
            let location = match above {
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
            let message = format!("'arguments' is not allowed in {location}");
            let help = "Assign the 'arguments' variable to a temporary variable outside";
            let error = self.error(at, message.into_bytes()).help(help);
            return self.errors.push(error);
        }
    }

    /// `export { static }`, which oxc's parser reports.
    fn exported_without_from(&mut self, spec: &hir::ExportSpec) {
        self.mark_checked(spec.local_pos);
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
        self.mark_checked(at);
        if self.is_declaration_file {
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

/// The `e` in `catch (e)` is a variable declaration in our tree but not in oxc's.
fn is_catch_parameter(it: VarDecl) -> bool {
    matches!(it.parent(), Node::Stmt(it) if matches!(it.kind(), StmtKind::Try { .. }))
}

/// True if oxc's current scope at `node` is a static block's. A function's or class's name is inside its own scope,
/// while the name of an enum, interface, type alias or namespace is outside.
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

/// True if oxc's parser resets the await and yield contexts for `func`, which isn't an arrow function. It doesn't for
/// type-only functions: a function type, or a signature in an interface or type literal.
fn has_own_context(func: Func) -> bool {
    match func.kind() {
        FnKind::CallSignature
        | FnKind::ConstructSignature
        | FnKind::FunctionType
        | FnKind::ConstructorType
        | FnKind::IndexSignature => false,
        FnKind::Method | FnKind::Getter | FnKind::Setter => !matches!(
            Node::Func(func).parent(),
            Node::Member(it) if !matches!(Node::Member(it).parent(), Node::Class(_))
        ),
        _ => true,
    }
}

/// oxc leaves the await context for a declaration that starts with one of these words. A declaration after `export` or
/// a decorator doesn't start with one. A type stays in the enclosing context.
fn leaves_await_context(it: Stmt) -> bool {
    let text = it.text();
    matches!(
        it.tag(),
        StmtTag::Class
            | StmtTag::Enum
            | StmtTag::Fn
            | StmtTag::Interface
            | StmtTag::Module
            | StmtTag::TypeAlias
            | StmtTag::Var
    ) && matches!(
        text.get(..token_len(text)),
        Some(
            b"abstract"
                | b"declare"
                | b"enum"
                | b"global"
                | b"interface"
                | b"module"
                | b"namespace"
                | b"type"
        )
    )
}

/// True if oxc's parser is in the yield context at `node`. Unlike the await context, the yield context extends into
/// types.
fn is_in_generator(node: Node) -> bool {
    let mut below = node;
    for above in node.ancestors() {
        match above {
            // An arrow function's head is in the enclosing context.
            Node::Func(func)
                if func.kind() == FnKind::Arrow
                    && matches!(below, Node::Param(_) | Node::Type(_) | Node::TypeParam(_)) => {}
            Node::Func(func) if has_own_context(func) => return func.is_generator(),
            Node::Member(member) if member.init().map(Node::Expr) == Some(below) => return false,
            _ => {}
        }
        below = above;
    }
    false
}

/// The function that has a parameter binding `name`, and true if the name is that parameter's whole pattern.
fn function_of_parameter<'a>(name: Node<'a>) -> Option<(Func<'a>, bool)> {
    let mut is_all = true;
    for above in name.ancestors() {
        match above {
            Node::Param(_) => {}
            Node::Pat(_) | Node::PatProp(_) | Node::PatElem(_) => is_all = false,
            Node::Func(func) => return Some((func, is_all)),
            _ => return None,
        }
    }
    None
}

/// oxc walks up from the name, even past functions, until it reaches a member expression. A destructuring assignment or
/// a `++` anywhere above counts, and so does an assignment to the same name.
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
            // oxc doesn't treat a default in a pattern as an assignment.
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
    if hir.keyword_identifier_positions.is_empty() {
        return Vec::new();
    }
    let positions = hir.keyword_identifier_positions.iter();
    let mut positions: SmallVec<[u32; 8]> = positions.copied().collect();
    positions.sort_unstable();
    positions.dedup();
    let recorded: SmallVec<[(u32, bool); 8]> = positions.iter().map(|&at| (at, false)).collect();
    let mut checks = Checks {
        file,
        is_module: source_type(file) == SourceType::Module,
        is_declaration_file: file.is_declaration_file(),
        unchecked: recorded.len(),
        recorded,
        reported_by_parser: SmallVec::new(),
        reparsed: OnceCell::new(),
        errors: Vec::new(),
    };
    let is_keyword = |name: Atom| name.is_keyword_identifier();
    let is_reserved = |name: Atom| name == known::r#await || name == known::r#yield;
    let statement = |id: hir::StmtId| Node::Stmt(Stmt::new(file, id));
    // Stop as soon as every recorded name has been found.
    'all: {
        for (i, raw) in hir.exprs.iter().enumerate() {
            if let hir::ExprKind::Ident(name) = raw.kind
                && is_keyword(name)
                && file.expr_in_tree(i).is_some()
            {
                let it = Expr::from_raw(file, i as u32);
                if !it.is_jsx_tag_name() {
                    checks.check(Role::Reference, name, raw.pos, Node::Expr(it));
                    if checks.unchecked == 0 {
                        break 'all;
                    }
                }
            }
        }
        for (i, raw) in hir.pats.iter().enumerate() {
            if let PatKind::Ident(name) = raw.kind
                && is_keyword(name)
                && file.pat_in_tree(i).is_some()
            {
                let node = Node::Pat(Pat::from_raw(file, i as u32));
                // oxc doesn't treat an index signature's key as a binding.
                let owner = node.ancestors().nth(1);
                if matches!(owner, Some(Node::Func(it)) if it.kind() == FnKind::IndexSignature) {
                    continue;
                }
                // Our parser parses an arrow function's head outside the enclosing context, and learns late that the
                // function is async.
                let is_keyword_here = match function_of_parameter(node) {
                    Some((func, false))
                        if !has_own_context(func)
                            && match name == known::r#await {
                                true => checks.is_in_async(Node::Func(func), raw.pos),
                                false => {
                                    name == known::r#yield && is_in_generator(Node::Func(func))
                                }
                            }
                            && checks.function_type_as_type(func, raw.pos) =>
                    {
                        false
                    }
                    Some((func, true))
                        if name == known::r#await
                            && func.kind() == FnKind::Arrow
                            && func.is_async()
                            && checks.await_before_arrow(func, raw.pos) =>
                    {
                        false
                    }
                    Some((func, _)) if name == known::r#await => {
                        func.is_async()
                            || (func.kind() == FnKind::Arrow || !has_own_context(func))
                                && checks.is_in_async(Node::Func(func), raw.pos)
                    }
                    Some((func, is_all)) if name == known::r#yield => {
                        (func.kind() == FnKind::Arrow || is_all && !has_own_context(func))
                            && is_in_generator(Node::Func(func))
                    }
                    _ => false,
                };
                if is_keyword_here {
                    checks.keyword_as_identifier(name, raw.pos);
                }
                checks.check(Role::Binding, name, raw.pos, node);
            }
        }
        if checks.unchecked == 0 {
            break 'all;
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
        if checks.unchecked == 0 {
            break 'all;
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
        if checks.unchecked == 0 {
            break 'all;
        }
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
                if is_reserved(spec.local) {
                    checks.reserved_word_in_import(spec.local, spec.pos);
                } else if is_keyword(spec.local) {
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
        // Our parser leaves the top-level await context for the whole of `import a = b`.
        for raw in hir.import_equals.iter() {
            if raw.name == known::r#await
                && matches!(statement(raw.stmt).parent(), Node::File(_))
                && checks.is_module_at(raw.name_pos)
            {
                checks.keyword_as_identifier(raw.name, raw.name_pos);
            }
            if let hir::ImportEqualsTarget::Entity(names) = raw.target
                && let Some(first) = hir.names.get(names.start as usize)
                && !names.is_empty()
                && is_keyword(first.text)
            {
                checks.check(
                    Role::Reference,
                    first.text,
                    first.pos(),
                    statement(raw.stmt),
                );
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
        if checks.unchecked == 0 {
            break 'all;
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
    }
    let is_let = |at: &u32| {
        let rest = file.text().get(*at as usize..).unwrap_or_default();
        rest.starts_with(b"let") && token_len(rest) == 3
    };
    let positions = hir.keyword_identifier_positions.iter();
    let lets: SmallVec<[u32; 4]> = positions.copied().filter(is_let).collect();
    if !lets.is_empty() {
        checks.let_statements(&lets);
    }
    // The parser records the `a` in `export * as a from "b"` like a declared name, but oxc accepts any word there.
    for it in file.stmts_of_kind(StmtTag::ExportStar) {
        if let StmtKind::ExportStar {
            alias: Some(alias), ..
        } = it.kind()
        {
            checks.reported_by_parser.push(alias.span().start);
        }
    }
    // The diagnostics the parser recorded. See `note_keyword_identifier`. 1262 and 1214 are only reported at the top
    // level.
    for it in hir.diagnostics.iter() {
        let is_recorded =
            it.kind == DiagnosticKind::Grammar && matches!(it.code, 1359 | 1262 | 1214);
        if is_recorded && (it.code == 1359 || checks.is_module_at(it.start)) {
            let name = match file.text().get(it.start as usize) {
                Some(b'y') => known::r#yield,
                _ => known::r#await,
            };
            checks.keyword_as_identifier(name, it.start);
        }
    }
    checks.errors
}
