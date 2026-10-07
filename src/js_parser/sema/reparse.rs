//! Turns the tags of JSDoc comments into ordinary nodes, in JavaScript. A port of reparser.go of
//! TypeScript 7.0.2's parser.
//!
//! The lowering pass calls [`Lower::with_jsdoc`] for every node TypeScript's parser calls
//! `withJSDoc` for, once the node is lowered. Hosted tags modify that node: they add annotations,
//! type parameters, modifiers, casts. Unhosted tags produce separate statements, which stay in
//! `Lower::reparsed` until they are inserted into their statement list.

use std::rc::Rc;

use crate::sema::ts_syntax as ts;
use bun_sema::atom::{Atom, known};
use bun_sema::hir::*;
use smallvec::SmallVec;

use super::comments::flags;
use super::jsdoc::{
    ClassName, DeclaredName, JsDoc, Name, Property, Signature, Tag, TagKind, TagType, TypeExpr,
};
use super::lower::Lower;

/// The node a JSDoc comment is attached to, to the extent that hosted tags distinguish node kinds.
pub(super) enum Host {
    /// Hosted tags on it are ignored.
    Other,
    VariableStatement(Span<VarDeclId>),
    VariableDeclaration(VarDeclId),
    /// `export default e`, `export = e`
    ExportAssignment(StmtId),
    ExpressionStatement(StmtId),
    ReturnStatement(StmtId),
    /// The expression inside the parentheses.
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
    /// The last of `docs` is the last of all the JSDoc comments.
    last_has_tags: bool,
    /// From the start of the first of all the JSDoc comments to the end of the last. `None`: there
    /// is none.
    range: Option<TextRange>,
}

/// The modifier flags in `flags`, which an overload signature shares with the implementation.
fn modifiers_of(flags: Flags) -> Flags {
    flags.difference(Flags::GENERATOR | Flags::OPTIONAL | Flags::MISSING_BODY)
}

/// `IsValidIdentifier`
fn is_valid_identifier(text: &[u8]) -> bool {
    bun_core::lexer::is_identifier(text)
}

impl<'p, 'a> Lower<'p, 'a> {
    // ───────────────────────────── attaching comments to nodes ─────────────────────────────

