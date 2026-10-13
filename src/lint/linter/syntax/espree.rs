//! The errors of espree, which is acorn with other words for an unexpected token.
//!
//! acorn checks the early errors of the language as it parses, and it is told what the file is: a module or a script, with JSX
//! or without. TypeScript's parser is told none of that, leaves the early errors to the type checker, and parses TypeScript in
//! a JavaScript file. What matters most is code that is not what the configuration says: ESLint takes every `.js` file for a
//! module, so a `return` at the top level of a CommonJS file, or anything that only sloppy mode allows, is an error.
//!
//! acorn throws at the first error, and it gets to them in the order of the source.
//!
//! Here is what depends on the configuration, and the words. The rest is in [`early`].

mod early;
pub(super) mod editions;

use super::{Stage, SyntaxError};
use crate::ast::{
    Expr, ExprTag, File, Func, Handle, Node, Param, Pat, PatTag, Stmt, StmtKind, StmtTag, VarKind,
};
use crate::language::SourceType;
use crate::semantic::{Declaration, Scope, ScopeKind};
use crate::span::Span;
use crate::tokens::{skip_trivia, token_len};
use crate::types::IdMap;
use crate::utils::oxlint::{is_script, is_strict_mode, source_type};
use bun_core::strings;
use bun_sema::atom::{Atom, known};
use bun_sema::hir::{
    self, BinOp, Chain, Diagnostic, DiagnosticKind, Flags, FnKind, ModifierKind, UnOp,
};
use rustc_hash::FxHashSet;
use smallvec::SmallVec;
use std::borrow::Cow;

struct Checks<'a, 'c> {
    file: &'a File<'a>,
    /// In place of the expressions of the file by kind.
    candidates: Option<&'c Candidates>,
    tops: Tops<'a>,
    /// The first error so far, and how far acorn has read when it throws it.
    first: Option<(u32, SyntaxError)>,
    /// For oxc, which goes on after an error: all of them.
    all: Vec<SyntaxError>,
    /// acorn notices what is being checked only when it has read this far.
    noticed: u32,
    /// The tree is whole: the parser has reported nothing.
    is_whole: bool,
    /// Only what Prettier refuses counts: see [`refusal_of_babel`].
    is_babel: bool,
    /// Only what oxc refuses counts: see [`Checks::early_errors_of_oxc`].
    is_oxc: bool,
    /// For oxc: only what its parser reports counts, and nothing is asked of the scopes. TypeScript's parser has an error, so
    /// that the tree has holes, or the file is formatted.
    only_parser: bool,
    /// For oxfmt, which has oxc's parser leave regular expressions alone.
    is_oxfmt: bool,
}

/// The errors, in the words of acorn, that Babel has too, that it does not recover from or Prettier does not let pass, and that
/// it reports wherever acorn does. What is not listed does not count: Prettier formats a file with such an error.
const REFUSED_BY_BABEL: [&str; 48] = [
    "A string literal cannot be used as an exported binding without `from`.",
    "An export name cannot include a lone surrogate.",
    "Assigning to rvalue",
    "Async functions can only be declared at the top level or inside a block",
    "Await expression cannot be a default value",
    "Cannot use 'arguments' in class field initializer",
    "Cannot use arguments in class static initialization block",
    "Cannot use new with import",
    "Classes can't have",
    "Classes may not have a static property named prototype",
    "Comma is not permitted after the rest element",
    "Constructor can't",
    "Duplicate constructor in the same class",
    "Duplicate export 'default'",
    "Duplicate regular expression flag",
    "Identifier '#",
    "Illegal 'use strict' directive in function with non-simple parameter list",
    "Illegal newline after throw",
    "Invalid regular expression flag",
    "Label '",
    "Leading decorators must be attached to a class declaration",
    "Lexical declaration cannot appear in a single-statement context",
    "Logical expressions and coalesce expressions cannot be mixed",
    "Multiple default clauses",
    "No line break is allowed before '=>'",
    "Object pattern can't contain getter or setter",
    "Only `import defer * as x` is valid",
    "Optional chaining cannot appear in left-hand side",
    "Optional chaining cannot appear in the tag of tagged template expressions",
    "Private fields can not be deleted",
    "Private fields can't be accessed on super",
    "Redefinition of __proto__ property",
    "Rest elements cannot have a default value",
    "Sequence expressions cannot be directly nested inside JSX",
    "Setter cannot use rest params",
    "Shorthand property assignments are valid only in destructuring patterns",
    "The left-hand side of a for-of loop may not be 'async'.",
    "The only valid meta property for",
    "Unsyntactic break",
    "Unsyntactic continue",
    "Using declaration",
    "Yield expression cannot be a default value",
    "`...` is not allowed in `import()`",
    "`import()` requires exactly one or two arguments",
    "getter should have no params",
    "let is disallowed as a lexically bound name",
    "setter should have exactly one param",
    "super() call outside constructor of a subclass",
];

/// Where the parser of oxlint, which takes a JavaScript file for JavaScript, stumbles over TypeScript. It has other words for it.
pub(super) fn typescript_in_javascript<'a>(file: &'a File<'a>) -> Option<SyntaxError> {
    if file.hir.diagnostics.is_empty() {
        return None;
    }
    let mut checks = Checks {
        file,
        candidates: None,
        tops: Tops::default(),
        first: None,
        all: Vec::new(),
        noticed: 0,
        is_whole: true,
        is_babel: false,
        is_oxc: false,
        only_parser: false,
        is_oxfmt: false,
    };
    checks.typescript_syntax(true);
    checks.first.map(|it| SyntaxError {
        at: it.1.at,
        end: Diagnostic::NO_LENGTH,
        message: b"Unexpected token".to_vec(),
        ..SyntaxError::default()
    })
}

/// Whether `statement` is an `import` or an `export`.
fn is_module_syntax(statement: &Stmt) -> bool {
    let is_export = |it: &hir::Modifier| it.kind == ModifierKind::Keyword(Flags::EXPORT);
    let modifiers = &statement.file().hir.modifiers;
    matches!(
        statement.tag(),
        StmtTag::Import | StmtTag::ExportNamed | StmtTag::ExportStar | StmtTag::ExportDefault
    ) || (statement.try_raw()).is_some_and(|raw| {
        (modifiers
            .get(raw.modifiers.range())
            .unwrap_or_default()
            .iter())
        .any(is_export)
    })
}

