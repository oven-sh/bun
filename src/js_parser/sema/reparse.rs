//! Makes ordinary nodes of the tags of JSDoc comments, in JavaScript. A port of reparser.go of TypeScript 7.0.2's parser.
//!
//! The lowering calls [`Lower::with_jsdoc`] for every node TypeScript's parser calls `withJSDoc` for, once the node is lowered.
//! Hosted tags change that node: they give it annotations, type parameters, modifiers, casts. Unhosted tags make statements of their
//! own, which wait in `Lower::reparsed` for the list of statements they go into.

use std::rc::Rc;

use bun_ast::ts_syntax as ts;
use bun_sema::atom::Atom;
use bun_sema::hir::*;
use smallvec::SmallVec;

use super::comments::flags;
use super::jsdoc::{
    self, ClassName, DeclaredName, JsDoc, Name, Property, Signature, Tag, TagKind, TagType,
    TypeExpr,
};
use super::lower::Lower;

/// The node a JSDoc comment belongs to, as far as hosted tags tell one kind from another.
pub(super) enum Host {
    /// Nothing is made of hosted tags on it.
    Other,
    VariableStatement(Span<VarDeclId>),
    VariableDeclaration(VarDeclId),
    /// `export default e`, `export = e`
    ExportAssignment(StmtId),
    ExpressionStatement(StmtId),
    ReturnStatement(StmtId),
    /// What is in the parentheses.
    Parenthesized(ExprId),
    Parameter(ParamId),
    /// A function declaration, a function expression or an arrow function.
    Function(FnId),
    Class(ClassId),
    /// A member of a class, before it is added to the file.
    ClassMember(Member),
    /// A property of an object literal, before it is added to the file, and the type of its `@type` tag.
    Property(Prop, TypeNodeId),
}

/// `GetJSDocCommentRanges`: the JSDoc comments before a token.
struct Attached {
    /// Those that have tags, as indices into `Comments::list`.
    docs: SmallVec<[u32; 2]>,
    /// The last of `docs` is the last JSDoc comment there is.
    last_has_tags: bool,
}

/// The modifiers among `flags`, which an overload signature has in common with the implementation.
fn modifiers_of(flags: Flags) -> Flags {
    flags.difference(Flags::GENERATOR | Flags::OPTIONAL | Flags::MISSING_BODY)
}

/// `IsValidIdentifier`
fn is_valid_identifier(text: &[u8]) -> bool {
    if bun_core::strings::contains_char(text, b'\\') {
        return bun_core::lexer::is_identifier(&jsdoc::unescaped_name(text));
    }
    bun_core::lexer::is_identifier(text)
}

impl<'p, 'a> Lower<'p, 'a> {
    // ───────────────────────────── which comments belong to a node ─────────────────────────────

    /// The JSDoc comments of the node whose first token is at `token` and fully starts at `full_start`. `with_trailing`: those on the
    /// line of the token before count too, as they do for a parameter, a variable declaration, a parenthesized expression and a
    /// function expression.
    fn jsdoc_before(&self, token: u32, full_start: u32, with_trailing: bool) -> Attached {
        let lexer = &self.p.lexer;
        let first = lexer
            .all_comments
            .partition_point(|comment| (comment.loc.start as u32) < full_start);
        let mut attached = Attached {
            docs: SmallVec::new(),
            last_has_tags: false,
        };
        // `GetLeadingCommentRanges`: what follows the first line break, or the start of the file.
        let mut is_collecting = with_trailing || full_start == 0;
        let comments = lexer.all_comments[first..]
            .iter()
            .zip(&lexer.comment_flags[first..])
            .take_while(|(comment, _)| (comment.loc.start as u32) < token);
        for (comment, &said) in comments {
            is_collecting |= said & flags::LINE_BREAK_BEFORE != 0;
            if !is_collecting || said & flags::JSDOC_LIKE == 0 {
                // A line comment ends with its line.
                is_collecting |= said & flags::SINGLE_LINE != 0;
                continue;
            }
            attached.last_has_tags = match self.jsdoc.at(comment.loc.start as u32) {
                Some(index) if !self.jsdoc.list[index].tags.is_empty() => {
                    attached.docs.push(index as u32);
                    true
                }
                Some(index) => {
                    attached.docs.push(index as u32);
                    false
                }
                None => false,
            };
        }
        attached
    }

    /// `withJSDoc`, of the node `host` whose first token is at `token` and fully starts at `full_start`.
    pub(super) fn with_jsdoc(
        &mut self,
        token: u32,
        full_start: u32,
        with_trailing: bool,
        host: &mut Host,
    ) {
        if self.jsdoc.list.is_empty() {
            return;
        }
        let attached = self.jsdoc_before(token, full_start, with_trailing);
        if !attached.docs.is_empty() {
            self.reparse_tags(host, &attached);
        }
    }

    /// The same for a member of a class that starts at `start`.
    pub(super) fn member_jsdoc(&mut self, member: Member, start: u32) -> Member {
        if self.jsdoc.list.is_empty() {
            return member;
        }
        self.member_modifiers.clear();
        let full_start = member.loc.pos;
        let mut host = Host::ClassMember(member);
        self.with_jsdoc(start, full_start, false, &mut host);
        let Host::ClassMember(mut member) = host else {
            return member;
        };
        if self.member_modifiers.is_empty() {
            return member;
        }
        // Those that are made of tags come after those that are written.
        let mut all: Vec<(Flags, u32)> = self
            .b
            .file
            .modifier_list(member.modifiers)
            .iter()
            .filter_map(|modifier| match modifier.kind {
                ModifierKind::Keyword(flag) => Some((flag, modifier.pos)),
                ModifierKind::Decorator(_) => None,
            })
            .collect();
        all.append(&mut self.member_modifiers);
        member.modifiers = self.b.add_modifier_list(&all);
        member
    }

