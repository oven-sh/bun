//! From the statements as the parse pass left them (nothing bound, folded or dropped) to `bun_sema::hir`.

use super::clone_types::PendingPart;
use super::jsdoc::Comments;
use super::reparse::Host;
use super::type_syntax::{Builder, Modified};
use super::{CastKind, ExprKey, Mark, TypeSyntax};
use crate::p::P;
use bun_ast::expr::Data;
use bun_ast::stmt::Data as StmtData;
use bun_ast::ts_syntax as ts;
use bun_ast::{self as ast, B, Expr, G, OpCode, S, Stmt, StmtOrExpr};
use bun_collections::HashMap;
use bun_sema::atom::{Atom, Interner};
use bun_sema::hir::{self, *};
use smallvec::SmallVec;

pub(crate) struct Lower<'p, 'a> {
    pub(super) b: Builder<'a>,
    pub(super) p: &'p P<'a, true, false>,
    /// Sorted.
    marks: Vec<(i32, Mark, i32)>,
    /// A bit for each place in the source, set where something in `marks` is noted from. At hardly any place something is.
    mark_starts: Vec<u64>,
    /// `TypeSyntax::modifier_lists`, sorted by where the statement is. Of a statement that was parsed more than once, the last attempt
    /// comes last.
    modifier_lists: Vec<(i32, ts::Span<ts::Modifier>)>,
    /// What the lists being lowered have so far, the innermost list last: ids, variables, parameters, properties.
    list_ids: Vec<u32>,
    list_decls: Vec<VarDecl>,
    list_params: Vec<Param>,
    list_props: Vec<Prop>,
    /// What is made of an expression, from the inside out.
    casts: HashMap<ExprKey, SmallVec<[(CastKind, i32); 2]>>,
    /// A bit for each place in the source, set where an expression in `casts` starts. Hardly any expression is in there.
    cast_starts: Vec<u64>,
    /// `hir::File::expr_ends`
    expr_ends: HashMap<ExprKey, i32>,
    kept_expressions: HashMap<i32, Vec<Expr>>,
    pub(super) source: &'a [u8],
    stack_check: bun_core::StackCheck,
    /// The JSDoc comments of a JavaScript file. None for TypeScript.
    pub(super) jsdoc: std::rc::Rc<Comments>,
    /// Which of them belong to a node.
    pub(super) jsdoc_is_attached: Vec<bool>,
    /// `reparseList`: the statements made of JSDoc tags, until the list of statements they go into takes them.
    pub(super) reparsed: Vec<StmtId>,
    /// The same for the overload signatures of the member of a class that was lowered last.
    pub(super) reparsed_members: Vec<Member>,
    /// The modifiers JSDoc tags give that member, and where the tags are.
    pub(super) member_modifiers: Vec<(Flags, u32)>,
    /// `parsingContexts&(1<<PCObjectLiteralMembers)`: how many object literals what is being lowered is written in.
    pub(super) object_literals_around: u32,
    /// The functions that have a `FullSignature`.
    pub(super) full_signatures: bun_collections::HashMap<u32, ()>,
    /// The functions whose `@param` tags were compared with their parameters.
    pub(super) documented_functions: bun_collections::HashMap<u32, ()>,
}

fn pos_of(loc: ast::Loc) -> u32 {
    loc.start.max(0) as u32
}

/// `SkipTrivia`: from `at`, past blanks and comments.
pub(super) fn skip_trivia(text: &[u8], mut at: usize) -> usize {
    loop {
        while text.get(at).is_some_and(u8::is_ascii_whitespace) {
            at += 1;
        }
        let rest = text.get(at..).unwrap_or_default();
        if rest.starts_with(b"/*") {
            at += bun_core::strings::index_of(&rest[2..], b"*/").map_or(rest.len(), |end| end + 4);
        } else if rest.starts_with(b"//") {
            at += bun_core::strings::index_of_char_usize(rest, b'\n').unwrap_or(rest.len());
        } else {
            return at.min(text.len());
        }
    }
}

impl<'p, 'a> Lower<'p, 'a> {
    pub(crate) fn run(
        p: &'p mut P<'a, true, false>,
        syntax: TypeSyntax,
        stmts: &[Stmt],
        atoms: &'a Interner,
        lexer: crate::lexer::Lexer<'a>,
    ) -> hir::File {
        // `withJSDoc`: only in JavaScript is anything made of the tags.
        let (syntax, jsdoc) = if p.lexer.is_javascript_file() {
            super::jsdoc::read_comments(p, syntax)
        } else {
            (syntax, Comments::default())
        };
        Self::run_on(p, syntax, Some(stmts), atoms, lexer, false, jsdoc)
    }

    /// For a `.d.ts` file. The parser's statements are not used yet: `type_syntax::Builder` reads the statements from the source and
    /// takes the type nodes the parser kept.
    /// `has_syntax_errors`: the parser logged syntax errors. If the file cannot be read without going on from them, the result says
    /// `has_parse_diagnostics` and the caller reports them.
    pub(crate) fn run_declaration_file(
        p: &'p P<'a, true, false>,
        syntax: TypeSyntax,
        atoms: &'a Interner,
        lexer: crate::lexer::Lexer<'a>,
        has_syntax_errors: bool,
    ) -> hir::File {
        Self::run_on(
            p,
            syntax,
            None,
            atoms,
            lexer,
            has_syntax_errors,
            Comments::default(),
        )
    }

    fn run_on(
        p: &'p P<'a, true, false>,
        syntax: TypeSyntax,
        stmts: Option<&[Stmt]>,
        atoms: &'a Interner,
        lexer: crate::lexer::Lexer<'a>,
        has_syntax_errors: bool,
        jsdoc: Comments,
    ) -> hir::File {
        let mut marks = syntax.marks;
        marks.sort_unstable();
        marks.dedup();
        let mut mark_starts = vec![0u64; p.source.contents().len() / 64 + 1];
        for &(from, ..) in &marks {
            if let Some(word) = mark_starts.get_mut(from as u32 as usize / 64) {
                *word |= 1 << (from as u32 % 64);
            }
        }
        let mut modifier_lists = syntax.modifier_lists;
        modifier_lists.sort_by_key(|list| list.0);
        let mut casts: HashMap<ExprKey, SmallVec<[(CastKind, i32); 2]>> = HashMap::default();
        let mut cast_starts = vec![0u64; p.source.contents().len() / 64 + 1];
        for (key, kind, ty) in syntax.casts {
            if let Some(word) = cast_starts.get_mut(key.start as u32 as usize / 64) {
                *word |= 1 << (key.start as u32 % 64);
            }
            let list = casts.entry(key).or_default();
            // An attempt that was abandoned and made again says everything twice.
            if !list.contains(&(kind, ty)) || kind == CastKind::NonNull {
                list.push((kind, ty));
            }
        }
        // Of what was parsed more than once, the last attempt counts.
        let mut expr_ends: HashMap<ExprKey, i32> = HashMap::default();
        for (key, end) in syntax.expr_ends {
            expr_ends.insert(key, end);
        }
        let mut b = Builder::new(lexer, atoms);
        b.comments = p.lexer.all_comments.clone();
        b.ts = syntax.ast;
        b.kept = syntax.by_offset;
        b.ambient_statements = syntax.ambient_statements;
        b.ambient_statements.sort_by_key(|statement| statement.0);
        b.ambient_initializers = syntax.ambient_initializers;
        b.ambient_initializers
            .sort_by_key(|initializer| initializer.0);
        let mut this = Lower {
            b,
            p,
            marks,
            mark_starts,
            modifier_lists,
            list_ids: Vec::new(),
            list_decls: Vec::new(),
            list_params: Vec::new(),
            list_props: Vec::new(),
            casts,
            cast_starts,
            expr_ends,
            kept_expressions: syntax.kept_expressions,
            source: p.source.contents(),
            stack_check: bun_core::StackCheck::init(),
            jsdoc_is_attached: vec![false; jsdoc.list.len()],
            jsdoc: std::rc::Rc::new(jsdoc),
            reparsed: Vec::new(),
            reparsed_members: Vec::new(),
            member_modifiers: Vec::new(),
            object_literals_around: 0,
            full_signatures: Default::default(),
            documented_functions: Default::default(),
        };
        this.b.file.source_len = this.source.len() as u32;
        let Some(stmts) = stmts else {
            this.b.declaration_file(false);
            if this.b.file.has_errors && has_syntax_errors {
                this.b.start_over();
                this.b.declaration_file(true);
                this.b.file.has_parse_diagnostics = true;
            }
            this.fill_in_pending_parts();
            this.b.file.parens.sort_unstable_by_key(|p| p.0.0);
            return this.b.file;
        };
        this.b.file.kind = if p.is_jsx_enabled() {
            FileKind::Tsx
        } else {
            FileKind::Ts
        };
        this.b.scan_references();
        let body = this.stmts(stmts, true);
        this.b.file.after_skipped = this
            .marks
            .iter()
            .filter(|mark| mark.1 == Mark::SkippedToken)
            .map(|mark| mark.2 as u32)
            .collect();
        this.b.file.after_skipped.sort_unstable();
        this.b.file.after_skipped.dedup();
        let stray_decorators = this
            .marks
            .iter()
            .filter(|mark| mark.1 == Mark::StrayDecorator)
            .map(|mark| (mark.0 as u32, mark.2 as u32));
        this.b.file.stray_decorators.extend(stray_decorators);
        this.b.file.unclosed_literals = this
            .marks
            .iter()
            .filter(|mark| mark.1 == Mark::UnclosedLiteral)
            .map(|mark| (mark.0 as u32, mark.2 as u32))
            .collect();
        this.b.file.body = body;
        // `checkImportAttributes`
        for (with_keyword, attributes) in syntax.import_attributes {
            let attributes = this.expr(&attributes);
            this.b
                .file
                .import_attributes
                .push((with_keyword.max(0) as u32, attributes));
        }
        // `parseModuleSpecifier`. An attempt that was abandoned and made again says everything twice, and nothing is made of a
        // comment that belongs to no node.
        let mut specifiers = syntax.specifier_expressions;
        specifiers.dedup_by_key(|specifier| specifier.loc.start);
        for specifier in &specifiers {
            let pos = pos_of(specifier.loc);
            let is_dropped = this
                .jsdoc
                .list
                .iter()
                .zip(&this.jsdoc_is_attached)
                .any(|(doc, &is_attached)| !is_attached && (doc.start..doc.end).contains(&pos));
            if !is_dropped {
                let specifier = this.expr(specifier);
                this.b.file.specifier_expressions.push(specifier);
            }
        }
        this.fill_in_pending_parts();
        this.b.file.parens.sort_unstable_by_key(|p| p.0.0);
        this.finish_jsdoc();
        this.b.file
    }

    /// Converts the expressions and function bodies that are written inside types. Converting one can clone more types, which can add
    /// more parts.
    fn fill_in_pending_parts(&mut self) {
        while let Some(part) = self.b.pending.pop() {
            match part {
                PendingPart::MemberKey(member, name) => self.fill_in_computed_key(member, &name),
                PendingPart::MemberInitializer(member, initializer) => {
                    let initializer = self.expr(&initializer);
                    self.b.file.members[member.idx()].init = initializer;
                }
                PendingPart::FunctionBody(func, body) => {
                    let body = FnBody::Block(self.stmts(body.stmts.slice(), false));
                    self.b.file.fns[func.idx()].body = body;
                }
                PendingPart::PatternKey(property, key) => {
                    let key = self.key(&key, true);
                    self.b.file.pat_props[property.idx()].key = key;
                }
                PendingPart::ParamDefault(param, default) => {
                    let default = self.expr(&default);
                    self.b.file.params[param.idx()].default = default;
                }
                PendingPart::PatternPropertyDefault(property, default) => {
                    let default = self.expr(&default);
                    self.b.file.pat_props[property.idx()].default = default;
                }
                PendingPart::PatternElementDefault(element, default) => {
                    let default = self.expr(&default);
                    self.b.file.pat_elems[element.idx()].default = default;
                }
                PendingPart::HeritageExpression(node) => {
                    let at = ast::Loc {
                        start: self.b.file[node].pos as i32,
                    };
                    if let Some(expression) = self.kept_expressions(at).first() {
                        let expression = self.expr(expression);
                        self.b.file[node].kind = TypeNodeKind::Heritage(expression);
                    }
                }
            }
        }
        let mut filled_in_any = false;
        while let Some((placeholder, statement)) = self.b.pending_statements.pop() {
            self.fill_in_ambient_statement(placeholder, &statement);
            filled_in_any = true;
        }
        while let Some((decl, initializer)) = self.b.pending_initializers.pop() {
            let initializer = self.expr(&initializer);
            self.b.file.var_decls[decl.idx()].init = initializer;
            filled_in_any = true;
        }
        if filled_in_any {
            self.fill_in_pending_parts();
        }
    }

