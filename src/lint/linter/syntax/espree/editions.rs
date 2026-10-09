//! What acorn cannot read in an edition of the language that is older than the code.
//!
//! ESLint 8 has a file read as ES5 unless `parserOptions.ecmaVersion` or an environment says otherwise, and then `let a` is a syntax
//! error. The parser here always reads the latest edition. For each thing that an edition has brought, here is where acorn stumbles
//! without it, and over what: mostly over a token that it has no use for, as it takes `let`, `async` and `of` for names, and `=>`,
//! `**`, `?.` and `??` for two tokens each.
//!
//! An edition is what acorn calls it: 3, 5, 6 for ES2015, up to 15 for ES2024, the last that espree 9 knows.
//!
//! Only the configuration files of ESLint 8 are followed that far.

use super::{Checks, is_module_syntax};
use crate::ast::{
    BinOp, Chain, Expr, ExprKind, ExprTag, File, FnKind, Func, Handle, KeyKind, MemberKind, Node,
    Param, Pat, PatElem, PatKind, PatProp, PatTag, Prop, PropKind, Stmt, StmtKind, StmtTag,
    VarKind,
};
use crate::language::SourceType;
use crate::linter::comment::parse_list_config;
use crate::linter::directives::Label;
use crate::options::Json;
use crate::regex;
use crate::tokens::skip_trivia;
use bun_core::strings;

/// `reservedWords[3]`, each between spaces.
const RESERVED_IN_ES3: &[u8] = b" abstract boolean byte char class double enum export extends final float goto implements import int interface long native package private protected public short static super synchronized throws transient volatile ";

/// `keywords[5]`, each between spaces.
const KEYWORDS_OF_ES5: &[u8] = b" break case catch continue debugger default do else finally for function if return switch throw try var while with null true false instanceof typeof void delete new in this ";

/// The environments that the `/* eslint-env */` comments of `file` name.
fn environments_in_comments<'a>(file: &'a File<'a>) -> Vec<&'a [u8]> {
    if !strings::contains(file.text(), b"eslint-env") {
        return Vec::new();
    }
    let comments = file.config_comments().iter();
    let comments = comments.filter(|it| it.label == Label::Env);
    comments
        .flat_map(|it| parse_list_config(file.slice(it.value)))
        .collect()
}

/// What espree throws about `parserOptions`, before it reads the file.
pub(crate) fn refused_options<'a>(file: &'a File<'a>) -> Option<Vec<u8>> {
    let eslint_8 = file.language().eslint_8.as_deref()?;
    eslint_8.edition(&environments_in_comments(file)).err()
}

/// Whether acorn reads `pat` as an expression first: among the parameters of an arrow function, and after a `let` that it takes
/// for a name.
fn is_read_as_expression(pat: Pat) -> bool {
    let found = Node::Pat(pat).ancestors().find_map(|it| match it {
        Node::Param(param) => Some(param.func().is_some_and(Func::is_arrow)),
        Node::VarDecl(declaration) => Some(
            declaration.var_kind() == VarKind::Let
                && matches!(declaration.parent(), Node::Stmt(list) if matches!(list.kind(), StmtKind::Var(_))),
        ),
        Node::Func(_) | Node::Stmt(_) => Some(false),
        _ => None,
    });
    found == Some(true)
}

/// The statement that is an expression and that starts with `it`.
fn statement_starting_with<'a>(it: Expr<'a>) -> Option<Stmt<'a>> {
    let start = it.span().start;
    let found = Node::Expr(it).ancestors().find_map(|node| match node {
        Node::Expr(outer) if outer.outer_span().start == start => None,
        Node::Stmt(statement)
            if matches!(statement.kind(), StmtKind::Expr(_)) && statement.span().start == start =>
        {
            Some(Some(statement))
        }
        _ => Some(None),
    });
    found.flatten()
}

