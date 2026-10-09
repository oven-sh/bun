//! reparser.go: the tags of JSDoc comments become ordinary nodes, in JavaScript. Where it clones a type, the type is parsed again.

use super::jsdoc::{Attached, Reach};
use super::{ListKind, Parser};
use bun_sema::atom::{Atom, known};
use bun_sema::check::jsdoc::syntax::{
    ClassName, DeclaredName, JsDoc, Name, Property, Signature, Tag, TagKind, TagType, TypeExpr,
    TypeShape,
};
use bun_sema::hir::*;
use smallvec::SmallVec;

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
    /// A member of a class, before it is on the stack of members. Its modifiers are on their stack: `modifiers` is empty.
    ClassMember(Member),
    /// A property of an object literal, before it is on the stack of properties, and the type of its `@type` tag.
    Property(Prop, TypeNodeId),
}

/// The modifier flags in `flags`, which an overload signature shares with the implementation.
fn modifiers_of(flags: Flags) -> Flags {
    flags.difference(Flags::GENERATOR | Flags::OPTIONAL | Flags::MISSING_BODY)
}

/// `entityNameToString`
/// The names of those of `tags` that no parameter matches, with the code of what is said about each.
fn push_unmatched_names<'d, 't>(
    tags: &[&'d Property<'t>],
    is_matched: &[bool],
    errors: &mut Vec<(&'d [Name<'t>], u32)>,
) {
    for (&property, &is_matched) in tags.iter().zip(is_matched) {
        if is_matched {
            continue;
        }
        match property.name[..] {
            [_] if !property.is_name_first => errors.push((&property.name, 8024)),
            [_] | [] => {}
            [..] => errors.push((&property.name, 8032)),
        }
    }
}