    /// Turns the empty statement `placeholder` into `statement`, which the parser read there in an ambient context.
    fn fill_in_ambient_statement(&mut self, placeholder: StmtId, statement: &Stmt) {
        let Some(lowered) = self.stmt(statement) else {
            return;
        };
        let kind = self.b.file[lowered].kind;
        self.b.file.set_stmt_kind(placeholder, kind);
        // Nothing refers to `lowered` yet.
        if lowered.idx() + 1 == self.b.file.stmts.len() {
            self.b.file.stmts.pop();
        } else {
            self.b.file.stmts[lowered.idx()].kind = StmtKind::Empty;
        }
    }

    // ───────────────────────────── what the parser noted ─────────────────────────────

    #[inline]
    fn mark(&self, from: ast::Loc, what: Mark) -> Option<u32> {
        // Outside the source there is no telling.
        let start = from.start as u32;
        if self
            .mark_starts
            .get(start as usize / 64)
            .is_some_and(|word| word & 1 << (start % 64) == 0)
        {
            return None;
        }
        self.find_mark(from, what)
    }

    fn find_mark(&self, from: ast::Loc, what: Mark) -> Option<u32> {
        let at = self
            .marks
            .partition_point(|&(f, w, _)| (f, w) < (from.start, what));
        match self.marks.get(at) {
            Some(&(f, w, to)) if f == from.start && w == what => Some(to as u32),
            _ => None,
        }
    }

    fn marks_from(&self, from: ast::Loc, what: Mark) -> Vec<u32> {
        let at = self
            .marks
            .partition_point(|&(f, w, _)| (f, w) < (from.start, what));
        self.marks[at..]
            .iter()
            .take_while(|&&(f, w, _)| f == from.start && w == what)
            .map(|&(_, _, to)| to as u32)
            .collect()
    }

    /// The type that starts at `at`, after any whitespace and comments.
    fn type_at(&mut self, at: u32) -> TypeNodeId {
        let kept = self
            .b
            .kept
            .types
            .get(&(skip_trivia(self.source, at as usize) as i32))
            .map(|kept| kept.node);
        match kept {
            Some(ty) => self.b.clone_type(ty),
            None => self.b.type_at(at),
        }
    }

    /// `<T>(x)` was first parsed as the type parameters of an arrow function and turned out to be a cast. Builds the cast's type from
    /// the single type parameter. `after_less_than` is the offset right after the `<`.
    fn cast_type_from_type_params(&mut self, after_less_than: u32) -> Option<TypeNodeId> {
        let params = self
            .b
            .kept
            .type_parameters
            .get(&(after_less_than.checked_sub(1)? as i32))?
            .node;
        let &[param] = &self.b.ts[params] else {
            return None;
        };
        let kind = match super::keep::keyword_type(&param.name) {
            Some(_) => return Some(self.b.clone_keyword_type(&param.name, param.loc)),
            None => {
                let name = self.b.atoms.intern(&param.name);
                TypeNodeKind::Ref {
                    name: self.b.file.list(&[name]),
                    args: IdList::EMPTY,
                }
            }
        };
        Some(self.b.file.ty(kind, pos_of(param.loc)))
    }

    /// The type arguments whose `<` is at `at`.
    fn type_args_at(&mut self, at: u32) -> IdList<TypeNodeId> {
        let kept = self
            .b
            .kept
            .type_arguments
            .get(&(at as i32))
            .map(|kept| kept.node);
        match kept {
            Some(arguments) => self.b.clone_type_list(arguments),
            None => self.b.type_args_at(at),
        }
    }

    /// The type parameters whose `<` is at `at`.
    fn type_params_at(&mut self, at: u32) -> Span<TypeParamId> {
        let kept = self
            .b
            .kept
            .type_parameters
            .get(&(at as i32))
            .map(|kept| kept.node);
        match kept {
            Some(parameters) => self.b.clone_type_params(parameters),
            None => self.b.type_params_at(at),
        }
    }

    /// The return type at `at`, or after the `:` there.
    fn return_type_at(&mut self, at: u32) -> TypeNodeId {
        let start = if self.source.get(at as usize) == Some(&b':') {
            skip_trivia(self.source, at as usize + 1) as u32
        } else {
            at
        };
        let kept = self.b.kept.types.get(&(start as i32)).map(|kept| kept.node);
        match kept {
            Some(ty) => self.b.clone_type(ty),
            None => self.b.return_type_at(at),
        }
    }

    fn annotation(&mut self, binding: ast::Loc) -> TypeNodeId {
        match self.mark(binding, Mark::Annotation) {
            Some(at) => self.type_at(at),
            None => TypeNodeId::NONE,
        }
    }

    fn name(&self, r: ast::Ref) -> Atom {
        self.b.atom(self.p.load_name_from_ref(r))
    }

    fn string(&self, s: &ast::E::EString) -> Atom {
        if s.next.is_some() {
            return self.b.atom(b"");
        }
        if s.is_utf8() {
            return self.b.atom(s.slice8());
        }
        self.b.atom(&crate::lexer::utf16_to_wtf8(s.slice16()))
    }

    // ───────────────────────────── statements ─────────────────────────────

    fn stmts(&mut self, stmts: &[Stmt], is_top_level: bool) -> IdList<StmtId> {
        let base = self.list_ids.len();
        // An `export` in a namespace makes no module of the file, from wherever it is parsed.
        let was_module = self.b.file.has_module_syntax;
        let outer_reparsed = std::mem::take(&mut self.reparsed);
        for stmt in stmts {
            if is_top_level
                && matches!(
                    stmt.data,
                    StmtData::SImport(_)
                        | StmtData::SExportClause(_)
                        | StmtData::SExportDefault(_)
                        | StmtData::SExportEquals(_)
                        | StmtData::SExportFrom(_)
                        | StmtData::SExportStar(_)
                )
            {
                self.b.file.has_module_syntax = true;
            }
            let id = self.stmt(stmt);
            // `parseListIndex`: what was made of JSDoc tags while the statement was parsed goes before it.
            self.list_reparsed();
            if let Some(id) = id {
                if is_top_level && self.is_exported(id) {
                    self.b.file.has_module_syntax = true;
                }
                self.list_ids.push(id.0);
            }
        }
        if is_top_level {
            // `parseSourceFileWorker`: the end of the file has comments as well.
            self.with_jsdoc(self.source.len() as u32, false, &mut Host::Other);
            self.dropped_statement_jsdoc();
            self.list_reparsed();
        }
        self.reparsed = outer_reparsed;
        if !is_top_level {
            self.b.file.has_module_syntax = was_module;
        }
        self.take_ids(base)
    }

    /// Moves what is in `reparsed` to the list of statements being lowered.
    #[inline]
    fn list_reparsed(&mut self) {
        if !self.reparsed.is_empty() {
            self.list_ids
                .extend(self.reparsed.drain(..).map(|statement| statement.0));
        }
    }

    /// Makes a list of what is in `list_ids` from `base` on, and takes it off.
    fn take_ids<T>(&mut self, base: usize) -> IdList<T> {
        let start = self.b.file.ids.len() as u32;
        self.b.file.ids.extend_from_slice(&self.list_ids[base..]);
        let len = (self.list_ids.len() - base) as u32;
        self.list_ids.truncate(base);
        IdList::new(start, len)
    }

    /// `parseList(PCSwitchClauseStatements)`: the type aliases and imports made of JSDoc tags go on to the list around the `switch`.
    fn clause_stmts(&mut self, stmts: &[Stmt]) -> IdList<StmtId> {
        if self.jsdoc.list.is_empty() {
            return self.stmts(stmts, false);
        }
        let was_module = self.b.file.has_module_syntax;
        let mut passed_on = std::mem::take(&mut self.reparsed);
        let mut out = Vec::with_capacity(stmts.len());
        for stmt in stmts {
            let id = self.stmt(stmt);
            for reparsed in std::mem::take(&mut self.reparsed) {
                match self.b.file[reparsed].kind {
                    StmtKind::TypeAlias(_) | StmtKind::Import(_) => passed_on.push(reparsed),
                    _ => out.push(reparsed),
                }
            }
            out.extend(id);
        }
        self.reparsed = passed_on;
        self.b.file.has_module_syntax = was_module;
        self.b.file.list(&out)
    }

    fn is_exported(&self, id: StmtId) -> bool {
        let f = &self.b.file;
        let flags = match f[id].kind {
            StmtKind::Var(decls) => decls.iter().next().map_or(Flags::empty(), |d| f[d].flags),
            StmtKind::Fn(x) => f[x].flags,
            StmtKind::Class(x) => f[x].flags,
            StmtKind::Interface(x) => f[x].flags,
            StmtKind::TypeAlias(x) => f[x].flags,
            StmtKind::Enum(x) => f[x].flags,
            StmtKind::Module(x) => f[x].flags,
            // `import a = b.c` gives another name to what is there already: no module for that.
            StmtKind::ImportEquals(x) if !matches!(f[x].target, ImportEqualsTarget::Require(_)) => {
                f[x].flags
            }
            StmtKind::ImportEquals(_)
            | StmtKind::Import(_)
            | StmtKind::ExportNamed(_)
            | StmtKind::ExportStar { .. } => {
                return true;
            }
            _ => Flags::empty(),
        };
        flags.contains(Flags::EXPORT)
    }

    fn block(&mut self, stmts: &[Stmt], loc: ast::Loc) -> StmtId {
        let list = self.stmts(stmts, false);
        let block = self.b.file.stmt(StmtKind::Block(list), pos_of(loc));
        self.finish_stmt(block, pos_of(loc))
    }

    fn required_stmt(&mut self, stmt: &Stmt) -> StmtId {
        match self.stmt(stmt) {
            Some(id) => id,
            None => {
                let empty = self.b.file.stmt(StmtKind::Empty, pos_of(stmt.loc));
                self.finish_stmt(empty, pos_of(stmt.loc))
            }
        }
    }

    /// `finishNode`, of the statement `id`, whose first token is at `start`. A block whose `{` is missing takes no room.
    fn finish_stmt(&mut self, id: StmtId, start: u32) -> StmtId {
        let pos = self.b.full_start_of(start);
        let from = ast::Loc {
            start: start as i32,
        };
        let end = self.mark(from, Mark::StatementEnd).unwrap_or(pos);
        let stmt = &mut self.b.file[id];
        (stmt.start, stmt.loc) = (start, TextRange { pos, end });
        id
    }

    /// What the parser has no more than a placeholder for, or less than everything of: parsed again from the source.
    fn reparse(&mut self, loc: ast::Loc) -> Option<StmtId> {
        let stmt = self.b.statement_at(pos_of(loc), Flags::empty());
        if stmt.is_none() {
            self.b.file.syntax_errors += 1;
        }
        stmt
    }

    /// Clones a statement that only exists in TypeScript.
    fn ts_statement(&mut self, id: ts::StatementId, start: u32) -> Option<StmtId> {
        let ts::Statement {
            data,
            modifiers,
            loc,
        } = self.b.ts[id];
        let (flags, export_pos) = self.b.clone_statement_modifiers(modifiers);
        // A statement starts at its decorators or at `export`, but not at `declare`.
        let has_decorators = self.source.get(start as usize) == Some(&b'@');
        let pos = if has_decorators {
            start
        } else {
            export_pos.unwrap_or_else(|| pos_of(loc))
        };
        let statement = match data {
            ts::StatementData::Interface(interface) => {
                self.b.clone_interface(interface, flags, pos)
            }
            ts::StatementData::TypeAlias(alias) => Some(self.b.clone_type_alias(alias, flags, pos)),
        };
        if statement.is_none() {
            self.b.file.syntax_errors += 1;
        }
        statement
    }