impl<'a> Checks<'a, '_> {
    /// The errors of acorn for what is newer than the edition that the configuration asks for.
    pub(super) fn editions(&mut self) {
        let file = self.file;
        let Some(eslint_8) = file.language().eslint_8.as_deref() else {
            return;
        };
        // What is wrong with the options is said without a look at the file: `refused_options`.
        let Ok(edition) = eslint_8.edition(&environments_in_comments(file)) else {
            return;
        };
        self.newer_declarations(edition);
        self.newer_statements(edition);
        self.newer_functions(edition);
        self.newer_classes(edition);
        self.newer_properties(edition);
        self.newer_patterns(edition);
        self.newer_operators(edition);
        self.newer_expressions(edition);
        self.newer_imports(edition);
        self.newer_literals(edition);
        self.newer_module_syntax(edition);
        if edition == 3 {
            self.words_of_es3();
        }
    }

    /// The tokenizer makes three tokens of `...` before ES2015.
    fn dots(&mut self, at: u32, edition: u32) {
        match edition < 6 {
            true => self.fail(at, "Unexpected token ."),
            false => self.unexpected(at),
        }
    }

    fn is_outside_functions(&mut self, node: Node<'a>) -> bool {
        !(self.tops.outward(node)).any(|it| matches!(it, Node::Func(_)))
    }

    /// Whether the token before the one at `close`, which closes a list, is a comma.
    fn has_comma_before(&self, close: u32) -> bool {
        self.token_at(self.before_token(close)) == b","
    }

    // ───────────────────────────── statements ─────────────────────────────

    /// `let`, `const`, `using`, `class`, `import`, `export`
    fn newer_declarations(&mut self, edition: u32) {
        let file = self.file;
        for it in file.stmts_of_kind(StmtTag::Var) {
            let StmtKind::Var(list) = it.kind() else {
                continue;
            };
            let (kind, start) = (
                list.first().map(|it| it.var_kind()),
                it.span_without_export().start,
            );
            match kind {
                // Names, which nothing can follow.
                Some(VarKind::Using) => self.unexpected(self.after_token(start)),
                Some(VarKind::AwaitUsing) => {
                    self.unexpected(self.after_token(self.after_token(start)))
                }
                Some(VarKind::Const) if edition == 5 => self.reserved(start),
                Some(VarKind::Const) if edition == 3 => self.unexpected(self.after_token(start)),
                Some(VarKind::Let) if edition < 6 => self.let_as_a_name(it, start, edition),
                _ => {}
            }
        }
        if edition >= 6 {
            return;
        }
        if let Some(first) = file.body().iter().find(is_module_syntax) {
            self.reserved(first.span().start);
        }
        for class in file.classes() {
            self.reserved(class.keyword_span().start);
        }
    }

    /// `it`: a declaration with `let`, which is at `start`.
    fn let_as_a_name(&mut self, it: Stmt<'a>, start: u32, edition: u32) {
        if edition >= 5 && self.is_strict(Node::Stmt(it)) {
            return self.reserved(start);
        }
        let next = self.after_token(start);
        let between = self.file.text().get(start as usize..next as usize);
        let is_on_next_line =
            between.is_some_and(|it| strings::index_of_any(it, b"\n\r").is_some());
        let is_in_head = matches!(it.parent(), Node::Stmt(parent) if parent.is_loop());
        // `let[a] = b` assigns, and a line break ends the statement that is the name.
        if self.token_at(next) != b"[" && (is_in_head || !is_on_next_line) {
            self.unexpected(next);
        }
    }

    /// `for`-`of`, `for await`, `catch` without a parameter
    fn newer_statements(&mut self, edition: u32) {
        let file = self.file;
        if edition >= 13 {
            return;
        }
        for it in file.stmts_of_kind(StmtTag::ForOf) {
            let StmtKind::ForOf { left, is_await, .. } = it.kind() else {
                continue;
            };
            if is_await && (edition < 9 || self.is_outside_functions(Node::Stmt(it))) {
                self.unexpected(self.after_token(it.span().start));
            }
            if edition < 6 {
                self.unexpected(match left.kind() {
                    StmtKind::Expr(target) => target.outer_span().end,
                    _ => left.span().end,
                });
            }
        }
        if edition >= 10 {
            return;
        }
        for it in file.stmts_of_kind(StmtTag::Try) {
            if let StmtKind::Try {
                param: None,
                handler: Some(handler),
                ..
            } = it.kind()
            {
                self.unexpected(handler.span().start);
            }
        }
        if edition >= 6 {
            return;
        }
        for it in file.stmts_of_kind(StmtTag::ForIn) {
            if let StmtKind::ForIn { left, .. } = it.kind()
                && let StmtKind::Expr(target) = left.kind()
            {
                self.pattern_as_target(target, target.outer_span().end);
            }
        }
    }

    /// Before ES2015 a list or an object cannot be assigned to. `noticed`: where what makes `target` a target is.
    fn pattern_as_target(&mut self, target: Expr<'a>, noticed: u32) {
        if matches!(target.kind(), ExprKind::Array(_) | ExprKind::Object(_)) {
            self.when_read_to(noticed, |checks| {
                checks.fail(target.span().start, "Assigning to rvalue")
            });
        }
    }

    // ───────────────────────────── functions ─────────────────────────────

    /// `async`, `function*`, `=>`, and what parameters can be
    fn newer_functions(&mut self, edition: u32) {
        if edition >= 9 {
            return;
        }
        for it in self.file.funcs() {
            match it.kind() {
                FnKind::Decl | FnKind::Expr => {
                    let start = it.estree_span().start;
                    let keyword = match it.is_async() {
                        true => self.after_token(start),
                        false => start,
                    };
                    if it.is_async() && edition < 8 {
                        self.unexpected(keyword);
                    }
                    if it.is_generator() && (edition < 6 || it.is_async()) {
                        self.unexpected(self.after_token(keyword));
                    }
                }
                FnKind::Arrow => self.arrow(it, edition),
                _ => {}
            }
            self.newer_parameters(it, edition);
        }
    }

    fn arrow(&mut self, it: Func<'a>, edition: u32) {
        let Some(arrow) = it.arrow_span() else {
            return;
        };
        let since = if it.is_async() { 8 } else { 6 };
        if edition >= since {
            return;
        }
        let (start, params, close) = (it.estree_span().start, it.params(), it.close_paren());
        let is_a_name = |it: Param<'a>| {
            it.default().is_none() && !it.is_rest() && matches!(it.pat().kind(), PatKind::Ident(_))
        };
        match (params.first(), close) {
            // `async` is a name, which no other can follow.
            (Some(first), None) if it.is_async() => self.unexpected(first.span().start),
            // `async(a)` is a call.
            _ if it.is_async() && edition >= 6 => self.unexpected(arrow.start),
            (None, Some(close)) if !it.is_async() => self.unexpected(close),
            // `a = > b`
            (Some(only), _) if !it.is_async() && params.len() == 1 && is_a_name(only) => {
                self.unexpected(arrow.start + 1)
            }
            _ => self.when_read_to(arrow.start, |checks| {
                checks.fail(start, "Assigning to rvalue")
            }),
        }
    }

    fn newer_parameters(&mut self, it: Func<'a>, edition: u32) {
        let params = it.params();
        if edition < 8
            && !params.is_empty()
            && let Some(close) = it.close_paren()
            && self.has_comma_before(close)
        {
            self.unexpected(close);
        }
        if edition >= 7 {
            return;
        }
        for param in params {
            if param.is_rest() && edition < 6 {
                self.dots(param.span_without_modifiers().start, edition);
            } else if param.is_rest() && !matches!(param.pat().kind(), PatKind::Ident(_)) {
                self.unexpected(param.pat().span().start);
            }
            // That of an arrow function is an assignment.
            if edition < 6
                && !it.is_arrow()
                && let Some(default) = param.default()
            {
                self.unexpected(self.before_token(default.outer_span().start));
            }
        }
    }

    /// `async a() {}`, `*a() {}`. `key`: where the name starts.
    fn method(&mut self, func: Option<Func<'a>>, key: u32, edition: u32) {
        let Some(func) = func else {
            return;
        };
        let is_newer = func.is_async() && edition < 8
            || func.is_generator() && (edition < 6 || func.is_async() && edition < 9);
        if is_newer {
            self.unexpected(match func.is_generator() {
                true => self.before_token(key),
                false => key,
            });
        }
    }

    // ───────────────────────────── classes and objects ─────────────────────────────

    /// Fields, private names, static blocks
    fn newer_classes(&mut self, edition: u32) {
        let file = self.file;
        if !(6..13).contains(&edition) {
            return;
        }
        for class in file.classes() {
            for member in class.members() {
                if member.kind() == MemberKind::StaticBlock {
                    self.unexpected(self.after_token(member.span().start));
                }
                let Some(key) = member.key() else {
                    continue;
                };
                let span = key.span(file);
                if key.is_private() {
                    self.fail(span.start, "Unexpected character '#'");
                }
                // The parameters of a method are expected.
                if member.kind() == MemberKind::Property {
                    self.unexpected(span.end);
                }
                self.method(member.func(), span.start, edition);
            }
        }
    }

    fn newer_properties(&mut self, edition: u32) {
        let file = self.file;
        if edition < 9 {
            file.every_prop(|prop| self.property(prop, edition));
        }
    }

    /// A property of an object literal.
    fn property(&mut self, prop: Prop<'a>, edition: u32) {
        if prop.is_jsx_attribute() || prop.is_import_attribute() {
            return;
        }
        if prop.kind() == PropKind::Spread {
            return self.dots(prop.span().start, edition);
        }
        let Some(key) = prop.key() else {
            return;
        };
        let (kind, span) = (prop.kind(), key.span(self.file));
        self.method(
            prop.func().filter(|_| kind == PropKind::Method),
            span.start,
            edition,
        );
        if edition >= 6 {
            return;
        }
        let is_accessor = matches!(kind, PropKind::Getter | PropKind::Setter);
        if key.is_computed() || is_accessor && edition == 3 {
            self.unexpected(span.start);
        } else if matches!(kind, PropKind::Shorthand | PropKind::Method) {
            self.unexpected(span.end);
        }
    }

    /// What `var`, a parameter and `catch` can declare
    fn newer_patterns(&mut self, edition: u32) {
        let file = self.file;
        if edition >= 9 {
            return;
        }
        for (i, raw) in file.hir.pat_props.iter().enumerate() {
            let it = PatProp::from_raw(file, i as u32);
            if file.pat_in_tree(it.value().id().idx()).is_none() {
                continue;
            }
            let Some(key) = it.key() else {
                self.dots(raw.pos, edition);
                continue;
            };
            if edition < 6 && key.is_computed() {
                self.unexpected(key.span(file).start);
            } else if edition < 6 && it.is_shorthand() {
                self.unexpected(key.span(file).end);
            }
        }
        if edition >= 6 {
            return;
        }
        for (i, raw) in file.hir.pat_elems.iter().enumerate() {
            let pat = PatElem::from_raw(file, i as u32).pat();
            if raw.is_rest && pat.is_some_and(|it| file.pat_in_tree(it.id().idx()).is_some()) {
                self.dots(raw.start, edition);
            }
        }
        for tag in [PatTag::Object, PatTag::Array] {
            for &id in file.pats_of(tag) {
                let pat = Pat::from_raw(file, id);
                if !is_read_as_expression(pat) {
                    self.unexpected(pat.span().start);
                }
            }
        }
    }

    // ───────────────────────────── expressions ─────────────────────────────

    /// `**`, `??`, `?.`, `&&=`, and patterns that are assigned to
    fn newer_operators(&mut self, edition: u32) {
        let (file, text) = (self.file, self.file.text());
        if edition >= 12 {
            return;
        }
        for it in self.exprs_of(ExprTag::Assign) {
            let (ExprKind::Assign { op, target, .. }, Some(operator)) =
                (it.kind(), it.operator_span())
            else {
                continue;
            };
            // How much of the operator is a token of its own.
            let read = match op {
                Some(BinOp::Pow) => (edition < 7).then_some(1),
                Some(BinOp::Nullish) if edition < 11 => Some(1),
                Some(BinOp::Nullish | BinOp::And | BinOp::Or) => Some(2),
                _ => None,
            };
            if let Some(read) = read {
                self.unexpected(operator.start + read);
            }
            if op.is_none() && edition < 6 {
                self.pattern_as_target(target, operator.start);
            }
        }
        if edition >= 11 {
            return;
        }
        if strings::contains(text, b"**") || strings::contains(text, b"??") {
            for it in self.exprs_of(ExprTag::Binary) {
                let is_newer = match it.binary_op() {
                    Some(BinOp::Pow) => edition < 7,
                    op => op == Some(BinOp::Nullish),
                };
                if is_newer && let Some(operator) = it.operator_span() {
                    self.unexpected(operator.start + 1);
                }
            }
        }
        if !strings::contains(text, b"?.") {
            return;
        }
        for tag in [ExprTag::Dot, ExprTag::Index, ExprTag::Call] {
            for it in file.exprs_of_kind(tag) {
                if it.chain() == Chain::Start
                    && let Some(before) = it.object().or_else(|| it.callee())
                {
                    // `a ? .b`
                    let question = skip_trivia(text, before.outer_span().end);
                    self.fail(question + 1, "Unexpected token .");
                }
            }
        }
    }

    /// Templates, `...`, `new.target`, private names, `await` outside of functions, a comma after the last argument
    fn newer_expressions(&mut self, edition: u32) {
        let (file, text) = (self.file, self.file.text());
        if edition >= 13 {
            return;
        }
        if strings::contains_char(text, b'#') {
            for it in self.exprs_of(ExprTag::Dot) {
                if it.is_private_member()
                    && let Some(name) = it.member_name_start()
                {
                    self.fail(name, "Unexpected character '#'");
                }
            }
            for it in self.exprs_of(ExprTag::PrivateIdentifier) {
                self.fail(it.span().start, "Unexpected character '#'");
            }
        }
        if file.language().source_type == SourceType::Module {
            for it in self.exprs_of(ExprTag::Await) {
                if self.is_outside_functions(Node::Expr(it)) {
                    let message = "Cannot use keyword 'await' outside an async function";
                    self.fail(it.span().start, message);
                }
            }
        }
        if edition >= 8 {
            return;
        }
        for tag in [ExprTag::Call, ExprTag::New] {
            for it in file.exprs_of_kind(tag) {
                let (ExprKind::Call(call) | ExprKind::New(call)) = it.kind() else {
                    continue;
                };
                if !call.args().is_empty()
                    && let Some(close) = call.close_paren()
                    && self.has_comma_before(close)
                {
                    self.unexpected(close);
                }
            }
        }
        if edition >= 6 {
            return;
        }
        for it in file.exprs_of_kind(ExprTag::Template) {
            self.fail(it.span().start, "Unexpected character '`'");
        }
        for it in self.exprs_of(ExprTag::TaggedTemplate) {
            if let ExprKind::TaggedTemplate(call) = it.kind()
                && let Some(template) = call.template()
            {
                self.fail(template.span().start, "Unexpected character '`'");
            }
        }
        for it in file.exprs_of_kind(ExprTag::Spread) {
            self.dots(it.span().start, edition);
        }
        for it in self.exprs_of(ExprTag::NewTarget) {
            self.unexpected(self.after_token(it.span().start));
        }
    }

    /// `import()`, `import.meta`
    fn newer_imports(&mut self, edition: u32) {
        let (file, text) = (self.file, self.file.text());
        let is_module = file.language().source_type == SourceType::Module;
        for tag in [ExprTag::ImportCall, ExprTag::ImportMeta] {
            for it in file.exprs_of_kind(tag) {
                let start = it.span().start;
                match statement_starting_with(it) {
                    _ if edition < 6 => self.reserved(start),
                    _ if edition >= 11 => self.second_argument_of_import(it, text),
                    None => self.unexpected(start),
                    // It is taken for a declaration.
                    Some(statement) if !matches!(statement.parent(), Node::File(_)) => self.fail(
                        start,
                        "'import' and 'export' may only appear at the top level",
                    ),
                    Some(_) if is_module => self.unexpected(self.after_token(start)),
                    Some(_) => self.fail(
                        start,
                        "'import' and 'export' may appear only with 'sourceType: module'",
                    ),
                }
            }
        }
    }

    /// `import(a, b)` came with ES2025.
    fn second_argument_of_import(&mut self, it: Expr<'a>, text: &[u8]) {
        let ExprKind::ImportCall { args } = it.kind() else {
            return;
        };
        let mut written = args.iter().filter(|it| !it.is_missing());
        let Some(first) = written.next() else {
            return;
        };
        let comma = skip_trivia(text, first.outer_span().end);
        if text.get(comma as usize) != Some(&b',') {
            return;
        }
        match written.next() {
            Some(_) => self.unexpected(comma),
            None => self.fail(comma, "Trailing comma is not allowed in import()"),
        }
    }

    // ───────────────────────────── literals ─────────────────────────────

    fn newer_literals(&mut self, edition: u32) {
        let (file, text) = (self.file, self.file.text());
        self.newer_regular_expressions(edition);
        if edition >= 12 {
            return;
        }
        for tag in [ExprTag::Number, ExprTag::BigInt] {
            for it in file.exprs_of_kind(tag) {
                let written = file.slice(it.span());
                let has_newer_prefix =
                    edition < 6 && matches!(written, [b'0', b'b' | b'B' | b'o' | b'O', ..]);
                // Where the number ends for the tokenizer.
                let end = match strings::index_of_char_usize(written, b'_') {
                    _ if has_newer_prefix => Some(1),
                    None if edition < 11 && written.ends_with(b"n") => Some(written.len() - 1),
                    separator => separator,
                };
                if let Some(end) = end {
                    let message = "Identifier directly after number";
                    self.fail(it.span().start + end as u32, message);
                }
            }
        }
        let separators = ["\u{2028}".as_bytes(), "\u{2029}".as_bytes()];
        let has_separator = |text: &[u8]| separators.iter().any(|it| strings::contains(text, it));
        let (looks_for_separators, looks_for_braces) = (
            edition < 10 && has_separator(text),
            edition < 6 && strings::contains(text, b"\\u{"),
        );
        if !looks_for_separators && !looks_for_braces {
            return;
        }
        for it in file.exprs_of_kind(ExprTag::String) {
            let written = file.slice(it.span());
            if !matches!(written.first(), Some(b'"' | b'\'')) {
                continue;
            }
            if looks_for_braces && strings::contains(written, b"\\u{") {
                self.fail(it.span().start, "Unexpected token");
            }
            if looks_for_separators && has_separator(written) {
                self.fail(it.span().start, "Unterminated string constant");
            }
        }
    }

    /// `validateRegExpFlags`, `validateRegExpPattern`
    fn newer_regular_expressions(&mut self, edition: u32) {
        let since = |flag: u8| match flag {
            b'u' | b'y' => 6,
            b's' => 9,
            b'd' => 13,
            b'v' => 15,
            _ => 0,
        };
        let year = if edition < 6 { 5 } else { edition + 2009 };
        for it in self.exprs_of(ExprTag::Regex) {
            let ExprKind::Regex(literal) = it.kind() else {
                continue;
            };
            let (pattern, flags, at) = (literal.pattern(), literal.flags(), it.span().start + 1);
            if flags.iter().any(|flag| since(*flag) > edition) {
                self.fail(at, "Invalid regular expression flag");
            } else if let Err(error) = regex::validate_pattern(
                pattern,
                regex::Mode::of_flags(flags),
                regex::Options::ecma_version(year),
                &mut regex::Ignore,
            ) {
                let message = [
                    b"Invalid regular expression: /",
                    pattern,
                    b"/: ",
                    error.reason().as_bytes(),
                ]
                .concat();
                self.fail(at, message);
            }
        }
    }

    // ───────────────────────────── modules ─────────────────────────────

    /// `export * as a`, names in quotes, `with { type: "json" }`
    fn newer_module_syntax(&mut self, edition: u32) {
        let file = self.file;
        if file.language().source_type != SourceType::Module {
            return;
        }
        for it in file.body() {
            let names: Vec<crate::ast::Ident<'a>> = match it.kind() {
                StmtKind::Import(import) => import.named().iter().map(|it| it.imported()).collect(),
                StmtKind::ExportNamed(export) => (export.items().iter())
                    .flat_map(|it| [it.local(), it.exported()])
                    .collect(),
                StmtKind::ExportStar { alias, .. } => {
                    if let Some(alias) = alias.filter(|_| edition < 11) {
                        self.unexpected(self.before_token(alias.start()));
                    }
                    alias.into_iter().collect()
                }
                _ => continue,
            };
            for name in names.iter().filter(|it| edition < 13 && it.is_string()) {
                self.unexpected(name.start());
            }
            // They came with ES2025.
            if let Some(attributes) = it.import_attributes() {
                self.unexpected(attributes.keyword_span().start);
            }
        }
    }

    // ───────────────────────────── ES3 ─────────────────────────────

    /// `checkUnreserved` for the word at `at`.
    fn word_of_es3(&mut self, at: u32) {
        let word = self.token_at(at);
        let spaced = [b" ", word, b" "].concat();
        if strings::contains(KEYWORDS_OF_ES5, &spaced) {
            self.fail(at, [b"Unexpected keyword '", word, b"'"].concat());
        } else if strings::contains(RESERVED_IN_ES3, &spaced) {
            self.reserved(at);
        }
    }

    /// In ES3 more words are reserved, also as the names of properties, and no comma can end an object literal.
    fn words_of_es3(&mut self) {
        let file = self.file;
        for it in file.exprs_of_kind(ExprTag::Object) {
            let close = it.span().end.saturating_sub(1);
            if self.has_comma_before(close) {
                self.unexpected(close);
            }
        }
        if file.language().parser_options.get(b"allowReserved") == Some(&Json::Bool(true)) {
            return;
        }
        for it in file.exprs_of_kind(ExprTag::Ident) {
            self.word_of_es3(it.span().start);
        }
        for it in file.exprs_of_kind(ExprTag::Dot) {
            if let Some(name) = it.member_name_start() {
                self.word_of_es3(name);
            }
        }
        for &id in file.pats_of(PatTag::Ident) {
            self.word_of_es3(Pat::from_raw(file, id).span().start);
        }
        for name in file.funcs().filter_map(Func::name) {
            self.word_of_es3(name.start());
        }
        for it in file.stmts_of_kind(StmtTag::Labeled) {
            self.word_of_es3(it.span().start);
        }
        file.every_prop(|prop| {
            if let Some(key) = prop.key()
                && matches!(key.kind(), KeyKind::Ident(_))
                && !prop.is_jsx_attribute()
            {
                self.word_of_es3(key.span(file).start);
            }
        });
    }
}