    /// Once everything is lowered: hands what is known of the comments over to the file.
    pub(super) fn finish_jsdoc(&mut self) {
        let file = &mut self.b.file;
        for (doc, &is_attached) in self.jsdoc.list.iter().zip(&self.jsdoc_is_attached) {
            file.jsdoc_comments.push((doc.start, doc.end));
            if is_attached {
                file.jsdoc_errors.extend_from_slice(&doc.errors);
                if !doc.error_arguments.is_empty() {
                    file.error_arguments.extend_from_slice(&doc.error_arguments);
                }
                if !doc.error_ends.is_empty() {
                    file.error_ends.extend_from_slice(&doc.error_ends);
                }
            }
        }
        file.jsdoc_types.sort_unstable_by_key(|t| t.0);
        file.jsdoc_modifiers.sort_unstable_by_key(|m| m.0);
    }

    // ───────────────────────────── helpers ─────────────────────────────

    fn name_atom(&self, name: Name) -> Atom {
        let text = name.text.slice();
        if bun_core::strings::contains_char(text, b'\\') {
            return self.b.atom(&jsdoc::unescaped_name(text));
        }
        self.b.atom(text)
    }

    /// Where the parenthesis around `e` opens, if `e` is written in parentheses.
    /// The outermost parentheses around `e`: where they open and where they end.
    fn paren_of(&self, e: ExprId) -> Option<(u32, u32)> {
        // In the order they were made, which is that of their ids.
        let outermost = parentheses_around(&self.b.file, e).last()?;
        Some((outermost.1, outermost.2))
    }

    /// `IsPrivateIdentifier`, of the name of a property access.
    fn is_private_name(&self, name: Atom) -> bool {
        self.b.atoms.bytes(name).first() == Some(&b'#')
    }

    /// `IsEntityNameExpressionEx`, in JavaScript.
    fn is_entity_name_expression(&self, e: ExprId) -> bool {
        if self.paren_of(e).is_some() {
            return false;
        }
        let file = &self.b.file;
        match file[e].kind {
            ExprKind::Ident(_) | ExprKind::This => true,
            ExprKind::Dot { obj, name, .. } => {
                !self.is_private_name(name) && self.is_entity_name_expression(obj)
            }
            ExprKind::Index { obj, index, .. } => {
                self.paren_of(index).is_none()
                    && match file[index].kind {
                        ExprKind::String(_) | ExprKind::Number(_) => true,
                        ExprKind::Template { exprs, .. } => exprs.is_empty(),
                        _ => false,
                    }
                    && self.is_entity_name_expression(obj)
            }
            _ => false,
        }
    }

    /// `GetAssignmentDeclarationKind(e) != JSDeclarationKindNone`, of a binary expression in JavaScript.
    fn is_assignment_declaration(&self, e: ExprId) -> bool {
        let file = &self.b.file;
        let ExprKind::Assign {
            op: None, target, ..
        } = file[e].kind
        else {
            return false;
        };
        if self.paren_of(e).is_some() || self.paren_of(target).is_some() {
            return false;
        }
        let is_this =
            |obj: ExprId| matches!(file[obj].kind, ExprKind::This) && self.paren_of(obj).is_none();
        match file[target].kind {
            ExprKind::Dot { obj, name, .. } => {
                is_this(obj) || !self.is_private_name(name) && self.is_entity_name_expression(obj)
            }
            ExprKind::Index { obj, .. } => is_this(obj) || self.is_entity_name_expression(obj),
            _ => false,
        }
    }

    /// The expression of an expression statement, a `return` or an `export default`.
    fn statement_expression(&self, stmt: StmtId) -> ExprId {
        match self.b.file[stmt].kind {
            StmtKind::Expr(e)
            | StmtKind::Return(e)
            | StmtKind::ExportDefault(e)
            | StmtKind::ExportAssign(e) => e,
            _ => ExprId::NONE,
        }
    }

    fn set_statement_expression(&mut self, stmt: StmtId, e: ExprId) {
        let kind = &mut self.b.file[stmt].kind;
        match kind {
            StmtKind::Expr(_) => *kind = StmtKind::Expr(e),
            StmtKind::Return(_) => *kind = StmtKind::Return(e),
            StmtKind::ExportDefault(_) => *kind = StmtKind::ExportDefault(e),
            StmtKind::ExportAssign(_) => *kind = StmtKind::ExportAssign(e),
            _ => {}
        }
    }

    /// The function `e` is, under any `satisfies` (`skipSatisfiesExpressions`). `NONE` if it is none.
    fn function_expression(&self, mut e: ExprId) -> FnId {
        let file = &self.b.file;
        while e.is_some() && self.paren_of(e).is_none() {
            match file[e].kind {
                ExprKind::Satisfies { expr, .. } => e = expr,
                ExprKind::Fn(func) => return func,
                _ => break,
            }
        }
        FnId::NONE
    }

    /// `getFunctionLikeHost`
    fn function_like_host(&self, host: &Host) -> FnId {
        let file = &self.b.file;
        match *host {
            Host::Function(func) => func,
            Host::ClassMember(member) => match member.kind {
                MemberKind::Property => self.function_expression(member.init),
                MemberKind::Method
                | MemberKind::Getter
                | MemberKind::Setter
                | MemberKind::Constructor => member.func,
                _ => FnId::NONE,
            },
            Host::Property(prop, _) => match prop.kind {
                PropKind::Init | PropKind::Method | PropKind::Getter | PropKind::Setter => {
                    self.function_expression(prop.value)
                }
                PropKind::Shorthand | PropKind::Spread => FnId::NONE,
            },
            Host::VariableStatement(decls) if !decls.is_empty() => {
                self.function_expression(file[decls.at(0)].init)
            }
            Host::ExportAssignment(stmt) | Host::ReturnStatement(stmt) => {
                self.function_expression(self.statement_expression(stmt))
            }
            Host::ExpressionStatement(stmt) => {
                // `GetRightMostAssignedExpression`
                let mut e = self.statement_expression(stmt);
                while e.is_some()
                    && self.paren_of(e).is_none()
                    && let ExprKind::Assign { value, .. } = file[e].kind
                {
                    e = value;
                }
                self.function_expression(e)
            }
            _ => FnId::NONE,
        }
    }

