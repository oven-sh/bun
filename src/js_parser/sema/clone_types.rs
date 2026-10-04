//! Builds HIR nodes (`bun_sema::hir`) from TypeScript syntax as the parser reads it: the
//! counterpart of `NewTypeReferenceNode` and the other node factories of TypeScript's parser. The
//! input types are in `ts_syntax.rs`.
//!
//! Nodes built during a speculative parse are rolled back with it (`P::rewind_type_syntax`). Names
//! are interned here, and the grammar checks that TypeScript runs on type syntax after parsing run
//! here.

use crate::sema::ts_syntax as ts;
use bun_ast::Expr;
use bun_sema::atom::{Atom, known};
use bun_sema::hir::{
    Alias, Chain, Diagnostic, DiagnosticKind, ExprId, ExprKind, Flags, FnBody, FnId, FnKind, Func,
    IdList, Interface, Keyword, Mapped, Member, MemberId, MemberKind, Param, ParamId, PatElem,
    PatElemId, PatId, PatKind, PatProp, PatPropId, PropKey, ResolutionMode, Span, SpecifierKind,
    SpecifierUse, StmtId, StmtKind, TextRange, TupleElem, TypeNodeId, TypeNodeKind, TypeParam,
    TypeParamId,
};

use super::builder::Builder;
use super::notes::Rows;

/// A field of a node whose source is a JavaScript expression or function body. The lowering pass
/// converts it and fills it in.
#[derive(Copy, Clone)]
pub(crate) enum PendingPart {
    /// `[expression]: T`
    MemberKey(MemberId, Expr),
    /// `name: T = expression`
    MemberInitializer(MemberId, Expr),
    /// `get name() { .. }`
    FunctionBody(FnId, ts::FunctionBody),
    /// `({ [expression]: binding }) => T`
    PatternKey(PatPropId, Expr),
    /// `(name = expression) => T`
    ParamDefault(ParamId, Expr),
    /// `({ name = expression }) => T`
    PatternPropertyDefault(PatPropId, Expr),
    /// `([name = expression]) => T`
    PatternElementDefault(PatElemId, Expr),
    /// `interface I extends expression`
    HeritageExpression(TypeNodeId, Expr),
    /// `import("m", { with: expression })`
    ImportAttributes(ts::ImportAttributes),
}

#[inline]
fn pos(loc: bun_ast::Loc) -> u32 {
    // Input locations are plain offsets, never note indexes.
    debug_assert!(!loc.is_index());
    loc.start.max(0) as u32
}

