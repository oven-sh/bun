//! From the statements as the parse pass left them (nothing bound, folded or dropped) to `bun_sema::hir`.

use super::builder::Builder;
use super::clone_types::PendingPart;
use super::jsdoc::Comments;
use super::notes::Notes;
use super::reparse::Host;
use super::{Mark, TypeSyntax};
use crate::p::P;
use crate::sema::ts_syntax as ts;
use bun_ast::expr::Data;
use bun_ast::stmt::Data as StmtData;
use bun_ast::{self as ast, B, Expr, G, OpCode, S, Stmt, StmtOrExpr};
use bun_sema::atom::Atom;
use bun_sema::hir::{self, *};
use smallvec::SmallVec;

pub(crate) struct Lower<'p, 'a> {
    pub(super) b: Builder<'a>,
    pub(super) p: &'p P<'a, true, false>,
    /// What the parser said of the nodes of the tree.
    noted: Notes,
    /// `TypeSyntax::class_index_signatures`
    class_index_signatures: Vec<Member>,
    /// What the lists being lowered have so far, the innermost list last: ids, variables, parameters, properties.
    list_ids: Vec<u32>,
    list_decls: Vec<VarDecl>,
    list_params: Vec<Param>,
    list_props: Vec<Prop>,
    /// `TokenFullStart` of the end of the file.
    end_of_file_full_start: u32,
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
    /// `node.End()` of what `expr` made last, as it is written: with the parentheses around it.
    written_end: u32,
    /// `GetTokenPosOfNode` of what `expr` made last, as it is written: with the parentheses around it.
    written_start: u32,
    /// The functions that have a `FullSignature`.
    pub(super) full_signatures: bun_collections::HashMap<u32, ()>,
    /// The functions whose `@param` tags were compared with their parameters.
    pub(super) documented_functions: bun_collections::HashMap<u32, ()>,
    /// `NodeFlagsAmbient`: what is being lowered is in a declaration file, or in a declaration that says `declare`.
    is_ambient: bool,
}