    fn stmt(&mut self, stmt: &Stmt) -> Option<StmtId> {
        let id = self.stmt_without_jsdoc(stmt);
        if let Some(id) = id {
            self.finish_stmt(id, self.declaration_start(stmt.loc));
            self.statement_modifiers(stmt.loc, id);
        }
        // `S::Comment`, a comment kept for the printer, is no node. The parser puts it where the next statement starts.
        if !self.jsdoc.list.is_empty() && !matches!(stmt.data, StmtData::SComment(_)) {
            self.statement_jsdoc(stmt, id);
        }
        id
    }

    /// Gives the statement `id`, which the parser says is at `loc`, the modifiers the parser took for it.
    fn statement_modifiers(&mut self, loc: ast::Loc, id: StmtId) {
        let after = self
            .modifier_lists
            .partition_point(|list| list.0 <= loc.start);
        let list = match after.checked_sub(1).map(|last| self.modifier_lists[last]) {
            Some((at, list)) if at == loc.start => list,
            _ => return,
        };
        self.b.statement_modifiers.clear();
        for modifier in list.iter() {
            let ts::Modifier { flag, loc } = self.b.ts[modifier];
            self.b.statement_modifiers.push(Modifier {
                kind: ModifierKind::Keyword(Flags::from_bits_retain(flag.bits())),
                pos: pos_of(loc),
            });
        }
        self.b.take_statement_modifiers(id, 0);
    }

