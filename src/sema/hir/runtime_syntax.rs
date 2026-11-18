use super::{
    ClassId, Diagnostic, DiagnosticKind, Expr, ExprFlags, ExprId, ExprKind, File, FileIn, Flags,
    FnBody, FnId, FnKind, IdList, MemberId, MemberKind, ModifierId, ModifierKind, ModuleId,
    ModuleName, NameKind, Node, NodeData, ParamId, PatKind, PatPropId, Prop, PropId, PropKey,
    PropKind, Span, Stmt, StmtId, StmtKind, Storage, VarDeclId, has_body, is_nested_namespace,
};
use crate::atom::{Atom, known};
use crate::file_analysis::has_written_top_level_await;
use bun_core::strings;
use std::ops::Range;

impl<S: Storage> FileIn<S> {
    #[inline]
    pub fn has_typescript_semantics(&self) -> bool {
        !self.is_js
    }

    fn runtime_key(&self, key: PropKey, name_pos: u32) -> PropKey {
        if self.bigint_names.is_empty() {
            return key;
        }
        let names = &self.bigint_names;
        match names.binary_search_by_key(&name_pos, |name| name.0) {
            Ok(at) => PropKey::Name(names[at].1),
            Err(_) => key,
        }
    }

    #[inline]
    pub fn runtime_property_key(&self, p: PropId) -> PropKey {
        self.runtime_key(self[p].key, self[p].pos)
    }

    #[inline]
    pub fn runtime_member_key(&self, m: MemberId) -> PropKey {
        self.runtime_key(self[m].key, self[m].name_pos)
    }

    #[inline]
    pub fn runtime_binding_key(&self, p: PatPropId) -> PropKey {
        self.runtime_key(self[p].key, self[p].key_pos)
    }

    #[inline]
    pub fn runtime_member_kind(&self, m: MemberId) -> MemberKind {
        match self[m].kind {
            MemberKind::Constructor if self[m].flags.contains(Flags::STATIC) => MemberKind::Method,
            kind => kind,
        }
    }

    #[inline]
    pub fn runtime_function_kind(&self, f: FnId) -> FnKind {
        match self[f].kind {
            FnKind::Constructor if self[f].flags.contains(Flags::STATIC) => FnKind::Method,
            kind => kind,
        }
    }