impl<'p, 'a> Lower<'p, 'a> {
    pub(crate) fn run(
        p: &'p mut P<'a, true, false>,
        syntax: TypeSyntax<'a>,
        stmts: &[Stmt],
        is_declaration_file: bool,
    ) -> hir::File {
        let end_of_file_full_start = p.lexer.token_full_start as u32;
        // `withJSDoc`: only in JavaScript is anything made of the tags.
        let (mut syntax, jsdoc) = if syntax.has_jsdoc {
            super::jsdoc::read_comments(p, syntax)
        } else {
            (syntax, Comments::default())
        };
        let p: &'p P<'a, true, false> = p;
        let source_len = p.source.contents().len();
        syntax.b.classes_around = 0;
        let mut this = Lower {
            b: syntax.b,
            p,
            noted: syntax.notes,
            class_index_signatures: syntax.class_index_signatures,
            list_ids: Vec::new(),
            list_decls: Vec::new(),
            list_params: Vec::new(),
            list_props: Vec::new(),
            end_of_file_full_start,
            stack_check: bun_core::StackCheck::init(),
            jsdoc_is_attached: vec![false; jsdoc.list.len()],
            jsdoc: std::rc::Rc::new(jsdoc),
            reparsed: Vec::new(),
            reparsed_members: Vec::new(),
            member_modifiers: Vec::new(),
            object_literals_around: 0,
            written_end: 0,
            written_start: 0,
            full_signatures: Default::default(),
            documented_functions: Default::default(),
            is_ambient: is_declaration_file,
        };
        this.b.file.source_len = source_len as u32;
        this.b.file.kind = if is_declaration_file {
            FileKind::Declaration
        } else if p.is_jsx_enabled() {
            FileKind::Tsx
        } else {
            FileKind::Ts
        };
        let body = this.stmts(stmts, true);
        let pair = |&(a, b): &(ast::Loc, ast::Loc)| (a.start.max(0) as u32, b.start.max(0) as u32);
        this.b.file.after_skipped = syntax
            .after_skipped
            .iter()
            .map(|next| next.start.max(0) as u32)
            .collect();
        // What is in the comments is read after the rest.
        if this.b.file.after_skipped.len() > 1 {
            this.b.file.after_skipped.sort_unstable();
        }
        if !syntax.stray_decorators.is_empty() {
            this.b
                .file
                .stray_decorators
                .extend(syntax.stray_decorators.iter().map(pair));
        }
        this.b.file.unclosed_literals = syntax.unclosed_literals.iter().map(pair).collect();
        // A literal is noted where it ends, so after those in it.
        if this.b.file.unclosed_literals.len() > 1 {
            this.b.file.unclosed_literals.sort_unstable();
        }
        this.b.file.body = body;
        this.fill_in_pending_parts();
        // A body in a type is filled in last.
        if !this.b.file.body_starts.is_sorted_by_key(|body| body.0.0) {
            this.b
                .file
                .body_starts
                .sort_unstable_by_key(|body| body.0.0);
        }
        // Those of import types come last, and a type in a comment is cloned for each node it is the type of.
        if this.b.file.import_attributes.len() > 1 {
            let import_attributes = &mut this.b.file.import_attributes;
            import_attributes.sort_by_key(|attributes| attributes.0);
            import_attributes.dedup_by_key(|attributes| attributes.0);
        }
        this.b.file.parens.sort_by_key(|p| p.0.0);
        this.b
            .file
            .jsx_expressions
            .sort_unstable_by_key(|braces| braces.0.0);
        this.finish_jsdoc();
        std::mem::take(&mut this.noted).leave_room();
        let positions = this.b.keyword_identifier_positions.take();
        if !positions.is_empty() {
            this.b.file.keyword_identifier_positions.extend(positions);
        }
        std::mem::take(&mut this.b.file)
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
                    let open = self.pos_of(body.loc);
                    self.b.file.body_starts.push((func, open));
                    let body = FnBody::Block(self.stmts(body.stmts.slice(), false));
                    self.b.file.fns[func.idx()].body = body;
                }
                PendingPart::PatternKey(property, key) => {
                    self.b.file.pat_props[property.idx()].name_kind = self.name_kind(&key, true);
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
                PendingPart::ImportAttributes(attributes) => self.import_attributes(attributes),
                PendingPart::HeritageExpression(node, expression) => {
                    let expression = self.expr(&expression);
                    self.b.file[node].kind = TypeNodeKind::Heritage(expression);
                }
            }
        }
    }

    // ───────────────────────────── what the parser noted ─────────────────────────────

    /// Where the node whose `loc` is `loc` is.
    #[inline]
    pub(super) fn pos_of(&self, loc: ast::Loc) -> u32 {
        self.noted.real_loc(loc).start.max(0) as u32
    }

    /// `node.End()` of the node whose `loc` is `loc`.
    #[inline]
    fn noted_end(&self, loc: ast::Loc) -> Option<u32> {
        let end = self.noted.node(loc)?.end;
        (!end.is_empty()).then_some(end.start as u32)
    }

    /// What the parser noted as `what` of the node whose `loc` is `loc`.
    #[inline]
    fn note(&self, loc: ast::Loc, what: Mark) -> Option<u32> {
        self.noted.get(loc, what)
    }

    /// All that it noted as `what` of that node, in the order of the source.
    fn notes(&self, loc: ast::Loc, what: Mark) -> SmallVec<[u32; 4]> {
        let mut found: SmallVec<[u32; 4]> = self
            .noted
            .of(loc)
            .filter(|note| note.what == what)
            .map(|note| note.payload)
            .collect();
        found.reverse();
        found
    }

    /// `node.Loc`, as the parser said it of the node whose `loc` is `loc`. 0: it did not.
    fn range_of(&self, loc: ast::Loc) -> TextRange {
        match self.noted.node(loc) {
            Some(node) => TextRange {
                pos: node.full_start.start.max(0) as u32,
                end: node.end.start.max(0) as u32,
            },
            None => TextRange { pos: 0, end: 0 },
        }
    }

    /// `node.Pos()` of that node, if the parser said it.
    fn full_start_of(&self, loc: ast::Loc) -> Option<u32> {
        let full_start = self.noted.node(loc)?.full_start;
        (!full_start.is_empty()).then_some(full_start.start as u32)
    }

    /// `node.Loc` of the member of a class that is named at `named_at`.
    fn member_range(&self, named_at: ast::Loc) -> TextRange {
        TextRange {
            pos: self.note(named_at, Mark::MemberFullStart).unwrap_or(0),
            end: self.note(named_at, Mark::MemberEnd).unwrap_or(0),
        }
    }

    /// The type that is the payload `kept` of a note.
    #[inline]
    fn type_at(&mut self, kept: u32) -> TypeNodeId {
        TypeNodeId(kept)
    }

    /// `T` was read as a type parameter and turned out to be a type.
    fn type_from_type_param(&mut self, param: TypeParamId) -> TypeNodeId {
        let TypeParam { name, pos, .. } = self.b.file[param];
        let kind = match super::keep::keyword_type(self.b.atoms.bytes(name)) {
            Some(keyword) => TypeNodeKind::Keyword(keyword),
            None => TypeNodeKind::Ref {
                name: self.b.file.entity_name([(name, pos)].into_iter()),
                args: IdList::EMPTY,
            },
        };
        let end = pos + self.b.atoms.bytes(name).len() as u32;
        self.b.file.ty(kind, pos, end)
    }

    /// `<T>(x)` was first parsed as the type parameters of an arrow function and turned out to be a cast. Builds the cast's type from
    /// the single type parameter. `kept` is the payload of the note.
    fn cast_type_from_type_params(&mut self, kept: u32) -> Option<TypeNodeId> {
        let params = self.type_params_at(kept);
        (params.len() == 1).then(|| self.type_from_type_param(params.at(0)))
    }

    /// `async<T, U>(x)` likewise, and turned out to be a call.
    fn type_args_from_type_params(&mut self, kept: u32) -> IdList<TypeNodeId> {
        let types: SmallVec<[TypeNodeId; 4]> = self
            .type_params_at(kept)
            .iter()
            .map(|param| self.type_from_type_param(param))
            .collect();
        self.b.file.list(&types)
    }

    /// The type arguments that are the payload `kept` of a note.
    fn type_args_at(&mut self, kept: u32) -> IdList<TypeNodeId> {
        let [start, len] = self.noted.range(kept);
        IdList::new(start, len)
    }

    /// The type parameters that are the payload `kept` of a note.
    fn type_params_at(&mut self, kept: u32) -> Span<TypeParamId> {
        let [start, len] = self.noted.range(kept);
        let list: Span<TypeParamId> = Span::new(start, len);
        // `jsErrorAtRange(list.Loc, ..)`
        if let Some(last) = list.iter().next_back() {
            let at = (self.b.file[list.at(0)].start, self.b.file[last].end);
            self.b.js_error_at_range(at, 8004, b"");
        }
        list
    }

    /// The expression that is the payload `kept` of a note.
    fn expr_at(&mut self, kept: u32) -> ExprId {
        let expression = self.b.ts[ts::Id::<Expr>::from_index(kept)];
        self.expr(&expression)
    }

    fn annotation(&mut self, binding: ast::Loc) -> TypeNodeId {
        match self.note(binding, Mark::Annotation) {
            Some(at) => self.ts_type_at(at, 8010),
            None => TypeNodeId::NONE,
        }
    }

    /// `type_at`, of a type that `checkJSSyntax` says `code` of.
    fn ts_type_at(&mut self, kept: u32, code: u32) -> TypeNodeId {
        let ty = self.type_at(kept);
        self.js_error_at_types(ty, ty, code);
        ty
    }

    /// `jsErrorAtRange`, of a type or of a list of types.
    fn js_error_at_types(&mut self, first: TypeNodeId, last: TypeNodeId, code: u32) {
        if first.is_some() {
            let at = (self.b.file[first].pos, self.b.file[last].end);
            self.b.js_error_at_range(at, code, b"");
        }
    }

    /// `checkJSSyntax`, of type arguments.
    fn check_js_type_arguments(&mut self, list: IdList<TypeNodeId>) {
        if !list.is_empty() {
            let last = self.b.file.id_at(list, list.len() - 1);
            self.js_error_at_types(self.b.file.id_at(list, 0), last, 8011);
        }
    }

    /// `checkJSSyntax`: the modifiers that are written and are not of `ModifierFlagsJavaScript`. `checkJSDecoratorSyntax`, with
    /// `decorators`: the first decorator, of what `CanHaveIllegalDecorators`.
    fn check_js_modifiers(&mut self, list: Span<ModifierId>, mut decorators: bool) {
        const JAVASCRIPT: Flags = Flags::EXPORT
            .union(Flags::STATIC)
            .union(Flags::ACCESSOR)
            .union(Flags::ASYNC)
            .union(Flags::DEFAULT)
            .union(Flags::REPARSED);
        for index in 0..list.len() {
            let Modifier { kind, pos } = self.b.file.modifier_list(list)[index];
            match kind {
                ModifierKind::Keyword(flag) if !JAVASCRIPT.intersects(flag) => {
                    let text = hir::modifier_text(flag).as_bytes();
                    self.b.js_error_at_range((pos, 0), 8009, text);
                }
                ModifierKind::Decorator(e) if std::mem::take(&mut decorators) => {
                    let end = hir::end_of_expr(&self.b.file, e);
                    self.b.js_error_at_range((pos, end), 1206, b"");
                }
                _ => {}
            }
        }
    }

    /// `checkJSSyntax`, of the statement `id`, which has its range and its modifiers and nothing of its comments yet.
    fn check_js_syntax(&mut self, id: StmtId) {
        let stmt = self.b.file[id];
        if let StmtKind::Fn(_) | StmtKind::Var(_) | StmtKind::Class(_) = stmt.kind {
            self.check_js_modifiers(stmt.modifiers, false);
        }
        let (file, whole) = (&self.b.file, (stmt.start, stmt.loc.end));
        let (at, code, what): (_, _, &[u8]) = match stmt.kind {
            StmtKind::Fn(f) if matches!(file[f].body, FnBody::None) => (whole, 8017, b""),
            StmtKind::Import(i) if file[i].type_only => (whole, 8006, b"import type"),
            StmtKind::ExportNamed(e) if file[e].type_only => (whole, 8006, b"export type"),
            StmtKind::ExportStar { type_only, .. } if type_only => (whole, 8006, b"export type"),
            StmtKind::ImportEquals(_) => (whole, 8002, b""),
            StmtKind::ExportAssign(_) => (whole, 8003, b""),
            StmtKind::Interface(i) => ((file[i].name_pos, 0), 8006, b"interface"),
            // `parseAmbientExternalModuleDeclaration` does not ask.
            StmtKind::Module(m) if !matches!(file[m].name, ModuleName::Ident(_)) => return,
            StmtKind::Module(m) if file[m].says_module => ((file[m].name_pos, 0), 8006, b"module"),
            StmtKind::Module(m) => ((file[m].name_pos, 0), 8006, b"namespace"),
            StmtKind::Enum(e) => ((file[e].name_pos, 0), 8006, b"enum"),
            StmtKind::TypeAlias(a) => ((file[a].name_pos, 0), 8008, b""),
            _ => return,
        };
        self.b.js_error_at_range(at, code, what);
    }

    /// `Builder::identifier`
    fn identifier(&self, r: ast::Ref, pos: u32) -> Atom {
        self.b.identifier(self.p.load_name_from_ref(r), pos)
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
                    StmtData::SExportDefault(_) | StmtData::SExportEquals(_)
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
            let (end_of_file, full_start) = (self.b.file.source_len, self.end_of_file_full_start);
            self.with_jsdoc(end_of_file, full_start, false, &mut Host::Other);
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
        let block = self.b.file.stmt(StmtKind::Block(list), self.pos_of(loc));
        self.finish_stmt(block, loc)
    }

    fn required_stmt(&mut self, stmt: &Stmt) -> StmtId {
        match self.stmt(stmt) {
            Some(id) => id,
            None => {
                let empty = self.b.file.stmt(StmtKind::Empty, self.pos_of(stmt.loc));
                self.finish_stmt(empty, stmt.loc)
            }
        }
    }

    /// `finishNode`, of the statement `id`, which the parser says is at `loc`.
    fn finish_stmt(&mut self, id: StmtId, loc: ast::Loc) -> StmtId {
        let start = self.declaration_start(loc);
        let mut range = self.range_of(loc);
        // A block whose `{` is missing takes no room.
        if range.end == 0 {
            range.end = range.pos;
        }
        let stmt = &mut self.b.file[id];
        (stmt.start, stmt.loc) = (start, range);
        // `else if`: `t_if` makes the chain in a loop, and every `if` of it ends where the first does.
        let mut last = id;
        while let StmtKind::If { no, .. } = self.b.file[last].kind
            && no.is_some()
            && matches!(self.b.file[no].kind, StmtKind::If { .. })
        {
            self.b.file[no].loc.end = range.end;
            last = no;
        }
        id
    }

    /// Clones a statement that only exists in TypeScript.
    fn ts_statement(&mut self, id: ts::StatementId) -> Option<StmtId> {
        let ts::Statement {
            data,
            modifiers,
            loc,
        } = self.b.ts[id];
        let (mut flags, export_pos) = self.b.clone_statement_modifiers(modifiers);
        flags |= self.ambient();
        // A statement starts at its decorators or at `export`, but not at `declare`.
        let first_decorator = self.b.ts[modifiers]
            .iter()
            .filter(|modifier| modifier.decorator.is_some())
            .map(|modifier| self.pos_of(modifier.loc))
            .min();
        // These are said to be at `export` or at their keyword, decorated or not.
        let keyword = export_pos.unwrap_or_else(|| self.pos_of(loc));
        let pos = first_decorator.map_or(keyword, |at_sign| at_sign.min(keyword));
        let statement = match data {
            ts::StatementData::Interface(interface) => {
                self.b.clone_interface(interface, flags, pos)
            }
            ts::StatementData::TypeAlias(alias) => Some(self.b.clone_type_alias(alias, flags, pos)),
            ts::StatementData::Import(import) => Some(self.import_declaration(import, keyword)),
            ts::StatementData::ImportEquals(import) => {
                let mut flags = flags & (Flags::EXPORT | Flags::AMBIENT);
                if self.is_ambient {
                    flags |= Flags::AMBIENT;
                }
                Some(self.import_equals_declaration(import, flags, keyword))
            }
            ts::StatementData::Export(export) => Some(self.export_declaration(export, keyword)),
            ts::StatementData::ExportAsNamespace(name) => {
                Some(self.namespace_export_declaration(name, keyword))
            }
        };
        if statement.is_none() {
            self.b.file.syntax_errors += 1;
        }
        statement
    }

    /// `NodeFlagsAmbient`, as a flag of a declaration.
    #[inline]
    fn ambient(&self) -> Flags {
        if self.is_ambient {
            Flags::AMBIENT
        } else {
            Flags::empty()
        }
    }

    /// All that the modifiers say which the parser took for the statement, or for the member or the parameter whose name it is, that has
    /// the `loc` `loc`.
    fn modifier_flags_at(&self, loc: ast::Loc) -> Flags {
        let Some(list) = self.modifier_list_at(loc) else {
            return Flags::empty();
        };
        self.b.ts[list]
            .iter()
            .fold(Flags::empty(), |flags, modifier| {
                flags | Flags::from_bits_retain(modifier.flag.bits())
            })
    }

    /// The same, one by one, with where each is.
    fn modifiers_at(&self, loc: ast::Loc) -> Vec<(Flags, u32)> {
        let Some(list) = self.modifier_list_at(loc) else {
            return Vec::new();
        };
        self.b.ts[list]
            .iter()
            .filter(|modifier| modifier.decorator.is_none())
            .map(|modifier| {
                (
                    Flags::from_bits_retain(modifier.flag.bits()),
                    self.pos_of(modifier.loc),
                )
            })
            .collect()
    }

    fn stmt(&mut self, stmt: &Stmt) -> Option<StmtId> {
        // `declare` makes all of the statement ambient.
        let was_ambient = self.is_ambient;
        self.is_ambient |= self.modifier_flags_at(stmt.loc).contains(Flags::AMBIENT);
        let id = self.stmt_in_context(stmt);
        self.is_ambient = was_ambient;
        id
    }

    fn stmt_in_context(&mut self, stmt: &Stmt) -> Option<StmtId> {
        let id = self.stmt_without_jsdoc(stmt);
        if let Some(id) = id {
            self.finish_stmt(id, stmt.loc);
            self.statement_modifiers(stmt.loc, id);
            if self.b.is_js {
                self.check_js_syntax(id);
            }
        }
        // `S::Comment`, a comment kept for the printer, is no node. The parser puts it where the next statement starts.
        if !self.jsdoc.list.is_empty() && !matches!(stmt.data, StmtData::SComment(_)) {
            self.statement_jsdoc(stmt, id);
        }
        id
    }

    /// Those modifiers.
    fn modifier_list_at(&self, loc: ast::Loc) -> Option<ts::Span<ts::Modifier>> {
        let kept = self.note(loc, Mark::Modifiers)?;
        Some(ts::Span::from_parts(self.noted.range(kept)))
    }

    /// Gives the statement `id`, which the parser says is at `loc`, the modifiers the parser took for it.
    fn statement_modifiers(&mut self, loc: ast::Loc, id: StmtId) {
        let list = match self.modifier_list_at(loc) {
            Some(list) => list,
            // A class has its decorators all the same.
            None if matches!(self.b.file[id].kind, StmtKind::Class(_)) => ts::Span::EMPTY,
            None => return,
        };
        let mut modifiers = Vec::with_capacity(list.len());
        for modifier in list.iter() {
            let ts::Modifier {
                flag,
                loc,
                decorator,
            } = self.b.ts[modifier];
            let kind = match decorator {
                Some(decorator) => ModifierKind::Decorator(self.expr(&decorator)),
                None => ModifierKind::Keyword(Flags::from_bits_retain(flag.bits())),
            };
            let pos = self.pos_of(loc);
            modifiers.push(Modifier { kind, pos });
        }
        // The parser finds out that decorators decorate no class after it has taken the keywords that follow them.
        modifiers.sort_by_key(|modifier| modifier.pos);
        self.b.statement_modifiers = modifiers;
        self.b.take_statement_modifiers(id, 0);
    }

    /// `withJSDoc`, of the statement `stmt`, which was lowered to `id`.
    fn statement_jsdoc(&mut self, stmt: &Stmt, id: Option<StmtId>) {
        let start = self.declaration_start(stmt.loc);
        let mut host = match id.map(|id| (id, self.b.file[id].kind)) {
            Some((_, StmtKind::Var(decls))) => Host::VariableStatement(decls),
            // `parseExpressionOrLabeledStatement`: what starts with a parenthesis leaves the comment to that.
            Some((_, StmtKind::Expr(_))) if self.note(stmt.loc, Mark::HasParen).is_some() => {
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
        let full_start = self.full_start_of(stmt.loc);
        self.with_noted_jsdoc(full_start, start, false, &mut host);
    }

    /// `withJSDoc`, of the node `host` whose first token is at `token`, if the parser said where it fully starts.
    fn with_noted_jsdoc(
        &mut self,
        full_start: Option<u32>,
        token: u32,
        with_trailing: bool,
        host: &mut Host,
    ) {
        if !self.jsdoc.list.is_empty()
            && let Some(full_start) = full_start
        {
            self.with_jsdoc(token, full_start, with_trailing, host);
        }
    }

    /// Where the first token of the statement or the class expression that is said to be at `loc` is: its decorators and modifiers are
    /// part of it.
    fn declaration_start(&self, loc: ast::Loc) -> u32 {
        self.note(loc, Mark::DeclarationStart)
            .unwrap_or_else(|| self.pos_of(loc))
    }

    /// Where the `@` of `decorator` is.
    fn at_sign(&self, decorator: &Expr) -> u32 {
        self.note(decorator.loc, Mark::AtSign)
            .unwrap_or_else(|| self.pos_of(decorator.loc))
    }

    /// The initializer of a `for` statement, which is no statement: a comment before it belongs to nothing.
    fn for_initializer(&mut self, stmt: &Stmt) -> StmtId {
        let id = match self.stmt_without_jsdoc(stmt) {
            Some(id) => id,
            None => self.b.file.stmt(StmtKind::Empty, self.pos_of(stmt.loc)),
        };
        self.finish_stmt(id, stmt.loc)
    }

    fn stmt_without_jsdoc(&mut self, stmt: &Stmt) -> Option<StmtId> {
        if !self.stack_check.is_safe_to_recurse() {
            self.b.file.syntax_errors += 1;
            return None;
        }
        let pos = self.pos_of(stmt.loc);
        let start = self.declaration_start(stmt.loc);
        self.b.statement_start = start;
        let kind = match &stmt.data {
            StmtData::STypeScript(placeholder)
                if placeholder.syntax != ast::ts_syntax::StatementId::NONE =>
            {
                return self.ts_statement(ts::Id::from_index(placeholder.syntax.0));
            }
            // Nothing is left of it.
            StmtData::STypeScript(_) => return None,
            // The parser gives `S::TypeScript` for these (`keep_import`, `keep_export`).
            StmtData::SImport(_)
            | StmtData::SExportClause(_)
            | StmtData::SExportFrom(_)
            | StmtData::SExportStar(_) => return None,
            StmtData::SEmpty(_) => StmtKind::Empty,
            StmtData::SDebugger(_) => StmtKind::Debugger,
            StmtData::SComment(_) | StmtData::SLazyExport(_) | StmtData::SDirective(_) => {
                return None;
            }
            StmtData::SBlock(s) => StmtKind::Block(self.stmts(s.stmts.slice(), false)),
            StmtData::SExpr(s) => StmtKind::Expr(self.expr(&s.value)),
            StmtData::SLocal(s) => self.local(s),
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
                StmtKind::ForOf {
                    left,
                    expr,
                    body,
                    is_await: s.is_await,
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
                    let pos = self.pos_of(case.loc);
                    // `parseCaseClause`, `parseDefaultClause`
                    let full_start = self.full_start_of(case.loc);
                    self.with_noted_jsdoc(full_start, pos, false, &mut Host::Other);
                    let end = self.noted_end(case.loc).unwrap_or(0);
                    cases.push(Case {
                        test,
                        body,
                        pos,
                        end,
                    });
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
                        let init = self.optional_expr_at(self.note(binding.loc, Mark::Initializer));
                        param = self.b.file.add_var_decl(VarDecl {
                            pat,
                            ty,
                            init,
                            kind: VarKind::Let,
                            flags: Flags::empty(),
                            loc: self.range_of(binding.loc),
                        });
                        let (start, full_start) =
                            (self.pos_of(binding.loc), self.b.file[param].loc.pos);
                        let mut host = Host::VariableDeclaration(param);
                        self.with_jsdoc(start, full_start, true, &mut host);
                    }
                    handler = self.block(catch.body.slice(), catch.body_loc);
                }
                let finalizer = match &s.finally {
                    Some(finally) => self.block(finally.stmts.slice(), finally.loc),
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
                let label = self.identifier(s.name.ref_, pos);
                let body = self.required_stmt(&s.stmt);
                StmtKind::Labeled { label, body }
            }
            StmtData::SWith(s) => {
                let value = self.expr(&s.value);
                let value = self.b.file.stmt(StmtKind::Expr(value), pos);
                // The expression, which the `)` follows.
                self.b.file[value].loc = self.range_of(s.body_loc);
                let body = self.required_stmt(&s.body);
                // `parseWithStatement`: `NodeFlagsInWithStatement` is on the statement, not on what is in the parentheses.
                let start = self.pos_of(s.body_loc) + 1;
                let end = self.b.file[body].loc.end;
                self.b.file.with_bodies.push((start, end));
                StmtKind::Block(self.b.file.list(&[value, body]))
            }
            StmtData::SBreak(s) => StmtKind::Break(
                s.label
                    .as_ref()
                    .map_or(Atom::NONE, |l| self.identifier(l.ref_, pos)),
            ),
            StmtData::SContinue(s) => StmtKind::Continue(
                s.label
                    .as_ref()
                    .map_or(Atom::NONE, |l| self.identifier(l.ref_, pos)),
            ),
            StmtData::SFunction(s) => {
                let mut flags = self.ambient();
                if s.func.flags.contains(ast::flags::Function::IsExport) {
                    flags |= Flags::EXPORT;
                }
                StmtKind::Fn(self.func(&s.func, FnKind::Decl, flags, pos, start))
            }
            StmtData::SClass(s) => {
                let mut flags = self.ambient() | self.modifier_flags_at(stmt.loc) & Flags::ABSTRACT;
                if s.is_export {
                    flags |= Flags::EXPORT;
                }
                StmtKind::Class(self.class(&s.class, flags, pos, start))
            }
            StmtData::SExportDefault(s) => match &s.value {
                StmtOrExpr::Expr(e) => StmtKind::ExportDefault(self.expr(e)),
                StmtOrExpr::Stmt(inner) => match &inner.data {
                    StmtData::SFunction(f) => StmtKind::Fn(self.func(
                        &f.func,
                        FnKind::Decl,
                        Flags::EXPORT | Flags::DEFAULT | self.ambient(),
                        pos,
                        start,
                    )),
                    StmtData::SClass(c) => StmtKind::Class(self.class(
                        &c.class,
                        Flags::EXPORT
                            | Flags::DEFAULT
                            | self.ambient()
                            | self.modifier_flags_at(stmt.loc) & Flags::ABSTRACT,
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
                    let member_pos = self.pos_of(value.loc);
                    // `HasDynamicName`: `[e]` declares nothing.
                    let computed_name =
                        self.optional_expr_at(self.note(value.loc, Mark::ComputedName));
                    let name = if computed_name.is_some() {
                        Atom::NONE
                    } else {
                        self.b.atom(value.name.slice())
                    };
                    members.push(EnumMember {
                        name,
                        name_kind: match self.note(value.loc, Mark::NameKind) {
                            Some(1) => NameKind::StringLiteral,
                            Some(2) => NameKind::NumericLiteral,
                            Some(3) => NameKind::ComputedString,
                            Some(4) => NameKind::ComputedNumber,
                            _ => NameKind::Identifier,
                        },
                        computed_name,
                        init,
                        pos: member_pos,
                        loc: self.range_of(value.loc),
                    });
                }
                let members = self.b.file.add_enum_members(&members);
                let mut flags = self.ambient() | self.modifier_flags_at(stmt.loc) & Flags::CONST;
                if s.is_export {
                    flags |= Flags::EXPORT;
                }
                StmtKind::Enum(self.b.file.add_enum(Enum {
                    name: self.identifier(s.name.ref_, self.pos_of(s.name.loc)),
                    name_pos: self.pos_of(s.name.loc),
                    flags,
                    members,
                    stmt: StmtId::NONE,
                }))
            }
            StmtData::SNamespace(s) => {
                let name = if self.note(s.name.loc, Mark::GlobalName).is_some() {
                    ModuleName::Global
                } else if self.note(s.name.loc, Mark::StringName).is_some() {
                    ModuleName::String(self.name(s.name.ref_))
                } else {
                    ModuleName::Ident(self.identifier(s.name.ref_, self.pos_of(s.name.loc)))
                };
                let mut flags = self.ambient();
                // `parseAmbientExternalModuleDeclaration`: what is in it is ambient, with or without `declare`.
                let was_ambient = self.is_ambient;
                self.is_ambient |= !matches!(name, ModuleName::Ident(_));
                if name == ModuleName::Global {
                    flags |= Flags::AMBIENT;
                }
                if s.is_export {
                    flags |= Flags::EXPORT;
                }
                let body = self.stmts(s.stmts.slice(), false);
                self.is_ambient = was_ambient;
                StmtKind::Module(self.b.file.add_module(Module {
                    name,
                    name_pos: self.pos_of(s.name.loc),
                    flags,
                    body,
                    has_body: self.note(s.name.loc, Mark::NoBody).is_none(),
                    says_module: self.note(s.name.loc, Mark::ModuleKeyword).is_some(),
                    stmt: StmtId::NONE,
                }))
            }
        };
        Some(self.b.file.stmt(kind, pos))
    }

    fn local(&mut self, s: &S::Local) -> StmtKind {
        let kind = match s.kind {
            S::Kind::KVar => VarKind::Var,
            S::Kind::KLet => VarKind::Let,
            S::Kind::KConst => VarKind::Const,
            S::Kind::KUsing => VarKind::Using,
            S::Kind::KAwaitUsing => VarKind::AwaitUsing,
        };
        let base = self.list_decls.len();
        for decl in s.decls.iter() {
            let mut flags = self.ambient();
            if s.is_export {
                flags |= Flags::EXPORT;
            }
            if self.note(decl.binding.loc, Mark::Definite).is_some() {
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
                loc: self.range_of(decl.binding.loc),
            });
        }
        let decls = self.b.file.add_var_decls(&self.list_decls[base..]);
        self.list_decls.truncate(base);
        // `parseVariableDeclarationWorker`
        if !self.jsdoc.list.is_empty() {
            for (id, decl) in decls.iter().zip(s.decls.iter()) {
                let (start, full_start) = (self.pos_of(decl.binding.loc), self.b.file[id].loc.pos);
                self.with_jsdoc(start, full_start, true, &mut Host::VariableDeclaration(id));
            }
        }
        StmtKind::Var(decls)
    }

    // ───────────────────────────── bindings ─────────────────────────────

    fn binding(&mut self, binding: &ast::Binding) -> PatId {
        let pos = self.pos_of(binding.loc);
        if !self.stack_check.is_safe_to_recurse() {
            return self.b.file.pat(PatKind::Missing, pos, pos);
        }
        // A name that is a piece of the text is as long as it is written.
        if let B::B::BIdentifier(id) = &binding.data
            && id.r#ref.is_source_contents_slice()
        {
            let kind = PatKind::Ident(self.identifier(id.r#ref, pos));
            return self.b.file.pat(kind, pos, pos + id.r#ref.inner_index());
        }
        let mut end = self.note(binding.loc, Mark::PatternEnd).unwrap_or(pos);
        let kind = match &binding.data {
            // `createMissingIdentifier`: a name of no length, where the token before it ends.
            B::B::BMissing(_) => PatKind::Ident(self.b.atom(b"")),
            B::B::BIdentifier(id) => {
                // A name without an escape is as long as it is written.
                if end == pos {
                    end += self.p.load_name_from_ref(id.r#ref).len() as u32;
                }
                PatKind::Ident(self.identifier(id.r#ref, pos))
            }
            B::B::BArray(array) => {
                let items = array.items();
                let mut elems = Vec::with_capacity(items.len());
                for item in items {
                    // `parseArrayBindingElement`: each element has its own `...`.
                    let dots = self.note(item.binding.loc, Mark::DotDotDot);
                    let is_rest = dots.is_some();
                    // `[a, , b]`: only an element that is left out has no name. It is said to be where its comma is.
                    let hole = self
                        .note(item.binding.loc, Mark::OmittedExpression)
                        .filter(|_| {
                            matches!(item.binding.data, B::B::BMissing(_))
                                && !is_rest
                                && item.default_value.is_none()
                        });
                    let pat = match hole {
                        // `finishNode(NewOmittedExpression(), nodePos())`
                        Some(full_start) => {
                            let comma = self.pos_of(item.binding.loc);
                            self.b.file.pat(PatKind::Missing, comma, full_start)
                        }
                        None => self.binding(&item.binding),
                    };
                    let default = self.optional_expr(item.default_value.as_ref());
                    elems.push(PatElem {
                        pat,
                        default,
                        is_rest,
                        start: dots.unwrap_or(self.b.file[pat].pos),
                        end: match default.is_some() {
                            true => self.written_end,
                            false => self.b.file[pat].end,
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
                        self.pos_of(property.value.loc)
                    } else if is_computed {
                        self.start_of_computed_name(&property.key)
                    } else {
                        self.pos_of(property.key.loc)
                    };
                    let dots = self.note(property.value.loc, Mark::DotDotDot);
                    let pos = dots.filter(|_| is_rest).unwrap_or(key_pos);
                    props.push(PatProp {
                        key,
                        name_kind: self.name_kind(&property.key, is_computed),
                        value,
                        default,
                        is_rest,
                        pos,
                        key_pos,
                        end: match default.is_some() {
                            true => self.written_end,
                            false => self.b.file[value].end,
                        },
                    });
                }
                PatKind::Object(self.b.file.add_pat_props(&props))
            }
        };
        self.b.file.pat(kind, pos, end)
    }

    /// Sets the key of an object type member that the parser kept with `[name]` still as an expression.
    fn fill_in_computed_key(&mut self, member: MemberId, name: &Expr) {
        let key = self.key(name, true);
        let file = &mut self.b.file;
        let member = &mut file.members[member.idx()];
        member.key = key;
        member.flags |= Flags::COMPUTED_NAME;
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
            && self.has_casts(key)
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

    /// How the name `key` is written.
    fn name_kind(&self, key: &Expr, is_computed: bool) -> NameKind {
        match (&key.data, is_computed) {
            (Data::EString(_), true) => NameKind::ComputedString,
            (Data::ENumber(_), true) => NameKind::ComputedNumber,
            (Data::ENumber(_), false) => NameKind::NumericLiteral,
            (Data::EString(_), false) if self.note(key.loc, Mark::StringLiteralName).is_some() => {
                NameKind::StringLiteral
            }
            _ => NameKind::Identifier,
        }
    }

    /// `parseComputedPropertyName`: the name `[key]` starts at its bracket.
    fn start_of_computed_name(&self, key: &Expr) -> u32 {
        self.note(key.loc, Mark::ComputedName)
            .unwrap_or_else(|| self.pos_of(key.loc))
    }

    // ───────────────────────────── functions and classes ─────────────────────────────

    fn params(&mut self, args: &[G::Arg]) -> Span<ParamId> {
        let base = self.list_params.len();
        let mut decorators: Vec<(usize, ExprId)> = Vec::new();
        let mut modifier_lists: Vec<(usize, Span<ModifierId>)> = Vec::new();

        for (i, arg) in args.iter().enumerate() {
            let mut flags = Flags::empty();
            // `parseParameterEx`: each parameter has its own `...`.
            if self.note(arg.binding.loc, Mark::DotDotDot).is_some() {
                flags |= Flags::REST;
            }
            if let Some(question) = self.note(arg.binding.loc, Mark::Optional) {
                flags |= Flags::OPTIONAL;
                self.b.js_error_at_range((question, 0), 8009, b"?");
            }
            let pos = self.declaration_start(arg.binding.loc);
            let mut modifiers: Vec<(Flags, u32)> = Vec::new();
            if arg.is_typescript_ctor_field {
                const PROPERTY_MODIFIERS: Flags = Flags::PUBLIC
                    .union(Flags::PRIVATE)
                    .union(Flags::PROTECTED)
                    .union(Flags::READONLY)
                    .union(Flags::OVERRIDE);
                let written = self
                    .modifier_list_at(arg.binding.loc)
                    .unwrap_or(ts::Span::EMPTY);
                modifiers.extend(written.iter().map(|modifier| {
                    let ts::Modifier { flag, loc, .. } = self.b.ts[modifier];
                    (Flags::from_bits_retain(flag.bits()), self.pos_of(loc))
                }));
                let seen = modifiers
                    .iter()
                    .fold(Flags::empty(), |seen, modifier| seen | modifier.0);

                // The other modifiers mean nothing on a parameter. They are only objected to.
                flags |= seen & PROPERTY_MODIFIERS;
                if seen.intersects(PROPERTY_MODIFIERS) {
                    flags |= Flags::PARAMETER_PROPERTY;
                }
            }
            let pat = self.binding(&arg.binding);
            let ty = self.annotation(arg.binding.loc);
            let default = self.optional_expr(arg.default.as_ref());
            let loc = self.range_of(arg.binding.loc);
            self.list_params.push(Param {
                pat,
                ty,
                default,
                flags,
                pos,
                loc,
            });
            let first_decorator = decorators.len();
            for decorator in arg.ts_decorators.iter() {
                decorators.push((i, self.expr(decorator)));
            }
            if !modifiers.is_empty() || decorators.len() > first_decorator {
                let keywords = self.b.add_modifier_list(&modifiers);
                let of_parameter: Vec<(ExprId, u32)> = decorators[first_decorator..]
                    .iter()
                    .zip(arg.ts_decorators.iter())
                    .map(|(&(_, e), written)| (e, self.at_sign(written)))
                    .collect();
                let list = self.b.modifiers_with_decorators(keywords, &of_parameter);
                modifier_lists.push((i, list));
                // `node.Modifiers().Loc`
                if let Some(&(flag, at)) = modifiers.last() {
                    let end = of_parameter
                        .last()
                        .map_or(0, |d| hir::end_of_expr(&self.b.file, d.0));
                    let end = end.max(at + hir::modifier_text(flag).len() as u32);
                    self.b.js_error_at_range((pos, end), 8012, b"");
                }
            }
        }
        let params = self.b.file.add_params(&self.list_params[base..]);
        self.list_params.truncate(base);
        for (i, list) in modifier_lists {
            self.b.file.set_param_modifiers(params.at(i), list);
        }
        for (i, e) in decorators {
            self.b
                .file
                .decorators
                .push((DecoratorOwner::Param(params.at(i)), e));
        }
        // `parseParameterEx`
        if !self.jsdoc.list.is_empty() {
            for (param, arg) in params.iter().zip(args) {
                // `parseSimpleArrowFunctionExpression`: the `x` of `x => x` has no comments of its own.
                if self
                    .note(arg.binding.loc, Mark::SimpleArrowParameter)
                    .is_none()
                {
                    let Param { pos, loc, .. } = self.b.file[param];
                    self.with_jsdoc(pos, loc.pos, true, &mut Host::Parameter(param));
                }
            }
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
        let type_params = match self.note(open, Mark::TypeParameters) {
            Some(at) => self.type_params_at(at),
            None => Span::EMPTY,
        };
        let this_param = match self.note(open, Mark::ThisParameter) {
            Some(kept) => {
                let this = ParamId(kept);
                let ty = self.b.file[this].ty;
                self.js_error_at_types(ty, ty, 8010);
                this
            }
            None => ParamId::NONE,
        };
        let params = self.params(func.args.slice());
        let ret = match self.note(open, Mark::ReturnType) {
            Some(at) => self.type_at(at),
            None => TypeNodeId::NONE,
        };
        // `parseFunctionBlockOrSemicolon`: no body at all after a semicolon.
        let body = if func
            .flags
            .contains(ast::flags::Function::IsForwardDeclaration)
        {
            FnBody::None
        } else {
            self.js_error_at_types(ret, ret, 8010);
            // `checkGrammarStatementInAmbientContext`, `checkGrammarAccessor`: of whatever has a body in an ambient context.
            if self.is_ambient || flags.contains(Flags::AMBIENT) {
                self.b
                    .file
                    .early_errors
                    .push((self.pos_of(func.body.loc), 1183));
            }
            FnBody::Block(self.stmts(func.body.stmts.slice(), false))
        };
        // `parseBlock` without its `{`: a missing block, which is not the same as no body.
        if self.note(open, Mark::MissingBody).is_some() {
            flags |= Flags::MISSING_BODY;
        }
        // `createMissingList`: without a `(` the parameters are where the token before them ends. The anchor is one before them.
        let anchor = match self.note(open, Mark::MissingParameters) {
            Some(list) => list.saturating_sub(1),
            None => self.pos_of(open),
        };
        let made = self.b.file.add_fn(Func {
            kind,
            flags,
            name: func
                .name
                .as_ref()
                .map_or(Atom::NONE, |n| self.identifier(n.ref_, self.pos_of(n.loc))),
            name_pos: func.name.as_ref().map_or(pos, |n| self.pos_of(n.loc)),
            type_params,
            params,
            this_param,
            ret,
            body,
            anchor,
            start,
        });
        if matches!(body, FnBody::Block(_)) {
            let open = self.pos_of(func.body.loc);
            self.b.file.body_starts.push((made, open));
        }
        made
    }

    fn arrow(&mut self, arrow: &ast::E::Arrow, loc: ast::Loc) -> FnId {
        let pos = self.pos_of(loc);
        let arrow_token = self
            .note(arrow.body.loc, Mark::ArrowToken)
            .or_else(|| arrow.prefer_expr.then(|| self.pos_of(arrow.body.loc)));
        let type_params = match self.note(loc, Mark::TypeParameters) {
            Some(at) => self.type_params_at(at),
            None => Span::EMPTY,
        };
        let params = self.params(arrow.args.slice());
        let (this_param, params) = self.b.file.split_this_parameter(params);
        let ret = match self.note(loc, Mark::ReturnType) {
            Some(at) => self.ts_type_at(at, 8010),
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
            _ => {
                if self.is_ambient {
                    self.b
                        .file
                        .early_errors
                        .push((self.pos_of(arrow.body.loc), 1183));
                }
                FnBody::Block(self.stmts(stmts, false))
            }
        };
        let anchor = arrow_token.unwrap_or(pos);
        let made = self.b.file.add_fn(Func {
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
            start: pos,
        });
        if matches!(body, FnBody::Block(_)) {
            let open = self.pos_of(arrow.body.loc);
            self.b.file.body_starts.push((made, open));
        }
        made
    }

    fn class(&mut self, class: &G::Class, flags: Flags, pos: u32, start: u32) -> ClassId {
        let keyword = class.class_keyword.loc;
        // `GetContainingClass`: its decorators and heritage clauses are inside it too.
        self.b.classes_around += 1;
        let type_params = match self.note(keyword, Mark::TypeParameters) {
            Some(at) => self.type_params_at(at),
            None => Span::EMPTY,
        };
        let mut extends = self.optional_expr(class.extends.as_ref());
        let mut extends_args = match self.note(keyword, Mark::ExtendsArguments) {
            Some(at) => self.type_args_at(at),
            None => IdList::EMPTY,
        };
        // `parseExpressionWithTypeArguments`: type arguments the expression took for itself are those of the clause.
        if let Some(written) = &class.extends
            && self.last_cast(written) == Some(Mark::Instantiation)
            && let ExprKind::Instantiation { expr, type_args } = self.b.file[extends].kind
        {
            extends = expr;
            extends_args = type_args;
        }
        self.check_js_type_arguments(extends_args);
        for &[start, end] in self
            .notes(keyword, Mark::ImplementsClause)
            .as_chunks::<2>()
            .0
        {
            self.b.js_error_at_range((start, end), 8005, b"");
        }
        let other_extends: Vec<ExprId> = self
            .notes(keyword, Mark::OtherExtends)
            .into_iter()
            .map(|kept| self.expr_at(kept))
            .collect();
        let other_extends = self.b.file.list(&other_extends);
        let [implements, other_implements] =
            [Mark::Implements, Mark::OtherImplements].map(|clause| {
                let elements: Vec<TypeNodeId> = self
                    .notes(keyword, clause)
                    .into_iter()
                    .map(|kept| self.type_at(kept))
                    .collect();
                self.b.file.list(&elements)
            });
        let of_class: Vec<(ExprId, u32)> = class
            .ts_decorators
            .iter()
            .map(|d| (self.expr(d), self.at_sign(d)))
            .collect();
        let mut members = Vec::with_capacity(class.properties.slice().len());
        // By where the member is: they are put in order further down.
        let mut of_members: Vec<(u32, ExprId)> = Vec::new();
        for property in class.properties.slice() {
            let decorators: Vec<(ExprId, u32)> = property
                .ts_decorators
                .iter()
                .map(|d| (self.expr(d), self.at_sign(d)))
                .collect();
            let mut member = self.class_member(property);
            // `parseClassElement`
            let named_at = match property.class_static_block_ref() {
                Some(block) => Some(block.loc),
                None => property.key.as_ref().map(|key| key.loc),
            };
            if let Some(at) = named_at {
                member.loc = self.member_range(at);
            }
            if let Some(start) = named_at.and_then(|at| self.note(at, Mark::MemberStart)) {
                member = self.member_jsdoc(member, start);
                members.append(&mut self.reparsed_members);
            }
            member.modifiers = self
                .b
                .modifiers_with_decorators(member.modifiers, &decorators);
            self.check_js_syntax_of_member(&member, named_at);
            of_members.extend(decorators.into_iter().map(|(e, _)| (member.name_pos, e)));
            members.push(member);
        }
        // `parseClassElement`: a `;` is a member, and has its comments.
        if !self.jsdoc.list.is_empty() {
            let semicolons = self.notes(keyword, Mark::SemicolonClassElement);
            let full_starts = self.notes(keyword, Mark::SemicolonFullStart);
            for (semicolon, full_start) in semicolons.into_iter().zip(full_starts) {
                self.with_jsdoc(semicolon, full_start, false, &mut Host::Other);
            }
        }
        for member in self.notes(keyword, Mark::IndexSignature) {
            let mut member = self.class_index_signatures[member as usize];
            if self.is_ambient {
                member.flags |= Flags::AMBIENT;
                self.b.file[member.func].flags |= Flags::AMBIENT;
            }
            self.check_js_syntax_of_member(&member, None);
            members.push(member);
        }
        self.b.classes_around -= 1;
        // Overloads go before what implements them.
        members.sort_by_key(|m| m.name_pos);
        // As they are written; those of one member keep their order.
        of_members.sort_by_key(|d| d.0);
        let members = self.b.file.add_members(&members);
        for (at, e) in of_members {
            if let Some(m) = members.iter().find(|&m| self.b.file[m].name_pos == at) {
                self.b.file.decorators.push((DecoratorOwner::Member(m), e));
            }
        }
        let modifiers = self.b.modifiers_with_decorators(Span::EMPTY, &of_class);
        let id = self.b.file.add_class(Class {
            name: class
                .class_name
                .as_ref()
                .map_or(Atom::NONE, |n| self.identifier(n.ref_, self.pos_of(n.loc))),
            name_pos: class
                .class_name
                .as_ref()
                .map_or(pos, |n| self.pos_of(n.loc)),
            flags,
            type_params,
            extends,
            extends_args,
            other_extends,
            implements,
            other_implements,
            members,
            start,
            modifiers,
        });
        for (e, _) in of_class {
            self.b.file.decorators.push((DecoratorOwner::Class(id), e));
        }
        id
    }

    /// `checkJSSyntax`, of a member of a class, whose name is at `name`.
    fn check_js_syntax_of_member(&mut self, member: &Member, name: Option<ast::Loc>) {
        if !self.b.is_js || member.kind == MemberKind::StaticBlock {
            return;
        }
        if matches!(member.kind, MemberKind::Property | MemberKind::Method)
            && let Some(question) = name.and_then(|name| self.note(name, Mark::Optional))
        {
            self.b.js_error_at_range((question, 0), 8009, b"?");
        }
        if member.func.is_some() && matches!(self.b.file[member.func].body, FnBody::None) {
            self.b
                .js_error_at_range((member.start, member.loc.end), 8017, b"");
        }
        if member.kind != MemberKind::IndexSignature {
            self.check_js_modifiers(member.modifiers, member.kind == MemberKind::Constructor);
        }
    }

    fn class_member(&mut self, property: &G::Property) -> Member {
        let mut member = Member {
            kind: MemberKind::Property,
            key: PropKey::None,
            flags: Flags::empty(),
            ty: TypeNodeId::NONE,
            init: ExprId::NONE,
            func: FnId::NONE,
            name_pos: 0,
            start: 0,
            loc: TextRange::default(),
            modifiers: Span::EMPTY,
        };
        if let Some(block) = property.class_static_block_ref() {
            member.kind = MemberKind::StaticBlock;
            member.flags = Flags::STATIC;
            member.name_pos = self.pos_of(block.loc);
            member.start = self
                .note(block.loc, Mark::MemberStart)
                .unwrap_or(member.name_pos);
            let modifiers = self.modifiers_at(block.loc);
            member.modifiers = self.b.add_modifier_list(&modifiers);
            let body = FnBody::Block(self.stmts(block.stmts.as_slice(), false));
            member.func = self.b.file.add_fn(Func {
                kind: FnKind::StaticBlock,
                flags: Flags::STATIC,
                name: Atom::NONE,
                name_pos: member.name_pos,
                type_params: Span::EMPTY,
                params: Span::EMPTY,
                this_param: ParamId::NONE,
                ret: TypeNodeId::NONE,
                body,
                anchor: member.name_pos,
                start: member.start,
            });
            return member;
        }
        let Some(key) = &property.key else {
            return member;
        };
        member.name_pos = self.pos_of(key.loc);
        member.start = member.name_pos;
        let is_computed = property.flags.contains(ast::flags::Property::IsComputed);
        member.key = self.key(key, is_computed);
        // `getDeclarationName`: a bigint names nothing.
        let is_named_by_bigint = !is_computed && matches!(key.data, Data::EBigInt(_));
        if is_named_by_bigint {
            member.key = PropKey::None;
        }
        if let Some(start) = self.note(key.loc, Mark::MemberStart) {
            member.start = start;
        }
        let modifiers = self.modifiers_at(key.loc);
        member.modifiers = self.b.add_modifier_list(&modifiers);
        // Its own `declare` makes a property or a method ambient.
        let is_parent_ambient = self.is_ambient;
        member.flags = modifiers
            .iter()
            .fold(self.ambient(), |flags, modifier| flags | modifier.0);
        if self.note(key.loc, Mark::Optional).is_some() {
            member.flags |= Flags::OPTIONAL;
        } else if self.note(key.loc, Mark::Definite).is_some() {
            member.flags |= Flags::DEFINITE;
        }
        member.ty = self.annotation(key.loc);

        let after_string = self.note(key.loc, Mark::StringLiteralName);
        let is_quoted = after_string.is_some();
        // `getLiteralTypeFromPropertyName`: `"0"` and `["0"]` name with a string, `0` and `[0]` with a number. An identifier is a
        // string to the parser as well.
        if (is_computed || is_quoted)
            && matches!(key.data, Data::EString(_))
            && matches!(member.key, PropKey::Name(_))
        {
            member.flags |= Flags::STRING_NAME;
        }
        if is_computed {
            member.flags |= Flags::COMPUTED_NAME;
            member.name_pos = self.start_of_computed_name(key);
        } else if is_quoted || matches!(key.data, Data::ENumber(_) | Data::EBigInt(_)) {
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
                && after_string.is_none_or(|next| next == self.pos_of(f.func.open_parens_loc));
            let is_constructor = is_named_constructor && property.kind == G::PropertyKind::Normal;
            let (member_kind, fn_kind) = match property.kind {
                G::PropertyKind::Get => (MemberKind::Getter, FnKind::Getter),
                G::PropertyKind::Set => (MemberKind::Setter, FnKind::Setter),
                _ if is_constructor => (MemberKind::Constructor, FnKind::Constructor),
                _ => (MemberKind::Method, FnKind::Method),
            };
            member.kind = member_kind;
            member.ty = TypeNodeId::NONE;
            // `parseClassElement`: but not an accessor or a constructor.
            if !is_parent_ambient && !matches!(member_kind, MemberKind::Method) {
                member.flags.remove(Flags::AMBIENT);
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
            let func = self.func(
                &f.func,
                fn_kind,
                member.flags,
                self.pos_of(*loc),
                member.start,
            );
            if !is_method {
                self.b.file[func].flags.remove(Flags::ASYNC);
            }
            self.b.file[func].name = member.key.name().unwrap_or(Atom::NONE);
            self.b.file[func].name_pos = member.name_pos;
            member.func = func;
            return member;
        }
        member
            .flags
            .remove(Flags::CONST | Flags::EXPORT | Flags::DEFAULT);
        // `checkVariableLikeDeclaration`
        if is_named_by_bigint {
            self.b.file.checker_errors.push((member.name_pos, 1539));
        }
        member.init = self.optional_expr(property.initializer.as_ref().or(property.value.as_ref()));
        member
    }

    // ───────────────────────────── expressions ─────────────────────────────

    /// `expr_at`, of a note that may not be there.
    fn optional_expr_at(&mut self, kept: Option<u32>) -> ExprId {
        match kept {
            Some(kept) => self.expr_at(kept),
            None => ExprId::NONE,
        }
    }

    fn optional_expr(&mut self, expr: Option<&Expr>) -> ExprId {
        match expr {
            Some(expr) => self.expr(expr),
            None => ExprId::NONE,
        }
    }

    /// `collectDynamicImportOrRequireOrJsDocImportCalls`: `argument` is what `import()` or `require()` is given, a string or a
    /// template without substitutions.
    fn call_specifier(&mut self, argument: ExprId, kind: SpecifierKind) {
        let hir::Expr {
            kind: literal, pos, ..
        } = self.b.file[argument];
        let spec = match literal {
            ExprKind::String(text) => text,
            ExprKind::Template { exprs } if exprs.is_empty() => {
                self.b.file.id_at(self.b.file.template_texts(exprs), 0)
            }
            _ => return,
        };
        self.b.file.specifier_uses.push(SpecifierUse {
            spec,
            pos,
            kind,
            mode: ResolutionMode::None,
        });
    }

    fn exprs<'e>(&mut self, exprs: impl Iterator<Item = &'e Expr>) -> IdList<ExprId> {
        let base = self.list_ids.len();
        for e in exprs {
            let id = self.expr(e);
            self.list_ids.push(id.0);
        }
        self.take_ids(base)
    }

    /// What was made last of `expr`, which is only `expr` in the parser's tree: `(x)`, `x as T`, `x!`, `x<T>`.
    #[inline]
    fn last_cast(&self, expr: &Expr) -> Option<Mark> {
        self.noted
            .of(expr.loc)
            .map(|note| note.what)
            .find(|what| what.is_cast())
    }

    #[inline]
    fn has_casts(&self, expr: &Expr) -> bool {
        self.last_cast(expr).is_some()
    }

    fn chain(chain: Option<ast::OptionalChain>) -> Chain {
        match chain {
            None => Chain::No,
            Some(ast::OptionalChain::Start) => Chain::Start,
            Some(ast::OptionalChain::Continuation) => Chain::Continue,
        }
    }

    pub(super) fn expr(&mut self, expr: &Expr) -> ExprId {
        if !self.stack_check.is_safe_to_recurse() {
            let pos = self.pos_of(expr.loc);
            self.b.file.syntax_errors += 1;
            self.written_end = pos;
            self.written_start = pos;
            return self.b.file.expr(ExprKind::Missing, pos, pos);
        }
        self.written_end = 0;
        let mut id = self.expr_without_casts(expr);
        // Where what has been made of it so far starts.
        let mut pos = self.b.file[id].pos;
        // Where what has been made of it so far ends.
        let mut end = self.b.file[id].end;
        if self.noted.has_notes(expr.loc) {
            // What is made of it, from the inside out.
            let mut made: SmallVec<[(Mark, u32); 4]> = self
                .noted
                .of(expr.loc)
                .map(|note| (note.what, note.payload))
                .collect();
            made.reverse();
            let mut paren_full_start = None;
            for (what, kept) in made {
                let kind = match what {
                    Mark::End => {
                        end = kept;
                        continue;
                    }
                    Mark::ParenFullStart => {
                        paren_full_start = Some(kept);
                        continue;
                    }
                    Mark::Paren => {
                        let open = kept;
                        // `parseParenthesizedExpression`
                        if let Some(full_start) = paren_full_start.take() {
                            let mut host = Host::Parenthesized(id);
                            self.with_jsdoc(open, full_start, true, &mut host);
                            if let Host::Parenthesized(inside) = host {
                                id = inside;
                            }
                        }
                        pos = open;
                        self.b.file.parens.push((id, open, end));
                        continue;
                    }
                    Mark::NonNull => {
                        self.b.js_error_at_range((pos, end), 8013, b"");
                        ExprKind::NonNull(id)
                    }
                    Mark::Instantiation => ExprKind::Instantiation {
                        expr: id,
                        type_args: self.type_args_at(kept),
                    },
                    Mark::Satisfies => ExprKind::Satisfies {
                        expr: id,
                        ty: self.ts_type_at(kept, 8037),
                    },
                    // `parseTypeAssertion`: `<T>e` starts at its `<`, and so does what is made of it afterwards.
                    Mark::LessThan => {
                        pos = kept;
                        continue;
                    }
                    Mark::As | Mark::AsTypeParameter => {
                        let ty = if what == Mark::As {
                            self.ts_type_at(kept, 8016)
                        } else {
                            match self.cast_type_from_type_params(kept) {
                                Some(ty) => ty,
                                None => self.b.error_type(pos),
                            }
                        };
                        match self.b.file[ty].kind {
                            TypeNodeKind::Ref { name, args }
                                if args.is_empty()
                                    && name.len() == 1
                                    && self.b.file[name.at(0)].text
                                        == bun_sema::atom::known::r#const =>
                            {
                                ExprKind::AsConst(id)
                            }
                            _ => ExprKind::As { expr: id, ty },
                        }
                    }
                    // Said of the node, and makes nothing of it.
                    _ => continue,
                };
                id = self.b.file.expr(kind, pos, end);
            }
        }
        self.written_end = end;
        self.written_start = pos;
        id
    }

    fn call(
        &mut self,
        callee: ExprId,
        args: IdList<ExprId>,
        anchor: ast::Loc,
        close: ast::Loc,
        chain: Chain,
    ) -> CallId {
        let type_args = match self.note(anchor, Mark::TypeArguments) {
            Some(at) => self.type_args_at(at),
            None => match self.note(anchor, Mark::TypeArgumentsReadAsParameters) {
                Some(kept) => self.type_args_from_type_params(kept),
                None => IdList::EMPTY,
            },
        };
        self.check_js_type_arguments(type_args);
        let close = self.noted.real_loc(close);
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
            // `tagged_template_contents` makes none for the type checker.
            ast::E::TemplateContents::Raw(s) => self.b.atom(s.slice()),
        }
    }

    /// `parsePropertyAccessExpressionRest`: `a<b>.c` is refused, at the `<`. `obj` is what `target` was lowered to.
    fn refuse_access_to_instantiation(&mut self, target: &Expr, obj: ExprId) {
        if matches!(self.b.file[obj].kind, ExprKind::Instantiation { .. })
            && self.last_cast(target) == Some(Mark::Instantiation)
            && let Some(less_than) = self.note(target.loc, Mark::InstantiationStart)
        {
            let end = self.b.file[obj].end;
            self.b.file.error(less_than, end, 1477);
        }
    }

    /// `parseJsxTagName`: `this` at the head of a tag name is the keyword, and a name is an identifier, which the parser gives as a
    /// string if the element is intrinsic. `tag` may be `NONE`.
    fn jsx_tag_name(&mut self, tag: ExprId) {
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
        } else if root.is_some()
            && let ExprKind::String(name) = self.b.file[root].kind
            && !self
                .b
                .atoms
                .bytes(name)
                .iter()
                .any(|c| matches!(c, b'-' | b':'))
        {
            self.b.file[root].kind = ExprKind::Ident(name);
        }
    }

    fn expr_without_casts(&mut self, expr: &Expr) -> ExprId {
        // What starts with a part starts where that is written to start, parentheses and all (`GetTokenPosOfNode`).
        let (mut pos, mut end) = match self.noted.node(expr.loc) {
            Some(node) => (node.loc.start.max(0) as u32, node.end.start.max(0) as u32),
            None => (expr.loc.start.max(0) as u32, 0),
        };
        let kind = match &expr.data {
            Data::EInlinedEnum(e) => return self.expr(&e.value),
            Data::EIdentifier(e) => {
                // A name that is a piece of the text is as long as it is written.
                if e.ref_.is_source_contents_slice() {
                    end = pos + e.ref_.inner_index();
                }
                ExprKind::Ident(self.identifier(e.ref_, pos))
            }
            Data::EImportIdentifier(e) => ExprKind::Ident(self.identifier(e.ref_, pos)),
            Data::ECommonjsExportIdentifier(e) => ExprKind::Ident(self.identifier(e.ref_, pos)),
            Data::ENameOfSymbol(e) => ExprKind::Ident(self.identifier(e.ref_, pos)),
            Data::EPrivateIdentifier(e) => ExprKind::String(self.name(e.ref_)),
            Data::EThis(_) => {
                end = pos + b"this".len() as u32;
                ExprKind::This
            }
            Data::ESuper(_) => {
                end = pos + b"super".len() as u32;
                ExprKind::Super
            }
            Data::ENull(_) => {
                end = pos + b"null".len() as u32;
                ExprKind::Null
            }
            Data::EUndefined(_) => ExprKind::Ident(bun_sema::atom::known::undefined),
            Data::EBoolean(e) | Data::EBranchBoolean(e) => {
                if e.value {
                    end = pos + b"true".len() as u32;
                    ExprKind::True
                } else {
                    end = pos + b"false".len() as u32;
                    ExprKind::False
                }
            }
            Data::ENumber(e) => ExprKind::Number(self.b.file.number(e.value())),
            Data::EBigInt(e) => ExprKind::BigInt(self.b.atom(e.value.slice())),
            Data::EString(e) => {
                if end == 0 {
                    let quoted =
                        super::notes::end_of_quoted(self.p.source.contents(), e.data.slice());
                    end = quoted.unwrap_or(0) as u32;
                }
                ExprKind::String(self.string(e))
            }
            Data::ERegExp(_) => ExprKind::Regex,
            Data::ENewTarget(_) => {
                // `parseMetaProperty` takes any word for the name, or none.
                let written = self
                    .note(expr.loc, Mark::MetaPropertyName)
                    .map(|kept| self.b.ts[ts::Id::<Expr>::from_index(kept)]);
                let name = match &written {
                    Some(Expr {
                        data: Data::EString(name),
                        ..
                    }) => self.string(name),
                    _ => self.b.atom(b"target"),
                };
                ExprKind::NewTarget(name)
            }
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
                // `File::template_texts`
                let texts: IdList<Atom> = self.take_ids(base);
                debug_assert_eq!(texts.start, exprs.start + exprs.len);
                match &e.tag {
                    Some(tag) => {
                        let type_args = match self.note(expr.loc, Mark::TagTypeArguments) {
                            Some(at) => self.type_args_at(at),
                            None => IdList::EMPTY,
                        };
                        self.check_js_type_arguments(type_args);
                        let callee = self.expr(tag);
                        pos = pos.min(self.written_start);
                        // `callIsIncomplete`: the checker takes a `close_pos` where no `)` is for an incomplete call.
                        let close_pos = if self.note(expr.loc, Mark::IncompleteTemplate).is_some() {
                            u32::MAX - 1
                        } else {
                            u32::MAX
                        };
                        // A `NoSubstitutionTemplateLiteral` is a string, as it is without a tag.
                        let template = if exprs.is_empty() {
                            ExprKind::String(head)
                        } else {
                            ExprKind::Template { exprs }
                        };
                        let template_pos = self.note(expr.loc, Mark::Backtick).unwrap_or(pos);
                        let template = self.b.file.expr(template, template_pos, end);
                        ExprKind::TaggedTemplate(self.b.file.add_call(Call {
                            callee,
                            args: exprs,
                            type_args,
                            close_pos,
                            chain: Chain::No,
                            template,
                        }))
                    }
                    None => ExprKind::Template { exprs },
                }
            }
            Data::EArray(e) => {
                if end == 0 {
                    end = self.pos_of(e.close_bracket_loc) + 1;
                }
                ExprKind::Array(self.exprs(e.items.iter()))
            }
            Data::EObject(e) => {
                // A synthesized object (`parse_json_text` for an empty file) has no closing brace and is zero-width.
                if end == 0 && !e.close_brace_loc.is_empty() {
                    end = self.pos_of(e.close_brace_loc) + 1;
                }
                ExprKind::Object(self.props(e.properties.as_slice(), true))
            }
            Data::ESpread(e) => ExprKind::Spread(self.expr(&e.value)),
            Data::EFunction(e) => {
                let func = self.func(&e.func, FnKind::Expr, Flags::empty(), pos, pos);
                let full_start = self.full_start_of(expr.loc);
                self.with_noted_jsdoc(full_start, pos, true, &mut Host::Function(func));
                ExprKind::Fn(func)
            }
            Data::EArrow(e) => {
                let func = self.arrow(e, expr.loc);
                let full_start = self.full_start_of(expr.loc);
                self.with_noted_jsdoc(full_start, pos, true, &mut Host::Function(func));
                ExprKind::Fn(func)
            }
            Data::EClass(e) => {
                let class = self.class(e, Flags::empty(), pos, self.declaration_start(expr.loc));
                let full_start = self.full_start_of(expr.loc);
                self.with_noted_jsdoc(full_start, pos, false, &mut Host::Class(class));
                ExprKind::Class(class)
            }
            Data::EDot(e) => {
                let obj = self.expr(&e.target);
                pos = pos.min(self.written_start);
                self.refuse_access_to_instantiation(&e.target, obj);
                let name_pos = self.pos_of(e.name_loc);
                if end == 0 {
                    end = name_pos + e.name.len() as u32;
                }
                ExprKind::Dot {
                    obj,
                    name: self.b.atom(e.name.slice()),
                    name_pos,
                    chain: Self::chain(e.optional_chain),
                }
            }
            Data::EIndex(e) => {
                let obj = self.expr(&e.target);
                pos = pos.min(self.written_start);
                let chain = Self::chain(e.optional_chain);
                match &e.index.data {
                    Data::EPrivateIdentifier(id) => {
                        self.refuse_access_to_instantiation(&e.target, obj);
                        ExprKind::Dot {
                            obj,
                            name: self.name(id.ref_),
                            name_pos: self.pos_of(e.index.loc),
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
                pos = pos.min(self.written_start);
                // `IsRequireCall`. `File::parens` is not in order yet: what was lowered last is at its end.
                let is_require = self.b.is_js
                    && matches!(
                        self.b.file[callee].kind,
                        ExprKind::Ident(bun_sema::atom::known::require)
                    )
                    && self.b.file.parens.last().is_none_or(|p| p.0 != callee);
                let args = self.exprs(e.args.iter());
                if is_require && args.len() == 1 {
                    let argument = self.b.file.id_at(args, 0);
                    if self.b.file.parens.last().is_none_or(|p| p.0 != argument) {
                        self.call_specifier(argument, SpecifierKind::RequireCall);
                    }
                }
                if end == 0 {
                    end = self.pos_of(e.close_paren_loc) + 1;
                }
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
                let operand = self.expr(&e.value);
                pos = pos.min(self.written_start);
                ExprKind::Unary { op, operand }
            }
            Data::EBinary(_) => return self.binary(expr),
            Data::EIf(e) => {
                let test = self.expr(&e.test);
                pos = pos.min(self.written_start);
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
                let options = (!matches!(e.options.data, Data::EMissing(_))).then_some(&e.options);
                let kept: SmallVec<[Expr; 2]> = self
                    .notes(expr.loc, Mark::OtherArgument)
                    .into_iter()
                    .map(|kept| self.b.ts[ts::Id::<Expr>::from_index(kept)])
                    .collect();
                let args = self.exprs(std::iter::once(&e.expr).chain(options).chain(&kept));
                let specifier = self.b.file.id_at(args, 0);
                if matches!(self.b.file[specifier].kind, ExprKind::String(_)) {
                    self.call_specifier(specifier, SpecifierKind::ImportCall);
                }
                if let Some(close) = self.note(expr.loc, Mark::DeferredImportClose) {
                    let specifier = self.b.file.id_at(args, 0);
                    self.b.file.deferred_import_calls.push((specifier, close));
                }
                if let Some(at) = self.note(expr.loc, Mark::TypeArguments) {
                    let type_args = self.type_args_at(at);
                    self.b
                        .file
                        .import_call_type_args
                        .push((specifier, type_args));
                }
                ExprKind::ImportCall { args }
            }
            Data::EJsxElement(e) => {
                let tag = self.optional_expr(e.tag.as_ref());
                self.jsx_tag_name(tag);
                let attrs = self.props(e.properties.as_slice(), false);
                let base = self.list_ids.len();
                for child in e.children.iter() {
                    let id = self.expr(child);
                    if let Some(open) = self.note(child.loc, Mark::JsxExpression) {
                        let end = self.note(child.loc, Mark::JsxExpressionEnd);
                        let braces = (id, open, end.unwrap_or(self.written_end));
                        self.b.file.jsx_expressions.push(braces);
                    }
                    self.list_ids.push(id.0);
                }
                let children = self.take_ids(base);
                let ts::Jsx {
                    closing_tag,
                    opening_end,
                    closing_start,
                    end: element_end,
                    type_arguments,
                } = self.b.ts[ts::JsxId::from_index(e.syntax.0)];
                end = self.pos_of(element_end);
                let type_args = type_arguments;
                let close_pos = if closing_start == ast::Loc::EMPTY {
                    u32::MAX
                } else {
                    self.pos_of(closing_start)
                };
                let close_tag = self.optional_expr(closing_tag.as_ref());
                self.jsx_tag_name(close_tag);
                ExprKind::Jsx(self.b.file.add_jsx(Jsx {
                    tag,
                    close_tag,
                    attrs,
                    children,
                    type_args,
                    opening_end: self.pos_of(opening_end),
                    close_pos,
                    end,
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
        let end = match kind {
            // `createMissingNode`: where the token before it ends. One that is made late does not know where.
            ExprKind::Missing if end != 0 => end,
            // It ends no earlier than its last part: JSX text that is left open is no trivia.
            _ => end.max(pos).max(self.written_end),
        };
        self.b.file.expr(kind, pos, end)
    }

    /// `a + b + c + ...` is as deep to the left as it is long.
    fn binary(&mut self, expr: &Expr) -> ExprId {
        let mut spine: SmallVec<[&Expr; 8]> = SmallVec::new();
        let mut leftmost = expr;
        while let Data::EBinary(e) = &leftmost.data {
            spine.push(leftmost);
            // A cast of the left operand, or parentheses around it, have to be looked up.
            if self.has_casts(&e.left) {
                leftmost = &e.left;
                break;
            }
            leftmost = &e.left;
        }
        let mut left = self.expr(leftmost);
        let start = self.written_start;
        while let Some(node) = spine.pop() {
            let Data::EBinary(e) = &node.data else {
                unreachable!()
            };
            let right = self.expr(&e.right);
            let pos = self.pos_of(node.loc).min(start);
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
            // What is put together of two expressions ends with the second.
            let end = self.noted_end(node.loc).unwrap_or(0).max(self.written_end);
            left = self.b.file.expr(kind, pos, end);
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
                    && array.comma_after_spread.start > self.noted.real_loc(*loc).start
                {
                    self.b
                        .file
                        .early_errors
                        .push((self.pos_of(array.comma_after_spread), 1013));
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
                    && object.comma_after_spread.start > self.noted.real_loc(value.loc).start
                {
                    self.b
                        .file
                        .early_errors
                        .push((self.pos_of(object.comma_after_spread), 1013));
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
                .map_or(0, |e| self.pos_of(e.loc));
            if property.kind == G::PropertyKind::Spread {
                let from = property.value.as_ref().map_or(ast::Loc::EMPTY, |e| e.loc);
                let value = self.optional_expr(property.value.as_ref());
                // `...e`, `{...e}`
                let first_token = if is_literal {
                    Mark::DotDotDot
                } else {
                    Mark::MemberStart
                };
                let start = self.note(from, first_token).unwrap_or(pos);
                self.list_props.push(Prop {
                    kind: PropKind::Spread,
                    key: PropKey::None,
                    name_kind: if is_literal {
                        NameKind::Identifier
                    } else {
                        NameKind::Jsx
                    },
                    value,
                    pos,
                    start,
                    end: self.note(from, Mark::MemberEnd).unwrap_or(self.written_end),
                    postfix_token: 0,
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
            let start = self.note(key.loc, Mark::MemberStart).unwrap_or(pos);
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
                    let func =
                        self.func(&f.func, fn_kind, Flags::empty(), self.pos_of(*loc), start);
                    self.b.file[func].name = key.name().unwrap_or(Atom::NONE);
                    self.b.file[func].name_pos = pos;
                    let end = self.noted_end(*loc).unwrap_or(0);
                    self.b.file.expr(ExprKind::Fn(func), self.pos_of(*loc), end)
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
                    self.written_end,
                );
            }
            let mut prop = Prop {
                kind,
                key,
                name_kind: if is_literal {
                    self.name_kind(written_key, is_computed)
                } else {
                    NameKind::Jsx
                },
                value,
                pos,
                start,
                // An import attribute ends with its value.
                end: self
                    .note(written_key.loc, Mark::MemberEnd)
                    .unwrap_or(self.written_end),
                postfix_token: self.note(written_key.loc, Mark::PostfixToken).unwrap_or(0),
            };
            if kind == PropKind::Method
                && let Some(question) = self.note(written_key.loc, Mark::Optional)
            {
                self.b.js_error_at_range((question, 0), 8009, b"?");
            }
            // `parseJsxAttributeValue`: the attribute ends with its `JsxExpression`.
            if !is_literal
                && let Some(inside) = &property.value
                && let Some(open) = self.note(inside.loc, Mark::JsxExpression)
            {
                self.b.file.jsx_expressions.push((value, open, prop.end));
            }
            // `parseObjectLiteralElement`
            if is_literal && !self.jsdoc.list.is_empty() {
                let mut host = Host::Property(prop, TypeNodeId::NONE);
                let full_start = self.note(written_key.loc, Mark::MemberFullStart);
                self.with_noted_jsdoc(full_start, start, false, &mut host);
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