    /// `FullSignature != nil`
    fn has_full_signature(&self, func: FnId) -> bool {
        self.full_signatures.contains(&func.0)
    }

    /// `checkNonIdentifierName`. The reparser's own errors are the parser's, not those of the comment.
    fn check_non_identifier_name(&mut self, name: Name) {
        if !is_valid_identifier(name.text.slice()) {
            // A missing name is reported at the character before it.
            let at = if name.is_missing() {
                name.start.saturating_sub(1)
            } else {
                name.start
            };
            self.b.file.early_errors.push((at, 1003));
        }
    }

    // ───────────────────────────── types ─────────────────────────────

    /// Reports what the checker objects to in the syntax of a comment from `start` to `end`, which is being reparsed.
    fn note_checker_errors(&mut self, start: u32, end: u32) {
        let list = &self.jsdoc.list;
        let after = list.partition_point(|doc| doc.start <= start);
        if let Some(doc) = after.checked_sub(1).map(|index| &list[index]) {
            self.b.file.jsdoc_errors.extend(
                doc.checker_errors
                    .iter()
                    .filter(|error| (start..end).contains(&error.0)),
            );
        }
    }

    /// `addDeepCloneReparse`, of the type of a type expression.
    fn reparse_type(&mut self, expr: TypeExpr) -> TypeNodeId {
        self.note_checker_errors(expr.pos, expr.end);
        let mut ty = self.b.clone_type(expr.ty);
        let file = &mut self.b.file;
        if ty.is_none() {
            ty = file.ty(TypeNodeKind::Keyword(Keyword::Any), expr.pos, expr.pos);
        }
        let end = file[ty].end;
        // `getTypeFromTypeNodeWorker`: `...T` is an array of `T`, and `T=` is `T` with `addOptionality`.
        if expr.is_variadic {
            ty = file.ty(TypeNodeKind::Array(ty), expr.pos, end);
        }
        if expr.is_optional {
            let undefined = TypeNodeKind::Keyword(Keyword::Undefined);
            let undefined = file.ty(undefined, expr.pos, expr.pos);
            let members = file.list(&[ty, undefined]);
            ty = file.ty(TypeNodeKind::Union(members), expr.pos, end);
        }
        ty
    }

    /// `reparseJSDocTypeLiteral`
    fn reparse_tag_type(&mut self, ty: &TagType) -> TypeNodeId {
        let (properties, is_array, pos) = match ty {
            TagType::None => return TypeNodeId::NONE,
            TagType::Expr(expr) => return self.reparse_type(*expr),
            TagType::Literal {
                properties,
                is_array,
                pos,
            } => (properties, *is_array, *pos),
        };
        let mut members = Vec::with_capacity(properties.len());
        for tag in properties {
            let (TagKind::Property(property) | TagKind::Param(property)) = &tag.kind else {
                continue;
            };
            let Some(&name) = property.name.last() else {
                continue;
            };
            let mut flags = Flags::REPARSED;
            // What is no identifier is a name all the same, as a string.
            if !is_valid_identifier(name.text.slice()) {
                flags |= Flags::STRING_NAME | Flags::LITERAL_NAME;
            }
            if Self::is_optional(property) {
                flags |= Flags::OPTIONAL;
            }
            members.push(Member {
                kind: MemberKind::Property,
                key: PropKey::Name(self.name_atom(name)),
                flags,
                ty: self.reparse_tag_type(&property.ty),
                init: ExprId::NONE,
                func: FnId::NONE,
                name_pos: name.start,
                start: tag.pos,
                loc: TextRange {
                    pos: tag.pos,
                    end: tag.end,
                },
                modifiers: Span::EMPTY,
            });
        }
        let end = members.last().map_or(pos, |last| last.loc.end);
        let members = self.b.file.add_members(&members);
        let literal = self.b.file.ty(TypeNodeKind::Object(members), pos, end);
        if is_array {
            self.b.file.ty(TypeNodeKind::Array(literal), pos, end)
        } else {
            literal
        }
    }

    /// `makeQuestionIfOptional`
    fn is_optional(property: &Property) -> bool {
        property.is_bracketed || matches!(property.ty, TagType::Expr(expr) if expr.is_optional)
    }

    /// `gatherTypeParameters`
    fn gather_type_parameters(
        &mut self,
        doc: &JsDoc,
        typedef_or_callback: bool,
    ) -> Span<TypeParamId> {
        // In a comment with a `@typedef` or a `@callback` the `@template` tags are about the type that is defined.
        if !typedef_or_callback
            && doc
                .tags
                .iter()
                .any(|tag| matches!(tag.kind, TagKind::Typedef(_) | TagKind::Callback(_)))
        {
            return Span::EMPTY;
        }
        let mut params = Vec::new();
        for tag in &doc.tags {
            let TagKind::Template(template) = &tag.kind else {
                continue;
            };
            for (index, param) in template.params.iter().enumerate() {
                let constraint = match template.constraint {
                    Some(constraint) if index == 0 => {
                        self.check_non_identifier_name(param.name);
                        self.reparse_type(constraint)
                    }
                    _ => TypeNodeId::NONE,
                };
                let default = match param.default {
                    Some(default) => self.reparse_type(default),
                    None => TypeNodeId::NONE,
                };
                let written = param.modifiers.iter();
                let written = written.fold(Flags::empty(), |all, modifier| all | modifier.0);
                let flags = Flags::REPARSED | written & (Flags::CONST | Flags::IN | Flags::OUT);
                let modifiers = self.b.add_modifier_list(&param.modifiers);
                params.push(TypeParam {
                    name: self.name_atom(param.name),
                    pos: param.name.start,
                    start: param.pos,
                    end: param.end,
                    constraint,
                    default,
                    flags,
                    modifiers,
                });
            }
        }
        self.b.file.add_type_params(&params)
    }