    pub fn directives(
        &self,
        statements: IdList<StmtId>,
    ) -> impl Iterator<Item = (StmtId, Atom)> + '_ {
        self.ids(statements).filter_map(|stmt| {
            match self.stmts.get(stmt.idx()).map(|statement| statement.kind) {
                Some(StmtKind::Directive { raw, .. }) => Some((stmt, raw)),
                _ => None,
            }
        })
    }

    pub fn has_use_strict_directive(&self, body: FnBody) -> bool {
        match body {
            FnBody::None | FnBody::Expr(_) => false,
            FnBody::Block(statements) => {
                (self.directives(statements)).any(|directive| directive.1 == known::use_strict)
            }
        }
    }

    pub fn is_strict_namespace(&self, declaration: ModuleId) -> bool {
        self.modules.get(declaration.idx()).is_some_and(|it| {
            (self.directives(it.body)).any(|directive| directive.1 == known::use_strict)
        })
    }

    pub fn is_erased_statement(&self, stmt: StmtId) -> bool {
        let Some(statement) = self.stmts.get(stmt.idx()) else {
            return false;
        };
        match statement.kind {
            StmtKind::Interface(_) | StmtKind::TypeAlias(_) | StmtKind::ExportAsNamespace(_) => {
                true
            }
            StmtKind::Import(import) => self.is_type_only_import(import),
            StmtKind::ImportEquals(alias) => {
                let erased = Flags::TYPE_ONLY | Flags::AMBIENT;
                (self.import_equals.get(alias.idx())).is_some_and(|it| it.flags.intersects(erased))
            }
            StmtKind::ExportNamed(export) => self.is_type_only_export(export),
            StmtKind::ExportStar { type_only, .. } => type_only,
            StmtKind::Var(declarations) => {
                let is_ambient = |it: VarDeclId| self[it].flags.contains(Flags::AMBIENT);
                !declarations.is_empty() && declarations.iter().all(is_ambient)
            }
            StmtKind::Fn(function) => (self.fns.get(function.idx()))
                .is_some_and(|it| it.flags.contains(Flags::AMBIENT) || !has_body(it)),
            StmtKind::Class(class) => {
                (self.classes.get(class.idx())).is_some_and(|it| it.flags.contains(Flags::AMBIENT))
            }
            StmtKind::Enum(enumeration) => (self.enums.get(enumeration.idx()))
                .is_some_and(|it| it.flags.contains(Flags::AMBIENT)),
            StmtKind::Module(module) => {
                (self.modules.get(module.idx())).is_some_and(|it| it.is_erased)
            }
            _ => false,
        }
    }

    pub fn erases_namespace(&self, flags: Flags, body: IdList<StmtId>) -> bool {
        let mut is_prologue = true;
        flags.intersects(Flags::AMBIENT | Flags::REPARSED)
            || self.ids(body).all(|statement| {
                let is_dropped_directive = is_prologue && self.is_dropped_directive(statement);
                is_prologue &= is_dropped_directive || self.is_erased_statement(statement);
                is_dropped_directive || !self.is_kept_in_namespace(statement)
            })
    }

    fn is_dropped_directive(&self, statement: StmtId) -> bool {
        let Some(&Stmt {
            kind: StmtKind::Expr(written) | StmtKind::Directive { expr: written, .. },
            start,
            ..
        }) = self.stmts.get(statement.idx())
        else {
            return false;
        };
        let text = self.skip_type_assertions(written);
        let not_directive = ExprFlags::PARENTHESIZED | ExprFlags::TEMPLATE_LITERAL;
        match self.exprs.get(text.idx()) {
            Some(&Expr {
                kind: ExprKind::String(value),
                pos,
                end,
            }) if pos == start && !self.expr_flags(text).intersects(not_directive) => {
                // With an escape it has the value of a directive, but is another text.
                let is_as_long_as_written = end - pos == b"'use strict'".len() as u32;
                value == known::use_asm || (value == known::use_strict && !is_as_long_as_written)
            }
            _ => false,
        }
    }

    fn is_kept_in_namespace(&self, statement: StmtId) -> bool {
        let Some(kind) = self.stmts.get(statement.idx()).map(|it| it.kind) else {
            return true;
        };
        let is_member =
            |flags: Flags| !flags.contains(Flags::AMBIENT) || flags.contains(Flags::EXPORT);
        match kind {
            StmtKind::Empty => false,
            StmtKind::ImportEquals(alias) => {
                !self.is_erased_statement(statement)
                    && (self.import_equals.get(alias.idx()))
                        .is_none_or(|it| it.flags.contains(Flags::EXPORT))
            }
            StmtKind::Var(declarations) => declarations.iter().any(|it| is_member(self[it].flags)),
            StmtKind::Fn(function) => self.fns.get(function.idx()).is_none_or(|it| {
                is_member(it.flags) && (has_body(it) || it.flags.contains(Flags::AMBIENT))
            }),
            StmtKind::Class(class) => {
                (self.classes.get(class.idx())).is_none_or(|it| is_member(it.flags))
            }
            StmtKind::Enum(enumeration) => {
                (self.enums.get(enumeration.idx())).is_none_or(|it| is_member(it.flags))
            }
            StmtKind::Module(inner) => {
                self.modules.get(inner.idx()).is_none_or(|it| !it.is_erased)
                    || is_nested_namespace(self, statement)
            }
            _ => !self.is_erased_statement(statement),
        }
    }

    pub fn only_declares(&self) -> bool {
        let mut statements = self.ids(self.body);
        self.has_typescript_semantics()
            && statements.len() != 0
            && statements.all(|statement| self.is_erased_statement(statement))
    }

    pub fn declares_beside_code(&self) -> bool {
        self.has_typescript_semantics()
            && self
                .ids(self.body)
                .any(|statement| self.is_erased_statement(statement))
    }

    /// `IsExternalModule`, asked for a `declare module "m"` or a `declare global` at the top of the file. A script for its
    /// project declares the modules that it names, though a build runs the file as a module.
    pub fn is_module_for(&self, name: ModuleName) -> bool {
        self.has_module_syntax && !self.declares_as_script(name)
    }

    pub fn declares_as_script(&self, name: ModuleName) -> bool {
        self.is_script_for_project && matches!(name, ModuleName::String(_))
    }

    pub fn set_strict_by_syntax(&mut self) {
        self.is_strict = true;
        self.is_strict_by_syntax = true;
        for function in self.fns.iter_mut() {
            function.is_strict = true;
            function.is_strict_by_syntax = true;
        }
    }
}