    /// The JSDoc comments of the node whose first token is at `token`, with full start
    /// `full_start`. `with_trailing`: comments on the same line as the previous token are included,
    /// as they are for a parameter, a variable declaration, a parenthesized expression and a
    /// function expression.
    fn jsdoc_before(&self, token: u32, full_start: u32, with_trailing: bool) -> Attached {
        let lexer = &self.p.lexer;
        let first = lexer
            .all_comments
            .partition_point(|comment| (comment.loc.start as u32) < full_start);
        let mut attached = Attached {
            docs: SmallVec::new(),
            last_has_tags: false,
            range: None,
        };
        // `GetLeadingCommentRanges`: the comments after the first line break, or after the start of
        // the file.
        let mut is_collecting = with_trailing || full_start == 0;
        let comments = lexer.all_comments[first..]
            .iter()
            .zip(&lexer.comment_flags[first..])
            .take_while(|(comment, _)| (comment.loc.start as u32) < token);
        for (comment, &reported) in comments {
            is_collecting |= reported & flags::LINE_BREAK_BEFORE != 0;
            if !is_collecting || reported & flags::JSDOC_LIKE == 0 {
                // A line comment ends with its line.
                is_collecting |= reported & flags::SINGLE_LINE != 0;
                continue;
            }
            let start = comment.loc.start as u32;
            attached.range = Some(TextRange {
                pos: attached.range.map_or(start, |range| range.pos),
                end: comment.end().start as u32,
            });
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

    /// `withJSDoc` for the node `host` whose first token is at `token`, with full start
    /// `full_start`.
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
        if let Some(comments) = attached.range {
            let docs = attached.docs.iter();
            let mut tags = docs.flat_map(|&doc| &self.jsdoc.list[doc as usize].tags);
            let first_satisfies_tag = tags.find(|tag| matches!(tag.kind, TagKind::Satisfies(_)));
            let first_satisfies_tag = first_satisfies_tag.map_or(u32::MAX, |tag| tag.name_pos);
            self.b.file.jsdoc_hosts.push(JsDocHost {
                token,
                comments,
                first_satisfies_tag,
            });
        }
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
        // Modifiers synthesized from tags come after those in the source.
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

    /// Called once everything is lowered: stores the information collected about the comments in
    /// the file.
    pub(super) fn finish_jsdoc(&mut self) {
        let file = &mut self.b.file;
        for (doc, &is_attached) in self.jsdoc.list.iter().zip(&self.jsdoc_is_attached) {
            file.jsdoc_comments.push((doc.start, doc.end));
            if is_attached {
                let parse_errors = doc
                    .diagnostics
                    .iter()
                    .filter(|d| d.kind == DiagnosticKind::JsDoc);
                file.diagnostics.extend(parse_errors.cloned());
            }
        }
        // Only `findOriginatingJSDocSatisfiesTag` asks for them.
        let mut hosts = file.jsdoc_hosts.iter();
        if hosts.any(|host| host.first_satisfies_tag != u32::MAX) {
            file.jsdoc_hosts.sort_by_key(|host| host.token);
            file.jsdoc_hosts.dedup_by_key(|host| host.token);
        } else {
            file.jsdoc_hosts.clear();
        }
        file.jsdoc_types.sort_unstable_by_key(|t| t.0);
        file.jsdoc_modifiers.sort_unstable_by_key(|m| m.0);
        file.jsdoc_member_comments.sort_unstable_by_key(|m| m.0);
    }

    // ───────────────────────────── helpers ─────────────────────────────

    fn name_atom(&self, name: Name) -> Atom {
        self.b.atom(name.text.slice())
    }

    /// Position of the `(` around `e`, if `e` is parenthesized.
    /// The outermost parentheses around `e`: their start and end.
    fn paren_of(&self, e: ExprId) -> Option<(u32, u32)> {
        // In creation order, which is id order.
        let outermost = parentheses_around(&self.b.file, e).last()?;
        Some((outermost.1, outermost.2))
    }

    /// `IsPrivateIdentifier` for the name of a property access.
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

    /// `GetAssignmentDeclarationKind(e) != JSDeclarationKindNone` for a binary expression in
    /// JavaScript.
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

    /// The function that `e` is after skipping any `satisfies` (`skipSatisfiesExpressions`). `NONE`
    /// if it is not a function.
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

    /// `checkNonIdentifierName`. The reparser's own errors count as parser errors, not as errors of
    /// the comment.
    fn check_non_identifier_name(&mut self, name: Name) {
        if !is_valid_identifier(name.text.slice()) {
            // A missing name is reported at the character before it.
            let start = if name.is_missing() {
                name.start.saturating_sub(1)
            } else {
                name.start
            };
            self.b
                .file
                .error(DiagnosticKind::Parse, start, name.end, 1003);
        }
    }

    // ───────────────────────────── types ─────────────────────────────

    /// Reports the checker errors in the comment syntax from `start` to `end`, which is being
    /// reparsed.
    fn note_checker_errors(&mut self, start: u32, end: u32) {
        let list = &self.jsdoc.list;
        let after = list.partition_point(|doc| doc.start <= start);
        if let Some(doc) = after.checked_sub(1).map(|index| &list[index]) {
            let checker_errors = doc
                .diagnostics
                .iter()
                .filter(|d| d.kind != DiagnosticKind::JsDoc && (start..end).contains(&d.start));
            self.b
                .file
                .diagnostics
                .extend(checker_errors.cloned().map(|d| Diagnostic {
                    kind: DiagnosticKind::JsDoc,
                    ..d
                }));
        }
    }

    /// `addDeepCloneReparse` for the type of a type expression.
    fn reparse_type(&mut self, expr: TypeExpr) -> TypeNodeId {
        // `checkSourceElementWorker` has no case for a `JSDocVariadicType` or a `JSDocOptionalType`.
        if expr.is_variadic || expr.is_optional {
            return self.reparse_unchecked_type(expr);
        }
        self.note_checker_errors(expr.pos, expr.end);
        self.clone_type_expression(expr)
    }

    /// The same for a type that `checkSourceFile` never reaches: the checker only calls
    /// `getTypeFromTypeNode` for it.
    fn reparse_unchecked_type(&mut self, expr: TypeExpr) -> TypeNodeId {
        let reported = self.b.file.diagnostics.len();
        let ty = self.clone_type_expression(expr);
        // The grammar errors that are cloned with the nodes.
        let diagnostics = &mut self.b.file.diagnostics;
        if diagnostics.len() > reported {
            let cloned = diagnostics.split_off(reported).into_iter();
            diagnostics.extend(cloned.filter(|d| d.kind != DiagnosticKind::Grammar));
        }
        ty
    }

    fn clone_type_expression(&mut self, expr: TypeExpr) -> TypeNodeId {
        let jsdoc = std::rc::Rc::clone(&self.jsdoc);
        let mut ty = self.b.clone_type(&jsdoc.types, expr.ty);
        let file = &mut self.b.file;
        if ty.is_none() {
            ty = file.ty(TypeNodeKind::Keyword(Keyword::Any), expr.pos, expr.pos);
        }
        let end = file[ty].end;
        // `parseJSDocType`
        if expr.is_variadic {
            let kind = JSDocTypeKind::Variadic;
            let is_postfix = false;
            ty = file.ty(
                TypeNodeKind::JSDoc {
                    ty,
                    kind,
                    is_postfix,
                },
                expr.pos,
                end,
            );
        }
        if expr.is_optional {
            let kind = JSDocTypeKind::Optional;
            let is_postfix = true;
            ty = file.ty(
                TypeNodeKind::JSDoc {
                    ty,
                    kind,
                    is_postfix,
                },
                expr.pos,
                end,
            );
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
        let mut comments: Vec<(usize, &[u8])> = Vec::new();
        for tag in properties {
            let (TagKind::Property(property) | TagKind::Param(property)) = &tag.kind else {
                continue;
            };
            let Some(&name) = property.name.last() else {
                continue;
            };
            let mut flags = Flags::REPARSED;
            // A name that is not an identifier is still a name, as a string.
            if !is_valid_identifier(name.text.slice()) {
                flags |= Flags::STRING_NAME | Flags::LITERAL_NAME;
            }
            if Self::is_optional(property) {
                flags |= Flags::OPTIONAL;
            }
            if !property.comment.is_empty() {
                comments.push((members.len(), &property.comment));
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
        for (index, comment) in comments {
            self.b
                .file
                .jsdoc_member_comments
                .push((members.at(index), comment.into()));
        }
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
        // In a comment with a `@typedef` or a `@callback` the `@template` tags apply to the type
        // being defined.
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
            // A `ParenthesizedType` has no node: it starts before the node of its type.
            && self.jsdoc.types.file[ty.ty].pos == ty.pos
            && matches!(self.jsdoc.types.file[ty.ty].kind, TypeNodeKind::Ref { name, args }
                if args.is_empty() && self.jsdoc.types.file.texts(name).eq([known::r#const]));
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
        if let Host::Class(class) = *host {
            self.check_grammar_augments_tags(class, attached);
        }
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

    /// The type alias for a `@typedef` or a `@callback`, wrapped in the namespaces of its qualified
    /// name (`wrapInJSDocNamespace`).
    fn reparse_alias(
        &mut self,
        name: &DeclaredName,
        ty: TypeNodeId,
        tag: &Tag,
        host: &Host,
        doc: &JsDoc,
    ) {
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
        // The binder exports the outermost one, only from a module
        // (`IsImplicitlyExportedJSDocDeclaration`).
        for (depth, &namespace) in name.namespaces.iter().enumerate().rev() {
            let module = Module {
                name: ModuleName::Ident(self.name_atom(namespace)),
                name_pos: namespace.start,
                flags: if depth > 0 {
                    Flags::REPARSED | Flags::EXPORT
                } else if matches!(host, Host::ClassMember(_)) {
                    Flags::REPARSED | Flags::CLASS_ELEMENT
                } else {
                    Flags::REPARSED
                },
                body: self.b.file.list(&[statement]),
                has_body: true,
                specifies_module: false,
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
        // `parseListIndex` passes only type aliases and imports on to a list of statements, so the
        // namespace is a member of the class (`checkGrammarModuleElementContext`).
        if let (Some(outermost), Host::ClassMember(_)) = (name.namespaces.first(), host) {
            let start = outermost.start;
            self.b.file.error(DiagnosticKind::Grammar, start, 0, 1235);
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
                self.reparse_alias(&typedef.name, ty, tag, host, doc);
            }
            TagKind::Callback(callback) => {
                let signature = self.reparse_signature(&callback.signature, None, doc, tag);
                let kind = TypeNodeKind::Fn(signature);
                let ty = self.b.file.ty(kind, callback.signature.pos, tag.end);
                self.reparse_alias(&callback.name, ty, tag, host, doc);
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
                        start: specifier.start,
                        imported: self.b.atom(&specifier.imported),
                        local: self.b.atom(&specifier.local),
                        pos: specifier.local_pos,
                        type_only: specifier.is_type_only,
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
                    // Only read by the diagnostics for `import defer`.
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
        // `checkNonIdentifierName(fun.Name())`: of the identifiers that the main parser accepts as
        // the name of a function or a method, only a missing one is not valid.
        if let Some(like) = like {
            let like = self.b.file[like];
            if matches!(like.kind, FnKind::Decl | FnKind::Method)
                && like.name == known::empty
                && !like
                    .flags
                    .intersects(Flags::COMPUTED_NAME | Flags::LITERAL_NAME)
            {
                self.check_non_identifier_name(Name::missing(like.name_pos));
            }
        }
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
                // The type after the dots is used unchanged as the type of the parameter.
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
                // Characters that are invalid in an identifier are replaced with `_`.
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
        let mut params = self.b.file.add_params(&params);
        // `GetThisParameter`. A parameter created from an `@this` tag precedes every `@param` tag.
        if this_param.is_none() {
            (this_param, params) = self.b.file.split_this_parameter(params);
        }
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
            TagKind::Type(ty) => {
                let mut type_tags = doc
                    .tags
                    .iter()
                    .filter(|t| matches!(t.kind, TagKind::Type(_)));
                let is_last = type_tags
                    .next_back()
                    .is_some_and(|last| last.pos == tag.pos);
                self.reparse_type_tag(*ty, host, is_last);
            }
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
                            self.b
                                .file
                                .error(DiagnosticKind::Grammar, tag.pos, tag.end, 1092);
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
                    // `checkGrammarParameterList`, `checkGrammarAccessor`: the position of the `?`
                    // is that of the tag.
                    let Func {
                        kind,
                        type_params,
                        params,
                        ret,
                        ..
                    } = self.b.file[func];
                    if self.b.file[param].flags.contains(Flags::REST) {
                        self.b
                            .file
                            .error(DiagnosticKind::Grammar, tag.pos, tag.end, 1047);
                    } else if kind == FnKind::Setter
                        && type_params.is_empty()
                        && params.len() == 1
                        && ret.is_none()
                    {
                        self.b
                            .file
                            .error(DiagnosticKind::Grammar, tag.pos, tag.end, 1051);
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
                    // `checkParameter`: the position of the parameter is that of the tag's name.
                    let code = match self.b.file[func].kind {
                        FnKind::Arrow => Some(2730),
                        FnKind::Constructor => Some(2681),
                        FnKind::Getter | FnKind::Setter => Some(2784),
                        _ => None,
                    };
                    if let Some(code) = code {
                        self.b
                            .file
                            .error(DiagnosticKind::Checker, tag.name_pos, 0, code);
                    }
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
                // A missing name is never resolved.
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
            TagKind::Augments(class_name, _) => {
                if let Host::Class(class) = *host {
                    self.reparse_augments_tag(class_name, class);
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
        let jsdoc = std::rc::Rc::clone(&self.jsdoc);
        self.b.clone_type_list(&jsdoc.types, type_args)
    }

    /// `checkGrammarClassDeclarationHeritageClauses`: the last name of an `@augments` or `@extends`
    /// tag, in any comment of the class, is the last name of the `extends` clause. It returns at the
    /// first error.
    fn check_grammar_augments_tags(&mut self, class: ClassId, attached: &Attached) {
        let extends = self.b.file[class].extends;
        if extends.is_none() || self.paren_of(extends).is_some() {
            return;
        }
        // `getIdentifierFromEntityNameExpression`
        let (ExprKind::Ident(target) | ExprKind::Dot { name: target, .. }) =
            self.b.file[extends].kind
        else {
            return;
        };
        let comments = Rc::clone(&self.jsdoc);
        let docs = attached.docs.iter();
        for tag in docs.flat_map(|&index| &comments.list[index as usize].tags) {
            if let TagKind::Augments(class_name, tag_name) = &tag.kind
                && let Some(&source) = class_name.name.last()
                && target != self.name_atom(source)
            {
                let target = self.b.atoms.bytes(target);
                let names = [tag_name.slice(), source.text.slice(), target];
                let at = (source.start, source.end);
                let diagnostic = Diagnostic::new(DiagnosticKind::Grammar, at, 8023, &names);
                self.b.file.diagnostics.push(diagnostic);
                return;
            }
        }
    }

    /// `@augments`, `@extends`: the type arguments are added to the `extends` clause, if it names
    /// the same class.
    fn reparse_augments_tag(&mut self, class_name: &ClassName, class: ClassId) {
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
    fn reparse_type_tag(&mut self, ty: TypeExpr, host: &mut Host, is_last_type_tag: bool) {
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
                    let ty = self.reparse_unchecked_type(ty);
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
                        *prop_ty = self.reparse_unchecked_type(ty);
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
                    // `SetType` without a test: the last tag replaces the others.
                    if is_last_type_tag {
                        let ty = self.reparse_unchecked_type(ty);
                        let owner = JsDocTypeOwner::Assign(e);
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
            let ty = self.reparse_unchecked_type(ty);
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
                    // They are not modifiers in an object literal, nor in anything nested in one.
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

    /// `checkUnmatchedJSDocParameters`, to the extent that syntax alone determines it.
    /// `getAllJSDocTags`: only the tags of the nearest comment are used, which is the first one to
    /// reach this function.
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
        self.b.file.functions_with_param_tags.push(func);
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
        let mut errors: Vec<(&[Name], u32)> = Vec::new();
        // If the function refers to `arguments`, the last tag may describe it.
        if let [_] = last.name[..]
            && !is_matched(&*self, tags.len() - 1, last)
            && !matches!(last.ty, TagType::None)
            && !self.is_array_type(&last.ty)
        {
            errors.push((&last.name, 8029));
        }
        for (index, &property) in tags.iter().enumerate() {
            if is_matched(&*self, index, property) {
                continue;
            }
            match property.name[..] {
                [_] if !property.is_name_first => errors.push((&property.name, 8024)),
                [_] | [] => {}
                [..] => errors.push((&property.name, 8032)),
            }
        }
        for (name, code) in errors {
            // `entityNameToString` of the name and, for a qualified name, of the part before its
            // last dot.
            let parts: Vec<&[u8]> = name.iter().map(|part| part.text.slice()).collect();
            let whole = parts.join(&b'.');
            let left = parts[..parts.len() - 1].join(&b'.');
            let args: &[&[u8]] = if code == 8032 {
                &[&whole, &left]
            } else {
                &[&whole]
            };
            let at = (name[0].start, name[name.len() - 1].end);
            let diagnostic = Diagnostic::new(DiagnosticKind::Checker, at, code, args);
            self.b.file.jsdoc_param_errors.push((func, diagnostic));
        }
    }

    /// `isArrayType`, decided from the syntax of the type.
    fn is_array_type(&self, ty: &TagType) -> bool {
        match *ty {
            TagType::None => false,
            TagType::Literal { is_array, .. } => is_array,
            TagType::Expr(expr) if expr.is_optional || expr.ty.is_none() => false,
            TagType::Expr(expr) if expr.is_variadic => true,
            TagType::Expr(expr) => match self.jsdoc.types.file[expr.ty].kind {
                TypeNodeKind::Array(_) => true,
                TypeNodeKind::Ref { name, .. } => {
                    let mut texts = self.jsdoc.types.file.texts(name);
                    name.len() == 1
                        && matches!(texts.next(), Some(known::Array | known::ReadonlyArray))
                }
                _ => false,
            },
        }
    }
}