impl Builder<'_> {
    #[inline]
    pub(crate) fn add_type(&mut self, kind: TypeNodeKind, loc: bun_ast::Loc) -> TypeNodeId {
        self.file.ty(kind, pos(loc), 0)
    }

    #[inline]
    pub(crate) fn add_id_list(&mut self, types: &[TypeNodeId]) -> IdList<TypeNodeId> {
        match types.is_empty() {
            true => IdList::EMPTY,
            false => self.file.list(types),
        }
    }

    pub(crate) fn add_tuple(&mut self, elements: &[ts::TupleElement]) -> TypeNodeKind {
        let elements: smallvec::SmallVec<[TupleElem; 8]> = elements
            .iter()
            .map(|element| {
                let ts::TupleElement {
                    mut ty,
                    label,
                    is_optional,
                    mut is_rest,
                    loc,
                    end,
                } = *element;
                let name = label.map_or(Atom::NONE, |label| self.identifier(&label, pos(loc)));
                if is_rest && is_optional && label.is_some() {
                    // `checkNamedTupleMember`: A tuple member cannot be both optional and rest.
                    self.file
                        .error(DiagnosticKind::Grammar, pos(loc), pos(end), 5085);
                    // `getTupleElementFlags`, `getTypeFromNamedTupleTypeNode`: it is optional.
                    is_rest = false;
                    ty = self.rest_element_type(ty);
                }
                TupleElem {
                    ty,
                    name,
                    optional: is_optional,
                    rest: is_rest,
                    start: pos(loc),
                    end: pos(end),
                }
            })
            .collect();
        TypeNodeKind::Tuple(self.file.add_tuple_elems(&elements))
    }

    pub(crate) fn add_template(
        &mut self,
        types: &[TypeNodeId],
        texts: &[bun_ast::StoreStr],
    ) -> TypeNodeKind {
        let texts: smallvec::SmallVec<[Atom; 4]> =
            texts.iter().map(|text| self.atoms.intern(text)).collect();
        TypeNodeKind::Template {
            types: self.file.list(types),
            texts: self.file.list(&texts),
        }
    }

    pub(crate) fn add_mapped_type(&mut self, mapped: ts::MappedType) -> TypeNodeKind {
        let ts::MappedType {
            param,
            name_type,
            ty,
            readonly,
            optional,
            is_readonly_with_plus,
            is_optional_with_plus,
            extra_member_loc,
            members,
        } = mapped;
        if let Some(loc) = extra_member_loc {
            // `checkGrammarMappedType`: A mapped type may not declare properties or methods.
            // `GetErrorRangeForNode`: the name of a property, the whole node of a signature.
            match members.iter().next().map(|first| self.file[first]) {
                Some(first) if first.kind != MemberKind::Property => {
                    self.file
                        .error(DiagnosticKind::Grammar, pos(loc), first.loc.end, 7061);
                }
                _ => self.file.error(DiagnosticKind::Grammar, pos(loc), 0, 7061),
            }
        }
        TypeNodeKind::Mapped(self.file.add_mapped(Mapped {
            param,
            name_ty: name_type,
            ty,
            readonly,
            optional,
            is_readonly_with_plus,
            is_optional_with_plus,
            members,
        }))
    }

    pub(crate) fn add_typeof(
        &mut self,
        names: &[ts::Name],
        args: IdList<TypeNodeId>,
        has_type_arguments: bool,
    ) -> TypeNodeKind {
        TypeNodeKind::Typeof {
            expr: self.entity_name_expression(names),
            name: self.add_names(names),
            args,
            has_type_arguments,
        }
    }

    /// `import("specifier")`. `argument`: the type that appears in place of a string literal.
    pub(crate) fn add_import_type(
        &mut self,
        specifier: (&[u8], u32),
        argument: TypeNodeId,
        (mode, assert_keyword_loc, attributes): super::keep::ImportTypeAttributes,
        is_typeof: bool,
    ) -> TypeNodeKind {
        if let Some(attributes) = attributes {
            self.pending.push(PendingPart::ImportAttributes(attributes));
        }
        // `getTypeFromImportTypeNode`: 1141 for `import(T)`, whose type is the error type.
        // `checkImportType` still checks `T`, which is stored in `args` of a node without a
        // specifier. The type arguments are never checked.
        if argument.is_some() {
            let bun_sema::hir::TypeNode { pos, end, .. } = self.file[argument];
            self.file.error(DiagnosticKind::Checker, pos, end, 1141);
            return TypeNodeKind::Import {
                spec: Atom::NONE,
                name: Span::EMPTY,
                args: self.file.list(&[argument]),
                is_typeof,
                mode: ResolutionMode::None,
            };
        }
        let spec = self.atoms.intern(specifier.0);
        self.file.specifier_uses.push(SpecifierUse {
            spec,
            pos: specifier.1,
            kind: SpecifierKind::ImportType,
            mode,
        });
        if let Some(loc) = assert_keyword_loc {
            // Import assertions have been replaced by import attributes. Use 'with' instead of 'assert'.
            self.file.error(DiagnosticKind::Parse, pos(loc), 0, 2880);
        }
        TypeNodeKind::Import {
            spec,
            name: Span::EMPTY,
            args: IdList::EMPTY,
            is_typeof,
            mode,
        }
    }

    /// `checkJSDocTypeIsInJsFile`
    pub(crate) fn check_jsdoc_type_is_in_js_file(&mut self, at: u32, code: u32) {
        if !self.is_js {
            self.file.error(DiagnosticKind::Grammar, at, 0, code);
        }
    }

    /// `operand | keyword`
    pub(crate) fn union_with_keyword(
        &mut self,
        operand: TypeNodeId,
        keyword: Keyword,
        at: u32,
    ) -> TypeNodeKind {
        let keyword = self.file.ty(TypeNodeKind::Keyword(keyword), at, at);
        TypeNodeKind::Union(self.file.list(&[operand, keyword]))
    }

    /// `getTypeFromRestTypeNode`: the element type if `ty` is an array type node, otherwise `ty`.
    pub(crate) fn rest_element_type(&self, ty: TypeNodeId) -> TypeNodeId {
        match self.file[ty].kind {
            TypeNodeKind::Array(element) => element,
            _ => ty,
        }
    }

    pub(crate) fn add_names(&mut self, names: &[ts::Name]) -> Span<bun_sema::hir::NameId> {
        let names: smallvec::SmallVec<[(Atom, u32); 4]> = names
            .iter()
            .map(|name| (self.identifier(&name.text, pos(name.loc)), pos(name.loc)))
            .collect();
        self.file.entity_name(names.into_iter())
    }

    /// `a.b.c` as an expression.
    fn entity_name_expression(&mut self, names: &[ts::Name]) -> ExprId {
        let mut expr = ExprId::NONE;
        let start = names.first().map_or(0, |first| pos(first.loc));
        for &ts::Name { text, loc } in names {
            let name = self.atoms.intern(&text);
            let kind = match expr.is_none() {
                true if name == known::this => ExprKind::This,
                true => ExprKind::Ident(name),
                false => ExprKind::Dot {
                    obj: expr,
                    name,
                    name_pos: pos(loc),
                    chain: Chain::No,
                },
            };
            expr = self.file.expr(kind, start, pos(loc) + text.len() as u32);
        }
        expr
    }

    fn modifier_list(
        &mut self,
        written: ts::Span<ts::Modifier>,
    ) -> Span<bun_sema::hir::ModifierId> {
        if written.is_empty() {
            return Span::EMPTY;
        }
        let modifiers: smallvec::SmallVec<[(Flags, u32); 4]> = self.ts[written]
            .iter()
            .map(|modifier| (modifier.flag, pos(modifier.loc)))
            .collect();
        self.add_modifier_list(&modifiers)
    }

    fn type_param(&mut self, param: &ts::TypeParam) -> TypeParam {
        TypeParam {
            name: self.identifier(&param.name, pos(param.loc)),
            pos: pos(param.loc),
            start: pos(param.start),
            end: pos(param.end),
            constraint: param.constraint,
            default: param.default,
            flags: param.flags,
            modifiers: self.modifier_list(param.modifiers),
        }
    }

    pub(crate) fn add_type_param(&mut self, param: ts::TypeParam) -> TypeParamId {
        let param = self.type_param(&param);
        self.file.add_type_param(param)
    }

    pub(crate) fn add_type_params(&mut self, params: &[ts::TypeParam]) -> Span<TypeParamId> {
        if params.is_empty() {
            return Span::EMPTY;
        }
        let params: smallvec::SmallVec<[TypeParam; 4]> =
            params.iter().map(|param| self.type_param(param)).collect();
        self.file.add_type_params(&params)
    }

    pub(crate) fn add_params(&mut self, params: &[ts::Param]) -> Span<ParamId> {
        if params.is_empty() {
            return Span::EMPTY;
        }
        let created: smallvec::SmallVec<[Param; 4]> = params
            .iter()
            .map(|param| {
                let mut flags = param.flags;
                if flags.intersects(
                    Flags::PUBLIC
                        | Flags::PRIVATE
                        | Flags::PROTECTED
                        | Flags::READONLY
                        | Flags::OVERRIDE,
                ) {
                    flags |= Flags::PARAMETER_PROPERTY;
                }
                Param {
                    pat: param.pattern,
                    ty: param.ty,
                    default: ExprId::NONE,
                    flags,
                    pos: pos(param.loc),
                    loc: TextRange {
                        pos: pos(param.full_start),
                        end: pos(param.end),
                    },
                }
            })
            .collect();
        let created = self.file.add_params(&created);
        for (param, id) in params.iter().zip(created.iter()) {
            if let Some(default) = param.default {
                self.pending.push(PendingPart::ParamDefault(id, default));
            }
            let list = self.modifier_list(param.modifiers);
            self.file.set_param_modifiers(id, list);
        }
        created
    }

    #[inline]
    pub(crate) fn add_pattern(
        &mut self,
        kind: PatKind,
        loc: bun_ast::Loc,
        end: bun_ast::Loc,
    ) -> PatId {
        self.file.pat(kind, pos(loc), pos(end))
    }

    pub(crate) fn add_pattern_elements(&mut self, elements: &[ts::PatternElement]) -> PatKind {
        let created: smallvec::SmallVec<[PatElem; 4]> = elements
            .iter()
            .map(|element| PatElem {
                pat: element.pattern,
                default: ExprId::NONE,
                is_rest: element.is_rest,
                start: pos(element.loc),
                end: pos(element.end),
            })
            .collect();
        let created = self.file.add_pat_elems(&created);
        for (element, id) in elements.iter().zip(created.iter()) {
            if let Some(default) = element.default {
                self.pending
                    .push(PendingPart::PatternElementDefault(id, default));
            }
        }
        PatKind::Array(created)
    }

    pub(crate) fn add_pattern_properties(&mut self, properties: &[ts::PatternProperty]) -> PatKind {
        let created: smallvec::SmallVec<[PatProp; 4]> = properties
            .iter()
            .map(|property| PatProp {
                key: self.key(property.key),
                name_kind: match property.key {
                    ts::PropertyKey::Number(_) => bun_sema::hir::NameKind::NumericLiteral,
                    _ => bun_sema::hir::NameKind::Identifier,
                },
                value: property.value,
                default: ExprId::NONE,
                is_rest: property.is_rest,
                pos: pos(property.loc),
                key_pos: pos(property.loc),
                end: pos(property.end),
            })
            .collect();
        let created = self.file.add_pat_props(&created);
        for (property, id) in properties.iter().zip(created.iter()) {
            if let ts::PropertyKey::Computed(expr) = property.key {
                self.pending.push(PendingPart::PatternKey(id, expr));
            }
            if let Some(default) = property.default {
                self.pending
                    .push(PendingPart::PatternPropertyDefault(id, default));
            }
        }
        PatKind::Object(created)
    }

    /// A computed key is left empty. The caller adds a `PendingPart` for it.
    fn key(&mut self, key: ts::PropertyKey) -> PropKey {
        match key {
            ts::PropertyKey::None | ts::PropertyKey::BigInt | ts::PropertyKey::Computed(_) => {
                PropKey::None
            }
            ts::PropertyKey::Name(name) => PropKey::Name(self.atom(&name)),
            ts::PropertyKey::Number(number) => PropKey::Name(self.number_name(number)),
            ts::PropertyKey::Private(name) => PropKey::Private(self.atoms.intern(&name)),
        }
    }

    /// Its name and start position are set by the member that owns it (`member`).
    pub(crate) fn add_signature(&mut self, signature: ts::Signature) -> FnId {
        let ts::Signature {
            kind,
            flags,
            type_params,
            params,
            return_type,
            body,
            open_paren_loc,
            loc,
        } = signature;
        let (this_param, params) = match kind {
            FnKind::IndexSignature => (ParamId::NONE, params),
            _ => self.file.split_this_parameter(params),
        };
        let func = self.file.add_fn(Func {
            kind,
            flags,
            name: Atom::NONE,
            name_pos: pos(loc),
            type_params,
            params,
            this_param,
            ret: return_type,
            body: FnBody::None,
            anchor: pos(open_paren_loc),
            start: pos(loc),
        });
        if let Some(body) = body {
            self.add_signature_body(func, body);
        }
        func
    }

    pub(crate) fn add_signature_body(&mut self, func: FnId, body: ts::FunctionBody) {
        // `checkGrammarAccessor`: An implementation cannot be declared in ambient contexts.
        self.file
            .error(DiagnosticKind::Grammar, pos(body.loc), pos(body.end), 1183);
        self.pending.push(PendingPart::FunctionBody(func, body));
    }

    /// The flags for `export`, `default` and `declare`, and the position of `export`.
    pub(crate) fn clone_statement_modifiers(
        &self,
        modifiers: ts::Span<ts::Modifier>,
    ) -> (Flags, Option<u32>) {
        let (mut all, mut export_pos) = (Flags::empty(), None);
        for modifier in modifiers.iter() {
            let ts::Modifier { flag, loc, .. } = self.ts[modifier];
            if flag == Flags::EXPORT {
                export_pos.get_or_insert_with(|| pos(loc));
            }
            all |= flag;
        }
        (all, export_pos)
    }

    /// Reports what `checkGrammarInterfaceDeclaration` reports, except 1176 for an `implements`
    /// clause, which the checker finds in the source text.
    pub(crate) fn clone_interface(
        &mut self,
        id: ts::Id<ts::Interface>,
        flags: Flags,
        pos: u32,
    ) -> Option<StmtId> {
        let ts::Interface {
            name,
            type_params,
            extends,
            other_heritage,
            heritage_errors,
            members,
        } = self.ts[id];
        for (loc, code) in heritage_errors.into_iter().flatten() {
            let (at, args): (_, &[&[u8]]) = match code {
                // An empty range at the end of the keyword. Only the first clause is checked.
                1097 => ((self::pos(loc), self::pos(loc)), &[b"extends"]),
                _ => ((self::pos(loc), 0), &[]),
            };
            let diagnostic = Diagnostic::new(DiagnosticKind::Grammar, at, code, args);
            self.file.diagnostics.push(diagnostic);
        }
        let interface = self.file.add_interface(Interface {
            name: self.identifier(&name.text, self::pos(name.loc)),
            name_pos: self::pos(name.loc),
            flags,
            type_params,
            extends,
            other_heritage,
            members,
            stmt: StmtId::NONE,
        });
        Some(self.file.stmt(StmtKind::Interface(interface), pos))
    }

    /// In a heritage clause `string` is an entity name, not the keyword type.
    pub(crate) fn heritage_type(&mut self, ty: TypeNodeId) {
        if ty.is_some()
            && let TypeNodeKind::Keyword(keyword) = self.file[ty].kind
        {
            let name = self.atoms.intern(keyword.text());
            let name = self
                .file
                .entity_name([(name, self.file[ty].pos)].into_iter());
            self.file[ty].kind = TypeNodeKind::Ref {
                name,
                args: IdList::EMPTY,
            };
        }
    }

    pub(crate) fn clone_type_alias(
        &mut self,
        id: ts::Id<ts::TypeAlias>,
        flags: Flags,
        pos: u32,
    ) -> StmtId {
        let ts::TypeAlias {
            name,
            type_params,
            ty,
        } = self.ts[id];
        let alias = self.file.add_alias(Alias {
            name: self.identifier(&name.text, self::pos(name.loc)),
            name_pos: self::pos(name.loc),
            flags,
            type_params,
            ty,
            stmt: StmtId::NONE,
        });
        self.file.stmt(StmtKind::TypeAlias(alias), pos)
    }

    pub(crate) fn add_members(&mut self, members: &[ts::Member]) -> Span<MemberId> {
        if members.is_empty() {
            return Span::EMPTY;
        }
        let created: smallvec::SmallVec<[Member; 8]> =
            members.iter().map(|member| self.member(member)).collect();
        let created = self.file.add_members(&created);
        for (member, id) in members.iter().zip(created.iter()) {
            if let ts::PropertyKey::Computed(expr) = member.key {
                self.pending.push(PendingPart::MemberKey(id, expr));
            }
            if let Some(initializer) = member.initializer {
                self.pending
                    .push(PendingPart::MemberInitializer(id, initializer));
            }
        }
        created
    }

    /// Not a HIR node yet: the members of a class are allocated together.
    pub(crate) fn member(&mut self, member: &ts::Member) -> Member {
        let ts::Member {
            kind,
            key,
            flags,
            modifiers,
            ty,
            signature: func,
            index_signature_errors,
            loc,
            start,
            full_start,
            end,
            ..
        } = *member;
        let modifiers = self.modifier_list(modifiers);
        for (at, code) in index_signature_errors.into_iter().flatten() {
            match code {
                // Without a parameter it is reported on the signature.
                1096 if at == pos(start) => {
                    self.file.error(DiagnosticKind::Grammar, at, pos(end), code)
                }
                _ => self.file.error(DiagnosticKind::Grammar, at, 0, code),
            }
        }
        // `checkVariableLikeDeclaration`: reported regardless of other errors in the file.
        if kind == MemberKind::Property && matches!(key, ts::PropertyKey::BigInt) {
            self.file.error(DiagnosticKind::Checker, pos(loc), 0, 1539);
        }
        let is_number = matches!(key, ts::PropertyKey::Number(_));
        let mut key = self.key(key);
        // `getDeclarationName`: a private name outside a class declares nothing.
        if self.classes_around == 0 && matches!(key, PropKey::Private(_)) {
            key = PropKey::None;
        }
        if func.is_some() {
            self.file[func].name = key.name().unwrap_or(Atom::NONE);
            self.file[func].start = pos(start);
        }
        Member {
            kind,
            key,
            flags: if is_number {
                flags | Flags::LITERAL_NAME
            } else {
                flags
            },
            modifiers,
            // The type of an index signature is the return type of its signature: one node, not two.
            ty: if kind == MemberKind::IndexSignature {
                self.file[func].ret
            } else {
                ty
            },
            init: ExprId::NONE,
            func,
            name_pos: pos(loc),
            start: pos(start),
            loc: TextRange {
                pos: pos(full_start),
                end: pos(end),
            },
        }
    }

    /// `checkGrammarIndexSignatureParameters`, up to the check of the parameter's type. The checker
    /// does the rest.
    /// `at`: start of the member.
    pub(crate) fn check_index_signature_parameters(
        &self,
        params: &[ts::Param],
        trailing_comma: Option<bun_ast::Loc>,
        at: u32,
    ) -> [Option<(u32, u32)>; 2] {
        let Some(first) = params.first() else {
            return [Some((at, 1096)), None];
        };
        let name = self.file[first.pattern].pos;
        if params.len() != 1 {
            return [Some((name, 1096)), None];
        }
        let error = if first.flags.contains(Flags::REST) {
            Some((pos(first.rest_loc), 1017))
        } else if !first.modifiers.is_empty() {
            Some((name, 1018))
        } else if first.flags.contains(Flags::OPTIONAL) {
            Some((pos(first.question_loc), 1019))
        } else if first.default.is_some() {
            Some((name, 1020))
        } else if first.ty.is_none() {
            Some((name, 1022))
        } else {
            None
        };
        [trailing_comma.map(|comma| (pos(comma), 1025)), error]
    }
}