impl<S: Storage> FileIn<S> {
    /// The first of `marks`, the sorted starts of the legacy HTML comment marks, that lies between two tokens of a JSX tag and in no expression of it. Every reader refuses a mark there.
    pub fn find_mark_between_tokens_of_jsx_tag(&self, marks: &[u32]) -> Option<u32> {
        let mut found: Option<u32> = None;
        for element in self.exprs.iter() {
            let ExprKind::Jsx(jsx) = element.kind else {
                continue;
            };
            let jsx = &self[jsx];
            let is_in_expression_of = |tag: (u32, u32), mark: u32| {
                let is_around = |(from, to): (u32, u32)| from < mark && mark < to;
                let mut braces = self.jsx_expressions.iter().map(|it| (it.1, it.2));
                let mut spreads = jsx.attrs.iter().map(|attribute| &self[attribute]);
                braces.any(|it| tag.0 < it.0 && it.1 <= tag.1 && is_around(it))
                    || spreads
                        .any(|it| it.kind == PropKind::Spread && is_around((it.start, it.end)))
            };
            for tag in [(element.pos, jsx.opening_end), (jsx.close_pos, jsx.end)] {
                let first = marks.partition_point(|&mark| mark <= tag.0);
                let in_tag = marks[first..].iter().take_while(|&&mark| mark < tag.1);
                let between_tokens = in_tag
                    .copied()
                    .find(|&mark| !is_in_expression_of(tag, mark));
                found = match (found, between_tokens) {
                    (Some(found), Some(mark)) => Some(found.min(mark)),
                    (found, mark) => found.or(mark),
                };
            }
        }
        found
    }
}

/// "Invalid character."
pub const INVALID_CHARACTER: u32 = 1127;

/// Where the legacy HTML comment mark starts that ends at `end` in `text`: `<!--` or `-->`.
fn find_html_comment_mark(text: &[u8], end: u32) -> u32 {
    let is_open = text
        .get(..end as usize)
        .is_some_and(|it| it.ends_with(b"<!--"));
    end.saturating_sub(if is_open { 4 } else { 3 })
}

/// Who reads a text of a compiled file when the program starts under `bun run`, and so gives the early errors of that text.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Reader {
    /// The parser of `bun run`. What it prints holds none of the forms that only sloppy mode code has, so it alone reports them: in a module that `import`, `export` or a top-level `await` proves, under a `"use strict"` directive and in a class. A file that only runs as a module is sloppy mode code to it.
    ParserOfBunRun,
    /// JavaScriptCore reads the text as it is written: a file that `bun build` wrote, and a text that the program evaluates. To it a module is strict mode code.
    Engine,
}