/// What the parser of oxlint says, in its words, about a file that is CommonJS by its name and has what only a module can have.
/// It goes on after each. `is_typescript`: `.cts`, in which `import` and `export` are written and mean `require` and `exports`.
pub(super) fn module_syntax_in_commonjs<'a>(
    file: &'a File<'a>,
    is_typescript: bool,
) -> Vec<SyntaxError> {
    let tops = std::cell::RefCell::new(Tops::default());
    // oxc reads the parameters of an arrow function that isn't async in the context around it.
    let is_at_top_level = |node: Node<'a>| {
        let mut inner = node;
        !(tops.borrow_mut().outward(node)).any(|it| {
            let was_parameter = matches!(std::mem::replace(&mut inner, it), Node::Param(_));
            matches!(it, Node::Func(func) if !(was_parameter && func.is_arrow() && !func.is_async()))
        })
    };
    // At the token at `at`.
    let error = |at: u32, message: &str| {
        let error = SyntaxError {
            at,
            end: 0,
            message: message.into(),
            ..SyntaxError::default()
        };
        error.stage(Stage::Parser)
    };
    let waits = |at: u32, what: &str| {
        let message =
            format!("{what} only allowed within async functions and at the top levels of modules");
        error(at, &message)
            .help("Either remove this `await` or add the `async` keyword to the enclosing function")
    };
    let mut all = Vec::new();
    let statements = file.body().iter().filter(is_module_syntax);
    for it in statements.filter(|_| !is_typescript) {
        let start = it.span().start;
        let rest = file.text().get(start as usize..).unwrap_or_default();
        all.push(match rest.starts_with(b"import") {
            true => error(start, "Cannot use import statement outside a module"),
            false => error(start, "Cannot use export statement outside a module"),
        });
    }
    for it in file.exprs_of_kind(ExprTag::ImportMeta) {
        all.push(
            SyntaxError::of_oxc(it.span(), "Unexpected import.meta expression")
                .help("import.meta is only allowed in module code")
                .stage(Stage::Parser),
        );
    }
    for it in file.exprs_of_kind(ExprTag::Await) {
        // After a name these go on with the expression, and `await` is a name there.
        let operand = it.operand().map(|it| it.outer_span().start as usize);
        let goes_on = matches!(
            operand.and_then(|at| file.text().get(at)),
            Some(b'(' | b'[' | b'/' | b'+' | b'-' | b'`')
        );
        // Of `await await a` only the first is reported.
        let follows_one = !it.is_parenthesized()
            && matches!(it.parent(), Node::Expr(parent) if parent.tag() == ExprTag::Await);
        if !goes_on && !follows_one && is_at_top_level(Node::Expr(it)) {
            all.push(waits(it.span().start, "`await` is"));
        }
    }
    if file.has_rare_syntax(hir::rare::AWAIT_USING) {
        for it in file.stmts_of_kind(StmtTag::Var) {
            let first = it.as_var().and_then(|it| it.first());
            if first.is_some_and(|it| it.var_kind() == VarKind::AwaitUsing)
                && is_at_top_level(Node::Stmt(it))
            {
                all.push(waits(it.span().start, "`await` is"));
            }
        }
    }
    for it in file.stmts_of_kind(StmtTag::ForOf) {
        if matches!(it.kind(), StmtKind::ForOf { is_await: true, .. })
            && is_at_top_level(Node::Stmt(it))
        {
            let keyword = skip_trivia(file.text(), it.span().start + 3);
            all.push(waits(keyword, "`for await` loops are"));
        }
    }
    all
}

/// Whether Prettier's `babel` parser throws on a JavaScript file that the parser here, in that dialect, has nothing to say about.
///
/// Prettier lets Babel go on after an error, and lets pass what is only wrong in strict mode, names that are declared twice or
/// not at all, `return`, `import` and `export` where they do not belong, and more. It is meant to format code that is not quite
/// right. So only errors count here of which it is known that it throws. Nothing is asked of the scopes of the file.
///
/// `finds_candidates`: `false` for a test, which wants to know that it makes no difference.
pub(super) fn refusal_of_babel<'a>(
    file: &'a File<'a>,
    finds_candidates: bool,
) -> Option<SyntaxError> {
    let candidates = finds_candidates.then(|| Candidates::of(file));
    let mut checks = Checks {
        file,
        candidates: candidates.as_ref(),
        tops: Tops::default(),
        first: None,
        all: Vec::new(),
        noticed: 0,
        is_whole: true,
        is_babel: true,
        is_oxc: false,
        only_parser: false,
        is_oxfmt: false,
    };
    checks.keywords_as_names();
    checks.early_errors();
    checks.first.map(|it| it.1)
}

/// The way up from a node, as [`Node::ancestors`], without the expressions between an expression and the outermost that it is
/// part of. `a + b + c + ..` is as deep as it is long, and what is asked about each of a, b, c is which function or class it is in.
#[derive(Default)]
struct Tops<'a> {
    /// The outermost expression around those on a long way.
    known: IdMap<Expr<'a>, Expr<'a>>,
}

impl<'a> Tops<'a> {
    /// The outermost expression that `of` is part of, and what that is directly part of, which is no expression.
    fn top(&mut self, of: Expr<'a>) -> (Expr<'a>, Node<'a>) {
        // Nearly all ways are short. They are gone without a note.
        if self.known.is_empty() {
            let mut at = of;
            for _ in 0..LONG {
                match at.parent() {
                    Node::Expr(parent) => at = parent,
                    above => return (at, above),
                }
            }
        }
        let mut passed = Vec::new();
        let mut at = of;
        let found = loop {
            if let Some(&top) = self.known.get(at) {
                break (top, top.parent());
            }
            match at.parent() {
                Node::Expr(parent) => {
                    passed.push(at);
                    at = parent;
                }
                above => break (at, above),
            }
        };
        if passed.len() >= LONG {
            self.known
                .extend(passed.into_iter().map(|it| (it, found.0)));
        }
        found
    }

    fn outward(&mut self, from: Node<'a>) -> impl Iterator<Item = Node<'a>> + use<'_, 'a> {
        let mut at = Some(from);
        std::iter::from_fn(move || {
            let next = match at? {
                Node::File(_) => None,
                Node::Expr(it) => Some(match self.top(it) {
                    (top, above) if top == it => above,
                    (top, _) => Node::Expr(top),
                }),
                other => Some(other.parent()),
            };
            at = next;
            next
        })
    }
}

/// From how many expressions in each other on the outermost is noted.
const LONG: usize = 16;

/// The expressions that [`refusal_of_babel`] has a question about. Nothing else of `bun fmt` wants all expressions of a file by
/// kind, and to sort them all costs ten times what the checks cost.
///
/// A check that asks for more of a kind than it did has to be given more HERE. `prettier-refusals.mjs` compares the two ways.
struct Candidates {
    /// Twice the kind, plus one in an optional chain, and the index of the expression. Sorted, which is the order of
    /// [`File::exprs_of_kind`].
    found: Vec<(u8, u32)>,
}

impl Candidates {
    /// Of other kinds there are no candidates: who asks for one gets all of the file.
    const KINDS: [ExprTag; 13] = [
        ExprTag::Assign,
        ExprTag::Await,
        ExprTag::Binary,
        ExprTag::Dot,
        ExprTag::Ident,
        ExprTag::ImportCall,
        ExprTag::NewTarget,
        ExprTag::PrivateIdentifier,
        ExprTag::Regex,
        ExprTag::Super,
        ExprTag::TaggedTemplate,
        ExprTag::Unary,
        ExprTag::Yield,
    ];

    fn of(file: &File) -> Candidates {
        use hir::ExprKind as Kind;
        let text = file.text();
        let has_private_names = strings::contains_char(text, b'#');
        let has_nullish = strings::contains(text, b"??");
        let mut found = Vec::new();
        for (i, raw) in file.hir.exprs.iter().enumerate() {
            let is_candidate = match raw.kind {
                // `keywords_as_names`
                Kind::Ident(name) => name.is_keyword_identifier(),
                // `private_names`: `a.#b`
                Kind::Dot { name_pos, .. } => {
                    has_private_names && text.get(name_pos as usize) == Some(&b'#')
                }
                // `operators`: `??` beside `&&` or `||`
                Kind::Binary { op, .. } => {
                    has_nullish && matches!(op, BinOp::Nullish | BinOp::And | BinOp::Or)
                }
                // `assignment_targets`, `deleted_private_fields`
                Kind::Unary { op, .. } => matches!(
                    op,
                    UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec | UnOp::Delete
                ),
                Kind::Assign { .. }
                | Kind::Await(_)
                | Kind::ImportCall { .. }
                | Kind::NewTarget(_)
                | Kind::PrivateIdentifier(_)
                | Kind::Regex
                | Kind::Super
                | Kind::TaggedTemplate(_)
                | Kind::Yield { .. } => true,
                _ => false,
            };
            if is_candidate && let Some(tag) = file.expr_in_tree(i) {
                let is_chained = matches!(raw.kind, Kind::Dot { chain, .. } if chain != Chain::No);
                found.push((2 * tag as u8 + u8::from(is_chained), i as u32));
            }
        }
        crate::utils::sort::sort_unstable(&mut found);
        Candidates { found }
    }