    /// `withJSDoc`, of the statement `stmt`, which was lowered to `id`.
    fn statement_jsdoc(&mut self, stmt: &Stmt, id: Option<StmtId>) {
        let start = self.declaration_start(stmt.loc);
        let mut host = match id.map(|id| (id, self.b.file[id].kind)) {
            Some((_, StmtKind::Var(decls))) => Host::VariableStatement(decls),
            // `parseExpressionOrLabeledStatement`: what starts with a parenthesis leaves the comment to that.
            Some((_, StmtKind::Expr(_))) if self.source.get(start as usize) == Some(&b'(') => {
                return;
            }
            Some((id, StmtKind::Expr(_))) => Host::ExpressionStatement(id),
            Some((id, StmtKind::Return(_))) => Host::ReturnStatement(id),
            Some((_, StmtKind::Fn(func))) => Host::Function(func),
            Some((_, StmtKind::Class(class))) => Host::Class(class),
            Some((id, StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_))) => {
                Host::ExportAssignment(id)
            }
            _ => Host::Other,
        };
        self.with_jsdoc(start, false, &mut host);
    }

    /// Where the first token of the statement or the class expression that is said to be at `loc` is: its decorators and modifiers are
    /// part of it.
    fn declaration_start(&self, loc: ast::Loc) -> u32 {
        self.mark(loc, Mark::DeclarationStart)
            .unwrap_or_else(|| pos_of(loc))
    }

    /// The initializer of a `for` statement, which is no statement: a comment before it belongs to nothing.
    fn for_initializer(&mut self, stmt: &Stmt) -> StmtId {
        let id = match self.stmt_without_jsdoc(stmt) {
            Some(id) => id,
            None => self.b.file.stmt(StmtKind::Empty, pos_of(stmt.loc)),
        };
        self.finish_stmt(id, pos_of(stmt.loc))
    }

    fn stmt_without_jsdoc(&mut self, stmt: &Stmt) -> Option<StmtId> {
        if !self.stack_check.is_safe_to_recurse() {
            self.b.file.syntax_errors += 1;
            return None;
        }
        let pos = pos_of(stmt.loc);
        let start = self.declaration_start(stmt.loc);
        self.b.statement_start = start;
        let kind = match &stmt.data {
            StmtData::STypeScript(placeholder) if placeholder.syntax.is_some() => {
                return self.ts_statement(placeholder.syntax, pos);
            }
            // The `B` of `namespace A.B { }` that the parser dropped: its placeholder is at the dot.
            StmtData::STypeScript(_) if self.source.get(pos as usize) == Some(&b'.') => {
                let module = self.b.nested_module_at(pos);
                if module.is_none() {
                    self.b.file.syntax_errors += 1;
                }
                return module;
            }
            StmtData::STypeScript(_)
            | StmtData::SImport(_)
            | StmtData::SExportClause(_)
            | StmtData::SExportFrom(_)
            | StmtData::SExportStar(_) => return self.reparse(stmt.loc),
            StmtData::SLocal(local) if local.origin.is_ts_import_equals() => {
                // `export import a = b` is said to be where `import` is.
                let before = self.b.lexer.contents[..pos as usize].trim_ascii_end();
                if local.is_export && before.ends_with(b"export") {
                    return self.reparse(ast::Loc {
                        start: (before.len() - 6) as i32,
                    });
                }
                if local.is_export {
                    // `parseDeclaration`: `export public import a = b`. Other modifiers stand between `export` and `import`.
                    let statement = self.b.statement_at(pos, Flags::EXPORT);
                    if statement.is_none() {
                        self.b.file.syntax_errors += 1;
                    }
                    return statement;
                }
                return self.reparse(stmt.loc);
            }
            // `export declare var a = 1` in a namespace: the parser keeps `export var a` of it, put where `declare` is.
            StmtData::SLocal(local)
                if self.source[pos as usize..]
                    .strip_prefix(b"declare")
                    .is_some_and(|rest| rest.first().is_some_and(u8::is_ascii_whitespace)) =>
            {
                let before = self.source[..pos as usize].trim_ascii_end();
                let whole = if before.ends_with(b"export") {
                    self.b
                        .statement_at((before.len() - 6) as u32, Flags::empty())
                } else {
                    self.b.statement_at(pos, Flags::EXPORT)
                };
                match whole {
                    Some(id) => return Some(id),
                    // An initializer the parser of declarations does not know: the names, at least.
                    None => self.local(local, stmt.loc),
                }
            }
            StmtData::SDirective(directive) => {
                let text = self.b.atom(directive.value.slice());
                self.b.file.directives.push((pos, text));
                return None;
            }
            StmtData::SComment(_)
            | StmtData::SEmpty(_)
            | StmtData::SDebugger(_)
            | StmtData::SLazyExport(_) => return None,
            StmtData::SBlock(s) => StmtKind::Block(self.stmts(s.stmts.slice(), false)),
            StmtData::SExpr(s) => StmtKind::Expr(self.expr(&s.value)),
            StmtData::SLocal(s) => self.local(s, stmt.loc),
            StmtData::SReturn(s) => StmtKind::Return(self.optional_expr(s.value.as_ref())),
            StmtData::SThrow(s) => StmtKind::Throw(self.expr(&s.value)),
            StmtData::SIf(s) => {
                let test = self.expr(&s.test);
                let yes = self.required_stmt(&s.yes);
                let no =
                    s.no.as_ref()
                        .map_or(StmtId::NONE, |no| self.required_stmt(no));
                StmtKind::If { test, yes, no }
            }
            StmtData::SFor(s) => {
                let init = s
                    .init
                    .as_ref()
                    .map_or(StmtId::NONE, |init| self.for_initializer(init));
                let test = self.optional_expr(s.test.as_ref());
                let update = self.optional_expr(s.update.as_ref());
                let body = self.required_stmt(&s.body);
                StmtKind::For {
                    init,
                    test,
                    update,
                    body,
                }
            }
            StmtData::SForIn(s) => {
                let left = self.for_initializer(&s.init);
                let expr = self.expr(&s.value);
                let body = self.required_stmt(&s.body);
                StmtKind::ForIn { left, expr, body }
            }
            StmtData::SForOf(s) => {
                let left = self.for_initializer(&s.init);
                let expr = self.expr(&s.value);
                let body = self.required_stmt(&s.body);
                // `parseForOrForInOrForOfStatement`: `await` after `for` makes it one wherever it stands. The parser forgets the
                // one it objects to.
                let is_await = s.is_await
                    || self.source[skip_trivia(self.source, pos as usize + 3)..]
                        .starts_with(b"await");
                StmtKind::ForOf {
                    left,
                    expr,
                    body,
                    is_await,
                }
            }
            StmtData::SWhile(s) => {
                let test = self.expr(&s.test);
                let body = self.required_stmt(&s.body);
                StmtKind::While { test, body }
            }
            StmtData::SDoWhile(s) => {
                let body = self.required_stmt(&s.body);
                let test = self.expr(&s.test);
                StmtKind::DoWhile { body, test }
            }
            StmtData::SSwitch(s) => {
                let expr = self.expr(&s.test);
                let mut cases = Vec::with_capacity(s.cases.slice().len());
                for case in s.cases.slice() {
                    let test = self.optional_expr(case.value.as_ref());
                    let body = self.clause_stmts(case.body.slice());
                    // The parser does not say where a clause starts: back from what follows the keyword.
                    let text = self.b.lexer.contents;
                    let pos = match (&case.value, case.body.slice().first()) {
                        (Some(value), _) => {
                            let before = text[..pos_of(value.loc) as usize].trim_ascii_end();
                            let before = before
                                .strip_suffix(b"(")
                                .map_or(before, <[u8]>::trim_ascii_end);
                            if before.ends_with(b"case") {
                                before.len() as u32 - 4
                            } else {
                                pos_of(value.loc)
                            }
                        }
                        (None, Some(first)) => {
                            let before = text[..pos_of(first.loc) as usize].trim_ascii_end();
                            match before.strip_suffix(b":").map(<[u8]>::trim_ascii_end) {
                                Some(rest) if rest.ends_with(b"default") => rest.len() as u32 - 7,
                                _ => pos_of(first.loc),
                            }
                        }
                        (None, None) => 0,
                    };
                    // `parseCaseClause`, `parseDefaultClause`
                    self.with_jsdoc(pos, false, &mut Host::Other);
                    cases.push(Case { test, body, pos });
                }
                StmtKind::Switch {
                    expr,
                    cases: self.b.file.add_cases(&cases),
                }
            }
            StmtData::STry(s) => {
                let block = self.block(s.body.slice(), s.body_loc);
                let mut param = VarDeclId::NONE;
                let mut handler = StmtId::NONE;
                if let Some(catch) = &s.catch {
                    if let Some(binding) = &catch.binding {
                        let pat = self.binding(binding);
                        let ty = self.annotation(binding.loc);
                        let init = self.optional_expr(self.kept_expressions(binding.loc).first());
                        param = self.b.file.add_var_decl(VarDecl {
                            pat,
                            ty,
                            init,
                            kind: VarKind::Let,
                            flags: Flags::empty(),
                        });
                        let start = pos_of(binding.loc);
                        self.with_jsdoc(start, true, &mut Host::VariableDeclaration(param));
                    }
                    handler = self.block(catch.body.slice(), catch.body_loc);
                }
                let finalizer = match &s.finally {
                    Some(finally) => {
                        let block = self.block(finally.stmts.slice(), finally.loc);
                        // It is put at the keyword, which is the token before it.
                        self.b.file[block].loc.pos = pos_of(finally.loc) + b"finally".len() as u32;
                        block
                    }
                    None => StmtId::NONE,
                };
                StmtKind::Try {
                    block,
                    param,
                    handler,
                    finalizer,
                }
            }
            StmtData::SLabel(s) => {
                let label = self.name(s.name.ref_);
                let body = self.required_stmt(&s.stmt);
                StmtKind::Labeled { label, body }
            }
            StmtData::SWith(s) => {
                let value = self.expr(&s.value);
                let value = self.b.file.stmt(StmtKind::Expr(value), pos);
                // The expression, which the `)` follows.
                self.b.file[value].loc = TextRange {
                    pos: self.b.full_start_of(pos_of(s.value.loc)),
                    end: self.b.full_start_of(pos_of(s.body_loc)),
                };
                let body = self.required_stmt(&s.body);
                // `parseWithStatement`: `NodeFlagsInWithStatement` is on the statement, not on what is in the parentheses.
                let start = pos_of(s.body_loc) + 1;
                let end = self.b.file[body].loc.end;
                self.b.file.with_bodies.push((start, end));
                StmtKind::Block(self.b.file.list(&[value, body]))
            }
            StmtData::SBreak(s) => {
                StmtKind::Break(s.label.as_ref().map_or(Atom::NONE, |l| self.name(l.ref_)))
            }
            StmtData::SContinue(s) => {
                StmtKind::Continue(s.label.as_ref().map_or(Atom::NONE, |l| self.name(l.ref_)))
            }
            StmtData::SFunction(s) => {
                let mut flags = Flags::empty();
                if s.func.flags.contains(ast::flags::Function::IsExport) {
                    flags |= Flags::EXPORT;
                }
                StmtKind::Fn(self.func(&s.func, FnKind::Decl, flags, pos, start))
            }
            StmtData::SClass(s) => {
                let flags = if s.is_export {
                    Flags::EXPORT
                } else {
                    Flags::empty()
                };
                StmtKind::Class(self.class(&s.class, flags, pos, start))
            }
            StmtData::SExportDefault(s) => match &s.value {
                StmtOrExpr::Expr(e) => StmtKind::ExportDefault(self.expr(e)),
                StmtOrExpr::Stmt(inner) => match &inner.data {
                    StmtData::SFunction(f) => StmtKind::Fn(self.func(
                        &f.func,
                        FnKind::Decl,
                        Flags::EXPORT | Flags::DEFAULT,
                        pos,
                        start,
                    )),
                    StmtData::SClass(c) => StmtKind::Class(self.class(
                        &c.class,
                        Flags::EXPORT | Flags::DEFAULT,
                        pos,
                        start,
                    )),
                    _ => return self.stmt(inner),
                },
            },
            StmtData::SExportEquals(s) => StmtKind::ExportAssign(self.expr(&s.value)),
            StmtData::SEnum(s) => {
                let mut members = Vec::with_capacity(s.values.slice().len());
                for value in s.values.slice() {
                    let init = self.optional_expr(value.value.as_ref());
                    let member_pos = pos_of(value.loc);
                    // `HasDynamicName`: `[e]` declares nothing.
                    let computed_name =
                        self.optional_expr(self.kept_expressions(value.loc).first());
                    let name = if computed_name.is_some() {
                        Atom::NONE
                    } else {
                        self.b.atom(value.name.slice())
                    };
                    members.push(EnumMember {
                        name,
                        computed_name,
                        init,
                        pos: member_pos,
                    });
                }
                let members = self.b.file.add_enum_members(&members);
                let mut flags = if s.is_export {
                    Flags::EXPORT
                } else {
                    Flags::empty()
                };
                if self.source[pos as usize..].starts_with(b"const")
                    || self.source[pos as usize..].starts_with(b"export const")
                {
                    flags |= Flags::CONST;
                }
                StmtKind::Enum(self.b.file.add_enum(Enum {
                    name: self.name(s.name.ref_),
                    name_pos: pos_of(s.name.loc),
                    flags,
                    members,
                    stmt: StmtId::NONE,
                }))
            }
            StmtData::SNamespace(s) => {
                let body = self.stmts(s.stmts.slice(), false);
                let name_pos = pos_of(s.name.loc);
                // `parseAmbientExternalModuleDeclaration`: `module "a" { .. }` without `declare`. The parser's symbol is not named by the string.
                let is_quoted = matches!(self.source.get(name_pos as usize), Some(b'"' | b'\''));
                let quoted_name = if is_quoted {
                    self.b.string_at(name_pos)
                } else {
                    Atom::NONE
                };
                StmtKind::Module(self.b.file.add_module(Module {
                    name: if quoted_name.is_some() {
                        ModuleName::String(quoted_name)
                    } else {
                        ModuleName::Ident(self.name(s.name.ref_))
                    },
                    name_pos,
                    flags: if s.is_export {
                        Flags::EXPORT
                    } else {
                        Flags::empty()
                    },
                    body,
                    has_body: true,
                    stmt: StmtId::NONE,
                }))
            }
        };
        Some(self.b.file.stmt(kind, pos))
    }

    fn local(&mut self, s: &S::Local, loc: ast::Loc) -> StmtKind {
        let mut kind = match s.kind {
            S::Kind::KVar => VarKind::Var,
            S::Kind::KLet => VarKind::Let,
            S::Kind::KConst => VarKind::Const,
            S::Kind::KUsing => VarKind::Using,
            S::Kind::KAwaitUsing => VarKind::AwaitUsing,
        };
        // `export declare let a` in a namespace: the parser makes an `export var a` of it, put where `declare` is.
        let mut is_ambient = false;
        if let Some(rest) = self.source[pos_of(loc) as usize..].strip_prefix(b"declare")
            && rest.first().is_some_and(u8::is_ascii_whitespace)
        {
            is_ambient = true;
            let rest = rest.trim_ascii_start();
            kind = if rest.starts_with(b"const") {
                VarKind::Const
            } else if rest.starts_with(b"let") {
                VarKind::Let
            } else {
                VarKind::Var
            };
        }
        let base = self.list_decls.len();
        for decl in s.decls.iter() {
            let mut flags = if s.is_export {
                Flags::EXPORT
            } else {
                Flags::empty()
            };
            if is_ambient {
                flags |= Flags::AMBIENT;
            }
            if self.mark(decl.binding.loc, Mark::Definite).is_some() {
                flags |= Flags::DEFINITE;
            }
            let pat = self.binding(&decl.binding);
            let ty = self.annotation(decl.binding.loc);
            let init = self.optional_expr(decl.value.as_ref());
            self.list_decls.push(VarDecl {
                pat,
                ty,
                init,
                kind,
                flags,
            });
        }
        let decls = self.b.file.add_var_decls(&self.list_decls[base..]);
        self.list_decls.truncate(base);
        // `parseVariableDeclarationWorker`
        if !self.jsdoc.list.is_empty() {
            for (id, decl) in decls.iter().zip(s.decls.iter()) {
                let start = pos_of(decl.binding.loc);
                self.with_jsdoc(start, true, &mut Host::VariableDeclaration(id));
            }
        }
        StmtKind::Var(decls)
    }

    // ───────────────────────────── bindings ─────────────────────────────

    fn binding(&mut self, binding: &ast::Binding) -> PatId {
        let pos = pos_of(binding.loc);
        if !self.stack_check.is_safe_to_recurse() {
            return self.b.file.pat(PatKind::Missing, pos);
        }
        let kind = match &binding.data {
            // `createMissingIdentifier`: a name of no length, where the token before it ends.
            B::B::BMissing(_) => {
                let name = self.b.atom(b"");
                let end_of_previous_token =
                    self.source[..pos as usize].trim_ascii_end().len() as u32;
                return self.b.file.pat(PatKind::Ident(name), end_of_previous_token);
            }
            B::B::BIdentifier(id) => PatKind::Ident(self.name(id.r#ref)),
            B::B::BArray(array) => {
                let items = array.items();
                let mut elems = Vec::with_capacity(items.len());
                // `[... /* comment */ a]`
                let last_is_rest = array.has_spread
                    && !items
                        .iter()
                        .any(|item| self.has_dots_before(item.binding.loc));
                for (i, item) in items.iter().enumerate() {
                    // `parseArrayBindingElement`: each element has its own `...`.
                    let is_rest = array.has_spread
                        && (self.has_dots_before(item.binding.loc)
                            || last_is_rest && i + 1 == items.len());
                    // `[a, , b]`: only an element that is left out has no name. It is said to be where its comma is.
                    let is_hole = matches!(item.binding.data, B::B::BMissing(_))
                        && !is_rest
                        && item.default_value.is_none()
                        && self.source.get(pos_of(item.binding.loc) as usize) == Some(&b',');
                    let pat = if is_hole {
                        self.b.file.pat(PatKind::Missing, pos_of(item.binding.loc))
                    } else {
                        self.binding(&item.binding)
                    };
                    let default = self.optional_expr(item.default_value.as_ref());
                    elems.push(PatElem {
                        pat,
                        default,
                        is_rest,
                        start: if is_rest {
                            self.dots_before(item.binding.loc)
                        } else {
                            self.b.file[pat].pos
                        },
                    });
                }
                PatKind::Array(self.b.file.add_pat_elems(&elems))
            }
            B::B::BObject(object) => {
                let mut props = Vec::with_capacity(object.properties().len());
                for property in object.properties() {
                    let is_rest = property.flags.contains(ast::flags::Property::IsSpread);
                    let is_computed = property.flags.contains(ast::flags::Property::IsComputed);
                    let has_name = !matches!(property.key.data, Data::EMissing(_));
                    let key = if has_name {
                        self.key(&property.key, is_computed)
                    } else {
                        PropKey::None
                    };
                    let value = self.binding(&property.value);
                    let default = self.optional_expr(property.default_value.as_ref());
                    let key_pos = if !has_name {
                        pos_of(property.value.loc)
                    } else if is_computed {
                        self.start_of_computed_name(&property.key)
                    } else {
                        pos_of(property.key.loc)
                    };
                    let pos = if is_rest {
                        self.dots_before(ast::Loc {
                            start: key_pos as i32,
                        })
                    } else {
                        key_pos
                    };
                    props.push(PatProp {
                        key,
                        value,
                        default,
                        is_rest,
                        pos,
                        key_pos,
                    });
                }
                PatKind::Object(self.b.file.add_pat_props(&props))
            }
        };
        self.b.file.pat(kind, pos)
    }

    /// Whether `...` is the token before `at`. A comment in between hides it.
    fn has_dots_before(&self, at: ast::Loc) -> bool {
        self.source[..pos_of(at) as usize]
            .trim_ascii_end()
            .ends_with(b"...")
    }

    /// Where the `...` is that is the token before `at`.
    fn dots_before(&self, at: ast::Loc) -> u32 {
        bun_core::strings::last_index_of(&self.source[..pos_of(at) as usize], b"...")
            .map_or(pos_of(at), |dots| dots as u32)
    }

    /// `createMissingIdentifier`: whether `binding` stands for a name that is not written.
    fn is_missing_name(&self, binding: &ast::Binding) -> bool {
        match &binding.data {
            B::B::BMissing(_) => true,
            B::B::BIdentifier(id) => self.p.load_name_from_ref(id.r#ref).is_empty(),
            _ => false,
        }
    }

    /// Sets the key of an object type member that the parser kept with `[name]` still as an expression.
    fn fill_in_computed_key(&mut self, member: MemberId, name: &Expr) {
        let key = self.key(name, true);
        let file = &mut self.b.file;
        let member = &mut file.members[member.idx()];
        member.key = key;
        if matches!((&name.data, key), (Data::EString(_), PropKey::Name(_))) {
            member.flags |= Flags::STRING_NAME;
        }
        if member.func.is_some() {
            let (func, flags) = (member.func, member.flags);
            file.fns[func.idx()].name = key.name().unwrap_or(Atom::NONE);
            file.fns[func.idx()].flags = flags;
        }
    }

    fn key(&mut self, key: &Expr, is_computed: bool) -> PropKey {
        // `IsDynamicName`: in brackets only a literal by itself is a name. `["a" as T]`, `[<T>"a"]`, `["a"!]` and `[("a")]` are
        // worked out.
        if is_computed
            && matches!(key.data, Data::EString(_) | Data::ENumber(_))
            && self.casts.contains_key(&ExprKey::of(key))
        {
            return PropKey::Computed(self.expr(key));
        }
        match &key.data {
            Data::EString(s) => PropKey::Name(self.string(s)),
            Data::ENumber(n) => PropKey::Name(self.b.number_name(n.value())),
            Data::EPrivateIdentifier(id) => PropKey::Private(self.name(id.ref_)),
            _ if is_computed => {
                let expr = self.expr(key);
                self.b.computed_key(expr)
            }
            // Only for a binding pattern, where a bigint is no index type (2538). As it is written, `0n` does not find `0`.
            Data::EBigInt(n) => PropKey::Name(self.b.atom(&[n.value.slice(), &b"n"[..]].concat())),
            _ => PropKey::None,
        }
    }

    /// `parseComputedPropertyName`: the name `[key]` starts at its bracket. Between that and where `key` is said to be there can be
    /// parentheses and the `<T>` of assertions.
    fn start_of_computed_name(&self, key: &Expr) -> u32 {
        let mut at = pos_of(key.loc);
        if let Some(casts) = self.casts.get(&ExprKey::of(key)) {
            for &(kind, to) in casts.iter() {
                // `<T>e`: the type comes before the expression.
                if kind == CastKind::As
                    && (to as u32) < at
                    && let Some(less_than) =
                        bun_core::strings::last_index_of_char(&self.source[..to as usize], b'<')
                {
                    at = less_than as u32;
                }
            }
        }
        let mut before = self.source[..at as usize].trim_ascii_end();
        while let Some(rest) = before.strip_suffix(b"(") {
            before = rest.trim_ascii_end();
        }
        if before.ends_with(b"[") {
            before.len() as u32 - 1
        } else {
            pos_of(key.loc)
        }
    }

    // ───────────────────────────── functions and classes ─────────────────────────────

    fn params(&mut self, args: &[G::Arg], has_rest: bool) -> Span<ParamId> {
        let base = self.list_params.len();
        let mut decorators: Vec<(usize, ExprId)> = Vec::new();
        // `(... /* comment */ a)`
        let last_is_rest =
            has_rest && !args.iter().any(|arg| self.has_dots_before(arg.binding.loc));
        for (i, arg) in args.iter().enumerate() {
            let mut flags = Flags::empty();
            // A missing name took no token. What is noted at its place is about the parameter after it, and the dots before both are its own.
            let took_nothing = self.is_missing_name(&arg.binding)
                && args
                    .get(i + 1)
                    .is_some_and(|next| next.binding.loc == arg.binding.loc);
            let dots_are_taken = i > 0
                && self.is_missing_name(&args[i - 1].binding)
                && self
                    .source
                    .get(pos_of(args[i - 1].binding.loc) as usize..pos_of(arg.binding.loc) as usize)
                    .is_some_and(|between| between.trim_ascii().is_empty());
            // `parseParameterEx`: each parameter has its own `...`.
            if has_rest
                && !dots_are_taken
                && (self.has_dots_before(arg.binding.loc) || last_is_rest && i + 1 == args.len())
            {
                flags |= Flags::REST;
            }
            if !took_nothing && self.mark(arg.binding.loc, Mark::Optional).is_some() {
                flags |= Flags::OPTIONAL;
            }
            let mut pos = pos_of(arg.binding.loc);
            if flags.contains(Flags::REST) {
                pos = self.dots_before(arg.binding.loc);
            } else if self.is_missing_name(&arg.binding) {
                // The parameter starts at its first token, which is the one after the empty name.
                pos = skip_trivia(self.source, pos as usize) as u32;
            }
            // 1187 or 1317
            let mut parameter_property_error = None;
            if arg.is_typescript_ctor_field {
                const PROPERTY_MODIFIERS: Flags = Flags::PUBLIC
                    .union(Flags::PRIVATE)
                    .union(Flags::PROTECTED)
                    .union(Flags::READONLY)
                    .union(Flags::OVERRIDE);
                // Which modifiers it has: the words before it.
                let mut before = self.b.lexer.contents[..pos as usize].trim_ascii_end();
                let mut modifiers: Vec<(Flags, u32)> = Vec::new();
                let mut seen = Flags::empty();
                loop {
                    let word_start = before
                        .iter()
                        .rposition(|b| !b.is_ascii_alphabetic())
                        .map_or(0, |i| i + 1);
                    let modifier = match &before[word_start..] {
                        b"public" => Flags::PUBLIC,
                        b"private" => Flags::PRIVATE,
                        b"protected" => Flags::PROTECTED,
                        b"readonly" => Flags::READONLY,
                        b"override" => Flags::OVERRIDE,
                        b"static" => Flags::STATIC,
                        b"declare" => Flags::AMBIENT,
                        b"async" => Flags::ASYNC,
                        b"abstract" => Flags::ABSTRACT,
                        b"accessor" => Flags::ACCESSOR,
                        b"export" => Flags::EXPORT,
                        _ => break,
                    };
                    // The end of a longer name or of a decorator: `@a.static`.
                    if before[..word_start].last().is_some_and(|&c| {
                        c.is_ascii_digit() || matches!(c, b'_' | b'$' | b'@' | b'.') || c >= 0x80
                    }) {
                        break;
                    }
                    seen |= modifier;
                    pos = word_start as u32;
                    modifiers.push((modifier, pos));
                    before = before[..word_start].trim_ascii_end();
                }
                // The other modifiers mean nothing on a parameter. They are only objected to.
                flags |= seen & PROPERTY_MODIFIERS;
                // None was found: a comment is in the way.
                if seen.is_empty() || seen.intersects(PROPERTY_MODIFIERS) {
                    flags |= Flags::PARAMETER_PROPERTY;
                }
                let errors_before = self.b.file.early_errors.len();
                if modifiers.len() > 1 || !PROPERTY_MODIFIERS.contains(seen) {
                    modifiers.reverse();
                    self.b.check_modifiers(
                        &modifiers,
                        Modified::Parameter,
                        false,
                        false,
                        pos_of(arg.binding.loc),
                    );
                }
                // `checkGrammarModifiers`, after the modifiers themselves were found in order.
                if flags.contains(Flags::PARAMETER_PROPERTY)
                    && self.b.file.early_errors.len() == errors_before
                {
                    if matches!(arg.binding.data, B::B::BArray(_) | B::B::BObject(_)) {
                        parameter_property_error = Some(1187);
                    } else if flags.contains(Flags::REST) {
                        parameter_property_error = Some(1317);
                    }
                }
            }
            let pat = self.binding(&arg.binding);
            let ty = if took_nothing {
                TypeNodeId::NONE
            } else {
                self.annotation(arg.binding.loc)
            };
            let default = self.optional_expr(arg.default.as_ref());
            // It starts with what decorates it.
            if let Some(first) = arg.ts_decorators.first()
                && let Some(at) = bun_core::strings::last_index_of_char(
                    &self.b.lexer.contents[..pos_of(first.loc) as usize],
                    b'@',
                )
            {
                pos = at as u32;
            }
            if let Some(code) = parameter_property_error {
                self.b.file.early_errors.push((pos, code));
            }
            // Of two at one place the first is the one that took nothing.
            let ends = self.marks_from(arg.binding.loc, Mark::VariableLikeEnd);
            let end = if took_nothing {
                ends.first()
            } else {
                ends.last()
            };
            self.list_params.push(Param {
                pat,
                ty,
                default,
                flags,
                pos,
                end: end.copied().unwrap_or(0),
            });
            for decorator in arg.ts_decorators.iter() {
                decorators.push((i, self.expr(decorator)));
            }
        }
        let params = self.b.file.add_params(&self.list_params[base..]);
        self.list_params.truncate(base);
        for (i, e) in decorators {
            self.b
                .file
                .decorators
                .push((DecoratorOwner::Param(params.at(i)), e));
        }
        // `parseParameterEx`
        for param in params.iter() {
            self.parameter_jsdoc(param);
        }
        params
    }

    fn func(&mut self, func: &G::Fn, kind: FnKind, mut flags: Flags, pos: u32, start: u32) -> FnId {
        if func.flags.contains(ast::flags::Function::IsAsync) {
            flags |= Flags::ASYNC;
        }
        if func.flags.contains(ast::flags::Function::IsGenerator) {
            flags |= Flags::GENERATOR;
        }
        let open = func.open_parens_loc;
        let type_params = match self.mark(open, Mark::TypeParameters) {
            Some(at) => self.type_params_at(at),
            None => Span::EMPTY,
        };
        let this_param = match self.mark(open, Mark::ThisParameter) {
            Some(name_pos) => {
                let name = ast::Loc {
                    start: name_pos as i32,
                };
                let this = Param {
                    pat: self
                        .b
                        .file
                        .pat(PatKind::Ident(bun_sema::atom::known::this), name_pos),
                    ty: self.annotation(name),
                    default: ExprId::NONE,
                    flags: Flags::empty(),
                    pos: self.declaration_start(name),
                    end: self.mark(name, Mark::VariableLikeEnd).unwrap_or(0),
                };
                self.b.file.add_param(this)
            }
            None => ParamId::NONE,
        };
        let params = self.params(
            func.args.slice(),
            func.flags.contains(ast::flags::Function::HasRestArg),
        );
        let ret = match self.mark(open, Mark::ReturnType) {
            Some(at) => self.return_type_at(at),
            None => TypeNodeId::NONE,
        };
        // `parseFunctionBlockOrSemicolon`: no body at all after a semicolon.
        let body = if func
            .flags
            .contains(ast::flags::Function::IsForwardDeclaration)
        {
            FnBody::None
        } else {
            FnBody::Block(self.stmts(func.body.stmts.slice(), false))
        };
        // `parseBlock` without its `{`: a missing block, which is not the same as no body.
        if self.mark(open, Mark::MissingBody).is_some() {
            flags |= Flags::MISSING_BODY;
        }
        // `createMissingList`: without a `(` the parameters are where the token before them ends. The anchor is one before them.
        let anchor = if self.source.get(pos_of(open) as usize) == Some(&b'(') {
            pos_of(open)
        } else {
            (self.source[..pos_of(open) as usize].trim_ascii_end().len() as u32).saturating_sub(1)
        };
        self.b.file.add_fn(Func {
            kind,
            flags,
            name: func.name.as_ref().map_or(Atom::NONE, |n| self.name(n.ref_)),
            name_pos: func.name.as_ref().map_or(pos, |n| pos_of(n.loc)),
            type_params,
            params,
            this_param,
            ret,
            body,
            anchor,
            pos,
            start,
        })
    }

    fn arrow(&mut self, arrow: &ast::E::Arrow, loc: ast::Loc) -> FnId {
        let pos = pos_of(loc);
        let arrow_token = if arrow.prefer_expr {
            Some(pos_of(arrow.body.loc))
        } else {
            self.mark(arrow.body.loc, Mark::ArrowToken)
        };
        let head = &self.source[pos as usize..];
        let type_params =
            if head.starts_with(b"<") || (arrow.is_async && head.starts_with(b"async")) {
                self.b.arrow_type_params_at(pos)
            } else {
                Span::EMPTY
            };
        let params = self.params(arrow.args.slice(), arrow.has_rest_arg);
        let (this_param, params) = self.b.file.split_this_parameter(params);
        let ret = match arrow_token
            .and_then(|at| self.mark(ast::Loc { start: at as i32 }, Mark::ReturnType))
        {
            Some(at) => self.return_type_at(at),
            None => TypeNodeId::NONE,
        };
        let stmts = arrow.body.stmts.slice();
        let body = match stmts {
            [
                Stmt {
                    data: StmtData::SReturn(ret),
                    ..
                },
            ] if arrow.prefer_expr && ret.value.is_some() => {
                FnBody::Expr(self.expr(ret.value.as_ref().unwrap()))
            }
            _ => FnBody::Block(self.stmts(stmts, false)),
        };
        // `parseExpectedToken`: a missing `=>` is at the end of the token before it.
        let anchor = match arrow_token {
            Some(at) if !self.source[at as usize..].starts_with(b"=>") => {
                self.source[..at as usize].trim_ascii_end().len() as u32
            }
            Some(at) => at,
            None => pos,
        };
        self.b.file.add_fn(Func {
            kind: FnKind::Arrow,
            flags: if arrow.is_async {
                Flags::ASYNC
            } else {
                Flags::empty()
            },
            name: Atom::NONE,
            name_pos: pos,
            type_params,
            params,
            this_param,
            ret,
            body,
            anchor,
            pos,
            start: pos,
        })
    }

    fn class(&mut self, class: &G::Class, mut flags: Flags, pos: u32, start: u32) -> ClassId {
        let keyword = class.class_keyword.loc;
        // `GetContainingClass`: its decorators and heritage clauses are inside it too.
        self.b.classes_around += 1;
        let type_params = self.b.class_type_params_at(pos_of(keyword));
        // `abstract` comes before the keyword on the same line (`scanStartOfDeclaration`, `nextTokenIsClassKeywordOnSameLine`), after
        // `export` or `export default` if they are there.
        let before = &self.source[..pos_of(keyword) as usize];
        let trimmed = before.trim_ascii_end();
        if let Some(rest) = trimmed.strip_suffix(b"abstract")
            && !rest.last().is_some_and(|&c| {
                c.is_ascii_alphanumeric() || matches!(c, b'_' | b'$') || c >= 0x80
            })
            && !bun_core::strings::contains_any(&before[trimmed.len()..], b"\n\r")
        {
            flags |= Flags::ABSTRACT;
        }
        let mut extends = self.optional_expr(class.extends.as_ref());
        let mut extends_args = match self.mark(keyword, Mark::ExtendsArguments) {
            Some(at) => self.type_args_at(at),
            None => IdList::EMPTY,
        };
        // `parseExpressionWithTypeArguments`: type arguments the expression took for itself are those of the clause.
        if let Some(written) = &class.extends
            && let Some(&(CastKind::Instantiation, _)) = self
                .casts
                .get(&ExprKey::of(written))
                .and_then(|casts| casts.last())
            && let ExprKind::Instantiation { expr, type_args } = self.b.file[extends].kind
        {
            extends = expr;
            extends_args = type_args;
        }
        let other_extends: Vec<ExprId> = self
            .marks_from(keyword, Mark::OtherExtends)
            .into_iter()
            .filter_map(|at| self.b.member_expr_at(at))
            .collect();
        let other_extends = self.b.file.list(&other_extends);
        let mut clauses = self.marks_from(keyword, Mark::Implements).into_iter();
        let implements = match clauses.next() {
            Some(at) => self.b.type_list_at(at),
            None => IdList::EMPTY,
        };
        let mut other_implements: Vec<TypeNodeId> = Vec::new();
        for at in clauses {
            let clause = self.b.type_list_at(at);
            other_implements.extend(self.b.file.ids(clause));
        }
        let other_implements = self.b.file.list(&other_implements);
        let of_class: Vec<ExprId> = class.ts_decorators.iter().map(|d| self.expr(d)).collect();
        let outer_is_abstract = std::mem::replace(
            &mut self.b.in_abstract_class,
            flags.contains(Flags::ABSTRACT),
        );
        let mut members = Vec::with_capacity(class.properties.slice().len());
        // By where the member is: they are put in order further down.
        let mut of_members: Vec<(u32, ExprId)> = Vec::new();
        for property in class.properties.slice() {
            let decorators: Vec<ExprId> = property
                .ts_decorators
                .iter()
                .map(|d| self.expr(d))
                .collect();
            let mut member = self.class_member(property);
            // `parseClassElement`
            let named_at = match property.class_static_block_ref() {
                Some(block) => Some(block.loc),
                None => property.key.as_ref().map(|key| key.loc),
            };
            member.loc = TextRange {
                pos: self.b.full_start_of(member.start),
                end: named_at
                    .and_then(|at| self.mark(at, Mark::MemberEnd))
                    .unwrap_or(0),
            };
            if let Some(start) = named_at.and_then(|at| self.mark(at, Mark::MemberStart)) {
                member = self.member_jsdoc(member, start);
                members.append(&mut self.reparsed_members);
            }
            of_members.extend(decorators.into_iter().map(|e| (member.pos, e)));
            members.push(member);
        }
        for at in self.marks_from(keyword, Mark::DroppedMember) {
            match self.b.class_member_at(at, false) {
                Some(member) => {
                    members.push(member);
                    of_members.append(&mut self.b.member_decorators);
                }
                None => self.b.file.syntax_errors += 1,
            }
        }
        self.b.in_abstract_class = outer_is_abstract;
        self.b.classes_around -= 1;
        // Overloads go before what implements them.
        members.sort_by_key(|m| m.pos);
        // As they are written; those of one member keep their order.
        of_members.sort_by_key(|d| d.0);
        let members = self.b.file.add_members(&members);
        for (at, e) in of_members {
            if let Some(m) = members.iter().find(|&m| self.b.file[m].pos == at) {
                self.b.file.decorators.push((DecoratorOwner::Member(m), e));
            }
        }
        let id = self.b.file.add_class(Class {
            name: class
                .class_name
                .as_ref()
                .map_or(Atom::NONE, |n| self.name(n.ref_)),
            name_pos: class.class_name.as_ref().map_or(pos, |n| pos_of(n.loc)),
            flags,
            type_params,
            extends,
            extends_args,
            other_extends,
            implements,
            other_implements,
            members,
            pos,
            start,
        });
        for e in of_class {
            self.b.file.decorators.push((DecoratorOwner::Class(id), e));
        }
        id
    }

    fn class_member(&mut self, property: &G::Property) -> Member {
        let mut member = Member {
            kind: MemberKind::Property,
            key: PropKey::None,
            flags: Flags::empty(),
            ty: TypeNodeId::NONE,
            init: ExprId::NONE,
            func: FnId::NONE,
            pos: 0,
            start: 0,
            loc: TextRange::default(),
            modifiers: Span::EMPTY,
        };
        if let Some(block) = property.class_static_block_ref() {
            member.kind = MemberKind::StaticBlock;
            member.flags = Flags::STATIC;
            member.pos = pos_of(block.loc);
            member.start = self
                .mark(block.loc, Mark::MemberStart)
                .unwrap_or(member.pos);
            self.b.member_header_at(member.start);
            let mut modifiers = self.b.header_modifiers.split_off(0);
            // `parseModifiersEx(stopOnStartOfClassStaticBlock)`
            if modifiers.last().is_some_and(|&(_, at)| {
                skip_trivia(self.source, at as usize + b"static".len()) == member.pos as usize
            }) {
                modifiers.pop();
            }
            member.modifiers = self.b.add_modifier_list(&modifiers);
            let body = FnBody::Block(self.stmts(block.stmts.as_slice(), false));
            member.func = self.b.file.add_fn(Func {
                kind: FnKind::StaticBlock,
                flags: Flags::STATIC,
                name: Atom::NONE,
                name_pos: member.pos,
                type_params: Span::EMPTY,
                params: Span::EMPTY,
                this_param: ParamId::NONE,
                ret: TypeNodeId::NONE,
                body,
                anchor: member.pos,
                pos: member.pos,
                start: member.start,
            });
            return member;
        }
        let Some(key) = &property.key else {
            return member;
        };
        member.pos = pos_of(key.loc);
        member.start = member.pos;
        let is_computed = property.flags.contains(ast::flags::Property::IsComputed);
        member.key = self.key(key, is_computed);
        // `getDeclarationName`: a bigint names nothing.
        let is_named_by_bigint = !is_computed && matches!(key.data, Data::EBigInt(_));
        if is_named_by_bigint {
            member.key = PropKey::None;
        }
        let mut modifiers = Vec::new();
        if let Some(start) = self.mark(key.loc, Mark::MemberStart) {
            member.start = start;
            let (flags, ty) = self.b.member_header_at(start);
            member.flags = flags;
            member.ty = ty;
            modifiers = self.b.header_modifiers.split_off(0);
            member.modifiers = self.b.add_modifier_list(&modifiers);
        }

        let text = self.b.lexer.contents;
        let is_quoted = !is_computed && matches!(text.get(member.pos as usize), Some(b'"' | b'\''));
        // `getLiteralTypeFromPropertyName`: `"0"` and `["0"]` name with a string, `0` and `[0]` with a number. An identifier is a
        // string to the parser as well.
        if (is_computed || is_quoted)
            && matches!(key.data, Data::EString(_))
            && matches!(member.key, PropKey::Name(_))
        {
            member.flags |= Flags::STRING_NAME;
        }
        if is_computed {
            member.pos = self.start_of_computed_name(key);
        } else if is_quoted
            || text
                .get(member.pos as usize)
                .is_some_and(|b| matches!(b, b'0'..=b'9' | b'.'))
        {
            member.flags |= Flags::LITERAL_NAME;
        }
        if property.flags.contains(ast::flags::Property::IsStatic) {
            member.flags |= Flags::STATIC;
        }
        if let Some(Expr {
            data: Data::EFunction(f),
            loc,
        }) = &property.value
            && (property.flags.contains(ast::flags::Property::IsMethod)
                || matches!(property.kind, G::PropertyKind::Get | G::PropertyKind::Set))
        {
            // `tryParseConstructorDeclaration`: the keyword, or a string that says the same right before the `(`. Never `[..]`.
            let is_named_constructor = !is_computed
                && member.key == PropKey::Name(bun_sema::atom::known::constructor)
                // `parsePropertyOrMethodDeclaration`: after `*` it names a method.
                && !f.func.flags.contains(ast::flags::Function::IsGenerator)
                && (!is_quoted
                    || self.is_right_after_string(member.pos, pos_of(f.func.open_parens_loc)));
            let is_constructor = is_named_constructor && property.kind == G::PropertyKind::Normal;
            let (member_kind, fn_kind) = match property.kind {
                G::PropertyKind::Get => (MemberKind::Getter, FnKind::Getter),
                G::PropertyKind::Set => (MemberKind::Setter, FnKind::Setter),
                _ if is_constructor => (MemberKind::Constructor, FnKind::Constructor),
                _ => (MemberKind::Method, FnKind::Method),
            };
            member.kind = member_kind;
            member.ty = TypeNodeId::NONE;
            if !modifiers.is_empty() {
                let on = match member_kind {
                    MemberKind::Constructor => Modified::Constructor,
                    MemberKind::Method => Modified::Method,
                    _ => Modified::Accessor,
                };
                self.b.check_modifiers(
                    &modifiers,
                    on,
                    false,
                    matches!(member.key, PropKey::Private(_)),
                    member.pos,
                );
            }
            // On a member these are only objected to.
            member
                .flags
                .remove(Flags::CONST | Flags::EXPORT | Flags::DEFAULT);
            // `GetFunctionFlags`: accessors and constructors are never async.
            let is_method = matches!(member_kind, MemberKind::Method);
            if !is_method {
                member.flags.remove(Flags::ASYNC);
            }
            let func = self.func(&f.func, fn_kind, member.flags, pos_of(*loc), member.start);
            if !is_method {
                self.b.file[func].flags.remove(Flags::ASYNC);
            }
            self.b.file[func].name = member.key.name().unwrap_or(Atom::NONE);
            self.b.file[func].name_pos = member.pos;
            member.func = func;
            return member;
        }
        if !modifiers.is_empty() {
            self.b.check_modifiers(
                &modifiers,
                Modified::Property,
                false,
                matches!(member.key, PropKey::Private(_)),
                member.pos,
            );
        }
        member
            .flags
            .remove(Flags::CONST | Flags::EXPORT | Flags::DEFAULT);
        // `checkVariableLikeDeclaration`
        if is_named_by_bigint {
            self.b.file.checker_errors.push((member.pos, 1539));
        }
        member.init = self.optional_expr(property.initializer.as_ref().or(property.value.as_ref()));
        member
    }

    /// Whether the token at `at` is the one after the string that starts at `string`.
    fn is_right_after_string(&self, string: u32, at: u32) -> bool {
        let Some(&quote) = self.source.get(string as usize) else {
            return false;
        };
        let mut end = string as usize + 1;
        while let Some(&c) = self.source.get(end) {
            end += if c == b'\\' { 2 } else { 1 };
            if c == quote {
                break;
            }
        }
        skip_trivia(self.source, end) == at as usize
    }

    // ───────────────────────────── expressions ─────────────────────────────

    /// What the parser kept for the node that starts at `of` (`keep_expressions`).
    fn kept_expressions(&self, of: ast::Loc) -> Vec<Expr> {
        self.kept_expressions
            .get(&of.start)
            .cloned()
            .unwrap_or_default()
    }

    fn optional_expr(&mut self, expr: Option<&Expr>) -> ExprId {
        match expr {
            Some(expr) => self.expr(expr),
            None => ExprId::NONE,
        }
    }

    fn exprs<'e>(&mut self, exprs: impl Iterator<Item = &'e Expr>) -> IdList<ExprId> {
        let base = self.list_ids.len();
        for e in exprs {
            let id = self.expr(e);
            self.list_ids.push(id.0);
        }
        self.take_ids(base)
    }

    /// Whether an expression in `casts` starts where `expr` does. Outside the source there is no telling.
    #[inline]
    fn may_have_casts(&self, expr: &Expr) -> bool {
        let start = expr.loc.start as u32;
        self.cast_starts
            .get(start as usize / 64)
            .is_none_or(|word| word & 1 << (start % 64) != 0)
    }

    fn chain(chain: Option<ast::OptionalChain>) -> Chain {
        match chain {
            None => Chain::No,
            Some(ast::OptionalChain::Start) => Chain::Start,
            Some(ast::OptionalChain::Continuation) => Chain::Continue,
        }
    }

    fn expr(&mut self, expr: &Expr) -> ExprId {
        // Where what has been made of it so far starts.
        let mut pos = pos_of(expr.loc);
        if !self.stack_check.is_safe_to_recurse() {
            self.b.file.syntax_errors += 1;
            return self.b.file.expr(ExprKind::Missing, pos);
        }
        let mut id = self.expr_without_casts(expr);
        if !self.expr_ends.is_empty()
            && let Some(&end) = self.expr_ends.get(&ExprKey::of(expr))
        {
            self.b.file.set_expr_end(id, end as u32);
        }
        if self.may_have_casts(expr)
            && let Some(casts) = self.casts.get(&ExprKey::of(expr))
        {
            for (kind, at) in casts.clone() {
                let kind = match kind {
                    CastKind::Paren => {
                        let Some(open) = self.open_paren(at as u32) else {
                            continue;
                        };
                        // `parseParenthesizedExpression`
                        let mut host = Host::Parenthesized(id);
                        self.with_jsdoc(open, true, &mut host);
                        if let Host::Parenthesized(inside) = host {
                            id = inside;
                        }
                        pos = open;
                        // Of parentheses within parentheses, the outermost.
                        match self.b.file.parens.last_mut() {
                            Some(last) if last.0 == id => last.1 = open,
                            _ => self.b.file.parens.push((id, open)),
                        }
                        continue;
                    }
                    CastKind::Tag => continue,
                    CastKind::NonNull => ExprKind::NonNull(id),
                    CastKind::Instantiation => {
                        let type_args = self.type_args_at(at as u32);
                        // Type arguments that were given up on: as if there were none. `f<>` is kept as an empty list.
                        if type_args.is_empty() && !self.b.kept.type_arguments.contains_key(&at) {
                            continue;
                        }
                        ExprKind::Instantiation {
                            expr: id,
                            type_args,
                        }
                    }
                    CastKind::Satisfies => ExprKind::Satisfies {
                        expr: id,
                        ty: self.type_at(at as u32),
                    },
                    CastKind::As => {
                        // `parseTypeAssertion`: `<T>e` starts at its `<`, and so does what is made of it afterwards.
                        if (at as u32) < pos
                            && let Some(less_than) = bun_core::strings::last_index_of_char(
                                &self.source[..at as usize],
                                b'<',
                            )
                        {
                            pos = less_than as u32;
                        }
                        let has_type = self
                            .b
                            .kept
                            .types
                            .contains_key(&(skip_trivia(self.source, at as usize) as i32));
                        let ty = match if has_type {
                            None
                        } else {
                            self.cast_type_from_type_params(at as u32)
                        } {
                            Some(ty) => ty,
                            None => self.type_at(at as u32),
                        };
                        match self.b.file[ty].kind {
                            TypeNodeKind::Ref { name, args }
                                if args.is_empty()
                                    && name.len() == 1
                                    && self.b.file.id_at(name, 0)
                                        == bun_sema::atom::known::r#const =>
                            {
                                ExprKind::AsConst(id)
                            }
                            _ => ExprKind::As { expr: id, ty },
                        }
                    }
                };
                id = self.b.file.expr(kind, pos);
            }
        }
        id
    }

    /// Where the parenthesis noted at `at` opens.
    fn open_paren(&self, at: u32) -> Option<u32> {
        if self.source.get(at as usize) != Some(&b'<') {
            return Some(at);
        }
        // `<T>(e)`: the parser has it open where the assertion starts.
        self.mark(ast::Loc { start: at as i32 }, Mark::AssertedParen)
    }

    fn call(
        &mut self,
        callee: ExprId,
        args: IdList<ExprId>,
        anchor: ast::Loc,
        close: ast::Loc,
        chain: Chain,
    ) -> CallId {
        let type_args = match self.mark(anchor, Mark::TypeArguments) {
            Some(at) => self.type_args_at(at),
            None => IdList::EMPTY,
        };
        let close_pos = if close.start < 0 || close == ast::Loc::EMPTY {
            u32::MAX
        } else {
            close.start as u32
        };
        self.b.file.add_call(Call {
            callee,
            args,
            type_args,
            close_pos,
            chain,
            template: ExprId::NONE,
        })
    }

    fn template_text(&mut self, contents: &ast::E::TemplateContents) -> Atom {
        match contents {
            ast::E::TemplateContents::Cooked(s) => self.string(s),
            // Under a tag.
            ast::E::TemplateContents::Raw(s) => {
                let cooked = self.b.lexer.cooked_template_contents(s.slice());
                self.b.atom(&cooked)
            }
        }
    }

    /// `parsePropertyAccessExpressionRest`: `a<b>.c` is refused, at the `<`. `obj` is what `target` was lowered to.
    fn refuse_access_to_instantiation(&mut self, target: &Expr, obj: ExprId) {
        if matches!(self.b.file[obj].kind, ExprKind::Instantiation { .. })
            && let Some(&(CastKind::Instantiation, less_than)) = self
                .casts
                .get(&ExprKey::of(target))
                .and_then(|casts| casts.last())
        {
            self.b.file.early_errors.push((less_than as u32, 1477));
        }
    }

    /// `parseJsxTagName`: `this` at the head of a tag name is the keyword. `tag` may be `NONE`.
    fn jsx_this_keyword(&mut self, tag: ExprId) {
        let mut root = tag;
        while root.is_some() {
            let ExprKind::Dot { obj, .. } = self.b.file[root].kind else {
                break;
            };
            root = obj;
        }
        if root.is_some()
            && matches!(self.b.file[root].kind, ExprKind::Ident(name) | ExprKind::String(name) if name == bun_sema::atom::known::this)
        {
            self.b.file[root].kind = ExprKind::This;
        }
    }

    fn expr_without_casts(&mut self, expr: &Expr) -> ExprId {
        let pos = pos_of(expr.loc);
        let kind = match &expr.data {
            Data::EInlinedEnum(e) => return self.expr(&e.value),
            Data::EIdentifier(e) => ExprKind::Ident(self.name(e.ref_)),
            Data::EImportIdentifier(e) => ExprKind::Ident(self.name(e.ref_)),
            Data::ECommonjsExportIdentifier(e) => ExprKind::Ident(self.name(e.ref_)),
            Data::ENameOfSymbol(e) => ExprKind::Ident(self.name(e.ref_)),
            Data::EPrivateIdentifier(e) => ExprKind::String(self.name(e.ref_)),
            Data::EThis(_) => ExprKind::This,
            Data::ESuper(_) => ExprKind::Super,
            Data::ENull(_) => ExprKind::Null,
            Data::EUndefined(_) => ExprKind::Ident(bun_sema::atom::known::undefined),
            Data::EBoolean(e) | Data::EBranchBoolean(e) => {
                if e.value {
                    ExprKind::True
                } else {
                    ExprKind::False
                }
            }
            Data::ENumber(e) => ExprKind::Number(self.b.file.number(e.value())),
            Data::EBigInt(e) => ExprKind::BigInt(self.b.atom(e.value.slice())),
            Data::EString(e) => ExprKind::String(self.string(e)),
            Data::ERegExp(_) => ExprKind::Regex,
            Data::ENewTarget(_) => ExprKind::NewTarget,
            Data::EImportMeta(_) => ExprKind::ImportMeta,
            Data::EMissing(_) => ExprKind::Missing,
            Data::ETemplate(e) => {
                let exprs = self.exprs(e.parts().iter().map(|part| &part.value));
                let base = self.list_ids.len();
                let head = self.template_text(&e.head);
                self.list_ids.push(head.0);
                for part in e.parts().iter() {
                    let tail = self.template_text(&part.tail);
                    self.list_ids.push(tail.0);
                }
                let texts = self.take_ids(base);
                match &e.tag {
                    Some(tag) => {
                        let type_args = match self.mark(expr.loc, Mark::TagTypeArguments) {
                            Some(at) => self.type_args_at(at),
                            None => IdList::EMPTY,
                        };
                        let callee = self.expr(tag);
                        // `callIsIncomplete`: the checker takes a `close_pos` where no `)` is for an incomplete call.
                        let close_pos = if self.mark(expr.loc, Mark::IncompleteTemplate).is_some() {
                            u32::MAX - 1
                        } else {
                            u32::MAX
                        };
                        // A `NoSubstitutionTemplateLiteral` is a string, as it is without a tag.
                        let template = if exprs.is_empty() {
                            ExprKind::String(head)
                        } else {
                            ExprKind::Template { exprs, texts }
                        };
                        let casts = self.casts.get(&ExprKey::of(tag));
                        let template_pos = casts
                            .and_then(|casts| casts.iter().find(|cast| cast.0 == CastKind::Tag))
                            .map_or(pos, |cast| cast.1 as u32);
                        let template = self.b.file.expr(template, template_pos);
                        ExprKind::TaggedTemplate(self.b.file.add_call(Call {
                            callee,
                            args: exprs,
                            type_args,
                            close_pos,
                            chain: Chain::No,
                            template,
                        }))
                    }
                    None => ExprKind::Template { exprs, texts },
                }
            }
            Data::EArray(e) => ExprKind::Array(self.exprs(e.items.iter())),
            Data::EObject(e) => ExprKind::Object(self.props(e.properties.as_slice(), true)),
            Data::ESpread(e) => ExprKind::Spread(self.expr(&e.value)),
            Data::EFunction(e) => {
                let func = self.func(&e.func, FnKind::Expr, Flags::empty(), pos, pos);
                self.with_jsdoc(pos, true, &mut Host::Function(func));
                ExprKind::Fn(func)
            }
            Data::EArrow(e) => {
                let func = self.arrow(e, expr.loc);
                self.with_jsdoc(pos, true, &mut Host::Function(func));
                ExprKind::Fn(func)
            }
            Data::EClass(e) => {
                let class = self.class(e, Flags::empty(), pos, self.declaration_start(expr.loc));
                self.with_jsdoc(pos, false, &mut Host::Class(class));
                ExprKind::Class(class)
            }
            Data::EDot(e) => {
                let obj = self.expr(&e.target);
                self.refuse_access_to_instantiation(&e.target, obj);
                ExprKind::Dot {
                    obj,
                    name: self.b.atom(e.name.slice()),
                    name_pos: pos_of(e.name_loc),
                    chain: Self::chain(e.optional_chain),
                }
            }
            Data::EIndex(e) => {
                let obj = self.expr(&e.target);
                let chain = Self::chain(e.optional_chain);
                match &e.index.data {
                    Data::EPrivateIdentifier(id) => {
                        self.refuse_access_to_instantiation(&e.target, obj);
                        ExprKind::Dot {
                            obj,
                            name: self.name(id.ref_),
                            name_pos: pos_of(e.index.loc),
                            chain,
                        }
                    }
                    _ => ExprKind::Index {
                        obj,
                        index: self.expr(&e.index),
                        chain,
                    },
                }
            }
            Data::ECall(e) => {
                let callee = self.expr(&e.target);
                let args = self.exprs(e.args.iter());
                ExprKind::Call(self.call(
                    callee,
                    args,
                    e.close_paren_loc,
                    e.close_paren_loc,
                    Self::chain(e.optional_chain),
                ))
            }
            Data::ENew(e) => {
                let callee = self.expr(&e.target);
                let args = self.exprs(e.args.iter());
                ExprKind::New(self.call(callee, args, expr.loc, e.close_parens_loc, Chain::No))
            }
            Data::EUnary(e) => {
                let op = match e.op {
                    OpCode::UnPos => UnOp::Plus,
                    OpCode::UnNeg => UnOp::Minus,
                    OpCode::UnCpl => UnOp::BitNot,
                    OpCode::UnNot => UnOp::Not,
                    OpCode::UnVoid => UnOp::Void,
                    OpCode::UnTypeof => UnOp::Typeof,
                    OpCode::UnDelete => UnOp::Delete,
                    OpCode::UnPreDec => UnOp::PreDec,
                    OpCode::UnPreInc => UnOp::PreInc,
                    OpCode::UnPostDec => UnOp::PostDec,
                    _ => UnOp::PostInc,
                };
                ExprKind::Unary {
                    op,
                    operand: self.expr(&e.value),
                }
            }
            Data::EBinary(_) => return self.binary(expr),
            Data::EIf(e) => {
                let test = self.expr(&e.test);
                let yes = self.expr(&e.yes);
                let no = self.expr(&e.no);
                ExprKind::Cond { test, yes, no }
            }
            Data::EAwait(e) => ExprKind::Await(self.expr(&e.value)),
            Data::EYield(e) => ExprKind::Yield {
                value: self.optional_expr(e.value.as_ref()),
                star: e.is_star,
            },
            Data::EImport(e) => {
                let spec = self.expr(&e.expr);
                if let Some(close) = self.mark(expr.loc, Mark::DeferredImportClose) {
                    self.b.file.deferred_import_calls.push((spec, close));
                }
                let options = (!matches!(e.options.data, Data::EMissing(_))).then_some(&e.options);
                let kept = self.kept_expressions(expr.loc);
                ExprKind::ImportCall(spec, self.exprs(options.into_iter().chain(&kept)))
            }
            Data::EJsxElement(e) => {
                let tag = self.optional_expr(e.tag.as_ref());
                self.jsx_this_keyword(tag);
                let attrs = self.props(e.properties.as_slice(), false);
                let children = self.exprs(e.children.iter());
                let type_args = match self.mark(expr.loc, Mark::TypeArguments) {
                    Some(at) => self.type_args_at(at),
                    None => IdList::EMPTY,
                };
                let close_pos = if e.closing_start == ast::Loc::EMPTY {
                    u32::MAX
                } else {
                    pos_of(e.closing_start)
                };
                let close_tag = self.optional_expr(e.closing_tag.as_ref());
                self.jsx_this_keyword(close_tag);
                ExprKind::Jsx(self.b.file.add_jsx(Jsx {
                    tag,
                    close_tag,
                    attrs,
                    children,
                    type_args,
                    opening_end: pos_of(e.opening_end),
                    close_pos,
                    end: pos_of(e.end),
                }))
            }
            Data::EObjectJSON(_)
            | Data::EArrayJSON(_)
            | Data::ERequireString(_)
            | Data::ERequireResolveString(_)
            | Data::ERequireCallTarget
            | Data::ERequireResolveCallTarget
            | Data::EImportMetaMain(_)
            | Data::ERequireMain
            | Data::ESpecial(_) => ExprKind::Missing,
        };
        self.b.file.expr(kind, pos)
    }

    /// `a + b + c + ...` is as deep to the left as it is long.
    fn binary(&mut self, expr: &Expr) -> ExprId {
        let mut spine: SmallVec<[&Expr; 8]> = SmallVec::new();
        let mut leftmost = expr;
        while let Data::EBinary(e) = &leftmost.data {
            spine.push(leftmost);
            // A cast of the left operand, or parentheses around it, have to be looked up.
            if self.may_have_casts(&e.left) && self.casts.contains_key(&ExprKey::of(&e.left)) {
                leftmost = &e.left;
                break;
            }
            leftmost = &e.left;
        }
        let mut left = self.expr(leftmost);
        while let Some(node) = spine.pop() {
            let Data::EBinary(e) = &node.data else {
                unreachable!()
            };
            let right = self.expr(&e.right);
            let pos = pos_of(node.loc);
            let kind = match binary_op(e.op) {
                Ok(op) => ExprKind::Binary { op, left, right },
                Err(op) => {
                    if op.is_none() {
                        self.report_trailing_comma_after_rest(&e.left);
                    }
                    ExprKind::Assign {
                        op,
                        target: left,
                        value: right,
                    }
                }
            };
            left = self.b.file.expr(kind, pos);
        }
        left
    }

    /// `checkGrammarForDisallowedTrailingComma`, for the target of a destructuring assignment: 1013 at the comma after a last `...x`.
    /// A nested `[..] = default` is an assignment of its own, which `binary` brings here.
    fn report_trailing_comma_after_rest(&mut self, target: &Expr) {
        if !self.stack_check.is_safe_to_recurse() {
            return;
        }
        match &target.data {
            Data::EArray(array) => {
                let items = array.items.as_slice();
                if let Some(Expr { data: Data::ESpread(rest), loc }) = items.last()
                    // `...x = d` has an error of its own (1186).
                    && !matches!(&rest.value.data, Data::EBinary(b) if matches!(b.op, OpCode::BinAssign))
                    && array.comma_after_spread.start > loc.start
                {
                    self.b
                        .file
                        .early_errors
                        .push((pos_of(array.comma_after_spread), 1013));
                }
                for item in items {
                    self.report_trailing_comma_after_rest(item);
                }
            }
            Data::EObject(object) => {
                let properties = object.properties.as_slice();
                if let Some(last) = properties.last()
                    && last.kind == G::PropertyKind::Spread
                    && let Some(value) = &last.value
                    && object.comma_after_spread.start > value.loc.start
                {
                    self.b
                        .file
                        .early_errors
                        .push((pos_of(object.comma_after_spread), 1013));
                }
                for property in properties {
                    if let Some(value) = &property.value {
                        self.report_trailing_comma_after_rest(value);
                    }
                }
            }
            Data::ESpread(rest) => self.report_trailing_comma_after_rest(&rest.value),
            _ => {}
        }
    }

    /// `is_literal`: they are those of an object literal, not the attributes of a JSX element.
    fn props(&mut self, properties: &[G::Property], is_literal: bool) -> Span<PropId> {
        let base = self.list_props.len();
        // The types of `@type` tags: of which property, and the type.
        let mut types: Vec<(usize, TypeNodeId)> = Vec::new();
        self.object_literals_around += u32::from(is_literal);
        for property in properties {
            let pos = property
                .key
                .as_ref()
                .or(property.value.as_ref())
                .map_or(0, |e| pos_of(e.loc));
            if property.kind == G::PropertyKind::Spread {
                let from = property.value.as_ref().map_or(ast::Loc::EMPTY, |e| e.loc);
                let value = self.optional_expr(property.value.as_ref());
                let start = self.mark(from, Mark::MemberStart).unwrap_or(pos);
                self.list_props.push(Prop {
                    kind: PropKind::Spread,
                    key: PropKey::None,
                    value,
                    pos,
                    start,
                    end: self.mark(from, Mark::MemberEnd).unwrap_or(0),
                });
                continue;
            }
            let Some(key) = &property.key else { continue };
            let is_computed = property.flags.contains(ast::flags::Property::IsComputed);
            let pos = if is_computed {
                self.start_of_computed_name(key)
            } else {
                pos
            };
            let start = self.mark(key.loc, Mark::MemberStart).unwrap_or(pos);
            let written_key = key;
            let mut key = self.key(key, is_computed);
            // `getDeclarationName`: a private name with no class around it names nothing.
            if self.b.classes_around == 0 && matches!(key, PropKey::Private(_)) {
                key = PropKey::None;
            }
            let kind = match property.kind {
                G::PropertyKind::Get => PropKind::Getter,
                G::PropertyKind::Set => PropKind::Setter,
                _ if property.flags.contains(ast::flags::Property::IsMethod) => PropKind::Method,
                _ if property.flags.contains(ast::flags::Property::WasShorthand) => {
                    PropKind::Shorthand
                }
                _ => PropKind::Init,
            };
            // Neither does a bigint. `checkGrammarObjectLiteralExpression` objects to it on a property assignment only.
            if !is_computed && matches!(written_key.data, Data::EBigInt(_)) {
                key = PropKey::None;
                if matches!(kind, PropKind::Init | PropKind::Shorthand) {
                    self.b.file.checker_errors.push((pos, 1539));
                }
            }
            let mut value = match (&property.value, kind) {
                (
                    Some(Expr {
                        data: Data::EFunction(f),
                        loc,
                    }),
                    PropKind::Getter | PropKind::Setter | PropKind::Method,
                ) => {
                    let fn_kind = match kind {
                        PropKind::Getter => FnKind::Getter,
                        PropKind::Setter => FnKind::Setter,
                        _ => FnKind::Method,
                    };
                    let func = self.func(&f.func, fn_kind, Flags::empty(), pos_of(*loc), start);
                    self.b.file[func].name = key.name().unwrap_or(Atom::NONE);
                    self.b.file[func].name_pos = pos;
                    self.b.file.expr(ExprKind::Fn(func), pos_of(*loc))
                }
                (value, _) => self.optional_expr(value.as_ref()),
            };
            // `{ a = 1 }`, which only a destructuring assignment can have.
            if let Some(initializer) = &property.initializer {
                let default = self.expr(initializer);
                value = self.b.file.expr(
                    ExprKind::Assign {
                        op: None,
                        target: value,
                        value: default,
                    },
                    pos,
                );
            }
            let mut prop = Prop {
                kind,
                key,
                value,
                pos,
                start,
                end: self.mark(written_key.loc, Mark::MemberEnd).unwrap_or(0),
            };
            // `parseObjectLiteralElement`
            if is_literal && !self.jsdoc.list.is_empty() {
                let mut host = Host::Property(prop, TypeNodeId::NONE);
                self.with_jsdoc(start, false, &mut host);
                if let Host::Property(documented, ty) = host {
                    prop = documented;
                    if ty.is_some() {
                        types.push((self.list_props.len() - base, ty));
                    }
                }
            }
            self.list_props.push(prop);
        }
        self.object_literals_around -= u32::from(is_literal);
        let props = self.b.file.add_props(&self.list_props[base..]);
        self.list_props.truncate(base);
        for (index, ty) in types {
            self.b
                .file
                .jsdoc_types
                .push((JsDocTypeOwner::Prop(props.at(index)), ty));
        }
        props
    }
}

/// `Err` for the assignments, with the operator they combine with.
fn binary_op(op: OpCode) -> Result<BinOp, Option<BinOp>> {
    Ok(match op {
        OpCode::BinAdd => BinOp::Add,
        OpCode::BinSub => BinOp::Sub,
        OpCode::BinMul => BinOp::Mul,
        OpCode::BinDiv => BinOp::Div,
        OpCode::BinRem => BinOp::Rem,
        OpCode::BinPow => BinOp::Pow,
        OpCode::BinLt => BinOp::Lt,
        OpCode::BinLe => BinOp::Le,
        OpCode::BinGt => BinOp::Gt,
        OpCode::BinGe => BinOp::Ge,
        OpCode::BinIn => BinOp::In,
        OpCode::BinInstanceof => BinOp::Instanceof,
        OpCode::BinShl => BinOp::Shl,
        OpCode::BinShr => BinOp::Shr,
        OpCode::BinUShr => BinOp::UShr,
        OpCode::BinLooseEq => BinOp::EqEq,
        OpCode::BinLooseNe => BinOp::NotEq,
        OpCode::BinStrictEq => BinOp::EqEqEq,
        OpCode::BinStrictNe => BinOp::NotEqEq,
        OpCode::BinNullishCoalescing => BinOp::Nullish,
        OpCode::BinLogicalOr => BinOp::Or,
        OpCode::BinLogicalAnd => BinOp::And,
        OpCode::BinBitwiseOr => BinOp::BitOr,
        OpCode::BinBitwiseAnd => BinOp::BitAnd,
        OpCode::BinBitwiseXor => BinOp::BitXor,
        OpCode::BinComma => BinOp::Comma,
        OpCode::BinAssign => return Err(None),
        OpCode::BinAddAssign => return Err(Some(BinOp::Add)),
        OpCode::BinSubAssign => return Err(Some(BinOp::Sub)),
        OpCode::BinMulAssign => return Err(Some(BinOp::Mul)),
        OpCode::BinDivAssign => return Err(Some(BinOp::Div)),
        OpCode::BinRemAssign => return Err(Some(BinOp::Rem)),
        OpCode::BinPowAssign => return Err(Some(BinOp::Pow)),
        OpCode::BinShlAssign => return Err(Some(BinOp::Shl)),
        OpCode::BinShrAssign => return Err(Some(BinOp::Shr)),
        OpCode::BinUShrAssign => return Err(Some(BinOp::UShr)),
        OpCode::BinBitwiseOrAssign => return Err(Some(BinOp::BitOr)),
        OpCode::BinBitwiseAndAssign => return Err(Some(BinOp::BitAnd)),
        OpCode::BinBitwiseXorAssign => return Err(Some(BinOp::BitXor)),
        OpCode::BinNullishCoalescingAssign => return Err(Some(BinOp::Nullish)),
        OpCode::BinLogicalOrAssign => return Err(Some(BinOp::Or)),
        OpCode::BinLogicalAndAssign => return Err(Some(BinOp::And)),
        _ => BinOp::Comma,
    })
}