impl File<'_> {
    /// `bun run` hands the text at `pos` to the engine as it is written.
    pub fn stands_as_written(&self, pos: u32) -> bool {
        find_transpiled_mark(&self.text).is_some() || self.is_in_known_evaluation(pos)
    }

    pub fn reader_at(&self, pos: u32) -> Reader {
        match self.stands_as_written(pos) {
            true => Reader::Engine,
            false => Reader::ParserOfBunRun,
        }
    }

    /// True if all of the file is strict mode code to `reader`.
    pub fn is_strict_file_to(&self, reader: Reader) -> bool {
        match reader {
            Reader::ParserOfBunRun => self.is_strict_by_syntax || self.is_proved_module,
            Reader::Engine => self.is_strict,
        }
    }

    /// True if the code of `function` is strict mode code to `reader`. False says nothing of the file around it.
    pub fn is_strict_function_to(&self, function: FnId, reader: Reader) -> bool {
        self.fns.get(function.idx()).is_some_and(|it| match reader {
            Reader::ParserOfBunRun => it.is_strict_by_syntax,
            Reader::Engine => it.is_strict,
        })
    }

    /// True if `node` is strict mode code to `reader`.
    pub fn is_strict_to(&self, node: Node, reader: Reader) -> bool {
        let class = self.get_containing_class_excluding_class_decorators(node);
        if self.is_strict_file_to(reader) || class.is_some() {
            return true;
        }
        let function = self.function_of(self.get_containing_function(node));
        let is_strict_namespace = |ancestor: Node| match self.data(ancestor) {
            NodeData::Stmt(statement) => {
                matches!(self[statement].kind, StmtKind::Module(it) if self.is_strict_namespace(it))
            }
            _ => false,
        };
        self.is_strict_function_to(function, reader)
            || self.find_ancestor(node, is_strict_namespace).is_some()
    }

    /// True if `node` is strict mode code to the one that reads its text. A form that only sloppy mode code has is an early error there, and nowhere else.
    pub fn is_strict_to_its_reader(&self, node: Node) -> bool {
        self.is_strict_to(node, self.reader_at(self.start(node)))
    }

    /// Where the first legacy HTML comment mark of the text is, if it has one that is not reported yet. It starts a comment, and the one that knows whether the file is a module says whether that is an error.
    #[inline]
    pub fn legacy_html_comment(&self) -> Option<(u32, u32)> {
        match self.html_comment_end {
            0 => None,
            end => Some((find_html_comment_mark(&self.text, end), end)),
        }
    }

    /// For a compiled text, right after its parse: a top-level `await` makes the file a module for the parser of `bun run` too, and the legacy HTML comment of such a module is reported.
    #[inline]
    pub fn judge_as_parsed_by_bun_run(&mut self, text: &[u8]) {
        if !self.is_proved_module && self.has_top_level_await() {
            self.is_proved_module = has_written_top_level_await(self);
        }
        if self.html_comment_end != 0 {
            self.report_html_comment_of_proved_module(text);
        }
    }

    #[cold]
    #[inline(never)]
    fn report_html_comment_of_proved_module(&mut self, text: &[u8]) {
        if !self.is_proved_module || find_transpiled_mark(text).is_some() {
            return;
        }
        // A parse error, as the mark was when the lexer reported it.
        let end = self.html_comment_end;
        let at = (find_html_comment_mark(text, end), end);
        let error = Diagnostic::new(DiagnosticKind::Parse, at, INVALID_CHARACTER, &[]);
        self.diagnostics.to_mut().push(error);
        self.has_parse_diagnostics = true;
        self.html_comment_end = 0;
    }

    /// `Function` makes sloppy functions in strict code too.
    pub fn makes_sloppy_functions(&self) -> bool {
        self.known_evaluations
            .iter()
            .any(|it| it.is_in_global_scope)
    }

    pub fn set_strict(&mut self) {
        self.is_strict = true;
        let evaluations = &self.known_evaluations[..];
        let is_made_by_function = |start: u32| {
            let count = evaluations.partition_point(|it| it.start <= start);
            let evaluation = evaluations[..count].last();
            evaluation.is_some_and(|it| it.is_in_global_scope && start < it.end)
        };
        for function in self.fns.iter_mut() {
            function.is_strict |= !is_made_by_function(function.start);
        }
    }

    pub fn reset_strict(&mut self) {
        self.is_strict = self.is_strict_by_syntax;
        for function in self.fns.iter_mut() {
            function.is_strict = function.is_strict_by_syntax;
        }
    }
}

pub fn is_proto_setter(property: &Prop) -> bool {
    let is_literal_name = matches!(
        property.name_kind,
        NameKind::Identifier | NameKind::StringLiteral
    );
    is_literal_name
        && property.kind == PropKind::Init
        && property.key == PropKey::Name(known::__proto__)
}

pub fn has_runtime_member(hir: &File, member: MemberId) -> bool {
    let node = hir[member];
    let is_declaration_only = node.flags.intersects(Flags::AMBIENT | Flags::ABSTRACT);
    match node.kind {
        MemberKind::Property => {
            let is_field = !node.flags.contains(Flags::ACCESSOR);
            !is_declaration_only || (is_field && has_decorator(hir, node.modifiers))
        }
        MemberKind::StaticBlock => !is_declaration_only,
        MemberKind::Method | MemberKind::Getter | MemberKind::Setter | MemberKind::Constructor => {
            !is_declaration_only && hir.fns.get(node.func.idx()).is_some_and(has_body)
        }
        MemberKind::CallSignature | MemberKind::ConstructSignature | MemberKind::IndexSignature => {
            false
        }
    }
}

pub fn find_runtime_constructor(hir: &File, class: ClassId) -> Option<MemberId> {
    hir[class].members.iter().find(|&member| {
        has_runtime_member(hir, member)
            && hir.runtime_member_kind(member) == MemberKind::Constructor
    })
}