    /// All expressions of the kinds `tags`, none of which is part of an optional chain, and none of another kind. They are
    /// looked for in the kinds that the binder has noted on its way, which costs next to nothing. `tags`: in the order of
    /// `ExprTag`, which leaves what is found in order.
    fn of_kinds(file: &File, tags: &[ExprTag]) -> Candidates {
        let (kinds, counts) = (file.bound.expr_kinds, file.bound.expr_kind_counts);
        // As `runner::Exprs::from_binder`.
        if kinds.len() != file.hir.exprs.len()
            || file.has_synthetic_nodes()
            || !file.hir.import_attributes.is_empty()
            || !tags.is_sorted_by_key(|&tag| tag as u8)
        {
            return Candidates::of(file);
        }
        let count_of = |tag: ExprTag| {
            counts
                .get(2 * tag as usize)
                .map_or(0, |&count| count as usize)
        };
        let mut found = Vec::with_capacity(tags.iter().map(|&tag| count_of(tag)).sum());
        for &tag in tags {
            let kind = 2 * tag as u8;
            if count_of(tag) == 0 {
                continue;
            }
            let mut at = 0;
            while let Some(next) =
                (kinds.get(at..)).and_then(|rest| strings::index_of_char_usize(rest, kind))
            {
                found.push((kind, (at + next) as u32));
                at += next + 1;
            }
        }
        debug_assert!(found.is_sorted());
        Candidates { found }
    }

    fn of_kind(&self, tag: ExprTag) -> &[(u8, u32)] {
        let start = self.found.partition_point(|it| it.0 < 2 * tag as u8);
        let len = self.found[start..].partition_point(|it| it.0 < 2 * tag as u8 + 2);
        &self.found[start..start + len]
    }
}

/// `of_parser`: the error of TypeScript's parser, if it has one, and where it is.
pub(super) fn first_error<'a>(
    file: &'a File<'a>,
    of_parser: Option<(Option<&'a Diagnostic>, u32)>,
) -> Option<SyntaxError> {
    let mut checks = Checks {
        file,
        candidates: None,
        tops: Tops::default(),
        first: None,
        all: Vec::new(),
        noticed: 0,
        is_whole: of_parser.is_none(),
        is_babel: false,
        is_oxc: false,
        only_parser: false,
        is_oxfmt: false,
    };
    if let Some((diagnostic, at)) = of_parser {
        checks.error_of_parser(diagnostic, at);
        checks.at_sign_before(at);
    }
    checks.editions();
    checks.typescript_syntax(false);
    checks.jsx();
    checks.returns();
    checks.module_syntax();
    checks.strict_mode();
    checks.octals_in_strict_code();
    checks.keywords_as_names();
    checks.parameters();
    checks.early_errors();
    if checks.is_whole {
        checks.redeclarations();
    }
    checks.first.map(|it| it.1)
}

/// `using a = b;` at the top level of a script, in the words of OXC. What CommonJS has is in a function.
pub(super) fn using_in_script<'a>(file: &'a File<'a>) -> Vec<SyntaxError> {
    if !file.has_rare_syntax(hir::rare::ODD_DECLARATION) {
        return Vec::new();
    }
    let is_using = |it: &Stmt| {
        let first = it.as_var().and_then(|list| list.first());
        first.is_some_and(|it| it.var_kind() == VarKind::Using)
    };
    let mut all = file.body().iter().filter(is_using).peekable();
    if all.peek().is_none() || !is_script(file) || file.is_declaration_file() {
        return Vec::new();
    }
    all.map(|it| {
        let message = "'using' declarations are not allowed at the top level of a script";
        SyntaxError::of_oxc(it.span(), message).help("Wrap this code in a block or use a module")
    })
    .collect()
}

/// `export = a` at the top level of a file that exports something else, in the words of OXC.
pub(super) fn export_assignment_beside_exports<'a>(file: &'a File<'a>) -> Vec<SyntaxError> {
    if !file.has_rare_syntax(hir::rare::EXPORT_ASSIGNMENT) {
        return Vec::new();
    }
    let is_assignment = |it: &Stmt| it.tag() == StmtTag::ExportAssign;
    let exports = |it: Stmt| match it.kind() {
        _ if matches!(it.tag(), StmtTag::ExportAssign | StmtTag::ExportAsNamespace) => false,
        StmtKind::ExportNamed(export) => !export.items().is_empty(),
        StmtKind::ExportStar { .. } | StmtKind::ExportDefault(_) => true,
        _ => it.is_exported(),
    };
    if !file.body().iter().any(exports) {
        return Vec::new();
    }
    let error = |it: Stmt| {
        let message =
            "An export assignment cannot be used in a module with other exported elements";
        SyntaxError::of_oxc(it.span(), message)
            .code(2309)
            .help("If you want to use `export =`, remove other `export`s and put all of them to the right hand value of `export =`. If you want to use `export`s, remove `export =` statement.")
            .noticed_at(u32::MAX)
    };
    (file.body().iter().filter(is_assignment).map(error)).collect()
}

/// `for await` in a function that is not `async`, or in no function in a script, in the words of OXC. For a file that is CommonJS by
/// its name see [`module_syntax_in_commonjs`].
pub(super) fn for_await_where_nothing_waits<'a>(file: &'a File<'a>) -> Vec<SyntaxError> {
    if !file.has_rare_syntax(hir::rare::FOR_AWAIT) {
        return Vec::new();
    }
    let error = |it: Stmt<'a>| {
        let span = it.span();
        let keyword = skip_trivia(file.text(), span.start + 3) as usize;
        if !file
            .text()
            .get(keyword..)
            .is_some_and(|it| it.starts_with(b"await"))
        {
            return None;
        }
        let function = Node::Stmt(it).enclosing_function();
        match function {
            Some(func) if func.kind() == FnKind::StaticBlock => {
                let message = b"Cannot use 'for await' in class static initialization block";
                return Some(SyntaxError::of_oxc(span, message));
            }
            Some(func) if func.is_async() => return None,
            None if !is_script(file) => return None,
            _ => {}
        }
        let error = SyntaxError {
            at: skip_trivia(file.text(), span.start + 3),
            end: 0,
            message: b"`for await` loops are only allowed within async functions and at the top levels of modules"
                .to_vec(),
            ..SyntaxError::default()
        };
        let help =
            "Either remove this `await` or add the `async` keyword to the enclosing function";
        let error = error.stage(Stage::Parser).help(Cow::Borrowed(help));
        // Only at the end of the file does oxc's parser know that it is no module.
        Some(match function {
            None => error.noticed_at(u32::MAX),
            Some(_) => error,
        })
    };
    // The others are an error after `for await`, which the parser goes on after.
    let loops = [StmtTag::ForOf, StmtTag::ForIn, StmtTag::For];
    let loops = loops.into_iter().flat_map(|it| file.stmts_of_kind(it));
    let mut all: Vec<_> = loops.filter_map(error).collect();
    crate::utils::sort::sort_by_key(&mut all, |it| it.at);
    all
}

/// `with` where the code is strict for OXC, and anywhere in TypeScript, in its words.
pub(super) fn with_in_strict_code<'a>(file: &'a File<'a>) -> Vec<SyntaxError> {
    if file.hir.with_bodies.is_empty() {
        return Vec::new();
    }
    let is_refused = |it: &Stmt<'a>| {
        matches!(it.kind(), StmtKind::With { .. })
            && (!file.is_javascript() || is_strict_mode(Node::Stmt(*it).scope(), file))
    };
    let refused = file.stmts_of_kind(StmtTag::Block).filter(is_refused);
    refused
        .map(|it| {
            let start = it.span().start;
            let keyword = Span::new(start, start + "with".len() as u32);
            // It is reported on the way out of the statement.
            SyntaxError::of_oxc(keyword, "'with' statements are not allowed")
                .noticed_at(it.span().end)
        })
        .collect()
}

