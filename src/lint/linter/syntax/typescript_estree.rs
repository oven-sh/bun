//! The errors of typescript-estree: `checkSyntaxError`, `checkModifiers`, and what `Converter` throws itself.
//!
//! TypeScript's parser accepts `interface I { private a }` and leaves the error to the type checker. typescript-estree has no
//! type checker to leave it to, and repeats a part of those checks as it converts a node.
//!
//! No tree is walked here. Each check goes through the vector of the HIR that has the nodes it is about, and tests what is
//! cheapest first. Where the HIR has dropped what is wrong, the parser has left a diagnostic, which is translated.
//!
//! It throws at the first node that fails, in the order in which it converts, which is not the order of the source: see
//! [`order`](super::order).

use super::SyntaxError;
use super::order::{self, Candidate, When};
use crate::ast::{
    Expr, ExprKind, ExprTag, File, Handle, Member, Node, Param, Prop, Stmt, TypeParam,
};
use crate::linter::space::trim_start;
use crate::span::Span;
use crate::tokens::{skip_trivia, token_len};
use bun_sema::bind::{ClassOwner, FnOwner, MemberOwner, Parent};
use bun_sema::hir::{
    self, BinOp, Chain, Diagnostic, Flags, FnBody, FnKind, MemberKind, ModifierKind, NameKind,
    PropKind, StmtKind, UnOp, VarKind,
};

/// `ts.SyntaxKind` of a node with modifiers, as far as `checkModifiers` tells them apart.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Kind {
    FunctionDeclaration,
    ClassDeclaration,
    ClassExpression,
    PropertyDeclaration,
    PropertySignature,
    MethodDeclaration,
    MethodSignature,
    /// `GetAccessor`, `SetAccessor`
    Accessor,
    IndexSignature,
    TypeParameter,
    Parameter,
    /// `PropertyAssignment`, `ShorthandPropertyAssignment`: not among `ts.canHaveModifiers`.
    PropertyAssignment,
    /// The others among `ts.canHaveModifiers`.
    Other,
}

/// `node.parent`, likewise.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Place {
    /// `ts.isClassLike`
    Class,
    /// `InterfaceDeclaration`, `TypeAliasDeclaration`
    InterfaceOrTypeAlias,
    /// `ModuleBlock`, `SourceFile`
    ModuleOrFile,
    ObjectLiteral,
    Other,
}

/// `nodeCanBeDecorated`
#[derive(Copy, Clone, PartialEq, Eq)]
enum Decorated {
    Validly,
    /// A method without a body.
    Overload,
    Invalidly,
}

const ACCESSIBILITY: Flags = Flags::PUBLIC.union(Flags::PRIVATE).union(Flags::PROTECTED);

fn has_keyword(modifiers: &[hir::Modifier], keyword: Flags) -> bool {
    modifiers
        .iter()
        .any(|it| it.kind == ModifierKind::Keyword(keyword))
}

fn var_kind_text(kind: VarKind) -> &'static str {
    match kind {
        VarKind::Var => "var",
        VarKind::Let => "let",
        VarKind::Const => "const",
        VarKind::Using => "using",
        VarKind::AwaitUsing => "await using",
    }
}

struct Checks<'a> {
    file: &'a File<'a>,
    is_of_prettier: bool,
    /// The checks that fail, and for each its error.
    candidates: Vec<Candidate>,
    errors: Vec<SyntaxError>,
}

/// More errors than this are not told apart: the file is refused with one of these.
const MAX_CANDIDATES: usize = 1024;

/// `is_of_prettier`: the version that Prettier 3.9 has, which does not look at the values of import attributes.
pub(super) fn first_error<'a>(file: &'a File<'a>, is_of_prettier: bool) -> Option<SyntaxError> {
    let mut checks = Checks {
        file,
        is_of_prettier,
        candidates: Vec::new(),
        errors: Vec::new(),
    };
    checks.statements();
    checks.variable_declarations();
    checks.classes();
    checks.members();
    checks.parameters();
    checks.type_parameters();
    checks.functions();
    checks.properties();
    checks.expressions();
    checks.the_rest();
    checks.diagnostics();
    let first = match checks.errors.len() {
        0 | 1 => 0,
        _ => order::first(file, &checks.candidates).unwrap_or(0),
    };
    (first < checks.errors.len()).then(|| checks.errors.swap_remove(first))
}

impl<'a> Checks<'a> {
    /// `throw createError(at, message)` while `node` is checked.
    fn fail(&mut self, node: Span, at: u32, message: impl Into<Vec<u8>>) {
        self.fail_at_step(node, 0, at, message);
    }

    /// The same for a check that comes after those of [`Checks::fail`], in the order of `step`.
    fn fail_at_step(&mut self, node: Span, step: u32, at: u32, message: impl Into<Vec<u8>>) {
        self.fail_when(When::First, node, step, at, message);
    }

    fn fail_when(
        &mut self,
        when: When,
        node: Span,
        step: u32,
        at: u32,
        message: impl Into<Vec<u8>>,
    ) {
        // What is synthesized from a comment is not syntax.
        if !self.file.is_in_jsdoc(at) && self.errors.len() < MAX_CANDIDATES {
            self.candidates.push(Candidate { node, when, step });
            self.errors.push(SyntaxError {
                at,
                message: message.into(),
            });
        }
    }

    /// `<>` at `at`.
    fn fail_for_empty_list(&mut self, when: When, at: u32) {
        let message = match when {
            When::TypeParameters => "Type parameter list cannot be empty.",
            _ => "Type argument list cannot be empty.",
        };
        self.fail_when(when, Span::empty(at), 0, at, message);
    }