    /// `makeNewCast`
    fn make_cast(&mut self, ty: TypeExpr, e: ExprId, is_assertion: bool) -> ExprId {
        let Expr { pos, end, .. } = self.b.file[e];
        let (pos, end) = self.paren_of(e).unwrap_or((pos, end));
        // `isConstTypeReference`
        let is_const = is_assertion
            && !ty.is_variadic
            && !ty.is_optional
            && ty.ty.is_some()
            && matches!(self.b.ts[ty.ty].data, ts::TypeData::Reference { name, args }
                if args.is_empty() && matches!(&self.b.ts[name], [name] if &*name.text == b"const"));
        let kind = if is_const {
            ExprKind::AsConst(e)
        } else if is_assertion {
            ExprKind::As {
                expr: e,
                ty: self.reparse_type(ty),
            }
        } else {
            ExprKind::Satisfies {
                expr: e,
                ty: self.reparse_type(ty),
            }
        };
        self.b.file.expr(kind, pos, end)
    }

    // ───────────────────────────── tags ─────────────────────────────

    /// `reparseTags`
    fn reparse_tags(&mut self, host: &mut Host, attached: &Attached) {
        let comments = Rc::clone(&self.jsdoc);
        for (i, &index) in attached.docs.iter().enumerate() {
            self.jsdoc_is_attached[index as usize] = true;
            let doc = &comments.list[index as usize];
            let is_last = attached.last_has_tags && i + 1 == attached.docs.len();
            for tag in &doc.tags {
                self.reparse_unhosted(tag, host, doc);
                if is_last {
                    self.reparse_hosted(tag, host, doc);
                }
            }
            if is_last {
                self.note_unmatched_parameters(host, doc);
            }
        }
    }

    /// The type alias of a `@typedef` or a `@callback`, in the namespaces its name says (`wrapInJSDocNamespace`).
    fn reparse_alias(&mut self, name: &DeclaredName, ty: TypeNodeId, tag: &Tag, doc: &JsDoc) {
        let type_params = self.gather_type_parameters(doc, true);
        let mut flags = Flags::REPARSED;
        if !name.namespaces.is_empty() {
            flags |= Flags::EXPORT;
        }
        let alias = Alias {
            name: self.name_atom(name.name),
            name_pos: name.name.start,
            flags,
            type_params,
            ty,
            stmt: StmtId::NONE,
        };
        let alias = self.b.file.add_alias(alias);
        let mut statement = self.b.file.stmt(StmtKind::TypeAlias(alias), tag.pos);
        self.b.file[statement].loc = TextRange {
            pos: tag.pos,
            end: tag.end,
        };
        // The outermost is exported by the binder, from a module alone (`IsImplicitlyExportedJSDocDeclaration`).
        for (depth, &namespace) in name.namespaces.iter().enumerate().rev() {
            let module = Module {
                name: ModuleName::Ident(self.name_atom(namespace)),
                name_pos: namespace.start,
                flags: if depth > 0 {
                    Flags::REPARSED | Flags::EXPORT
                } else {
                    Flags::REPARSED
                },
                body: self.b.file.list(&[statement]),
                has_body: true,
                stmt: StmtId::NONE,
            };
            let module = self.b.file.add_module(module);
            statement = self.b.file.stmt(StmtKind::Module(module), namespace.start);
            // `parseJSDocTypeNameWithNamespace`: the rest of the name is its body.
            self.b.file[statement].loc = TextRange {
                pos: namespace.start,
                end: name.name.end,
            };
        }
        self.reparsed.push(statement);
    }