/// Those of the checks of [`first_error`] that OXC makes too, for a file that TypeScript's parser has nothing to say about: see
/// [`super::oxc`]. OXC takes a file for a module if it has `import` or `export`.
pub(super) fn errors_of_oxc<'a>(
    file: &'a File<'a>,
    only_parser: bool,
    is_oxfmt: bool,
) -> Vec<SyntaxError> {
    // Of TypeScript `early_errors_of_oxc` asks for these only. Of JavaScript it asks for one expression in ten, which the
    // rules are about to want by kind anyway.
    let suspends = hir::rare::SUSPENDS_IN_PARAMETERS | hir::rare::SUSPENDS_IN_STATIC_BLOCK;
    let kinds: &[ExprTag] = match file.has_rare_syntax(suspends) {
        true => &[
            ExprTag::PrivateIdentifier,
            ExprTag::Super,
            ExprTag::Regex,
            ExprTag::Await,
            ExprTag::Yield,
            ExprTag::NewTarget,
        ],
        false => &[
            ExprTag::PrivateIdentifier,
            ExprTag::Super,
            ExprTag::Regex,
            ExprTag::NewTarget,
        ],
    };
    // `a.#b` and `delete a` are of kinds of which there are many.
    let asks_about_many = hir::rare::ODD_PRIVATE_NAME | hir::rare::DELETES_A_NAME;
    let candidates = (!file.is_javascript()).then(|| match file.has_rare_syntax(asks_about_many) {
        true => Candidates::of(file),
        false => Candidates::of_kinds(file, kinds),
    });
    let mut checks = checks_of_oxc(file, candidates.as_ref());
    (checks.only_parser, checks.is_oxfmt) = (only_parser, is_oxfmt);
    checks.early_errors_of_oxc();
    checks.all
}

fn checks_of_oxc<'a, 'c>(file: &'a File<'a>, candidates: Option<&'c Candidates>) -> Checks<'a, 'c> {
    Checks {
        file,
        candidates,
        tops: Tops::default(),
        first: None,
        all: Vec::new(),
        noticed: 0,
        // Nothing is asked of the scopes, to which a file is a module whatever is in it.
        is_whole: false,
        is_babel: false,
        is_oxc: true,
        only_parser: false,
        is_oxfmt: false,
    }
}

fn is_identifier_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$' | 0x80..)
}