pub fn parameter_properties(hir: &File, constructor: FnId) -> impl Iterator<Item = ParamId> {
    hir[constructor].params.iter().filter(move |&parameter| {
        let node = hir[parameter];
        node.flags.contains(Flags::PARAMETER_PROPERTY)
            && matches!(hir[node.pat].kind, PatKind::Ident(_))
    })
}

pub fn find_super_call_statement(hir: &File, constructor: FnId) -> Option<(StmtId, ExprId)> {
    let FnBody::Block(statements) = hir[constructor].body else {
        return None;
    };
    hir.ids(statements).find_map(|statement| {
        if let StmtKind::Expr(expression) = hir[statement].kind
            && let ExprKind::Call(call) = hir[expression].kind
            && matches!(hir[hir[call].callee].kind, ExprKind::Super)
        {
            return Some((statement, expression));
        }
        None
    })
}

const TRANSPILED_MARK: &[u8] = b"// @bun";

pub fn find_transpiled_mark(text: &[u8]) -> Option<Range<usize>> {
    let end_of_line = |start: usize| {
        let length = strings::index_of_char_usize(&text[start..], b'\n')?;
        Some(start + length + 1)
    };
    let start = match text.starts_with(b"#!") {
        true => end_of_line(0)?,
        false => 0,
    };
    text[start..]
        .starts_with(TRANSPILED_MARK)
        .then(|| start..end_of_line(start).unwrap_or(text.len()))
}

pub fn is_marked_as_commonjs(mark: &[u8]) -> bool {
    let mut rest = &mark[TRANSPILED_MARK.len()..];
    while let Some(at) = strings::index_of_char_usize(rest, b'@') {
        let word = &rest[at + 1..];
        if word.starts_with(b"bun-cjs") {
            return true;
        }
        let passed = match word.starts_with(b"bytecode") {
            true => b"bytecode".len() + 1,
            false => 1,
        };
        rest = word.get(passed..).unwrap_or_default();
    }
    false
}

pub fn is_moved_to_file_start(hir: &File, statement: StmtId) -> bool {
    let can_move = match hir[statement].kind {
        StmtKind::Class(class) => can_move_class(hir, class),
        StmtKind::ExportDefault(value) => can_move_expression(hir, value),
        _ => false,
    };
    can_move && find_transpiled_mark(&hir.text).is_none()
}

fn can_move_class(hir: &File, class: ClassId) -> bool {
    let node = hir[class];
    node.extends.is_none()
        && !has_decorator(hir, node.modifiers)
        && node
            .members
            .iter()
            .all(|member| can_move_member(hir, member))
}

fn can_move_member(hir: &File, member: MemberId) -> bool {
    let node = hir[member];
    if has_decorator(hir, node.modifiers) {
        return false;
    }
    if !has_runtime_member(hir, member) {
        return true;
    }
    let parameters = node
        .func
        .some()
        .map_or(Span::EMPTY, |function| hir[function].params);
    let has_bracketed_name = hir.text.get(node.name_pos as usize) == Some(&b'[');
    if node.kind == MemberKind::StaticBlock
        || has_bracketed_name
        || parameters
            .iter()
            .any(|parameter| has_decorator(hir, hir.param_modifiers(parameter)))
    {
        return false;
    }
    let is_static_field = node.kind == MemberKind::Property && node.flags.contains(Flags::STATIC);
    !is_static_field || node.init.is_none() || can_move_expression(hir, node.init)
}

fn can_move_expression(hir: &File, expression: ExprId) -> bool {
    match hir[hir.skip_type_assertions(expression)].kind {
        ExprKind::Class(class) => can_move_class(hir, class),
        ExprKind::Template { exprs } => exprs.is_empty(),
        ExprKind::Fn(_)
        | ExprKind::Number(_)
        | ExprKind::True
        | ExprKind::False
        | ExprKind::Null
        | ExprKind::BigInt(_)
        | ExprKind::String(_)
        | ExprKind::ImportMeta => true,
        _ => false,
    }
}

fn has_decorator(hir: &File, modifiers: Span<ModifierId>) -> bool {
    modifiers
        .iter()
        .any(|modifier| matches!(hir[modifier].kind, ModifierKind::Decorator(_)))
}