fn entity_name_to_string(name: &[Name<'_>]) -> Vec<u8> {
    let parts: Vec<&[u8]> = name.iter().map(|part| &*part.text).collect();
    parts.join(&b'.')
}

impl<'a, const GENERAL: bool> Parser<'a, GENERAL> {
    // ───────────────────────────── helpers ─────────────────────────────

    fn name_atom(&mut self, name: &Name<'_>) -> Atom {
        self.atom(&name.text)
    }

    /// The outermost parentheses around `e`: their start and end.
    fn paren_of(&self, e: ExprId) -> Option<(u32, u32)> {
        // An expression is added after its operands, its parentheses after it: the list is in the order of the ids.
        let outermost = parentheses_around(&self.f, e).last()?;
        Some((outermost.1, outermost.2))
    }

    /// `IsPrivateIdentifier` for the name of a property access.
    fn is_private_name(&self, name: Atom) -> bool {
        self.lx.text_of(name).first() == Some(&b'#')
    }

    /// `p.parsingContexts&(1<<PCObjectLiteralMembers) != 0`
    fn is_in_object_literal(&self) -> bool {
        self.lists & 1 << ListKind::ObjectLiteralMembers as u32 != 0
    }

    /// `IsStringOrNumericLiteralLike`
    fn is_literal_like(&self, e: ExprId) -> bool {
        self.paren_of(e).is_none()
            && match self.f[e].kind {
                ExprKind::String(_) | ExprKind::Number(_) => true,
                ExprKind::Template { exprs, .. } => exprs.is_empty(),
                _ => false,
            }
    }

    /// `IsEntityNameExpressionEx`, in JavaScript.
    fn is_entity_name_expression(&self, mut e: ExprId) -> bool {
        loop {
            if self.paren_of(e).is_some() {
                return false;
            }
            e = match self.f[e].kind {
                ExprKind::Ident(_) | ExprKind::This => return true,
                ExprKind::Dot { obj, name, .. } if !self.is_private_name(name) => obj,
                ExprKind::Index { obj, index, .. } if self.is_literal_like(index) => obj,
                _ => return false,
            };
        }
    }

    /// `GetAssignmentDeclarationKind(e) != JSDeclarationKindNone` for a binary expression.
    fn is_assignment_declaration(&self, e: ExprId) -> bool {
        let ExprKind::Assign {
            op: None, target, ..
        } = self.f[e].kind
        else {
            return false;
        };
        if self.paren_of(e).is_some() || self.paren_of(target).is_some() {
            return false;
        }
        let is_this = |obj: ExprId| {
            matches!(self.f[obj].kind, ExprKind::This) && self.paren_of(obj).is_none()
        };
        match self.f[target].kind {
            ExprKind::Dot { obj, name, .. } => {
                is_this(obj) || !self.is_private_name(name) && self.is_entity_name_expression(obj)
            }
            ExprKind::Index { obj, .. } => is_this(obj) || self.is_entity_name_expression(obj),
            _ => false,
        }
    }

    /// The expression of an expression statement, a `return` or an `export default`.
    fn statement_expression(&self, stmt: StmtId) -> ExprId {
        match self.f[stmt].kind {
            StmtKind::Expr(e)
            | StmtKind::Return(e)
            | StmtKind::ExportDefault(e)
            | StmtKind::ExportAssign(e) => e,
            _ => ExprId::NONE,
        }
    }

    fn set_statement_expression(&mut self, stmt: StmtId, e: ExprId) {
        let kind = &mut self.f[stmt].kind;
        match kind {
            StmtKind::Expr(_) => *kind = StmtKind::Expr(e),
            StmtKind::Return(_) => *kind = StmtKind::Return(e),
            StmtKind::ExportDefault(_) => *kind = StmtKind::ExportDefault(e),
            StmtKind::ExportAssign(_) => *kind = StmtKind::ExportAssign(e),
            _ => {}
        }
    }

    /// `skipSatisfiesExpressions`: the function that `e` is then. `NONE`: it is no function.
    fn function_of_expression(&self, mut e: ExprId) -> FnId {
        while e.is_some() && self.paren_of(e).is_none() {
            match self.f[e].kind {
                ExprKind::Satisfies { expr, .. } => e = expr,
                ExprKind::Fn(func) => return func,
                _ => break,
            }
        }
        FnId::NONE
    }

    /// `getFunctionLikeHost`
    fn function_like_host(&self, host: &Host) -> FnId {
        match *host {
            Host::Function(func) => func,
            Host::ClassMember(member) => match member.kind {
                MemberKind::Property => self.function_of_expression(member.init),
                MemberKind::Method
                | MemberKind::Getter
                | MemberKind::Setter
                | MemberKind::Constructor => member.func,
                _ => FnId::NONE,
            },
            Host::Property(prop, _) => match prop.kind {
                PropKind::Init | PropKind::Method | PropKind::Getter | PropKind::Setter => {
                    self.function_of_expression(prop.value)
                }
                PropKind::Shorthand | PropKind::Spread => FnId::NONE,
            },
            Host::VariableStatement(decls) if !decls.is_empty() => {
                self.function_of_expression(self.f[decls.at(0)].init)
            }
            Host::ExportAssignment(stmt) | Host::ReturnStatement(stmt) => {
                self.function_of_expression(self.statement_expression(stmt))
            }
            Host::ExpressionStatement(stmt) => {
                // `GetRightMostAssignedExpression`
                let mut e = self.statement_expression(stmt);
                while e.is_some()
                    && self.paren_of(e).is_none()
                    && let ExprKind::Assign { value, .. } = self.f[e].kind
                {
                    e = value;
                }
                self.function_of_expression(e)
            }
            _ => FnId::NONE,
        }
    }

    /// `FullSignature != nil`
    fn has_full_signature(&self, func: FnId) -> bool {
        self.jsdoc.full_signatures.contains(&func.0)
    }

    /// `checkNonIdentifierName`. It is an error of the parser, not of the comment.
    fn check_non_identifier_name(&mut self, name: &Name<'_>) {
        if bun_core::lexer::is_identifier(&name.text) {
            return;
        }
        // A missing name is reported at the character before it.
        let start = match name.is_missing() {
            true => name.start.saturating_sub(1),
            false => name.start,
        };
        match self.recovers() {
            true => self.f.error(DiagnosticKind::Parse, start, name.end, 1003),
            false => self.report(),
        }
    }

    // ───────────────────────────── types ─────────────────────────────

    /// `addDeepCloneReparse` for the type of a type expression.
    fn reparse_type(&mut self, expr: TypeExpr) -> TypeNodeId {
        // `checkSourceElementWorker` has no case for a `JSDocVariadicType` or a `JSDocOptionalType`.
        let wrappers = TypeShape::VARIADIC | TypeShape::OPTIONAL;
        match expr.shape.intersects(wrappers) {
            true => self.parse_type_again(expr, Reach::Resolved),
            false => self.parse_type_again(expr, Reach::Checked),
        }
    }

    /// The same for a type that `checkSourceFile` never reaches: only `getTypeFromTypeNode` is called for it.
    fn reparse_unchecked_type(&mut self, expr: TypeExpr) -> TypeNodeId {
        self.parse_type_again(expr, Reach::Resolved)
    }

    /// `reparseJSDocTypeLiteral`
    fn reparse_tag_type(&mut self, ty: &TagType<'_>) -> TypeNodeId {
        if self.is_too_deep() {
            return TypeNodeId::NONE;
        }
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
            let Some(name) = property.name.last() else {
                continue;
            };
            let mut flags = Flags::REPARSED;
            // A name that is not an identifier is still a name, as a string.
            if !bun_core::lexer::is_identifier(&name.text) {
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
        let members = self.f.add_members(&members);
        for (index, comment) in comments {
            self.f
                .jsdoc_member_comments
                .push((members.at(index), comment.into()));
        }
        let literal = self.f.ty(TypeNodeKind::Object(members), pos, end);
        match is_array {
            true => self.f.ty(TypeNodeKind::Array(literal), pos, end),
            false => literal,
        }
    }

    /// `makeQuestionIfOptional`
    fn is_optional(property: &Property<'_>) -> bool {
        match property.ty {
            TagType::Expr(expr) if expr.shape.contains(TypeShape::OPTIONAL) => true,
            _ => property.is_bracketed,
        }
    }

    /// `gatherTypeParameters`
    fn gather_type_parameters(
        &mut self,
        doc: &JsDoc<'_>,
        typedef_or_callback: bool,
    ) -> Span<TypeParamId> {
        // In a comment with a `@typedef` or a `@callback` the `@template` tags apply to the type being defined.
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
                        self.check_non_identifier_name(&param.name);
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
                let modifiers: SmallVec<[Modifier; 2]> = param
                    .modifiers
                    .iter()
                    .map(|&(flag, pos)| Modifier {
                        kind: ModifierKind::Keyword(flag),
                        pos,
                    })
                    .collect();
                let modifiers = self.f.add_modifiers(&modifiers);
                params.push(TypeParam {
                    name: self.name_atom(&param.name),
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
        self.f.add_type_params(&params)
    }

    /// `makeNewCast`
    fn make_cast(&mut self, ty: TypeExpr, e: ExprId, is_assertion: bool) -> ExprId {
        let Some(&Expr { pos, end, .. }) = self.f.exprs.get(e.idx()) else {
            return e;
        };
        let (pos, end) = self.paren_of(e).unwrap_or((pos, end));
        // `isConstTypeReference`
        let kind = if is_assertion && ty.shape.contains(TypeShape::CONST) {
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
        self.f.expr(kind, pos, end)
    }

    // ───────────────────────────── tags ─────────────────────────────

    /// `reparseTags`, in JavaScript only, and what the checker reads from the tags of `host` in every file.
    pub(super) fn reparse_tags(&mut self, host: &mut Host, attached: &Attached<'a>) {
        // Reading the comments has ended the file.
        if self.has_failed() {
            return;
        }
        let is_js = self.f.is_js;
        // `EagerJSDoc`: in TypeScript `withJSDoc` parses the comments only if one has a link.
        if let Host::Class(class) = *host
            && (is_js || attached.has_see_or_link)
        {
            self.check_grammar_augments_tags(class, attached);
        }
        for (i, doc) in attached.docs.iter().enumerate() {
            let is_last = attached.last_has_tags && i + 1 == attached.docs.len();
            let reparsed: &[Tag<'_>] = if is_js { &doc.tags } else { &[] };
            for tag in reparsed {
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

    /// The type alias for a `@typedef` or a `@callback`, in the namespaces of its name (`wrapInJSDocNamespace`).
    fn reparse_alias(
        &mut self,
        name: &DeclaredName<'_>,
        ty: TypeNodeId,
        tag: &Tag<'_>,
        host: &Host,
        doc: &JsDoc<'_>,
    ) {
        let type_params = self.gather_type_parameters(doc, true);
        let mut flags = Flags::REPARSED;
        if !name.namespaces.is_empty() {
            flags |= Flags::EXPORT;
        }
        let alias = Alias {
            name: self.name_atom(&name.name),
            name_pos: name.name.start,
            flags,
            type_params,
            ty,
            stmt: StmtId::NONE,
        };
        let alias = self.f.add_alias(alias);
        let mut statement = self.f.stmt(StmtKind::TypeAlias(alias), tag.pos);
        self.f[statement].loc = TextRange {
            pos: tag.pos,
            end: tag.end,
        };
        // `IsImplicitlyExportedJSDocDeclaration`: the binder exports the outermost one, only from a module.
        for (depth, namespace) in name.namespaces.iter().enumerate().rev() {
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
                body: self.f.list(&[statement]),
                has_body: true,
                specifies_module: false,
                stmt: StmtId::NONE,
            };
            let module = self.f.add_module(module);
            statement = self.f.stmt(StmtKind::Module(module), namespace.start);
            // `parseJSDocTypeNameWithNamespace`: the rest of the name is its body.
            self.f[statement].loc = TextRange {
                pos: namespace.start,
                end: name.name.end,
            };
        }
        // `parseListIndex` passes only type aliases and imports on: the namespace is a member of the class.
        if let (Some(outermost), Host::ClassMember(_)) = (name.namespaces.first(), host) {
            self.flag(DiagnosticKind::Grammar, 1235, (outermost.start, 0), &[]);
        }
        self.jsdoc.reparsed.push(statement);
    }

    /// `reparseUnhosted`
    fn reparse_unhosted(&mut self, tag: &Tag<'_>, host: &Host, doc: &JsDoc<'_>) {
        match &tag.kind {
            TagKind::Typedef(typedef) => {
                if matches!(typedef.ty, TagType::None) {
                    return;
                }
                self.check_non_identifier_name(&typedef.name.name);
                let ty = self.reparse_tag_type(&typedef.ty);
                self.reparse_alias(&typedef.name, ty, tag, host, doc);
            }
            TagKind::Callback(callback) => {
                let signature = self.reparse_signature(&callback.signature, None, doc, tag);
                let kind = TypeNodeKind::Fn(signature);
                let ty = self.f.ty(kind, callback.signature.pos, tag.end);
                self.reparse_alias(&callback.name, ty, tag, host, doc);
            }
            TagKind::Import(import) => {
                if !import.has_clause {
                    return;
                }
                // `checkImportDeclaration` returns after `checkGrammarModuleElementContext`.
                let reach = match self.lists & 1 << ListKind::BlockStatements as u32 {
                    0 => Reach::Checked,
                    _ => Reach::Unvisited,
                };
                let loc = TextRange {
                    pos: tag.pos,
                    end: tag.end,
                };
                let statement = self.parse_import_again(*import, loc, reach);
                self.jsdoc.reparsed.push(statement);
            }
            TagKind::Overload(signature) => {
                // Only for function, method and constructor declarations outside of object literals.
                if self.is_in_object_literal() {
                    return;
                }
                // `tag.TagName()`
                let loc = TextRange {
                    pos: tag.name_pos,
                    end: tag.name_pos + b"overload".len() as u32,
                };
                match *host {
                    Host::Function(func) if func.is_some() && self.f[func].kind == FnKind::Decl => {
                        let signature = self.reparse_signature(signature, Some(func), doc, tag);
                        let statement = self.f.stmt(StmtKind::Fn(signature), tag.name_pos);
                        self.f[statement].loc = loc;
                        self.jsdoc.reparsed.push(statement);
                    }
                    Host::ClassMember(member)
                        if matches!(member.kind, MemberKind::Method | MemberKind::Constructor)
                            && !matches!(member.key, PropKey::Computed(_))
                            && member.func.is_some() =>
                    {
                        let func = self.reparse_signature(signature, Some(member.func), doc, tag);
                        self.s.members.push(Member {
                            flags: modifiers_of(member.flags) | Flags::REPARSED,
                            ty: TypeNodeId::NONE,
                            init: ExprId::NONE,
                            func,
                            name_pos: tag.name_pos,
                            start: tag.name_pos,
                            loc,
                            ..member
                        });
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }

    /// The name of the parameter for the tag `index` of a signature, which names `text`: `_` stands for what no identifier has.
    fn parameter_name(&mut self, text: &[u8], index: usize) -> Atom {
        if bun_core::lexer::is_identifier(text) {
            return self.atom(text);
        }
        if text.is_empty() {
            return self.atom(format!("_{index}").as_bytes());
        }
        let is_start = |c: u8| c.is_ascii_alphabetic() || matches!(c, b'_' | b'$') || c >= 0x80;
        let spelled: Vec<u8> = text
            .iter()
            .enumerate()
            .map(|(i, &c)| match is_start(c) || i > 0 && c.is_ascii_digit() {
                true => c,
                false => b'_',
            })
            .collect();
        self.atom(&spelled)
    }

    /// `reparseJSDocSignature`. `like`: the function an `@overload` tag is on. `None`: the function type of a `@callback`.
    fn reparse_signature(
        &mut self,
        signature: &Signature<'_>,
        like: Option<FnId>,
        doc: &JsDoc<'_>,
        tag: &Tag<'_>,
    ) -> FnId {
        let like = like.map(|like| self.f[like]);
        // `checkNonIdentifierName(fun.Name())`: of the names that the parser accepts only a missing one is not valid.
        if let Some(like) = like
            && matches!(like.kind, FnKind::Decl | FnKind::Method)
            && like.name == known::empty
            && !like
                .flags
                .intersects(Flags::COMPUTED_NAME | Flags::LITERAL_NAME)
        {
            self.check_non_identifier_name(&Name::missing(like.name_pos));
        }
        let type_params = match like {
            Some(_) => self.gather_type_parameters(doc, false),
            None => Span::EMPTY,
        };
        let source: &'a [u8] = self.lx.src;
        let mut this_param = ParamId::NONE;
        let mut params = Vec::with_capacity(signature.params.len());
        for (index, param) in signature.params.iter().enumerate() {
            let loc = TextRange {
                pos: param.pos,
                end: param.end,
            };
            let property = match &param.kind {
                TagKind::This(ty) => {
                    if this_param.is_none() {
                        // `thisIdent.Loc = thisTag.Loc`
                        let text = source.get(param.pos as usize..param.end as usize);
                        let name = self.atom(text.unwrap_or_default());
                        let this = Param {
                            pat: self.f.pat(PatKind::Ident(name), param.pos, param.end),
                            ty: self.reparse_type(*ty),
                            default: ExprId::NONE,
                            flags: Flags::REPARSED,
                            pos: param.pos,
                            loc,
                        };
                        this_param = self.f.add_param(this);
                    }
                    continue;
                }
                TagKind::Param(property) | TagKind::Property(property) => property,
                _ => continue,
            };
            // `@param x.y` describes a property of another parameter.
            let [name] = &property.name[..] else {
                continue;
            };
            let mut flags = Flags::REPARSED;
            let ty = match property.ty {
                // The type after the dots is used unchanged as the type of the parameter.
                TagType::Expr(expr)
                    if expr.shape.contains(TypeShape::VARIADIC)
                        && !expr.shape.contains(TypeShape::OPTIONAL) =>
                {
                    flags |= Flags::REST;
                    self.reparse_type(TypeExpr {
                        shape: expr.shape - TypeShape::VARIADIC,
                        ..expr
                    })
                }
                _ => self.reparse_tag_type(&property.ty),
            };
            if Self::is_optional(property) {
                flags |= Flags::OPTIONAL;
            }
            let name_atom = self.parameter_name(&name.text, index);
            params.push(Param {
                pat: self.f.pat(PatKind::Ident(name_atom), name.start, name.end),
                ty,
                default: ExprId::NONE,
                flags,
                pos: param.pos,
                loc,
            });
        }
        let pos = match like {
            Some(_) => tag.name_pos,
            None => signature.pos,
        };
        let ret = match (signature.ret, like) {
            (Some(ret), _) => self.reparse_type(ret),
            (None, Some(_)) => TypeNodeId::NONE,
            (None, None) => self.f.ty(TypeNodeKind::Keyword(Keyword::Any), pos, pos),
        };
        let (kind, flags, name) = match like {
            Some(like) => (like.kind, modifiers_of(like.flags), like.name),
            None => (FnKind::FunctionType, Flags::empty(), Atom::NONE),
        };
        let mut params = self.f.add_params(&params);
        // `GetThisParameter`. A parameter created from an `@this` tag precedes every `@param` tag.
        if this_param.is_none() {
            (this_param, params) = self.f.split_this_parameter(params);
        }
        self.f.add_fn(Func {
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
    fn reparse_hosted(&mut self, tag: &Tag<'_>, host: &mut Host, doc: &JsDoc<'_>) {
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
                    if self.f[func].type_params.is_empty() && !self.has_full_signature(func) {
                        let type_params = self.gather_type_parameters(doc, false);
                        self.f[func].type_params = type_params;
                        // `checkGrammarConstructorTypeParameters`: the list starts with its first tag.
                        if self.f[func].kind == FnKind::Constructor && !type_params.is_empty() {
                            self.flag(DiagnosticKind::Grammar, 1092, (tag.pos, tag.end), &[]);
                        }
                    }
                } else if let Host::Class(class) = *host
                    && self.f[class].type_params.is_empty()
                {
                    let type_params = self.gather_type_parameters(doc, false);
                    self.f[class].type_params = type_params;
                }
            }
            TagKind::Param(property) => self.reparse_param_tag(tag, property, host, doc),
            TagKind::This(ty) => {
                let func = self.function_like_host(host);
                if func.is_some() && self.f[func].this_param.is_none() {
                    // `finishReparsedNode(thisParam, tag.TagName())`
                    let this = Param {
                        pat: self.f.pat(PatKind::Missing, tag.name_pos, tag.name_pos),
                        ty: self.reparse_type(*ty),
                        default: ExprId::NONE,
                        flags: Flags::REPARSED,
                        pos: tag.name_pos,
                        loc: TextRange {
                            pos: tag.name_pos,
                            end: tag.name_pos + b"this".len() as u32,
                        },
                    };
                    let this = self.f.add_param(this);
                    self.f[func].this_param = this;
                    // `checkParameter`: the position of the parameter is that of the tag's name.
                    let code = match self.f[func].kind {
                        FnKind::Arrow => Some(2730),
                        FnKind::Constructor => Some(2681),
                        FnKind::Getter | FnKind::Setter => Some(2784),
                        _ => None,
                    };
                    if let Some(code) = code {
                        self.flag(DiagnosticKind::Checker, code, (tag.name_pos, 0), &[]);
                    }
                }
            }
            TagKind::Return(Some(ty)) => {
                let func = self.function_like_host(host);
                if func.is_some() && !self.has_full_signature(func) && self.f[func].ret.is_none() {
                    let ty = self.reparse_type(*ty);
                    self.f[func].ret = ty;
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
                    let mut all: Vec<TypeNodeId> = self.f.ids(self.f[class].implements).collect();
                    all.push(implemented);
                    let all = self.f.list(&all);
                    self.f[class].implements = all;
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

    /// `@param`, `@arg`, `@argument`
    fn reparse_param_tag(
        &mut self,
        tag: &Tag<'_>,
        property: &Property<'_>,
        host: &Host,
        doc: &JsDoc<'_>,
    ) {
        let func = self.function_like_host(host);
        if func.is_none() || self.has_full_signature(func) {
            return;
        }
        let Some(param) = self.find_matching_parameter(func, tag, property, doc) else {
            return;
        };
        if self.f[param].ty.is_none() && !matches!(property.ty, TagType::None) {
            let ty = self.reparse_tag_type(&property.ty);
            self.f[param].ty = ty;
        }
        if self.f[param].flags.contains(Flags::OPTIONAL) || !Self::is_optional(property) {
            return;
        }
        self.f[param].flags |= Flags::OPTIONAL | Flags::REPARSED;
        // `checkGrammarParameterList`, `checkGrammarAccessor`: the position of the `?` is that of the tag.
        let Func {
            kind,
            type_params,
            params,
            ret,
            ..
        } = self.f[func];
        if self.f[param].flags.contains(Flags::REST) {
            self.flag(DiagnosticKind::Grammar, 1047, (tag.pos, tag.end), &[]);
        } else if kind == FnKind::Setter
            && type_params.is_empty()
            && params.len() == 1
            && ret.is_none()
        {
            self.flag(DiagnosticKind::Grammar, 1051, (tag.pos, tag.end), &[]);
        }
    }

    /// `A.B<T>` as a type.
    fn reparse_class_name(&mut self, class_name: &ClassName<'_>) -> TypeNodeId {
        let name: SmallVec<[(Atom, u32); 4]> = class_name
            .name
            .iter()
            .map(|name| (self.name_atom(name), name.start))
            .collect();
        let args = self.reparse_type_arguments(class_name);
        let name = self.f.entity_name(name.into_iter());
        let pos = class_name.name.first().map_or(0, |first| first.start);
        let kind = TypeNodeKind::Ref { name, args };
        self.f.ty(kind, pos, class_name.end)
    }

    fn reparse_type_arguments(&mut self, class_name: &ClassName<'_>) -> IdList<TypeNodeId> {
        match class_name.type_args {
            Some(type_args) => self.parse_type_arguments_again(type_args),
            None => IdList::EMPTY,
        }
    }

    /// `checkGrammarClassDeclarationHeritageClauses`, the first `@augments` tag of any comment whose last name is not that of the `extends` clause. `Checker::check_grammar_augments_tags` decides between it and the other errors.
    fn check_grammar_augments_tags(&mut self, class: ClassId, attached: &Attached<'_>) {
        let extends = self.f[class].extends;
        if extends.is_none() || self.paren_of(extends).is_some() {
            return;
        }
        // `getIdentifierFromEntityNameExpression`
        let (ExprKind::Ident(target) | ExprKind::Dot { name: target, .. }) = self.f[extends].kind
        else {
            return;
        };
        for tag in attached.docs.iter().flat_map(|doc| &doc.tags) {
            if let TagKind::Augments(class_name, tag_name) = &tag.kind
                && let Some(source) = class_name.name.last()
                && target != self.name_atom(source)
            {
                let names: [&[u8]; 3] = [tag_name, &source.text, self.lx.text_of(target)];
                let at = (source.start, source.end);
                let diagnostic = Diagnostic::new(DiagnosticKind::Grammar, at, 8023, &names);
                self.f.diagnostics.push(diagnostic);
                self.f.unmatched_augments_tags.push((class, source.start));
                return;
            }
        }
    }

    /// `@augments`, `@extends`: the type arguments go to the `extends` clause, if it names the same class.
    fn reparse_augments_tag(&mut self, class_name: &ClassName<'_>, class: ClassId) {
        let Class {
            extends,
            extends_args,
            ..
        } = self.f[class];
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
            match self.f[at].kind {
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
                .all(|(&a, b)| a == self.name_atom(b));
        if is_same && extends_args.is_empty() && class_name.type_args.is_some() {
            let args = self.reparse_type_arguments(class_name);
            self.f[class].extends_args = args;
        }
    }

    /// `@type`
    fn reparse_type_tag(&mut self, ty: TypeExpr, host: &mut Host, is_last_type_tag: bool) {
        match host {
            Host::VariableStatement(decls) => {
                if let Some(decl) = decls.iter().find(|&decl| self.f[decl].ty.is_none()) {
                    let ty = self.reparse_type(ty);
                    self.f[decl].ty = ty;
                    return;
                }
            }
            Host::VariableDeclaration(decl) => {
                if self.f[*decl].ty.is_none() {
                    let ty = self.reparse_type(ty);
                    self.f[*decl].ty = ty;
                    return;
                }
            }
            Host::ExportAssignment(stmt) => {
                let owner = JsDocTypeOwner::Export(*stmt);
                if self.f.jsdoc_types.last().is_none_or(|t| t.0 != owner) {
                    let ty = self.reparse_unchecked_type(ty);
                    self.f.jsdoc_types.push((owner, ty));
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
                if self.f[*func].ret.is_none() {
                    let ty = self.reparse_type(ty);
                    self.f[*func].ret = ty;
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
                    let func = self.function_of_expression(prop.value);
                    if func.is_some() && self.f[func].ret.is_none() {
                        let ty = self.reparse_type(ty);
                        self.f[func].ret = ty;
                        return;
                    }
                }
                _ => {}
            },
            Host::Parameter(param) => {
                if self.f[*param].ty.is_none() {
                    let ty = self.reparse_type(ty);
                    self.f[*param].ty = ty;
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
                        self.f.jsdoc_types.push((owner, ty));
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
        let function = self.f[func];
        let Func {
            type_params,
            params,
            ret,
            ..
        } = function;
        let has_no_typed_params = function.this_ty(&self.f).is_none()
            && params.iter().all(|param| self.f[param].ty.is_none());
        if type_params.is_empty() && ret.is_none() && has_no_typed_params {
            let ty = self.reparse_unchecked_type(ty);
            self.f.jsdoc_types.push((JsDocTypeOwner::Fn(func), ty));
            self.jsdoc.full_signatures.insert(func.0);
        }
    }

    /// `@satisfies`
    fn reparse_satisfies_tag(&mut self, ty: TypeExpr, host: &mut Host) {
        match host {
            Host::VariableStatement(decls) => {
                if let Some(decl) = decls.iter().find(|&decl| self.f[decl].init.is_some()) {
                    let cast = self.make_cast(ty, self.f[decl].init, false);
                    self.f[decl].init = cast;
                }
            }
            Host::VariableDeclaration(decl) => {
                let init = self.f[*decl].init;
                if init.is_some() {
                    let cast = self.make_cast(ty, init, false);
                    self.f[*decl].init = cast;
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
                    && let ExprKind::Assign { op, target, value } = self.f[e].kind
                {
                    let value = self.make_cast(ty, value, false);
                    self.f[e].kind = ExprKind::Assign { op, target, value };
                }
            }
            _ => {}
        }
    }

    /// `@public`, `@private`, `@protected`, `@readonly`, `@override`
    fn reparse_modifier_tag(&mut self, modifier: Flags, tag: &Tag<'_>, host: &mut Host) {
        match host {
            Host::ExpressionStatement(stmt) => {
                let e = self.statement_expression(*stmt);
                if e.is_some()
                    && self.paren_of(e).is_none()
                    && matches!(self.f[e].kind, ExprKind::Assign { .. })
                {
                    match self.f.jsdoc_modifiers.last_mut() {
                        Some(last) if last.0 == e => last.1 |= modifier,
                        _ => self.f.jsdoc_modifiers.push((e, modifier)),
                    }
                }
            }
            Host::ClassMember(member) => {
                let is_modified = match member.kind {
                    // They are not modifiers in an object literal, nor in anything nested in one.
                    MemberKind::Method | MemberKind::Getter | MemberKind::Setter => {
                        !self.is_in_object_literal()
                    }
                    MemberKind::Property | MemberKind::Constructor => true,
                    _ => false,
                };
                if is_modified {
                    member.flags |= modifier;
                    if member.func.is_some() {
                        self.f[member.func].flags |= modifier;
                    }
                    // Modifiers synthesized from tags come after those in the source.
                    self.s.modifiers.push(Modifier {
                        kind: ModifierKind::Keyword(modifier | Flags::REPARSED),
                        pos: tag.pos,
                    });
                }
            }
            _ => {}
        }
    }

    /// `findMatchingParameter`
    fn find_matching_parameter(
        &mut self,
        func: FnId,
        tag: &Tag<'_>,
        property: &Property<'_>,
        doc: &JsDoc<'_>,
    ) -> Option<ParamId> {
        let tag_index = doc
            .tags
            .iter()
            .filter(|other| matches!(other.kind, TagKind::Param(_)))
            .position(|other| std::ptr::eq(other, tag));
        let tag_name = match &property.name[..] {
            [name] => Some((self.name_atom(name), name.is_missing())),
            _ => None,
        };
        let mut params = self.f[func].params.iter().enumerate();
        let matching = params.find(|&(index, param)| match self.f[self.f[param].pat].kind {
            PatKind::Ident(name) => tag_name.is_some_and(|(tag_name, is_missing)| {
                name == tag_name || Some(index) == tag_index && is_missing
            }),
            _ => Some(index) == tag_index,
        });
        matching.map(|(_, param)| param)
    }

    /// `checkUnmatchedJSDocParameters`, as far as syntax decides. `getAllJSDocTags`: only the nearest comment counts, which gets here first.
    fn note_unmatched_parameters(&mut self, host: &Host, doc: &JsDoc<'_>) {
        let func = match *host {
            // `GetNextJSDocCommentLocation` does not go through an assignment.
            Host::ExpressionStatement(stmt) => {
                self.function_of_expression(self.statement_expression(stmt))
            }
            Host::VariableDeclaration(decl) => self.function_of_expression(self.f[decl].init),
            _ => self.function_like_host(host),
        };
        if func.is_none() || !self.jsdoc.documented_functions.insert(func.0) {
            return;
        }
        let tags: Vec<&Property<'_>> = doc
            .tags
            .iter()
            .filter_map(|tag| match &tag.kind {
                TagKind::Param(property)
                    if !matches!(&property.name[..], [name] if name.is_missing()) =>
                {
                    Some(property)
                }
                _ => None,
            })
            .collect();
        let Some(&last) = tags.last() else {
            return;
        };
        self.f.functions_with_param_tags.push(func);
        // `isJs`
        if !self.f.is_js {
            return;
        }
        let mut names = Vec::new();
        let mut is_pattern = Vec::new();
        for param in self.f[func].params.iter() {
            match self.f[self.f[param].pat].kind {
                PatKind::Ident(name) => {
                    names.push(name);
                    is_pattern.push(false);
                }
                PatKind::Object(_) | PatKind::Array(_) => is_pattern.push(true),
                PatKind::Missing => is_pattern.push(false),
            }
        }
        let mut is_matched = Vec::with_capacity(tags.len());
        for (index, property) in tags.iter().enumerate() {
            is_matched.push(match &property.name[..] {
                _ if is_pattern.get(index) == Some(&true) => true,
                [name] => names.contains(&self.name_atom(name)),
                _ => false,
            });
        }
        let mut errors: Vec<(&[Name<'_>], u32)> = Vec::new();
        // If the function refers to `arguments`, the last tag may describe it.
        if let [_] = last.name[..]
            && is_matched.last() == Some(&false)
            && !matches!(last.ty, TagType::None)
            && !Self::is_array_type(&last.ty)
        {
            errors.push((&last.name, 8029));
        }
        push_unmatched_names(&tags, &is_matched, &mut errors);
        for (name, code) in errors {
            let (Some(first), Some((last, left))) = (name.first(), name.split_last()) else {
                continue;
            };
            // The name and, for a qualified name, the part before its last dot.
            let whole = entity_name_to_string(name);
            let left = entity_name_to_string(left);
            let args: &[&[u8]] = if code == 8032 {
                &[&whole, &left]
            } else {
                &[&whole]
            };
            let at = (first.start, last.end);
            let diagnostic = Diagnostic::new(DiagnosticKind::Checker, at, code, args);
            self.f.jsdoc_param_errors.push((func, diagnostic));
        }
    }

    /// `isArrayType`, decided from the syntax of the type.
    fn is_array_type(ty: &TagType<'_>) -> bool {
        match *ty {
            TagType::None => false,
            TagType::Literal { is_array, .. } => is_array,
            TagType::Expr(expr) if expr.shape.contains(TypeShape::OPTIONAL) => false,
            TagType::Expr(expr) if expr.shape.contains(TypeShape::VARIADIC) => true,
            TagType::Expr(expr) => expr
                .shape
                .intersects(TypeShape::ARRAY | TypeShape::ARRAY_REFERENCE),
        }
    }
}