impl<'a, 'c> Checks<'a, 'c> {
    /// [`File::exprs_of_kind`], or those of them that are [`Candidates`].
    fn exprs_of(&self, tag: ExprTag) -> impl Iterator<Item = Expr<'a>> + use<'a, 'c> {
        let file = self.file;
        let candidates = self.candidates.filter(|_| Candidates::KINDS.contains(&tag));
        let of_file = candidates.is_none().then(|| file.exprs_of_kind(tag));
        let found = candidates.map_or(&[][..], |it| it.of_kind(tag));
        (of_file.into_iter().flatten())
            .chain(found.iter().map(move |it| Expr::from_raw(file, it.1)))
    }

    /// Of two errors that acorn would notice at one place, the one that is found first counts.
    fn fail(&mut self, at: u32, message: impl Into<Vec<u8>>) {
        self.fail_for(Span::new(at, 0), message.into());
    }

    /// The same for an error that oxc labels up to `label.end`: see [`SyntaxError::end`].
    fn fail_for(&mut self, label: Span, message: Vec<u8>) {
        let Span { start: at, end } = label;
        if self.is_babel && !(REFUSED_BY_BABEL.iter()).any(|it| message.starts_with(it.as_bytes()))
        {
            return;
        }
        if self.is_oxc {
            return self.all.push(SyntaxError {
                at,
                end,
                message,
                ..SyntaxError::default()
            });
        }
        let noticed = self.noticed.max(at);
        if self.first.as_ref().is_none_or(|it| noticed < it.0) {
            let error = SyntaxError {
                at,
                end,
                message,
                ..SyntaxError::default()
            };
            self.first = Some((noticed, error));
        }
    }

    /// For oxc: an error in its words.
    fn report(&mut self, error: SyntaxError) {
        self.all.push(error);
    }

    /// For oxc: `name` is declared at `first` and again at `again`.
    fn redeclared(&mut self, what: &str, name: &[u8], first: Span, again: Span) -> SyntaxError {
        SyntaxError::redeclared(what, name, first, again)
    }

    /// Runs `check`, whose errors are those of oxc's parser.
    fn as_parser(&mut self, check: impl FnOnce(&mut Self)) {
        let before = self.all.len();
        check(self);
        for it in self.all.iter_mut().skip(before) {
            it.of_oxc.stage = Stage::Parser;
        }
    }

    /// The token at `at`.
    fn token_span(&self, at: u32) -> Span {
        Span::new(at, at + self.token_at(at).len() as u32)
    }

    /// Runs `check`, the errors of which acorn notices when it has read up to `noticed`: it parses `[a, b()]` before it sees
    /// the `=` that makes it a pattern.
    fn when_read_to(&mut self, noticed: u32, check: impl FnOnce(&mut Self)) {
        let before = std::mem::replace(&mut self.noticed, noticed);
        check(self);
        self.noticed = before;
    }

    fn text_from(&self, at: u32) -> &'a [u8] {
        self.file.text().get(at as usize..).unwrap_or_default()
    }

    fn token_at(&self, at: u32) -> &'a [u8] {
        let rest = self.text_from(at);
        let len = match rest {
            // TypeScript's scanner stops after the first `>`.
            [b'>', ..] => {
                let same = rest.iter().take(3).take_while(|it| **it == b'>').count();
                same + usize::from(rest.get(same) == Some(&b'='))
            }
            // The quote is a token of its own.
            [b'`', ..] => 1,
            _ => token_len(rest),
        };
        &rest[..len.min(rest.len())]
    }

    /// The start of the token after the one at `at`.
    fn after_token(&self, at: u32) -> u32 {
        skip_trivia(self.file.text(), at + self.token_at(at).len() as u32)
    }

    /// The start of the token before the one at `at`: a word, or a punctuator of one character.
    fn before_token(&self, at: u32) -> u32 {
        let text = self.file.text();
        let end = self.file.end_of_token_before(at) as usize;
        let mut start = end.saturating_sub(1);
        while start > 0 && is_identifier_byte(text[start]) && is_identifier_byte(text[start - 1]) {
            start -= 1;
        }
        start as u32
    }

    /// espree's `unexpected`, or what acorn's tokenizer says if it cannot read the token at `at`.
    fn unexpected(&mut self, at: u32) {
        let at = skip_trivia(self.file.text(), at);
        match self.token_at(at) {
            [] => self.fail(at, "Unexpected token"),
            [b'@', ..] | [b'#'] => self.unexpected_character(at),
            [b'\\', ..] if !self.is_unicode_escape(at) => self.unexpected_character(at),
            token => self.fail(at, [b"Unexpected token ", token].concat()),
        }
    }

    fn reserved(&mut self, at: u32) {
        self.fail(
            at,
            [b"The keyword '", self.token_at(at), b"' is reserved"].concat(),
        );
    }

    /// Whether a check for oxc has nothing to look for: the parser has not seen `bit` of `hir::rare`. The checks for acorn and
    /// Babel look at every file.
    fn lacks(&self, bit: u32) -> bool {
        self.is_oxc && !self.file.has_rare_syntax(bit)
    }

    /// What the parser takes the file for.
    fn source_type(&self) -> SourceType {
        match self.is_oxc {
            true => source_type(self.file),
            false => self.file.language().source_type,
        }
    }

    /// All of the file is strict. oxc goes by the name of the file too: `.mjs` and `.mts` are modules whatever is in them.
    fn is_all_strict(&self) -> bool {
        let language = self.file.language();
        match (self.is_oxc, self.is_babel) {
            (true, _) => source_type(self.file) == SourceType::Module,
            // See `is_strict`.
            (_, true) => false,
            _ => language.source_type == SourceType::Module || language.implied_strict,
        }
    }

    /// Whether the code at `node` is strict.
    fn is_strict(&self, node: Node<'a>) -> bool {
        // What is only wrong in strict mode does not keep Prettier from formatting.
        !self.is_babel
            && (self.is_all_strict()
                || match self.is_oxc {
                    true => !self.only_parser && is_strict_mode(node.scope(), self.file),
                    false => self.is_whole && node.scope().is_strict(),
                })
    }

    // ───────────────────────────── the words for an error of the parser ─────────────────────────────

    #[optimize(size)]
    fn error_of_parser(&mut self, diagnostic: Option<&Diagnostic>, at: u32) {
        let text = self.file.text();
        match diagnostic.map_or(0, |it| it.code) {
            1002 => {
                // It is reported where the line ends. acorn reports where the string starts.
                let line =
                    strings::last_index_of_any(&text[..(at as usize).min(text.len())], b"\n\r")
                        .map_or(0, |it| it + 1);
                let mut token = skip_trivia(text, line as u32);
                while token < at && self.after_token(token) < at && self.after_token(token) > token
                {
                    token = self.after_token(token);
                }
                self.fail(token.min(at), "Unterminated string constant");
            }
            1010 => {
                let closed = strings::last_index_of(text, b"*/").map_or(0, |it| it + 2);
                let start =
                    strings::index_of(&text[closed..], b"/*").map_or(at as usize, |it| closed + it);
                self.fail(start as u32, "Unterminated comment");
            }
            1160 => self.unterminated_template(at),
            // After the `/`.
            1161 => self.fail(at + 1, "Unterminated regular expression"),
            1121 | 1489 => self.fail(at, "Invalid number"),
            1487 => self.fail(at, "Octal literal in strict mode"),
            1488 => self.fail(at + 1, "Invalid escape sequence"),
            1127 | 18026 => self.unexpected_character(at),
            1351 => self.fail(at, "Identifier directly after number"),
            1381 => self.fail(
                at,
                "Unexpected token `}`. Did you mean `&rbrace;` or `{\"}\"}`?",
            ),
            1382 => self.fail(
                at,
                "Unexpected token `>`. Did you mean `&gt;` or `{\">\"}`?",
            ),
            6189 => self.fail(at, "Numeric separator must be exactly one underscore"),
            6188 => {
                let before = text.get(..at as usize).unwrap_or_default();
                let digits = before
                    .iter()
                    .rev()
                    .take_while(|it| it.is_ascii_alphanumeric() || **it == b'_')
                    .count();
                let number = &before[before.len() - digits..];
                let message = match number {
                    [b'0', b'0'..=b'9', ..] | [b'0'] => {
                        "Numeric separator is not allowed in legacy octal numeric literals"
                    }
                    [] | [b'0', b'b' | b'B' | b'o' | b'O' | b'x' | b'X'] | [.., b'e' | b'E'] => {
                        "Numeric separator is not allowed at the first of digits"
                    }
                    _ => "Numeric separator is not allowed at the last of digits",
                };
                self.fail(at, message);
            }
            // At a word that nothing can follow. acorn stumbles over what follows.
            1434 | 1435 => self.unexpected(self.after_token(at)),
            // Not a keyword for acorn.
            1389 | 1390 if self.token_at(at) == b"enum" => self.reserved(at),
            1389 | 1390 => self.fail(
                at,
                [b"Unexpected keyword '", self.token_at(at), b"'"].concat(),
            ),
            1472 => {
                let is_before =
                    |it: &&hir::Stmt| matches!(it.kind, hir::StmtKind::Try { .. }) && it.start < at;
                let start = self
                    .file
                    .hir
                    .stmts
                    .iter()
                    .filter(is_before)
                    .map(|it| it.start)
                    .max();
                self.fail(start.unwrap_or(at), "Missing catch or finally clause");
            }
            _ => {
                let at = skip_trivia(text, at);
                let before = self.before_token(at);
                let is_module = self.file.language().source_type == SourceType::Module;
                let (token, next) = (self.token_at(at), self.after_token(at));
                let is_dynamic = matches!(self.token_at(next), b"(" | b".");
                let starts_statement =
                    before >= at || matches!(self.token_at(before), b";" | b"{" | b"}");
                let is_assignment = token.ends_with(b"=")
                    && !matches!(token, b"==" | b"===" | b"!=" | b"!==" | b"<=" | b">=");
                // What TypeScript's parser does not let an assignment operator follow, acorn parses first.
                let end = crate::tokens::skip_trivia_back(text, at);
                let is_before = |it: &&hir::Expr| {
                    it.end == end && it.pos < end && !matches!(it.kind, hir::ExprKind::Missing)
                };
                let assigned_to = self
                    .file
                    .hir
                    .exprs
                    .iter()
                    .filter(is_before)
                    .map(|it| it.pos)
                    .min();
                if before < at && text.get(before as usize) == Some(&b'@') {
                    // TypeScript's parser takes it for the start of a decorator.
                    self.unexpected_character(before);
                } else if !is_module
                    && starts_statement
                    && (token == b"export" || token == b"import" && !is_dynamic)
                {
                    self.fail(
                        at,
                        "'import' and 'export' may appear only with 'sourceType: module'",
                    );
                } else if token == b"import"
                    && self.token_at(next) == b"."
                    && self.token_at(self.after_token(next)) != b"meta"
                {
                    self.fail(
                        self.after_token(next),
                        "The only valid meta property for import is 'import.meta'",
                    );
                } else if let Some(start) = assigned_to.filter(|_| is_assignment) {
                    self.when_read_to(at, |checks| checks.fail(start, "Assigning to rvalue"));
                } else {
                    self.unexpected(at);
                }
            }
        }
    }

    /// TypeScript's parser takes an `@` for the start of a decorator and fails later. acorn cannot read it. The tokens before
    /// `limit` are told apart without regard to what is around them, which is good enough for the place of an error.
    fn at_sign_before(&mut self, limit: u32) {
        let text = self.file.text();
        if !strings::contains_char(text.get(..limit as usize).unwrap_or(text), b'@') {
            return;
        }
        let mut at = skip_trivia(text, 0);
        while at < limit {
            match self.token_at(at) {
                [] => break,
                [b'@', ..] => return self.unexpected_character(at),
                token => at = skip_trivia(text, at + token.len() as u32),
            }
        }
    }

    /// A template that ends with the text. acorn reports where its last piece of text starts.
    fn unterminated_template(&mut self, at: u32) {
        let (file, len) = (self.file, self.file.text().len() as u32);
        let is_open =
            |it: &&hir::Expr| it.end >= len && file.text().get(it.pos as usize) == Some(&b'`');
        let Some(template) = file
            .hir
            .exprs
            .iter()
            .filter(is_open)
            .max_by_key(|it| it.pos)
        else {
            // The parser did not expect a template there, and neither does acorn.
            let quote = (file.hir.diagnostics.iter().map(|it| it.start))
                .find(|&it| file.text().get(it as usize) == Some(&b'`'));
            return match quote {
                Some(quote) => self.unexpected(quote),
                None => self.fail(at, "Unterminated template"),
            };
        };
        let last = match template.kind {
            hir::ExprKind::Template { exprs } => file
                .hir
                .ids
                .get(exprs.range())
                .and_then(<[_]>::last)
                .copied(),
            _ => None,
        };
        let piece = match last {
            Some(last) => {
                skip_trivia(
                    file.text(),
                    Expr::new(file, hir::ExprId(last)).outer_span().end,
                ) + 1
            }
            None => template.pos + 1,
        };
        match piece >= len {
            true => self.fail(len, "Unterminated template literal"),
            false => self.fail(piece, "Unterminated template"),
        }
    }

    /// `\uXXXX`, `\u{X..}`
    fn is_unicode_escape(&self, at: u32) -> bool {
        match self.text_from(at) {
            [b'\\', b'u', b'{', rest @ ..] => {
                let digits = rest.iter().take_while(|it| it.is_ascii_hexdigit()).count();
                digits > 0 && rest.get(digits) == Some(&b'}')
            }
            [b'\\', b'u', rest @ ..] => {
                rest.len() >= 4 && rest[..4].iter().all(u8::is_ascii_hexdigit)
            }
            _ => false,
        }
    }

    /// What acorn's tokenizer says about the character at `at`, with which no token starts.
    fn unexpected_character(&mut self, at: u32) {
        let (at, rest) = match self.text_from(at) {
            [b'\\', b'u', ..] if self.is_unicode_escape(at) => {
                return self.fail(at, "Invalid Unicode escape");
            }
            [b'\\', b'u', ..] => return self.fail(at + 2, "Bad character escape sequence"),
            [b'\\', ..] => return self.fail(at + 1, "Expecting Unicode escape sequence \\uXXXX"),
            // It reads a private name.
            [b'#', rest @ ..] => (at + 1, rest),
            rest => (at, rest),
        };
        let len = rest
            .utf8_chunks()
            .next()
            .and_then(|it| it.valid().chars().next())
            .map_or(1, char::len_utf8);
        self.fail(
            at,
            [
                b"Unexpected character '",
                &rest[..len.min(rest.len())],
                b"'",
            ]
            .concat(),
        );
    }

    // ───────────────────────────── TypeScript in JavaScript ─────────────────────────────

    /// What acorn stumbles over where TypeScript's parser says that something "can only be used in TypeScript files".
    /// `allows_modifiers`: `private a` and the like in a class pass, as in oxlint.
    fn typescript_syntax(&mut self, allows_modifiers: bool) {
        for it in self
            .file
            .hir
            .diagnostics
            .iter()
            .filter(|it| it.kind == DiagnosticKind::Js)
        {
            if self.file.is_in_jsdoc(it.start) {
                continue;
            }
            let at = it.start;
            let argument = it.args.first().map_or(&b""[..], |it| &it[..]);
            let is_after_export =
                |checks: &Self, at: u32| checks.token_at(checks.before_token(at)) == b"export";
            match it.code {
                // A type annotation, a list of type parameters, `as T`, `satisfies T`, `<T>a`: the token before.
                8010 | 8004 | 8016 | 8037 => self.unexpected(self.before_token(at)),
                8009 | 8012 if argument == b"?" => self.unexpected(at),
                8009 | 8012 if allows_modifiers => {}
                // A modifier is a name for acorn, and nothing can follow it.
                8009 | 8012 if is_after_export(self, at) => self.unexpected(at),
                8009 | 8012 => self.unexpected(self.after_token(at)),
                // `a<T>(b)` is two comparisons.
                8011 => {
                    let end = if it.end > at {
                        it.end
                    } else {
                        at + self.token_at(at).len() as u32
                    };
                    let after = self.after_token(skip_trivia(self.file.text(), end));
                    match self.token_at(after) {
                        b"(" if self.token_at(self.after_token(after)) == b")" => {
                            self.unexpected(self.after_token(after))
                        }
                        b"(" => {}
                        _ => self.unexpected(after),
                    }
                }
                8013 => self.unexpected(it.end.max(at + 1) - 1),
                // At the name.
                8006 if matches!(argument, b"enum" | b"interface") => {
                    let keyword = self.before_token(at);
                    if is_after_export(self, keyword) {
                        self.unexpected(keyword);
                    } else if argument == b"enum" || self.is_all_strict() {
                        self.reserved(keyword);
                    } else {
                        self.unexpected(at);
                    }
                }
                8006 if matches!(argument, b"module" | b"namespace") => self.unexpected(at),
                // `import type a`, `export type { a }`: at the statement.
                8006 if self.token_at(at) == b"import" => {
                    self.unexpected(self.after_token(self.after_token(at)))
                }
                8006 | 8003 if self.token_at(at) == b"export" => {
                    self.unexpected(self.after_token(at))
                }
                8002 if self.token_at(at) == b"import" => {
                    self.unexpected(self.after_token(self.after_token(at)))
                }
                8008 => {
                    let keyword = self.before_token(at);
                    let at = if is_after_export(self, keyword) {
                        keyword
                    } else {
                        at
                    };
                    self.unexpected(at);
                }
                _ => self.unexpected(at),
            }
        }
    }

    fn jsx(&mut self) {
        if self.file.language().jsx || self.file.hir.jsx.is_empty() {
            return;
        }
        if let Some(first) = self
            .file
            .exprs_of_kind(ExprTag::Jsx)
            .map(|it| it.span().start)
            .min()
        {
            self.fail(first, "Unexpected token <");
        }
    }

    // ───────────────────────────── what the kind of file decides ─────────────────────────────

    /// The first `return` among `statements` and in them, outside of functions.
    fn first_return(statements: impl Iterator<Item = Stmt<'a>>) -> Option<u32> {
        let mut open: SmallVec<[Stmt<'a>; 16]> = statements.collect();
        open.reverse();
        while let Some(it) = open.pop() {
            let before = open.len();
            match it.kind() {
                StmtKind::Return(_) => return Some(it.span().start),
                StmtKind::If { yes, no, .. } => open.extend([Some(yes), no].into_iter().flatten()),
                StmtKind::For { body, .. }
                | StmtKind::ForIn { body, .. }
                | StmtKind::ForOf { body, .. }
                | StmtKind::While { body, .. }
                | StmtKind::DoWhile { body, .. }
                | StmtKind::Labeled { body, .. }
                | StmtKind::With { body, .. } => open.push(body),
                StmtKind::Block(body) => open.extend(body),
                StmtKind::Switch { cases, .. } => {
                    open.extend(cases.iter().flat_map(|it| it.body()))
                }
                StmtKind::Try {
                    block,
                    handler,
                    finalizer,
                    ..
                } => {
                    open.extend([Some(block), handler, finalizer].into_iter().flatten());
                }
                _ => {}
            }
            open[before..].reverse();
        }
        None
    }

    fn returns(&mut self) {
        let file = self.file;
        if file.language().has_function_scope_at_top_level() {
            return;
        }
        let in_static_blocks = (file.hir.fns.iter().enumerate())
            .filter(|it| it.1.kind == FnKind::StaticBlock)
            .map(|it| Func::from_raw(file, it.0 as u32))
            .filter(|it| it.is_in_tree())
            .filter_map(|it| Self::first_return(it.body_statements()?.iter()));
        let first = Self::first_return(file.body().iter())
            .into_iter()
            .chain(in_static_blocks)
            .min();
        if let Some(at) = first {
            self.fail(at, "'return' outside of function");
        }
    }

    fn module_syntax(&mut self) {
        let file = self.file;
        if file.language().source_type == SourceType::Module {
            return;
        }
        if let Some(first) = file.body().iter().find(is_module_syntax) {
            self.fail(
                first.span().start,
                "'import' and 'export' may appear only with 'sourceType: module'",
            );
        }
        if let Some(first) = file
            .exprs_of_kind(ExprTag::ImportMeta)
            .map(|it| it.span().start)
            .min()
        {
            self.fail(first, "Cannot use 'import.meta' outside a module");
        }
    }

    // ───────────────────────────── strict mode ─────────────────────────────

    fn strict_mode(&mut self) {
        let file = self.file;
        // For oxc this is about `delete a` alone: for `with` see `with_in_strict_code`.
        if self.lacks(hir::rare::DELETES_A_NAME) {
            return;
        }
        // Code is strict in a module, after a directive, and in a class.
        if !self.is_all_strict()
            && (!(self.is_whole || self.is_oxc)
                || !file.has_classes() && !file.mentions("use strict"))
        {
            return;
        }
        for it in file.exprs_of_kind(ExprTag::Unary) {
            let Some(hir::ExprKind::Unary {
                op: UnOp::Delete,
                operand,
            }) = it.try_raw().map(|it| it.kind)
            else {
                continue;
            };
            // oxc looks through what only TypeScript has: `delete (a as T)`, `delete a!`.
            let mut operand = Expr::new(file, operand);
            while self.is_oxc
                && matches!(
                    operand.tag(),
                    ExprTag::As | ExprTag::AsConst | ExprTag::Satisfies | ExprTag::NonNull
                )
                && let Some(inner) = operand.operand()
            {
                operand = inner;
            }
            let Some(&hir::Expr {
                kind: hir::ExprKind::Ident(_),
                pos,
                ..
            }) = operand.try_raw()
            else {
                continue;
            };
            match self.is_strict(Node::Expr(it)) {
                true if self.is_oxc => {
                    self.fail(pos, "Delete of an unqualified identifier in strict mode.")
                }
                true => self.fail(it.span().start, "Deleting local variable in strict mode"),
                false => {}
            }
        }
        if !file.hir.with_bodies.is_empty() && !self.is_oxc {
            for it in file.stmts_of_kind(StmtTag::Block) {
                if matches!(it.kind(), StmtKind::With { .. }) && self.is_strict(Node::Stmt(it)) {
                    self.fail(it.span().start, "'with' in strict mode");
                }
            }
        }
    }

    /// Octal literals and escapes are errors where the code is strict. The parser reports them wherever they are, as its own
    /// errors ([`is_tolerated`](super::is_tolerated) lets them pass in a script) or beside them.
    fn octals_in_strict_code(&mut self) {
        let file = self.file;
        let is_octal = |it: &&Diagnostic| {
            matches!(it.kind, DiagnosticKind::Parse | DiagnosticKind::Grammar)
                && matches!(it.code, 1121 | 1487 | 1488 | 1489)
        };
        for it in file.hir.diagnostics.iter().filter(is_octal) {
            let is_strict = self.is_all_strict()
                || (self.is_whole || self.is_oxc)
                    && (file.scopes())
                        .filter(|scope| scope.span().contains_offset(it.start))
                        .max_by_key(|scope| scope.span().start)
                        .is_some_and(|scope| match self.is_oxc {
                            true => is_strict_mode(scope, file),
                            false => scope.is_strict(),
                        });
            if is_strict && self.is_oxc {
                self.octal_of_oxc(it);
            } else if is_strict {
                self.error_of_parser(Some(it), it.start);
            }
        }
    }

    /// An octal literal or escape in strict code, in the words of oxc, which labels the whole literal.
    fn octal_of_oxc(&mut self, it: &Diagnostic) {
        // The token that it is in.
        let before = self.file.token_before(Span::empty(it.start));
        let literal = self
            .file
            .token_after(before.map_or(Span::empty(0), |it| it.span()));
        let literal = literal.map(|it| it.span());
        let literal = literal.filter(|literal| literal.contains_offset(it.start));
        let literal = literal.unwrap_or_else(|| Span::new(it.start, it.end.max(it.start + 1)));
        let deprecated = "'0'-prefixed octal literals and octal escape sequences are deprecated";
        let (message, help) = match it.code {
            1489 => (
                "Decimals with leading zeros are not allowed in strict mode",
                "remove the leading zero",
            ),
            1488 => (
                "Invalid escape sequence",
                "\\8 and \\9 are not allowed in strict mode",
            ),
            _ => (deprecated, "for octal literals use the '0o' prefix instead"),
        };
        self.report(SyntaxError::of_oxc(literal, message).help(help));
    }

    /// The names that are keywords in some places: one comparison for each identifier of the file.
    fn keywords_as_names(&mut self) {
        let file = self.file;
        for it in self.exprs_of(ExprTag::Ident) {
            let Some(hir::ExprKind::Ident(name)) = it.try_raw().map(|it| it.kind) else {
                continue;
            };
            if name.is_keyword_identifier() && !it.is_jsx_tag_name() {
                self.keyword_as_reference(it, name);
            }
        }
        for &id in file.pats_of(PatTag::Ident) {
            let it = Pat::from_raw(file, id);
            let Some(hir::PatKind::Ident(name)) = it.try_raw().map(|it| it.kind) else {
                continue;
            };
            if name.is_keyword_identifier() {
                self.keyword_as_binding(Node::Pat(it), it.span().start, name);
            }
        }
        for it in file.funcs() {
            let Some(raw) = it.try_raw().filter(|raw| raw.name.is_keyword_identifier()) else {
                continue;
            };
            // The name of a method is not a binding.
            if matches!(raw.kind, FnKind::Decl | FnKind::Expr) {
                self.keyword_as_binding(Node::Func(it), raw.name_pos, raw.name);
            }
        }
        for it in file.classes() {
            if let Some(raw) = it.try_raw().filter(|raw| raw.name.is_keyword_identifier()) {
                self.keyword_as_binding(Node::Class(it), raw.name_pos, raw.name);
            }
        }
        for it in file.stmts_of_kind(StmtTag::Labeled) {
            if let Some(hir::StmtKind::Labeled { label, .. }) = it.try_raw().map(|it| it.kind)
                && label.is_keyword_identifier()
            {
                self.is_reserved(Node::Stmt(it), it.span().start, label);
            }
        }
        let root = Node::File(file);
        for raw in file.hir.imports {
            for (name, at) in [
                (raw.default, raw.default_pos),
                (raw.namespace, raw.namespace_pos),
            ] {
                if name.is_keyword_identifier() {
                    self.keyword_as_binding(root, at, name);
                }
            }
        }
        for raw in file
            .hir
            .import_specs
            .iter()
            .filter(|it| it.local.is_keyword_identifier())
        {
            self.keyword_as_binding(root, raw.pos, raw.local);
        }
    }

    /// `checkUnreserved`. `node`: the identifier, or what it names.
    fn is_reserved(&mut self, node: Node<'a>, at: u32, name: Atom) -> bool {
        // The name of a function expression is in the scope of the function.
        let function = match node {
            Node::Func(func) if func.kind() == FnKind::Expr => Some(func),
            _ => {
                let mut inside = node;
                let found = self.tops.outward(node).find_map(|it| {
                    let from = std::mem::replace(&mut inside, it);
                    match it {
                        Node::Func(func) => Some(Some(func)),
                        // For acorn the initializer of a field is a scope of its own, which is not that of the function around.
                        Node::Member(member) if member.init().map(Node::Expr) == Some(from) => {
                            Some(None)
                        }
                        _ => None,
                    }
                });
                found.flatten()
            }
        };
        let is_in_static_block = function.is_some_and(|it| it.kind() == FnKind::StaticBlock);
        let message = if name == known::r#yield && function.is_some_and(Func::is_generator) {
            "Cannot use 'yield' as identifier inside a generator"
        } else if name == known::r#await && function.is_some_and(Func::is_async) {
            "Cannot use 'await' as identifier inside an async function"
        } else if name == known::arguments
            && matches!(
                Self::this_scope(&mut self.tops, node),
                Some(Node::Member(_))
            )
        {
            "Cannot use 'arguments' in class field initializer"
        } else if name == known::arguments && is_in_static_block {
            "Cannot use arguments in class static initialization block"
        } else if name == known::r#await && is_in_static_block {
            "Cannot use await in class static initialization block"
        } else if name == known::r#await && self.source_type() == SourceType::Module {
            if self.is_oxc {
                self.reserved(at);
                return true;
            }
            "Cannot use keyword 'await' outside an async function"
        } else if name == known::r#await
            || name == known::eval
            || name == known::arguments
            || !self.is_strict(node)
        {
            return false;
        } else {
            self.reserved(at);
            return true;
        };
        self.fail(at, message);
        true
    }

    fn keyword_as_reference(&mut self, it: Expr<'a>, name: Atom) {
        let at = it.span().start;
        if self.is_reserved(Node::Expr(it), at, name)
            || (name != known::eval && name != known::arguments)
        {
            return;
        }
        // `checkLValSimple`
        let is_written = match it.parent() {
            Node::Expr(parent) => match parent.try_raw().map(|it| it.kind) {
                Some(hir::ExprKind::Assign { target, .. }) => target == it.id(),
                Some(hir::ExprKind::Unary { op, .. }) => {
                    matches!(
                        op,
                        UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec
                    )
                }
                _ => it.is_assignment_target(),
            },
            // oxc takes `for (eval in a)` and `for (eval of a)`.
            Node::Stmt(_) if self.is_oxc => false,
            _ => it.is_assignment_target(),
        };
        if is_written && self.is_strict(Node::Expr(it)) {
            self.fail(
                at,
                [b"Assigning to ", self.token_at(at), b" in strict mode"].concat(),
            );
        }
    }

    fn keyword_as_binding(&mut self, node: Node<'a>, at: u32, name: Atom) {
        if self.is_reserved(node, at, name) {
            return;
        }
        if name == known::eval || name == known::arguments {
            if self.is_strict(node) {
                self.fail(
                    at,
                    [b"Binding ", self.token_at(at), b" in strict mode"].concat(),
                );
            }
        } else if name == known::let_ {
            let is_lexical = match node {
                // oxc takes `catch (let)`.
                Node::Pat(pat) if self.is_oxc && Declaration::Var(pat).is_catch_parameter() => {
                    false
                }
                Node::Pat(pat) => (Node::Pat(pat).ancestors())
                    .find_map(|it| match it {
                        Node::VarDecl(it) => Some(it.var_kind() != VarKind::Var),
                        Node::Param(_) | Node::Func(_) => Some(false),
                        _ => None,
                    })
                    .unwrap_or(false),
                // For Babel the name of a class is only a reserved word there.
                Node::Class(_) => !self.is_babel,
                _ => false,
            };
            if is_lexical {
                self.fail(at, "let is disallowed as a lexically bound name");
            }
        }
    }

    /// `checkParams`
    fn parameters(&mut self) {
        let file = self.file;
        for (i, raw) in file.hir.fns.iter().enumerate() {
            let params = file.hir.params.get(raw.params.range()).unwrap_or_default();
            let is_simple = |it: &hir::Param| {
                it.default.is_none()
                    && !it.flags.contains(Flags::REST)
                    && matches!(
                        file.hir.pats.get(it.pat.idx()).map(|it| it.kind),
                        Some(hir::PatKind::Ident(_))
                    )
            };
            let are_simple = params.iter().all(is_simple);
            if params.len() < 2 && are_simple {
                continue;
            }
            let mut names: SmallVec<[(Atom, u32); 8]> = SmallVec::new();
            for id in raw.params.iter() {
                let id: hir::ParamId = id;
                Param::new(file, id).pat().for_each_binding(&mut |it| {
                    if let Some(hir::PatKind::Ident(name)) = it.try_raw().map(|it| it.kind) {
                        names.push((name, it.span().start));
                    }
                });
            }
            // The first that is there before. Nearly every list is short.
            let clash = match names.len() {
                ..=8 => (names.iter().enumerate())
                    .find(|&(i, it)| names[..i].iter().any(|before| before.0 == it.0))
                    .map(|it| it.1),
                _ => {
                    let mut seen = FxHashSet::default();
                    names.iter().find(|it| !seen.insert(it.0))
                }
            };
            let (Some(&(_, at)), func) = (clash, Func::from_raw(file, i as u32)) else {
                continue;
            };
            let allows = are_simple
                && matches!(raw.kind, FnKind::Decl | FnKind::Expr)
                && !self.is_strict(Node::Func(func));
            if !allows && func.is_in_tree() {
                let body = func.body_span().map_or(at, |it| it.start);
                self.when_read_to(body, |checks| checks.fail(at, "Argument name clash"));
            }
        }
    }

    // ───────────────────────────── `declareName` ─────────────────────────────

    /// `treatFunctionsAsVarInScope`
    fn treats_functions_as_var(scope: Scope) -> bool {
        matches!(scope.kind(), ScopeKind::Function | ScopeKind::Global)
    }

    fn redeclarations(&mut self) {
        let file = self.file;
        let has_var = file.hir.var_decls.iter().any(|it| it.kind == VarKind::Var);
        for scope in file.scopes() {
            // The block of a `catch` is one scope with its parameter.
            let catch = scope
                .parent()
                .filter(|it| it.kind() == ScopeKind::Catch && scope.kind() == ScopeKind::Block);
            let is_block = !matches!(
                scope.kind(),
                ScopeKind::Function
                    | ScopeKind::Global
                    | ScopeKind::Module
                    | ScopeKind::ClassStaticBlock
            );
            for symbol in scope.symbols() {
                let declarations = symbol.declarations();
                if declarations.len() > 1 {
                    self.declarations_in_one_scope(scope, declarations);
                }
                if catch.is_some_and(|it| it.get_name(symbol.name()).is_some())
                    && let Some(at) = symbol
                        .declarations()
                        .filter_map(Declaration::name_span)
                        .map(|it| it.start)
                        .min()
                {
                    self.already_declared(at);
                }
                if has_var && is_block {
                    self.var_through(scope, symbol.name(), symbol.declarations());
                }
            }
        }
    }

    fn already_declared(&mut self, at: u32) {
        self.fail(
            at,
            [
                b"Identifier '",
                self.token_at(at),
                b"' has already been declared",
            ]
            .concat(),
        );
    }

    /// The declarations of one name in `scope`, in the order of the source.
    fn declarations_in_one_scope(
        &mut self,
        scope: Scope<'a>,
        declarations: impl Iterator<Item = Declaration<'a>>,
    ) {
        let mut sorted: SmallVec<[(u32, Binding); 4]> = declarations
            .filter_map(|it| Some((it.name_span()?.start, Binding::of(it, scope)?)))
            .collect();
        crate::utils::sort::sort_unstable_by_key(&mut sorted, |it| it.0);
        let as_var = Self::treats_functions_as_var(scope);
        let (mut lexical, mut function, mut var) = (false, false, false);
        for (at, binding) in sorted {
            let is_redeclared = match binding {
                Binding::Lexical => lexical || function || var,
                Binding::Function => lexical || !as_var && var,
                Binding::Var => lexical || !as_var && function,
            };
            if is_redeclared {
                return self.already_declared(at);
            }
            match binding {
                Binding::Lexical => lexical = true,
                Binding::Function => function = true,
                Binding::Var => var = true,
            }
        }
    }

    /// A `var` in `scope`, which is a block, or in a block in it, declares the name in every scope up to the function. It
    /// clashes with what `scope` declares.
    fn var_through(
        &mut self,
        scope: Scope<'a>,
        name: crate::ast::Name<'a>,
        here: impl Iterator<Item = Declaration<'a>>,
    ) {
        let Some(hoisted) = scope.variable_scope().get_name(name) else {
            return;
        };
        // `catch (e) { var e }` is allowed.
        let is_simple_catch = |it: Declaration<'a>| {
            it.is_catch_parameter()
                && matches!(it, Declaration::Var(pat) if matches!(pat.parent(), Node::VarDecl(_)))
        };
        let Some(here) = here
            .filter(|&it| !is_simple_catch(it))
            .filter_map(Declaration::name_span)
            .map(|it| it.start)
            .min()
        else {
            return;
        };
        let span = scope.span();
        let vars = hoisted
            .declarations()
            .filter(|&it| Binding::of(it, scope) == Some(Binding::Var));
        let inside = vars
            .filter_map(Declaration::name_span)
            .map(|it| it.start)
            .filter(|&at| span.contains_offset(at))
            .min();
        if let Some(var) = inside {
            self.already_declared(var.max(here));
        }
    }
}