    fn modifiers(&self, list: hir::Span<hir::ModifierId>) -> &'a [hir::Modifier] {
        self.file
            .hir
            .modifiers
            .get(list.range())
            .unwrap_or_default()
    }

    /// `node.getStart()` of an expression, which can be a parenthesis.
    fn start_of(&self, id: hir::ExprId) -> u32 {
        Expr::new(self.file, id).outer_span().start
    }

    /// The token at `at`.
    fn token_at(&self, at: u32) -> &'a [u8] {
        let rest = self.file.text().get(at as usize..).unwrap_or_default();
        rest.get(..token_len(rest)).unwrap_or(rest)
    }

    fn byte(&self, at: u32) -> u8 {
        self.file.text().get(at as usize).copied().unwrap_or(0)
    }

    /// Whether the token at `at` is a `StringLiteral`.
    fn is_string_literal(&self, at: u32) -> bool {
        matches!(self.byte(at), b'"' | b'\'')
    }

    // ───────────────────────────── modifiers ─────────────────────────────

    /// `checkModifiers`. `decorated`: `nodeCanBeDecorated(node)`, asked if there is a decorator.
    fn check_modifiers(
        &mut self,
        owner: (Kind, Place, Span),
        modifiers: &[hir::Modifier],
        decorated: impl FnOnce(&Self) -> Decorated,
    ) {
        self.check_modifiers_and(owner, modifiers, decorated, None);
    }

    /// `other`: what is wrong with the node if it has one of these modifiers.
    fn check_modifiers_and(
        &mut self,
        (kind, place, node): (Kind, Place, Span),
        modifiers: &[hir::Modifier],
        decorated: impl FnOnce(&Self) -> Decorated,
        other: Option<(Flags, &str)>,
    ) {
        let on = |text: &str, modifier: Flags| {
            ["'", hir::modifier_text(modifier), "' modifier ", text].concat()
        };
        if kind == Kind::PropertyAssignment {
            if let Some(it) = modifiers
                .iter()
                .find(|it| matches!(it.kind, ModifierKind::Keyword(_)))
            {
                self.fail(node, it.pos, on("cannot be used here.", it.kind.flag()));
            }
            return;
        }
        if let Some(decorator) = modifiers
            .iter()
            .find(|it| matches!(it.kind, ModifierKind::Decorator(_)))
        {
            let message = match decorated(self) {
                Decorated::Validly => None,
                Decorated::Overload => {
                    Some("A decorator can only decorate a method implementation, not an overload.")
                }
                Decorated::Invalidly => Some("Decorators are not valid here."),
            };
            if let Some(message) = message {
                return self.fail(node, decorator.pos, message);
            }
        }
        for it in modifiers {
            let ModifierKind::Keyword(modifier) = it.kind else {
                continue;
            };
            let is = |flags: Flags| flags.contains(modifier);
            let message = if modifier != Flags::READONLY
                && matches!(kind, Kind::PropertySignature | Kind::MethodSignature)
            {
                on("cannot appear on a type member", modifier)
            } else if modifier != Flags::READONLY
                && kind == Kind::IndexSignature
                && (modifier != Flags::STATIC || place != Place::Class)
            {
                on("cannot appear on an index signature", modifier)
            } else if kind == Kind::TypeParameter && !is(Flags::IN | Flags::OUT | Flags::CONST) {
                on("cannot appear on a type parameter", modifier)
            } else if is(Flags::IN | Flags::OUT)
                && (kind != Kind::TypeParameter
                    || !matches!(place, Place::Class | Place::InterfaceOrTypeAlias))
            {
                on(
                    "can only appear on a type parameter of a class, interface or type alias",
                    modifier,
                )
            } else if modifier == Flags::READONLY
                && !matches!(
                    kind,
                    Kind::PropertyDeclaration
                        | Kind::PropertySignature
                        | Kind::IndexSignature
                        | Kind::Parameter
                )
            {
                on(
                    "can only appear on a property declaration or index signature.",
                    modifier,
                )
            } else if modifier == Flags::AMBIENT
                && place == Place::Class
                && kind != Kind::PropertyDeclaration
            {
                on("cannot appear on class elements of this kind.", modifier)
            } else if modifier == Flags::ABSTRACT
                && !matches!(
                    kind,
                    Kind::ClassDeclaration
                        | Kind::MethodDeclaration
                        | Kind::PropertyDeclaration
                        | Kind::Accessor
                )
            {
                on(
                    "can only appear on a class, method, or property declaration.",
                    modifier,
                )
            } else if is(Flags::STATIC | ACCESSIBILITY) && place == Place::ModuleOrFile {
                on("cannot appear on a module or namespace element.", modifier)
            } else if modifier == Flags::ACCESSOR && kind != Kind::PropertyDeclaration {
                on("can only appear on a property declaration.", modifier)
            } else if modifier == Flags::ASYNC
                && !matches!(kind, Kind::MethodDeclaration | Kind::FunctionDeclaration)
            {
                on("cannot be used here.", modifier)
            } else if kind == Kind::Parameter
                && is(Flags::STATIC | Flags::EXPORT | Flags::AMBIENT | Flags::ASYNC)
            {
                on("cannot appear on a parameter.", modifier)
            } else if let Some(other) = (modifiers.iter()).find(|other| {
                is(ACCESSIBILITY)
                    && other.pos != it.pos
                    && ACCESSIBILITY.intersects(other.kind.flag())
            }) {
                return self.fail(node, other.pos, "Accessibility modifier already seen.");
            } else if let Some((_, message)) = other.filter(|it| is(it.0)) {
                message.to_owned()
            } else if place == Place::ObjectLiteral
                && (modifier != Flags::ASYNC || kind != Kind::MethodDeclaration)
            {
                on("cannot be used here.", modifier)
            } else {
                continue;
            };
            return self.fail(node, it.pos, message);
        }
    }

    fn place_of_statement(&self, id: usize) -> Place {
        match self.file.bound.stmt_parent.get(id) {
            Some(Parent::File | Parent::Module(_)) => Place::ModuleOrFile,
            _ => Place::Other,
        }
    }

    // ───────────────────────────── statements ─────────────────────────────

    fn statements(&mut self) {
        let (hir, bound) = (&self.file.hir, &self.file.bound);
        for (i, raw) in hir.stmts.iter().enumerate() {
            let has_check = !raw.modifiers.is_empty()
                || matches!(
                    raw.kind,
                    StmtKind::Switch { .. }
                        | StmtKind::Throw(_)
                        | StmtKind::Try { .. }
                        | StmtKind::Fn(_)
                        | StmtKind::ForIn { .. }
                        | StmtKind::ForOf { .. }
                        | StmtKind::ImportEquals(_)
                )
                || matches!(raw.kind, StmtKind::Var(list) if list.is_empty());
            if !has_check || matches!(bound.stmt_parent.get(i), None | Some(Parent::None)) {
                continue;
            }
            let node = Span::new(raw.start, raw.loc.end);
            let modifiers = self.modifiers(raw.modifiers);
            // Those of a class are checked with the class.
            if !modifiers.is_empty() && !matches!(raw.kind, StmtKind::Class(_)) {
                let kind = match raw.kind {
                    StmtKind::Fn(_) => Kind::FunctionDeclaration,
                    _ => Kind::Other,
                };
                let using = match raw.kind {
                    StmtKind::Var(list) => match hir
                        .var_decls
                        .get(list.range())
                        .and_then(<[_]>::first)
                        .map(|it| it.kind)
                    {
                        Some(VarKind::Using) => {
                            Some("'declare' modifier cannot appear on a 'using' declaration.")
                        }
                        Some(VarKind::AwaitUsing) => {
                            Some("'declare' modifier cannot appear on a 'await using' declaration.")
                        }
                        _ => None,
                    },
                    _ => None,
                };
                let owner = (kind, self.place_of_statement(i), node);
                self.check_modifiers_and(
                    owner,
                    modifiers,
                    |_| Decorated::Invalidly,
                    using.map(|it| (Flags::AMBIENT, it)),
                );
            }
            match raw.kind {
                StmtKind::Switch { cases, .. } => {
                    let cases = hir.cases.get(cases.range()).unwrap_or_default();
                    if cases.iter().filter(|it| it.test.is_none()).count() > 1 {
                        self.fail(node, node.start, "A 'default' clause cannot appear more than once in a 'switch' statement.");
                    }
                }
                StmtKind::Throw(thrown) => {
                    if hir
                        .exprs
                        .get(thrown.idx())
                        .is_none_or(|it| it.pos == it.end)
                    {
                        self.fail(
                            node,
                            node.start,
                            "A throw statement must throw an expression.",
                        );
                    }
                }
                StmtKind::Try { param, .. } => {
                    if let Some(init) = hir
                        .var_decls
                        .get(param.idx())
                        .map(|it| it.init)
                        .filter(|it| it.is_some())
                    {
                        let clause = Stmt::from_raw(self.file, i as u32)
                            .catch_clause_span()
                            .unwrap_or(node);
                        let message = "Catch clause variable cannot have an initializer.";
                        self.fail_when(When::CatchClause, clause, 0, self.start_of(init), message);
                    }
                }
                StmtKind::Fn(func) => {
                    let Some(func) = hir.fns.get(func.idx()) else {
                        continue;
                    };
                    let has_body = !matches!(func.body, FnBody::None);
                    let is_generator = func.flags.contains(Flags::GENERATOR);
                    let message = if has_keyword(modifiers, Flags::AMBIENT) {
                        if has_body {
                            "An implementation cannot be declared in ambient contexts."
                        } else if has_keyword(modifiers, Flags::ASYNC) {
                            "'async' modifier cannot be used in an ambient context."
                        } else if is_generator {
                            "Generators are not allowed in an ambient context."
                        } else {
                            continue;
                        }
                    } else if !has_body && is_generator {
                        "A function signature cannot be declared as a generator."
                    } else {
                        continue;
                    };
                    self.fail(node, node.start, message);
                }
                StmtKind::Var(list) => {
                    let is_statement = !self.is_in_head_of_loop(i);
                    if list.is_empty() && is_statement {
                        let message = "A variable declaration list must have at least one variable declarator.";
                        self.fail(node, node.start, message);
                    }
                    if has_keyword(modifiers, Flags::AMBIENT) {
                        list.iter()
                            .for_each(|it: hir::VarDeclId| self.variable_declaration(it.idx()));
                    }
                }
                StmtKind::ForIn { left, .. } => {
                    self.check_for_statement_declaration(node, left, "for...in")
                }
                StmtKind::ForOf { left, .. } => {
                    self.check_for_statement_declaration(node, left, "for...of")
                }
                StmtKind::ImportEquals(import) => {
                    let is_alias = |it: &hir::ImportEquals| {
                        it.flags.contains(Flags::TYPE_ONLY)
                            && matches!(it.target, hir::ImportEqualsTarget::Entity(_))
                    };
                    if hir.import_equals.get(import.idx()).is_some_and(is_alias) {
                        self.fail(node, node.start, "An import alias cannot use 'import type'");
                    }
                }
                _ => {}
            }
        }
    }

    /// The statement whose head the `VariableDeclarationList` at `id` is in, if it is in one.
    fn loop_with_head(&self, id: usize) -> Option<&'a StmtKind> {
        let Some(&Parent::Stmt(parent)) = self.file.bound.stmt_parent.get(id) else {
            return None;
        };
        let kind = &self.file.hir.stmts.get(parent.idx())?.kind;
        let head = match *kind {
            StmtKind::For { init, .. } => init,
            StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } => left,
            _ => return None,
        };
        (head.idx() == id).then_some(kind)
    }

    fn is_in_head_of_loop(&self, id: usize) -> bool {
        self.loop_with_head(id).is_some()
    }

    /// `checkForStatementDeclaration`
    fn check_for_statement_declaration(&mut self, node: Span, left: hir::StmtId, name: &str) {
        let hir = &self.file.hir;
        let Some(left) = hir.stmts.get(left.idx()) else {
            return;
        };
        let of = |start: &str, end: &str| [start, name, end].concat();
        match left.kind {
            StmtKind::Var(list) => {
                let declarations = hir.var_decls.get(list.range()).unwrap_or_default();
                let [declaration] = declarations else {
                    let message = of(
                        "Only a single variable declaration is allowed in a '",
                        "' statement.",
                    );
                    return self.fail(node, left.start, message);
                };
                let start = hir
                    .pats
                    .get(declaration.pat.idx())
                    .map_or(left.start, |it| it.pos);
                if declaration.init.is_some() {
                    let message = of(
                        "The variable declaration of a '",
                        "' statement cannot have an initializer.",
                    );
                    self.fail(node, start, message);
                } else if declaration.ty.is_some() {
                    let message = of(
                        "The variable declaration of a '",
                        "' statement cannot have a type annotation.",
                    );
                    self.fail(node, start, message);
                }
            }
            StmtKind::Expr(target) => {
                let is_pattern = matches!(
                    hir.exprs.get(target.idx()).map(|it| it.kind),
                    Some(hir::ExprKind::Object(_) | hir::ExprKind::Array(_))
                ) && !self.file.is_parenthesized(target);
                if !is_pattern && !self.is_valid_assignment_target(target) {
                    let message = of(
                        "The left-hand side of a '",
                        "' statement must be a variable or a property access.",
                    );
                    self.fail(node, self.start_of(target), message);
                }
            }
            _ => {}
        }
    }

    /// `isValidAssignmentTarget`
    fn is_valid_assignment_target(&self, mut id: hir::ExprId) -> bool {
        loop {
            id = match self.file.hir.exprs.get(id.idx()).map(|it| it.kind) {
                Some(hir::ExprKind::Ident(_)) => return true,
                Some(hir::ExprKind::Dot { chain, .. } | hir::ExprKind::Index { chain, .. }) => {
                    return chain == Chain::No;
                }
                Some(
                    hir::ExprKind::As { expr, .. }
                    | hir::ExprKind::Satisfies { expr, .. }
                    | hir::ExprKind::Instantiation { expr, .. }
                    | hir::ExprKind::AsConst(expr)
                    | hir::ExprKind::NonNull(expr),
                ) => expr,
                _ => return false,
            };
        }
    }

    // ───────────────────────────── declarations of variables ─────────────────────────────

    fn variable_declarations(&mut self) {
        for (i, raw) in self.file.hir.var_decls.iter().enumerate() {
            if raw.flags.contains(Flags::DEFINITE)
                || matches!(raw.kind, VarKind::Using | VarKind::AwaitUsing)
            {
                self.variable_declaration(i);
            }
        }
    }

    /// `VariableDeclaration`
    fn variable_declaration(&mut self, id: usize) {
        let (hir, bound) = (&self.file.hir, &self.file.bound);
        let (Some(raw), Some(list)) = (hir.var_decls.get(id), bound.var_stmt.get(id)) else {
            return;
        };
        let (Some(name), Some(statement)) =
            (hir.pats.get(raw.pat.idx()), hir.stmts.get(list.idx()))
        else {
            return;
        };
        let node = Span::new(name.pos, raw.loc.end);
        let is_definite = raw.flags.contains(Flags::DEFINITE);
        let is_identifier = matches!(name.kind, hir::PatKind::Ident(_));
        if is_definite && raw.init.is_some() {
            let message =
                "Declarations with initializers cannot also have definite assignment assertions.";
            return self.fail(node, node.start, message);
        }
        if is_definite && (!is_identifier || raw.ty.is_none()) {
            let message =
                "Declarations with definite assignment assertions must also have type annotations.";
            return self.fail(node, node.start, message);
        }
        // The parameter of a `catch` is not in a list.
        if !matches!(statement.kind, StmtKind::Var(_)) {
            return;
        }
        let head_of = self.loop_with_head(list.idx());
        let kind = var_kind_text(raw.kind);
        if matches!(raw.kind, VarKind::Using | VarKind::AwaitUsing) {
            match head_of {
                Some(StmtKind::ForIn { .. }) => {
                    let message = [
                        "The left-hand side of a 'for...in' statement cannot be a '",
                        kind,
                        "' declaration.",
                    ];
                    return self.fail(node, statement.start, message.concat());
                }
                Some(StmtKind::ForOf { .. }) => {}
                _ if raw.init.is_none() => {
                    return self.fail(
                        node,
                        node.start,
                        ["'", kind, "' declarations must be initialized."].concat(),
                    );
                }
                _ if !is_identifier => {
                    let message =
                        ["'", kind, "' declarations may not have binding patterns."].concat();
                    return self.fail(node, node.start, message);
                }
                _ => {}
            }
        }
        if head_of.is_some() {
            return;
        }
        let is_declared = has_keyword(self.modifiers(statement.modifiers), Flags::AMBIENT);
        let is_assignable = matches!(raw.kind, VarKind::Let | VarKind::Var);
        if is_definite && (is_declared || !is_assignable) {
            let message = "A definite assignment assertion '!' is not permitted in this context.";
            return self.fail(node, node.start, message);
        }
        if is_declared && raw.init.is_some() && (is_assignable || raw.ty.is_some()) {
            self.fail(
                node,
                node.start,
                "Initializers are not permitted in ambient contexts.",
            );
        }
    }

    // ───────────────────────────── classes and interfaces ─────────────────────────────

    fn classes(&mut self) {
        let (hir, bound) = (&self.file.hir, &self.file.bound);
        for (i, raw) in hir.classes.iter().enumerate() {
            let has_check =
                !raw.modifiers.is_empty() || raw.name.is_none() || !raw.implements.is_empty();
            if !has_check || bound.class_scope.get(i).is_none_or(|it| !it.is_some()) {
                continue;
            }
            let Some(&owner) = bound.class_owner.get(i) else {
                continue;
            };
            let node = crate::ast::Class::from_raw(self.file, i as u32).span();
            let modifiers = self.modifiers(raw.modifiers);
            let (kind, place) = match owner {
                ClassOwner::Stmt(statement) => (
                    Kind::ClassDeclaration,
                    self.place_of_statement(statement.idx()),
                ),
                ClassOwner::Expr(_) => (Kind::ClassExpression, Place::Other),
            };
            self.check_modifiers((kind, place, node), modifiers, |_| Decorated::Validly);
            let is_default_export =
                has_keyword(modifiers, Flags::EXPORT) && has_keyword(modifiers, Flags::DEFAULT);
            if kind == Kind::ClassDeclaration && raw.name.is_none() && !is_default_export {
                self.fail(
                    node,
                    node.start,
                    "A class declaration without the 'default' modifier must have a name.",
                );
            }
            let message = "A class can only implement an identifier/qualified-name with optional type arguments.";
            self.heritage(node, raw.implements, message);
        }
        for raw in hir.interfaces {
            let Some(statement) = hir.stmts.get(raw.stmt.idx()) else {
                continue;
            };
            let node = Span::new(statement.start, statement.loc.end);
            let message = "Interface declaration can only extend an identifier/qualified name with optional type arguments.";
            self.heritage(node, raw.extends, message);
            // An `implements` without elements leaves nothing in the HIR.
            if let crate::ast::StmtKind::Interface(it) = Stmt::new(self.file, raw.stmt).kind() {
                let after_head = it.body_span().start;
                if self.token_at(after_head) == b"implements" {
                    let message = "Interface declaration cannot have 'implements' clause.";
                    self.fail_in_heritage(node, after_head, 0, message);
                }
            }
            // The elements of the clauses after the first `extends`. An `extends` among them has a diagnostic.
            let others = hir.ids.get(raw.other_heritage.range()).unwrap_or_default();
            for element in others.iter().filter_map(|&it| hir.types.get(it as usize)) {
                let keyword = self.file.end_of_token_before(element.pos);
                if self
                    .file
                    .text()
                    .get(..keyword as usize)
                    .is_some_and(|it| it.ends_with(b"implements"))
                {
                    let at = keyword - "implements".len() as u32;
                    self.fail_in_heritage(
                        node,
                        at,
                        0,
                        "Interface declaration cannot have 'implements' clause.",
                    );
                }
            }
        }
    }

    /// The elements of a heritage clause have to be entity names.
    fn heritage(&mut self, node: Span, elements: hir::IdList<hir::TypeNodeId>, message: &str) {
        let hir = &self.file.hir;
        let elements = hir.ids.get(elements.range()).unwrap_or_default();
        for element in elements.iter().filter_map(|&it| hir.types.get(it as usize)) {
            if matches!(element.kind, hir::TypeNodeKind::Heritage { .. }) {
                self.fail_in_heritage(node, element.pos, 1, message);
            }
        }
    }

    /// A check of the heritage clauses of `node` fails at `at`. They are checked after everything else about the node, in their
    /// order. `rank`: the order of the checks that fail at the same place.
    fn fail_in_heritage(&mut self, node: Span, at: u32, rank: u32, message: impl Into<Vec<u8>>) {
        let step = at
            .saturating_sub(node.start)
            .saturating_mul(2)
            .saturating_add(1 + rank);
        self.fail_at_step(node, step, at, message);
    }

    // ───────────────────────────── members ─────────────────────────────

    fn members(&mut self) {
        let (hir, bound) = (&self.file.hir, &self.file.bound);
        for (i, raw) in hir.members.iter().enumerate() {
            let flags = Flags::ABSTRACT | Flags::DEFINITE | Flags::STRING_NAME;
            if raw.modifiers.is_empty() && !raw.flags.intersects(flags) && raw.init.is_none() {
                continue;
            }
            let class = match bound.member_owner.get(i) {
                None | Some(MemberOwner::None) => continue,
                Some(&MemberOwner::Class(class)) => Some(class),
                Some(_) => None,
            };
            let node = Span::new(raw.start, raw.loc.end);
            let has_body =
                (hir.fns.get(raw.func.idx())).is_some_and(|it| !matches!(it.body, FnBody::None));
            let kind = match (raw.kind, class.is_some()) {
                (MemberKind::Property, true) => Kind::PropertyDeclaration,
                (MemberKind::Property, false) => Kind::PropertySignature,
                (MemberKind::Method, true) => Kind::MethodDeclaration,
                (MemberKind::Method, false) => Kind::MethodSignature,
                (MemberKind::Getter | MemberKind::Setter, _) => Kind::Accessor,
                (MemberKind::IndexSignature, _) => Kind::IndexSignature,
                (MemberKind::Constructor, _) => Kind::Other,
                // Not among `ts.canHaveModifiers`.
                (
                    MemberKind::CallSignature
                    | MemberKind::ConstructSignature
                    | MemberKind::StaticBlock,
                    _,
                ) => continue,
            };
            let place = if class.is_some() {
                Place::Class
            } else {
                Place::Other
            };
            let is_abstract = raw.flags.contains(Flags::ABSTRACT);
            self.check_modifiers(
                (kind, place, node),
                self.modifiers(raw.modifiers),
                |checks| match kind {
                    Kind::PropertyDeclaration => {
                        let is_declaration = class.is_some_and(|it| {
                            matches!(
                                checks.file.bound.class_owner.get(it.idx()),
                                Some(ClassOwner::Stmt(_))
                            )
                        });
                        if is_declaration || !is_abstract {
                            Decorated::Validly
                        } else {
                            Decorated::Invalidly
                        }
                    }
                    Kind::MethodDeclaration | Kind::Accessor if has_body && class.is_some() => {
                        Decorated::Validly
                    }
                    Kind::MethodDeclaration => Decorated::Overload,
                    _ => Decorated::Invalidly,
                },
            );
            let file = self.file;
            let member = Member::from_raw(file, i as u32);
            let name = || {
                member
                    .key()
                    .map_or(Span::empty(raw.name_pos), |it| it.span(file))
            };
            match kind {
                Kind::PropertyDeclaration => {
                    let is_definite = raw.flags.contains(Flags::DEFINITE);
                    if is_abstract && raw.init.is_some() {
                        self.fail(
                            node,
                            self.start_of(raw.init),
                            "Abstract property cannot have an initializer.",
                        );
                    } else if is_definite && is_abstract {
                        let message =
                            "A definite assignment assertion '!' is not permitted in this context.";
                        self.fail(node, skip_trivia(self.file.text(), name().end), message);
                    } else if is_definite && raw.ty.is_none() {
                        let message = "Declarations with definite assignment assertions must also have type annotations.";
                        self.fail(node, node.start, message);
                    } else if is_definite && raw.init.is_some() {
                        let message = "Declarations with initializers cannot also have definite assignment assertions.";
                        self.fail(node, node.start, message);
                    } else if raw.flags.contains(Flags::STRING_NAME)
                        && !raw.flags.contains(Flags::COMPUTED_NAME)
                        && member.key().is_some_and(|it| it.is("constructor"))
                    {
                        self.fail(
                            node,
                            raw.name_pos,
                            "Classes may not have a field named 'constructor'.",
                        );
                    }
                }
                Kind::PropertySignature if raw.init.is_some() => {
                    self.fail(
                        node,
                        self.start_of(raw.init),
                        "A property signature cannot have an initializer.",
                    );
                }
                Kind::Accessor if class.is_some() && is_abstract && has_body => {
                    self.fail(
                        node,
                        raw.name_pos,
                        "An abstract accessor cannot have an implementation.",
                    );
                }
                Kind::MethodDeclaration if is_abstract && has_body => {
                    // `declarationNameToString`: with the comments before the name.
                    let from = self.file.end_of_token_before(raw.name_pos);
                    let text = trim_start(self.file.slice(Span::new(from, name().end)));
                    let message = [
                        b"Method '",
                        text,
                        b"' cannot have an implementation because it is marked abstract.",
                    ];
                    self.fail(node, raw.name_pos, message.concat());
                }
                _ => {}
            }
        }
    }

    // ───────────────────────────── parameters ─────────────────────────────

    fn parameters(&mut self) {
        let (hir, bound) = (&self.file.hir, &self.file.bound);
        for (i, &list) in hir.modifiers_of_params.iter().enumerate() {
            let (false, Some(raw), Some(func)) =
                (list.is_empty(), hir.params.get(i), bound.param_fn.get(i))
            else {
                continue;
            };
            let Some(function) = hir.fns.get(func.idx()) else {
                continue;
            };
            let node = Param::from_raw(self.file, i as u32).span();
            let modifiers = self.modifiers(list);
            let has_body = !matches!(function.body, FnBody::None);
            let is_pattern = matches!(
                hir.pats.get(raw.pat.idx()).map(|it| it.kind),
                Some(hir::PatKind::Object(_) | hir::PatKind::Array(_))
            );
            // `checkParameter`
            let as_property = if function.kind != FnKind::Constructor || !has_body {
                Some("A parameter property is only allowed in a constructor implementation.")
            } else if raw.flags.contains(Flags::REST) {
                Some("A parameter property cannot be a rest parameter.")
            } else if is_pattern {
                Some("A parameter property may not be declared using a binding pattern.")
            } else {
                None
            };
            let decorated = |checks: &Self| {
                let bound = &checks.file.bound;
                let is_in_class_declaration = match bound.fns.get(func.idx()).map(|it| it.owner) {
                    Some(FnOwner::Member(member)) => match bound.member_owner.get(member.idx()) {
                        Some(MemberOwner::Class(class)) => {
                            matches!(
                                bound.class_owner.get(class.idx()),
                                Some(ClassOwner::Stmt(_))
                            )
                        }
                        _ => false,
                    },
                    _ => false,
                };
                let takes_decorators = matches!(
                    function.kind,
                    FnKind::Constructor | FnKind::Method | FnKind::Setter
                );
                match has_body && takes_decorators && is_in_class_declaration {
                    true => Decorated::Validly,
                    false => Decorated::Invalidly,
                }
            };
            let of_property = ACCESSIBILITY | Flags::READONLY | Flags::OVERRIDE;
            let owner = (Kind::Parameter, Place::Other, node);
            self.check_modifiers_and(
                owner,
                modifiers,
                decorated,
                as_property.map(|it| (of_property, it)),
            );
        }
    }

    fn type_parameters(&mut self) {
        let (hir, bound) = (&self.file.hir, &self.file.bound);
        for (i, raw) in hir.type_params.iter().enumerate() {
            if raw.modifiers.is_empty()
                || bound.type_param_scope.get(i).is_none_or(|it| !it.is_some())
            {
                continue;
            }
            let place = match TypeParam::from_raw(self.file, i as u32).parent() {
                Node::Class(_) => Place::Class,
                Node::Stmt(it)
                    if matches!(
                        it.try_raw().map(|it| it.kind),
                        Some(StmtKind::Interface(_) | StmtKind::TypeAlias(_))
                    ) =>
                {
                    Place::InterfaceOrTypeAlias
                }
                _ => Place::Other,
            };
            let node = Span::new(raw.start, raw.end);
            self.check_modifiers(
                (Kind::TypeParameter, place, node),
                self.modifiers(raw.modifiers),
                |_| Decorated::Invalidly,
            );
        }
    }

    // ───────────────────────────── `<>` ─────────────────────────────

    /// `<>` from `open`, where a list of type parameters can start.
    fn empty_type_parameters_at(&mut self, open: u32) {
        let text = self.file.text();
        if self.byte(open) == b'<' && self.byte(skip_trivia(text, open + 1)) == b'>' {
            self.fail_for_empty_list(When::TypeParameters, open);
        }
    }

    /// `convertTypeParameters`. The HIR does not tell a list that is empty from none. For a class there is a diagnostic.
    fn functions(&mut self) {
        let (hir, bound, text) = (&self.file.hir, &self.file.bound, self.file.text());
        for (i, raw) in hir.fns.iter().enumerate() {
            let has_list = !matches!(
                raw.kind,
                FnKind::Arrow | FnKind::StaticBlock | FnKind::IndexSignature
            );
            if !has_list || !raw.type_params.is_empty() || raw.anchor == 0 {
                continue;
            }
            // Before the `(`: a `>`, or something to look behind.
            if !matches!(
                text.get(raw.anchor as usize - 1),
                Some(b'>' | b' ' | b'\t' | b'\n' | b'\r' | b'/')
            ) {
                continue;
            }
            if raw.flags.contains(Flags::REPARSED)
                || bound.fns.get(i).is_none_or(|it| it.owner == FnOwner::None)
            {
                continue;
            }
            let close = self.file.end_of_token_before(raw.anchor);
            if close < 2 || self.byte(close - 1) != b'>' {
                continue;
            }
            let open = self.file.end_of_token_before(close - 1);
            if open > 0 && self.byte(open - 1) == b'<' {
                self.fail_for_empty_list(When::TypeParameters, open - 1);
            }
        }
        let file = self.file;
        let after_name = |at: u32| {
            skip_trivia(
                text,
                at + token_len(file.text().get(at as usize..).unwrap_or_default()) as u32,
            )
        };
        for raw in hir.interfaces.iter().filter(|it| it.type_params.is_empty()) {
            self.empty_type_parameters_at(after_name(raw.name_pos));
        }
        for raw in hir
            .aliases
            .iter()
            .filter(|it| it.type_params.is_empty() && !it.flags.contains(Flags::REPARSED))
        {
            self.empty_type_parameters_at(after_name(raw.name_pos));
        }
    }

    // ───────────────────────────── object literals ─────────────────────────────

    fn properties(&mut self) {
        let (hir, bound) = (&self.file.hir, &self.file.bound);
        for &(id, list) in hir.modifiers_of_props {
            let (Some(raw), prop) = (hir.props.get(id.idx()), Prop::new(self.file, id)) else {
                continue;
            };
            if !prop.is_in_tree() {
                continue;
            }
            let kind = match raw.kind {
                PropKind::Method => Kind::MethodDeclaration,
                PropKind::Getter | PropKind::Setter => Kind::Accessor,
                _ => Kind::PropertyAssignment,
            };
            self.check_modifiers(
                (kind, Place::ObjectLiteral, prop.span()),
                self.modifiers(list),
                |_| Decorated::Invalidly,
            );
        }
        for (i, raw) in hir.props.iter().enumerate() {
            let is_method = matches!(
                raw.kind,
                PropKind::Method | PropKind::Getter | PropKind::Setter
            );
            if !is_method && raw.postfix_token == 0 {
                continue;
            }
            let prop = Prop::from_raw(self.file, i as u32);
            if is_method {
                let has_body = match hir.exprs.get(raw.value.idx()).map(|it| it.kind) {
                    Some(hir::ExprKind::Fn(func)) => hir
                        .fns
                        .get(func.idx())
                        .is_none_or(|it| !matches!(it.body, FnBody::None)),
                    _ => true,
                };
                let Some(&object) = bound
                    .prop_owner
                    .get(i)
                    .filter(|_| !has_body && prop.is_in_tree())
                else {
                    continue;
                };
                // A check of the `ObjectLiteralExpression`, unless it is converted as a pattern.
                let object = Expr::new(self.file, object);
                if !object.is_assignment_target() {
                    self.fail_at_step(
                        object.span(),
                        i as u32,
                        prop.span().end.saturating_sub(1),
                        "'{' expected.",
                    );
                }
                continue;
            }
            if !prop.is_in_tree() {
                continue;
            }
            let of = match raw.kind {
                PropKind::Init => "A property assignment",
                PropKind::Shorthand => "A shorthand property assignment",
                _ => continue,
            };
            let token = match self.byte(raw.postfix_token) {
                b'?' => " cannot have a question token.",
                _ => " cannot have an exclamation token.",
            };
            self.fail(prop.span(), raw.postfix_token, [of, token].concat());
        }
    }

    // ───────────────────────────── expressions ─────────────────────────────

    fn expressions(&mut self) {
        let file = self.file;
        for it in file.exprs_of_kind(ExprTag::TaggedTemplate) {
            let ExprKind::TaggedTemplate(call) = it.kind() else {
                continue;
            };
            let tag = call.callee();
            // `node.tag.flags & ts.NodeFlags.OptionalChain`
            let is_chain = matches!(tag.tag(), ExprTag::Dot | ExprTag::Index | ExprTag::Call)
                && tag.chain() != Chain::No;
            if is_chain && !tag.is_parenthesized() {
                let message = "Tagged template expressions are not permitted in an optional chain.";
                self.fail(it.span(), it.span().start, message);
            }
        }
        for it in file.exprs_of_kind(ExprTag::PrivateIdentifier) {
            let Node::Expr(parent) = it.parent() else {
                continue;
            };
            let (is_in, left, right) = match parent.try_raw().map(|it| it.kind) {
                Some(hir::ExprKind::Binary { op, left, right }) => (op == BinOp::In, left, right),
                Some(hir::ExprKind::Assign { target, value, .. }) => (false, target, value),
                _ => continue,
            };
            let is_private = |id: hir::ExprId| {
                matches!(
                    file.hir.exprs.get(id.idx()).map(|it| it.kind),
                    Some(hir::ExprKind::PrivateIdentifier(_))
                )
            };
            if left == it.id() && !is_in {
                let message = "Private identifiers cannot appear on the right-hand-side of an 'in' expression.";
                self.fail(parent.span(), it.span().start, message);
            } else if right == it.id() && (is_in || !is_private(left)) {
                let message = "Private identifiers are only allowed on the left-hand-side of an 'in' expression.";
                self.fail(parent.span(), it.span().start, message);
            }
        }
        for it in file.exprs_of_kind(ExprTag::Unary) {
            let Some(hir::ExprKind::Unary { op, operand }) = it.try_raw().map(|it| it.kind) else {
                continue;
            };
            let is_update = matches!(
                op,
                UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec
            );
            if is_update && !self.is_valid_assignment_target(operand) {
                self.fail(
                    it.span(),
                    self.start_of(operand),
                    "Invalid left-hand side expression in unary operation",
                );
            }
        }
        for it in file.exprs_of_kind(ExprTag::ImportCall) {
            let Some(hir::ExprKind::ImportCall { args }) = it.try_raw().map(|it| it.kind) else {
                continue;
            };
            let args = file.hir.ids.get(args.range()).unwrap_or_default();
            let is_missing = |id: u32| {
                matches!(
                    file.hir.exprs.get(id as usize).map(|it| it.kind),
                    Some(hir::ExprKind::Missing)
                )
            };
            let has_none = matches!(*args, [only] if is_missing(only));
            let is_deferred = file
                .hir
                .deferred_import_calls
                .iter()
                .any(|call| Some(&call.0.0) == args.first());
            if (has_none || args.len() > 2) && !is_deferred {
                let at = args
                    .get(2)
                    .map_or(it.span().start, |&third| self.start_of(hir::ExprId(third)));
                self.fail(
                    it.span(),
                    at,
                    "Dynamic import requires exactly one or two arguments.",
                );
            }
        }
    }

    // ───────────────────────────── what there is little of ─────────────────────────────

    fn the_rest(&mut self) {
        let hir = &self.file.hir;
        for raw in hir.enum_members {
            let node = Span::new(raw.pos, raw.loc.end);
            let is_computed = raw.computed_name.is_some()
                || matches!(
                    raw.name_kind,
                    NameKind::ComputedString | NameKind::ComputedNumber
                );
            if is_computed {
                self.fail(
                    node,
                    raw.pos,
                    "Computed property names are not allowed in enums.",
                );
            } else if raw.name_kind == NameKind::NumericLiteral
                || self.byte(raw.pos).is_ascii_digit()
            {
                self.fail(node, raw.pos, "An enum member cannot have a numeric name.");
            }
        }
        for (i, raw) in hir.mapped.iter().enumerate() {
            let Some(member) = hir.members.get(raw.members.range()).and_then(<[_]>::first) else {
                continue;
            };
            let is_this = |it: &&hir::TypeNode| matches!(it.kind, hir::TypeNodeKind::Mapped(id) if id.idx() == i);
            let node = hir
                .types
                .iter()
                .find(is_this)
                .map_or(Span::empty(member.start), |it| Span::new(it.pos, it.end));
            self.fail(
                node,
                member.start,
                "A mapped type may not declare properties or methods.",
            );
        }
        for raw in hir.imports {
            let Some(statement) = hir.stmts.get(raw.stmt.idx()) else {
                continue;
            };
            let has_bindings = raw.namespace.is_some() || raw.has_named_imports;
            let message = if raw.type_only && raw.default.is_some() && has_bindings {
                "A type-only import can specify a default import or named bindings, but not both."
            } else if raw.is_deferred && raw.has_named_imports {
                "Named imports are not allowed in a deferred import."
            } else if raw.is_deferred && raw.default.is_some() {
                "Default imports are not allowed in a deferred import."
            } else {
                continue;
            };
            self.fail(
                Span::new(statement.start, statement.loc.end),
                raw.clause_start,
                message,
            );
        }
        for raw in hir.export_specs {
            let has_source = hir
                .exports
                .get(raw.export.idx())
                .is_none_or(|it| it.spec.is_some());
            if !has_source && self.is_string_literal(raw.local_pos) {
                let message =
                    "A string literal cannot be used as a local exported binding without `from`.";
                self.fail(Span::new(raw.start, raw.end), raw.local_pos, message);
            }
        }
        if !hir.import_attributes.is_empty() && !self.is_of_prettier {
            self.import_attributes();
        }
    }

    /// `ImportAttribute`. Those of an import type are not converted as such.
    fn import_attributes(&mut self) {
        let file = self.file;
        for (i, raw) in file.hir.stmts.iter().enumerate() {
            if !matches!(
                raw.kind,
                StmtKind::Import(_) | StmtKind::ExportNamed(_) | StmtKind::ExportStar { .. }
            ) {
                continue;
            }
            let Some(attributes) = Stmt::from_raw(file, i as u32).import_attributes() else {
                continue;
            };
            for value in attributes.entries().iter().filter_map(Prop::value) {
                let start = value.outer_span().start;
                if !self.is_string_literal(start) {
                    self.fail(value.outer_span(), start, "String literal expected.");
                }
            }
        }
    }

    // ───────────────────────────── what the HIR has dropped ─────────────────────────────

    /// The class or the interface whose head `at` is in, and whether it is an interface.
    fn declaration_with_head(&self, at: u32) -> Option<(Span, bool)> {
        let hir = &self.file.hir;
        let body = |members: hir::Span<hir::MemberId>, end: u32| {
            hir.members
                .get(members.range())
                .and_then(<[_]>::first)
                .map_or(end, |it| it.start)
        };
        let classes = self
            .file
            .classes()
            .filter_map(|it| Some((it.span(), body(it.try_raw()?.members, it.span().end), false)));
        let interfaces = hir.interfaces.iter().filter_map(|raw| {
            let statement = hir.stmts.get(raw.stmt.idx())?;
            Some((
                Span::new(statement.start, statement.loc.end),
                body(raw.members, statement.loc.end),
                true,
            ))
        });
        (classes.chain(interfaces))
            .filter(|&(span, body, _)| span.start <= at && at <= body)
            .max_by_key(|it| it.0.start)
            .map(|it| (it.0, it.2))
    }

    /// The start of the `import` of the meta property whose name starts at `name`.
    fn import_before(&self, name: u32) -> Option<u32> {
        let dot = self.file.end_of_token_before(name);
        let keyword = self.file.end_of_token_before(dot.checked_sub(1)?);
        let is_import = self.byte(dot - 1) == b'.'
            && self
                .file
                .text()
                .get(..keyword as usize)?
                .ends_with(b"import");
        is_import.then(|| keyword - "import".len() as u32)
    }

    fn diagnostics(&mut self) {
        for it in self.file.hir.diagnostics {
            self.diagnostic(it);
        }
    }

    fn diagnostic(&mut self, it: &Diagnostic) {
        let at = it.start;
        let in_heritage = |checks: &mut Self, at: u32, rank: u32, message: &str| {
            let Some((node, _)) = checks.declaration_with_head(at) else {
                return;
            };
            // That a clause is empty is checked first, and the parser reports one thing about a clause.
            let keyword = checks.token_at(at);
            let is_clause = matches!(keyword, b"extends" | b"implements");
            if is_clause
                && checks.byte(skip_trivia(checks.file.text(), at + keyword.len() as u32)) == b'{'
            {
                return checks.fail_in_heritage(
                    node,
                    at,
                    0,
                    [b"'", keyword, b"' list cannot be empty."].concat(),
                );
            }
            checks.fail_in_heritage(node, at, rank, message);
        };
        match it.code {
            1098 => self.fail_for_empty_list(When::TypeParameters, at),
            1099 => self.fail_for_empty_list(When::TypeArguments, at),
            // At the end of the keyword.
            1097 => {
                let keyword = it.args.first().map_or(&b""[..], |it| &it[..]);
                let end = match self.file.text().get(..at as usize) {
                    Some(before) if before.ends_with(keyword) => at,
                    _ => self.file.end_of_token_before(at),
                };
                let start = end.saturating_sub(keyword.len() as u32);
                let Some((node, is_interface)) = self.declaration_with_head(start) else {
                    return;
                };
                if is_interface && keyword == b"implements" {
                    return self.fail_in_heritage(
                        node,
                        start,
                        0,
                        "Interface declaration cannot have 'implements' clause.",
                    );
                }
                self.fail_in_heritage(
                    node,
                    start,
                    0,
                    [b"'", keyword, b"' list cannot be empty."].concat(),
                );
            }
            1172 => in_heritage(self, at, 1, "'extends' clause already seen."),
            1173 => in_heritage(
                self,
                at,
                1,
                "'extends' clause must precede 'implements' clause.",
            ),
            1174 => in_heritage(self, at, 1, "Classes can only extend a single class."),
            1175 => in_heritage(self, at, 1, "'implements' clause already seen."),
            // `a?.b` as an element of a clause.
            2499 => {
                let message = "Interface declaration can only extend an identifier/qualified name with optional type arguments.";
                in_heritage(self, at, 1, message);
            }
            2500 => {
                let message = "A class can only implement an identifier/qualified-name with optional type arguments.";
                in_heritage(self, at, 1, message);
            }
            // The specifier of a module that is not a string.
            1141 => {
                let is_require = (self.file.hir.import_equals.iter()).any(|import| {
                    self.file
                        .hir
                        .exprs
                        .get(import.expression.idx())
                        .is_some_and(|e| e.pos == at)
                });
                let message = match is_require {
                    true => "String literal expected.",
                    false => "Module specifier must be a string literal.",
                };
                self.fail(Span::empty(at), at, message);
            }
            // `import.a`
            17012 | 18061 => {
                let Some(start) = self.import_before(at) else {
                    return;
                };
                let name = self.token_at(at);
                let message = [
                    b"'",
                    name,
                    b"' is not a valid meta-property for keyword 'import'.",
                ]
                .concat();
                self.fail(Span::new(start, at), start, message);
            }
            // `import.defer` that is not called: the `(` is missing.
            1005 if it.args.first().is_some_and(|it| **it == *b"(") => {
                let end = self.file.end_of_token_before(at);
                let Some(name) = end.checked_sub("defer".len() as u32) else {
                    return;
                };
                if self.file.slice(Span::new(name, end)) == b"defer"
                    && let Some(start) = self.import_before(name)
                {
                    // `node.parent.kind !== SyntaxKind.CallExpression`, which an argument passes too.
                    let is_in_call = (self.file.exprs_of_kind(ExprTag::Dot))
                        .find(|it| it.span().start == start && !it.is_parenthesized())
                        .is_some_and(|it| matches!(it.parent(), Node::Expr(parent) if parent.tag() == ExprTag::Call));
                    let message = match is_in_call {
                        true => "'defer' is not a valid meta-property for keyword 'import'.",
                        false => {
                            "'import.defer' is only valid when called. Use 'import.defer()' instead."
                        }
                    };
                    self.fail(Span::new(start, end), start, message);
                }
            }
            _ => {}
        }
    }
}