    /// `reparseUnhosted`
    fn reparse_unhosted(&mut self, tag: &Tag, host: &Host, doc: &JsDoc) {
        match &tag.kind {
            TagKind::Typedef(typedef) => {
                if matches!(typedef.ty, TagType::None) {
                    return;
                }
                self.check_non_identifier_name(typedef.name.name);
                let ty = self.reparse_tag_type(&typedef.ty);
                self.reparse_alias(&typedef.name, ty, tag, doc);
            }
            TagKind::Callback(callback) => {
                let signature = self.reparse_signature(&callback.signature, None, doc, tag);
                let kind = TypeNodeKind::Fn(signature);
                let ty = self.b.file.ty(kind, callback.signature.pos, tag.end);
                self.reparse_alias(&callback.name, ty, tag, doc);
            }
            TagKind::Import(import) => {
                if !import.has_clause {
                    return;
                }
                self.note_checker_errors(tag.pos, import.end);
                if let Some(module) = import.module {
                    self.unchecked_parts_of_module_specifier(module);
                }
                let mode = match import.module.map(|module| module.mode) {
                    Some(ts::ResolutionMode::Import) => ResolutionMode::Import,
                    Some(ts::ResolutionMode::Require) => ResolutionMode::Require,
                    _ => ResolutionMode::None,
                };
                let spec = match import.specifier {
                    Some((text, pos)) => {
                        let spec = self.b.atom(&text);
                        self.b.file.specifier_uses.push(SpecifierUse {
                            spec,
                            pos,
                            kind: SpecifierKind::Import,
                            mode,
                        });
                        spec
                    }
                    None => Atom::NONE,
                };
                let named: Vec<ImportSpec> = import
                    .named
                    .iter()
                    .map(|specifier| ImportSpec {
                        start: specifier.imported_pos,
                        imported: self.b.atom(&specifier.imported),
                        local: self.b.atom(&specifier.local),
                        pos: specifier.local_pos,
                        type_only: false,
                        imported_pos: specifier.imported_pos,
                        end: specifier.local_pos + specifier.local.len() as u32,
                        import: ImportId(self.b.file.imports.len() as u32),
                    })
                    .collect();
                let declaration = Import {
                    spec,
                    default: import
                        .default
                        .map_or(Atom::NONE, |name| self.name_atom(name)),
                    default_pos: import.default.map_or(0, |name| name.start),
                    namespace: import
                        .namespace
                        .map_or(Atom::NONE, |name| self.name_atom(name)),
                    namespace_pos: import.namespace.map_or(0, |name| name.start),
                    clause_start: import.clause_start,
                    // Only what is said of `import defer` asks.
                    clause_end: import.clause_end,
                    namespace_start: import.namespace_start,
                    named: self.b.file.add_import_specs(&named),
                    type_only: true,
                    is_deferred: false,
                    mode,
                    stmt: StmtId::NONE,
                };
                let declaration = self.b.file.add_import(declaration);
                let statement = self.b.file.stmt(StmtKind::Import(declaration), tag.pos);
                self.b.file[statement].loc = TextRange {
                    pos: tag.pos,
                    end: tag.end,
                };
                self.reparsed.push(statement);
            }
            TagKind::Overload(signature) => {
                // Only for function, method and constructor declarations outside of object literals.
                if self.object_literals_around != 0 {
                    return;
                }
                match *host {
                    Host::Function(func) if self.b.file[func].kind == FnKind::Decl => {
                        let signature = self.reparse_signature(signature, Some(func), doc, tag);
                        let statement = self.b.file.stmt(StmtKind::Fn(signature), tag.name_pos);
                        // `tag.TagName()`
                        self.b.file[statement].loc = TextRange {
                            pos: tag.name_pos,
                            end: tag.name_pos + b"overload".len() as u32,
                        };
                        self.reparsed.push(statement);
                    }
                    Host::ClassMember(member)
                        if matches!(member.kind, MemberKind::Method | MemberKind::Constructor)
                            && !matches!(member.key, PropKey::Computed(_)) =>
                    {
                        let func = self.reparse_signature(signature, Some(member.func), doc, tag);
                        self.reparsed_members.push(Member {
                            flags: modifiers_of(member.flags) | Flags::REPARSED,
                            ty: TypeNodeId::NONE,
                            init: ExprId::NONE,
                            func,
                            name_pos: tag.name_pos,
                            start: tag.name_pos,
                            // `tag.TagName()`
                            loc: TextRange {
                                pos: tag.name_pos,
                                end: tag.name_pos + b"overload".len() as u32,
                            },
                            ..member
                        });
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }

    /// `reparseJSDocSignature`. `like`: the function an `@overload` tag is on. Without it the signature is the function type of a
    /// `@callback`.
    fn reparse_signature(
        &mut self,
        signature: &Signature,
        like: Option<FnId>,
        doc: &JsDoc,
        tag: &Tag,
    ) -> FnId {
        let type_params = match like {
            Some(_) => self.gather_type_parameters(doc, false),
            None => Span::EMPTY,
        };
        let mut this_param = ParamId::NONE;
        let mut params = Vec::with_capacity(signature.params.len());
        for (index, param) in signature.params.iter().enumerate() {
            let property = match &param.kind {
                TagKind::This(ty, text) => {
                    if this_param.is_none() {
                        // `thisIdent.Loc = thisTag.Loc`
                        let name = self.b.atom(text);
                        let this = Param {
                            pat: self.b.file.pat(PatKind::Ident(name), param.pos, param.end),
                            ty: self.reparse_type(*ty),
                            default: ExprId::NONE,
                            flags: Flags::REPARSED,
                            pos: param.pos,
                            loc: TextRange {
                                pos: param.pos,
                                end: param.end,
                            },
                        };
                        this_param = self.b.file.add_param(this);
                    }
                    continue;
                }
                TagKind::Param(property) | TagKind::Property(property) => property,
                _ => continue,
            };
            // `@param x.y` describes a property of another parameter.
            let &[name] = &property.name[..] else {
                continue;
            };
            let mut flags = Flags::REPARSED;
            let ty = match property.ty {
                // The type after the dots is that of the parameter as it stands.
                TagType::Expr(expr) if expr.is_variadic && !expr.is_optional => {
                    flags |= Flags::REST;
                    self.reparse_type(TypeExpr {
                        is_variadic: false,
                        ..expr
                    })
                }
                _ => self.reparse_tag_type(&property.ty),
            };
            if Self::is_optional(property) {
                flags |= Flags::OPTIONAL;
            }
            let text = name.text.slice();
            let name_atom = if is_valid_identifier(text) {
                self.name_atom(name)
            } else if text.is_empty() {
                self.b.atom(format!("_{index}").as_bytes())
            } else {
                // What cannot be in an identifier is written `_`.
                let is_start =
                    |c: u8| c.is_ascii_alphabetic() || matches!(c, b'_' | b'$') || c >= 0x80;
                let spelled: Vec<u8> = text
                    .iter()
                    .enumerate()
                    .map(|(i, &c)| {
                        if is_start(c) || i > 0 && c.is_ascii_digit() {
                            c
                        } else {
                            b'_'
                        }
                    })
                    .collect();
                self.b.atom(&spelled)
            };
            params.push(Param {
                pat: self
                    .b
                    .file
                    .pat(PatKind::Ident(name_atom), name.start, name.end),
                ty,
                default: ExprId::NONE,
                flags,
                pos: param.pos,
                loc: TextRange {
                    pos: param.pos,
                    end: param.end,
                },
            });
        }
        let pos = match like {
            Some(_) => tag.name_pos,
            None => signature.pos,
        };
        let ret = match (signature.ret, like) {
            (Some(ret), _) => self.reparse_type(ret),
            (None, Some(_)) => TypeNodeId::NONE,
            (None, None) => self
                .b
                .file
                .ty(TypeNodeKind::Keyword(Keyword::Any), pos, pos),
        };
        let (kind, flags, name) = match like {
            Some(like) => {
                let like = &self.b.file[like];
                (like.kind, modifiers_of(like.flags), like.name)
            }
            None => (FnKind::FunctionType, Flags::empty(), Atom::NONE),
        };
        let params = self.b.file.add_params(&params);
        self.b.file.add_fn(Func {
            kind,
            flags: flags | Flags::REPARSED,
            name,
            name_pos: pos,
            type_params,
            params,
            this_param,
            ret,
            body: FnBody::None,
            anchor: pos,
            start: pos,
        })
    }

    /// `reparseHosted`
    fn reparse_hosted(&mut self, tag: &Tag, host: &mut Host, doc: &JsDoc) {
        match &tag.kind {
            TagKind::Type(ty) => self.reparse_type_tag(*ty, host),
            TagKind::Satisfies(ty) => self.reparse_satisfies_tag(*ty, host),
            TagKind::Template(_) => {
                let func = self.function_like_host(host);
                if func.is_some() {
                    if self.b.file[func].type_params.is_empty() && !self.has_full_signature(func) {
                        let type_params = self.gather_type_parameters(doc, false);
                        self.b.file[func].type_params = type_params;
                        // `checkGrammarConstructorTypeParameters`: the list starts with its first tag.
                        if self.b.file[func].kind == FnKind::Constructor && !type_params.is_empty()
                        {
                            self.b.file.error(tag.pos, tag.end, 1092);
                        }
                    }
                } else if let Host::Class(class) = *host
                    && self.b.file[class].type_params.is_empty()
                {
                    let type_params = self.gather_type_parameters(doc, false);
                    self.b.file[class].type_params = type_params;
                }
            }
            TagKind::Param(property) => {
                let func = self.function_like_host(host);
                if func.is_none() || self.has_full_signature(func) {
                    return;
                }
                let Some(param) = self.find_matching_parameter(func, tag, property, doc) else {
                    return;
                };
                if self.b.file[param].ty.is_none() && !matches!(property.ty, TagType::None) {
                    let ty = self.reparse_tag_type(&property.ty);
                    self.b.file[param].ty = ty;
                }
                if !self.b.file[param].flags.contains(Flags::OPTIONAL)
                    && Self::is_optional(property)
                {
                    self.b.file[param].flags |= Flags::OPTIONAL | Flags::REPARSED;
                    // `checkGrammarParameterList`, `checkGrammarAccessor`: the `?` is where the tag is.
                    let Func {
                        kind,
                        type_params,
                        params,
                        ret,
                        ..
                    } = self.b.file[func];
                    if self.b.file[param].flags.contains(Flags::REST) {
                        self.b.file.error(tag.pos, tag.end, 1047);
                    } else if kind == FnKind::Setter
                        && type_params.is_empty()
                        && params.len() == 1
                        && ret.is_none()
                    {
                        self.b.file.error(tag.pos, tag.end, 1051);
                    }
                }
            }
            TagKind::This(ty, _) => {
                let func = self.function_like_host(host);
                if func.is_some() && self.b.file[func].this_param.is_none() {
                    // `finishReparsedNode(thisParam, tag.TagName())`
                    let this = Param {
                        pat: self
                            .b
                            .file
                            .pat(PatKind::Missing, tag.name_pos, tag.name_pos),
                        ty: self.reparse_type(*ty),
                        default: ExprId::NONE,
                        flags: Flags::REPARSED,
                        pos: tag.name_pos,
                        loc: TextRange {
                            pos: tag.name_pos,
                            end: tag.name_pos + b"this".len() as u32,
                        },
                    };
                    let this = self.b.file.add_param(this);
                    self.b.file[func].this_param = this;
                    // `checkParameter`: the parameter is where the name of the tag is.
                    let code = match self.b.file[func].kind {
                        FnKind::Arrow => Some(2730),
                        FnKind::Constructor => Some(2681),
                        FnKind::Getter | FnKind::Setter => Some(2784),
                        _ => None,
                    };
                    self.b
                        .file
                        .checker_errors
                        .extend(code.map(|code| (tag.name_pos, code)));
                }
            }
            TagKind::Return(Some(ty)) => {
                let func = self.function_like_host(host);
                if func.is_some()
                    && !self.has_full_signature(func)
                    && self.b.file[func].ret.is_none()
                {
                    let ty = self.reparse_type(*ty);
                    self.b.file[func].ret = ty;
                }
            }
            TagKind::Modifier(modifier) => self.reparse_modifier_tag(*modifier, tag, host),
            TagKind::Implements(class_name) => {
                // A name that is missing is looked up by nobody.
                if let Host::Class(class) = *host
                    && class_name
                        .name
                        .first()
                        .is_some_and(|first| !first.is_missing())
                {
                    let implemented = self.reparse_class_name(class_name);
                    let mut all: Vec<TypeNodeId> =
                        self.b.file.ids(self.b.file[class].implements).collect();
                    all.push(implemented);
                    let all = self.b.file.list(&all);
                    self.b.file[class].implements = all;
                }
            }
            TagKind::Augments(class_name, tag_name) => {
                if let Host::Class(class) = *host {
                    self.reparse_augments_tag(class_name, tag_name.slice(), class);
                }
            }
            _ => {}
        }
    }

    /// `A.B<T>` as a type.
    fn reparse_class_name(&mut self, class_name: &ClassName) -> TypeNodeId {
        let name: SmallVec<[(Atom, u32); 4]> = class_name
            .name
            .iter()
            .map(|&name| (self.name_atom(name), name.start))
            .collect();
        let args = self.reparse_type_arguments(class_name);
        let name = self.b.file.entity_name(name.into_iter());
        let pos = class_name.name.first().map_or(0, |first| first.start);
        let kind = TypeNodeKind::Ref { name, args };
        self.b.file.ty(kind, pos, class_name.end)
    }

    fn reparse_type_arguments(&mut self, class_name: &ClassName) -> IdList<TypeNodeId> {
        let Some(type_args) = class_name.type_args else {
            return IdList::EMPTY;
        };
        let start = class_name.name.first().map_or(0, |first| first.start);
        self.note_checker_errors(start, class_name.end);
        self.b.clone_type_list(type_args)
    }

    /// `@augments`, `@extends`: the type arguments go to the `extends` clause, if that names the same class.
    fn reparse_augments_tag(&mut self, class_name: &ClassName, tag_name: &[u8], class: ClassId) {
        let Class {
            extends,
            extends_args,
            ..
        } = self.b.file[class];
        if extends.is_none() {
            return;
        }
        // From the last name to the first.
        let mut written = Vec::new();
        let mut at = extends;
        let is_entity_name = loop {
            if self.paren_of(at).is_some() {
                break false;
            }
            match self.b.file[at].kind {
                ExprKind::Ident(name) => {
                    written.push(name);
                    break true;
                }
                ExprKind::Dot { obj, name, .. } => {
                    written.push(name);
                    at = obj;
                }
                _ => break false,
            }
        };
        // `checkGrammarClassDeclarationHeritageClauses`, `getIdentifierFromEntityNameExpression`: the last names have to agree.
        if is_entity_name
            && let (Some(&target), Some(&source)) = (written.first(), class_name.name.last())
            && target != self.name_atom(source)
        {
            let names = [tag_name, source.text.slice(), self.b.atoms.bytes(target)];
            (self.b.file).error_about(source.start, source.end, 8023, &names);
        }
        // `HasSamePropertyAccessName`
        let is_same = is_entity_name
            && written.len() == class_name.name.len()
            && written
                .iter()
                .rev()
                .zip(&class_name.name)
                .all(|(&a, &b)| a == self.name_atom(b));
        if is_same && extends_args.is_empty() && class_name.type_args.is_some() {
            let args = self.reparse_type_arguments(class_name);
            self.b.file[class].extends_args = args;
        }
    }

    /// `@type`
    fn reparse_type_tag(&mut self, ty: TypeExpr, host: &mut Host) {
        match host {
            Host::VariableStatement(decls) => {
                if let Some(decl) = decls.iter().find(|&decl| self.b.file[decl].ty.is_none()) {
                    let ty = self.reparse_type(ty);
                    self.b.file[decl].ty = ty;
                    return;
                }
            }
            Host::VariableDeclaration(decl) => {
                if self.b.file[*decl].ty.is_none() {
                    let ty = self.reparse_type(ty);
                    self.b.file[*decl].ty = ty;
                    return;
                }
            }
            Host::ExportAssignment(stmt) => {
                let owner = JsDocTypeOwner::Export(*stmt);
                if self.b.file.jsdoc_types.last().is_none_or(|t| t.0 != owner) {
                    let ty = self.reparse_type(ty);
                    self.b.file.jsdoc_types.push((owner, ty));
                    return;
                }
            }
            Host::ClassMember(member) if member.kind == MemberKind::Property => {
                if member.ty.is_none() {
                    member.ty = self.reparse_type(ty);
                    return;
                }
            }
            Host::ClassMember(Member {
                kind: MemberKind::Getter,
                func,
                ..
            }) => {
                if self.b.file[*func].ret.is_none() {
                    let ty = self.reparse_type(ty);
                    self.b.file[*func].ret = ty;
                    return;
                }
            }
            Host::Property(prop, prop_ty) => match prop.kind {
                PropKind::Init | PropKind::Shorthand => {
                    if prop_ty.is_none() {
                        *prop_ty = self.reparse_type(ty);
                        return;
                    }
                }
                PropKind::Getter => {
                    let func = self.function_expression(prop.value);
                    if func.is_some() && self.b.file[func].ret.is_none() {
                        let ty = self.reparse_type(ty);
                        self.b.file[func].ret = ty;
                        return;
                    }
                }
                _ => {}
            },
            Host::Parameter(param) => {
                if self.b.file[*param].ty.is_none() {
                    let ty = self.reparse_type(ty);
                    self.b.file[*param].ty = ty;
                    return;
                }
            }
            Host::ExpressionStatement(stmt) => {
                let e = self.statement_expression(*stmt);
                if e.is_some() && self.is_assignment_declaration(e) {
                    let owner = JsDocTypeOwner::Assign(e);
                    if self.b.file.jsdoc_types.last().is_none_or(|t| t.0 != owner) {
                        let ty = self.reparse_type(ty);
                        self.b.file.jsdoc_types.push((owner, ty));
                    }
                    return;
                }
            }
            Host::ReturnStatement(stmt) => {
                let e = self.statement_expression(*stmt);
                if e.is_some() {
                    let cast = self.make_cast(ty, e, true);
                    self.set_statement_expression(*stmt, cast);
                    return;
                }
            }
            Host::Parenthesized(e) => {
                *e = self.make_cast(ty, *e, true);
                return;
            }
            _ => {}
        }
        let func = self.function_like_host(host);
        if func.is_none() || self.has_full_signature(func) {
            return;
        }
        let function = self.b.file[func];
        let Func {
            type_params,
            params,
            ret,
            ..
        } = function;
        let has_no_typed_params = function.this_ty(&self.b.file).is_none()
            && params.iter().all(|param| self.b.file[param].ty.is_none());
        if type_params.is_empty() && ret.is_none() && has_no_typed_params {
            let ty = self.reparse_type(ty);
            self.b.file.jsdoc_types.push((JsDocTypeOwner::Fn(func), ty));
            self.full_signatures.insert(func.0, ());
        }
    }

    /// `@satisfies`
    fn reparse_satisfies_tag(&mut self, ty: TypeExpr, host: &mut Host) {
        match host {
            Host::VariableStatement(decls) => {
                if let Some(decl) = decls.iter().find(|&decl| self.b.file[decl].init.is_some()) {
                    let cast = self.make_cast(ty, self.b.file[decl].init, false);
                    self.b.file[decl].init = cast;
                }
            }
            Host::VariableDeclaration(decl) => {
                let init = self.b.file[*decl].init;
                if init.is_some() {
                    let cast = self.make_cast(ty, init, false);
                    self.b.file[*decl].init = cast;
                }
            }
            Host::ClassMember(member) if member.kind == MemberKind::Property => {
                if member.init.is_some() {
                    member.init = self.make_cast(ty, member.init, false);
                }
            }
            Host::Property(prop, _) if prop.kind == PropKind::Init => {
                if prop.value.is_some() {
                    prop.value = self.make_cast(ty, prop.value, false);
                }
            }
            Host::ReturnStatement(stmt) | Host::ExportAssignment(stmt) => {
                let e = self.statement_expression(*stmt);
                if e.is_some() {
                    let cast = self.make_cast(ty, e, false);
                    self.set_statement_expression(*stmt, cast);
                }
            }
            Host::Parenthesized(e) => *e = self.make_cast(ty, *e, false),
            Host::ExpressionStatement(stmt) => {
                let e = self.statement_expression(*stmt);
                if e.is_some()
                    && self.is_assignment_declaration(e)
                    && let ExprKind::Assign { op, target, value } = self.b.file[e].kind
                {
                    let value = self.make_cast(ty, value, false);
                    self.b.file[e].kind = ExprKind::Assign { op, target, value };
                }
            }
            _ => {}
        }
    }

    /// `@public`, `@private`, `@protected`, `@readonly`, `@override`
    fn reparse_modifier_tag(&mut self, modifier: Flags, tag: &Tag, host: &mut Host) {
        match host {
            Host::ExpressionStatement(stmt) => {
                let e = self.statement_expression(*stmt);
                if e.is_some()
                    && self.paren_of(e).is_none()
                    && matches!(self.b.file[e].kind, ExprKind::Assign { .. })
                {
                    match self.b.file.jsdoc_modifiers.last_mut() {
                        Some(last) if last.0 == e => last.1 |= modifier,
                        _ => self.b.file.jsdoc_modifiers.push((e, modifier)),
                    }
                }
            }
            Host::ClassMember(member) => {
                let is_modified = match member.kind {
                    // In an object literal they are no modifiers, nor in what is written in one.
                    MemberKind::Method | MemberKind::Getter | MemberKind::Setter => {
                        self.object_literals_around == 0
                    }
                    MemberKind::Property | MemberKind::Constructor => true,
                    _ => false,
                };
                if is_modified {
                    member.flags |= modifier;
                    if member.func.is_some() {
                        self.b.file[member.func].flags |= modifier;
                    }
                    self.member_modifiers
                        .push((modifier | Flags::REPARSED, tag.pos));
                }
            }
            _ => {}
        }
    }

    /// `findMatchingParameter`
    fn find_matching_parameter(
        &self,
        func: FnId,
        tag: &Tag,
        property: &Property,
        doc: &JsDoc,
    ) -> Option<ParamId> {
        let tag_index = doc
            .tags
            .iter()
            .filter(|other| matches!(other.kind, TagKind::Param(_)))
            .position(|other| std::ptr::eq(other, tag));
        let tag_name = match property.name[..] {
            [name] => Some(name),
            _ => None,
        };
        let file = &self.b.file;
        file[func]
            .params
            .iter()
            .enumerate()
            .find(|&(index, param)| match file[file[param].pat].kind {
                PatKind::Ident(name) => tag_name.is_some_and(|tag_name| {
                    name == self.name_atom(tag_name)
                        || Some(index) == tag_index && tag_name.is_missing()
                }),
                _ => Some(index) == tag_index,
            })
            .map(|(_, param)| param)
    }

    /// `checkUnmatchedJSDocParameters`, as far as the syntax tells. `getAllJSDocTags`: the tags of the nearest comment count, which
    /// is the first one that gets here.
    fn note_unmatched_parameters(&mut self, host: &Host, doc: &JsDoc) {
        let func = match *host {
            // `GetNextJSDocCommentLocation` does not go through an assignment.
            Host::ExpressionStatement(stmt) => {
                self.function_expression(self.statement_expression(stmt))
            }
            Host::VariableDeclaration(decl) => self.function_expression(self.b.file[decl].init),
            _ => self.function_like_host(host),
        };
        if func.is_none() || self.documented_functions.insert(func.0, ()).is_some() {
            return;
        }
        let tags: Vec<&Property> = doc
            .tags
            .iter()
            .filter_map(|tag| match &tag.kind {
                TagKind::Param(property)
                    if !matches!(property.name[..], [name] if name.is_missing()) =>
                {
                    Some(property)
                }
                _ => None,
            })
            .collect();
        let Some(&last) = tags.last() else {
            return;
        };
        let mut names = Vec::new();
        let mut is_pattern = Vec::new();
        for param in self.b.file[func].params.iter() {
            match self.b.file[self.b.file[param].pat].kind {
                PatKind::Ident(name) => {
                    names.push(name);
                    is_pattern.push(false);
                }
                PatKind::Object(_) | PatKind::Array(_) => is_pattern.push(true),
                PatKind::Missing => is_pattern.push(false),
            }
        }
        let is_matched = |this: &Self, index: usize, property: &Property| {
            is_pattern.get(index) == Some(&true)
                || matches!(property.name[..], [name] if names.contains(&this.name_atom(name)))
        };
        let mut errors = Vec::new();
        // If the function refers to `arguments`, the last tag can be about that.
        if let [name] = last.name[..]
            && !is_matched(&*self, tags.len() - 1, last)
            && !matches!(last.ty, TagType::None)
            && !self.is_array_type(&last.ty)
        {
            errors.push((func, name.start, 8029));
        }
        for (index, &property) in tags.iter().enumerate() {
            if is_matched(&*self, index, property) {
                continue;
            }
            match property.name[..] {
                [name] if !property.is_name_first => errors.push((func, name.start, 8024)),
                [_] | [] => {}
                [first, ..] => errors.push((func, first.start, 8032)),
            }
        }
        self.b.file.jsdoc_param_errors.extend(errors);
    }

    /// `isArrayType`, of a type as it is written.
    fn is_array_type(&self, ty: &TagType) -> bool {
        match *ty {
            TagType::None => false,
            TagType::Literal { is_array, .. } => is_array,
            TagType::Expr(expr) if expr.is_optional || expr.ty.is_none() => false,
            TagType::Expr(expr) if expr.is_variadic => true,
            TagType::Expr(expr) => match self.b.ts[expr.ty].data {
                ts::TypeData::Array(_) => true,
                ts::TypeData::Reference { name, .. } => matches!(&self.b.ts[name],
                    [name] if matches!(&*name.text, b"Array" | b"ReadonlyArray")),
                _ => false,
            },
        }
    }
}