/// `BIND_LEXICAL`, `BIND_FUNCTION`, `BIND_VAR`
#[derive(Copy, Clone, PartialEq, Eq)]
enum Binding {
    Lexical,
    Function,
    Var,
}

impl Binding {
    /// How `declaration`, which is in `scope`, binds its name.
    fn of<'a>(declaration: Declaration<'a>, scope: Scope<'a>) -> Option<Binding> {
        Some(match declaration {
            Declaration::Var(_) if declaration.is_catch_parameter() => Binding::Lexical,
            Declaration::Var(pat) => {
                let declaration = Node::Pat(pat).ancestors().find_map(|it| match it {
                    Node::VarDecl(it) => Some(it),
                    _ => None,
                })?;
                if declaration.var_kind() == VarKind::Var {
                    Binding::Var
                } else {
                    Binding::Lexical
                }
            }
            Declaration::Param(_) => Binding::Var,
            Declaration::Fn(func) => {
                let is_plain = !scope.is_strict() && !func.is_async() && !func.is_generator();
                match (is_plain, Checks::treats_functions_as_var(scope)) {
                    (true, _) => Binding::Function,
                    (false, true) => Binding::Var,
                    (false, false) => Binding::Lexical,
                }
            }
            Declaration::Class(_)
            | Declaration::ImportDefault(_)
            | Declaration::ImportNamespace(_)
            | Declaration::ImportSpec(_) => Binding::Lexical,
            _ => return None,
        })
    }
}