/// The types in a file's JSDoc comments, as nodes of a separate HIR.
#[derive(Default)]
pub(crate) struct CommentTypes {
    pub(crate) file: bun_sema::hir::FileBuilder,
    pub(crate) pending: Vec<PendingPart>,
    /// Node counts before and after each type and each type argument list was parsed, in source
    /// order.
    pub(crate) created: Vec<(Rows, Rows)>,
}

/// `DeepCloneReparse`: a JSDoc type is cloned for each node it annotates. Its nodes are contiguous
/// in each vector, so they are appended as a block and the ids that refer to them are offset.
impl Builder<'_> {
    pub(crate) fn clone_type(&mut self, from: &CommentTypes, id: TypeNodeId) -> TypeNodeId {
        if id.is_none() {
            return TypeNodeId::NONE;
        }
        let read = from
            .created
            .partition_point(|created| created.1.types <= id.0);
        let moved = self.clone_rows(from, from.created[read]);
        TypeNodeId(id.0.wrapping_add(moved.types))
    }

    pub(crate) fn clone_type_list(
        &mut self,
        from: &CommentTypes,
        list: IdList<TypeNodeId>,
    ) -> IdList<TypeNodeId> {
        if list.is_empty() {
            return IdList::EMPTY;
        }
        let read = from
            .created
            .partition_point(|created| created.1.ids <= list.start);
        let moved = self.clone_rows(from, from.created[read]);
        let list = IdList::new(list.start.wrapping_add(moved.ids), list.len);
        // No node owns this list, so `clone_rows`, which offsets the ids held by nodes, has not
        // offset it.
        for ty in &mut self.file.ids[list.range()] {
            *ty = ty.wrapping_add(moved.types);
        }
        list
    }

    /// Returns the offset applied to the ids of each vector.
    fn clone_rows(&mut self, from: &CommentTypes, (first, end): (Rows, Rows)) -> Rows {
        let file = &mut self.file;
        let moved = first.copy(&end, &from.file, file);
        macro_rules! id {
            ($id:expr, $rows:ident) => {
                if $id.is_some() {
                    $id.0 = $id.0.wrapping_add(moved.$rows);
                }
            };
        }
        macro_rules! run {
            ($run:expr, $rows:ident) => {
                if !$run.is_empty() {
                    $run.start = $run.start.wrapping_add(moved.$rows);
                }
            };
        }
        // The copied range. Vectors that are empty in most files are skipped.
        macro_rules! copies {
            ($rows:ident) => {{
                let copies = first.$rows.wrapping_add(moved.$rows) as usize
                    ..end.$rows.wrapping_add(moved.$rows) as usize;
                match copies.is_empty() {
                    true => &mut [][..],
                    false => &mut file.$rows[copies],
                }
            }};
        }
        let mut lists: smallvec::SmallVec<[IdList<TypeNodeId>; 8]> = smallvec::SmallVec::new();
        for node in copies!(types) {
            match &mut node.kind {
                TypeNodeKind::Error
                | TypeNodeKind::Keyword(_)
                | TypeNodeKind::StringLit(_)
                | TypeNodeKind::BigIntLit { .. }
                | TypeNodeKind::BoolLit(_)
                | TypeNodeKind::UniqueSymbol => {}
                TypeNodeKind::Heritage(e) => id!(e, exprs),
                TypeNodeKind::NumberLit(number) => *number = number.wrapping_add(moved.numbers),
                TypeNodeKind::Ref { name, args } | TypeNodeKind::Import { name, args, .. } => {
                    run!(name, names);
                    run!(args, ids);
                    lists.push(*args);
                }
                TypeNodeKind::Typeof {
                    name, args, expr, ..
                } => {
                    run!(name, names);
                    run!(args, ids);
                    lists.push(*args);
                    id!(expr, exprs);
                }
                TypeNodeKind::Template { types, texts } => {
                    run!(types, ids);
                    lists.push(*types);
                    run!(texts, ids);
                }
                TypeNodeKind::Union(types) | TypeNodeKind::Intersection(types) => {
                    run!(types, ids);
                    lists.push(*types);
                }
                TypeNodeKind::Array(ty)
                | TypeNodeKind::Keyof(ty)
                | TypeNodeKind::Readonly(ty)
                | TypeNodeKind::JSDoc { ty, .. }
                | TypeNodeKind::Predicate { ty, .. } => id!(ty, types),
                TypeNodeKind::Tuple(elements) => run!(elements, tuple_elems),
                TypeNodeKind::Fn(signature) => id!(signature, fns),
                TypeNodeKind::Object(members) => run!(members, members),
                TypeNodeKind::Cond {
                    check,
                    extends,
                    yes,
                    no,
                } => {
                    id!(check, types);
                    id!(extends, types);
                    id!(yes, types);
                    id!(no, types);
                }
                TypeNodeKind::Infer(param) => id!(param, type_params),
                TypeNodeKind::Mapped(mapped) => id!(mapped, mapped),
                TypeNodeKind::IndexedAccess { obj, index } => {
                    id!(obj, types);
                    id!(index, types);
                }
            }
        }
        for list in lists {
            for ty in &mut file.ids[list.range()] {
                *ty = ty.wrapping_add(moved.types);
            }
        }
        for member in copies!(members) {
            id!(member.ty, types);
            id!(member.func, fns);
            run!(member.modifiers, modifiers);
        }
        for signature in copies!(fns) {
            run!(signature.type_params, type_params);
            run!(signature.params, params);
            id!(signature.this_param, params);
            id!(signature.ret, types);
        }
        for param in copies!(params) {
            id!(param.pat, pats);
            id!(param.ty, types);
        }
        for pattern in copies!(pats) {
            match &mut pattern.kind {
                PatKind::Missing | PatKind::Ident(_) => {}
                PatKind::Object(properties) => run!(properties, pat_props),
                PatKind::Array(elements) => run!(elements, pat_elems),
            }
        }
        for property in copies!(pat_props) {
            id!(property.value, pats);
        }
        for element in copies!(pat_elems) {
            id!(element.pat, pats);
        }
        for param in copies!(type_params) {
            id!(param.constraint, types);
            id!(param.default, types);
            run!(param.modifiers, modifiers);
        }
        for mapped in copies!(mapped) {
            id!(mapped.param, type_params);
            id!(mapped.name_ty, types);
            id!(mapped.ty, types);
            run!(mapped.members, members);
        }
        for element in copies!(tuple_elems) {
            id!(element.ty, types);
        }
        for expr in copies!(exprs) {
            if let ExprKind::Dot { obj, .. } = &mut expr.kind {
                id!(obj, exprs);
            }
        }
        for param in first.params..end.params {
            let mut modifiers = from.file.param_modifiers(ParamId(param));
            run!(modifiers, modifiers);
            file.set_param_modifiers(ParamId(param.wrapping_add(moved.params)), modifiers);
        }
        // The parser failed on these.
        if moved.syntax_errors > 0 {
            let mut bailed_out = copies!(types)
                .iter()
                .filter(|node| matches!(node.kind, TypeNodeKind::Error));
            let at = bailed_out.next().map_or(0, |node| node.pos);
            if file.syntax_errors == 0 {
                file.error_pos = at;
            }
            file.syntax_errors += moved.syntax_errors;
        }
        for &part in &from.pending[first.pending as usize..end.pending as usize] {
            let mut part = part;
            match &mut part {
                PendingPart::MemberKey(member, _) | PendingPart::MemberInitializer(member, _) => {
                    id!(member, members)
                }
                PendingPart::FunctionBody(signature, _) => id!(signature, fns),
                PendingPart::PatternKey(property, _)
                | PendingPart::PatternPropertyDefault(property, _) => id!(property, pat_props),
                PendingPart::ParamDefault(param, _) => id!(param, params),
                PendingPart::PatternElementDefault(element, _) => id!(element, pat_elems),
                PendingPart::HeritageExpression(node, _) => id!(node, types),
                PendingPart::ImportAttributes(_) => {}
            }
            self.pending.push(part);
        }
        moved
    }
}
