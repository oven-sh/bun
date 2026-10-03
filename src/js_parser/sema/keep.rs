//! Keep mode for TypeScript type syntax.
//!
//! By default the parser skips types. When `TypeSyntax::save_types` is set, the same skip functions in
//! `parse/parse_skip_typescript.rs` also make the rows of the type checker's tree, by calling the helpers in this file under `if KEEP`
//! (`clone_types.rs` makes them).
//!
//! Each function that parses a type stores the result in `TypeSyntax::last_type`, and the caller reads it from there. `NONE` means there
//! is no usable type, which only happens for invalid code. `NONE` propagates to the enclosing type.

use crate::sema::ts_syntax::{
    Flags, FunctionBody, Interface, Keyword, MappedModifier, MappedType, Member, MemberKind,
    Members, Modifier, Name, Param, Params, PatternElement, PatternId, PatternProperty,
    PropertyKey, ResolutionMode, Signature, SignatureId, SignatureKind, Span, Statement,
    StatementData, StatementId, TupleElement, TypeAlias, TypeId, TypeParam, TypeParams, Types,
};
use bun_ast::{Expr, Loc, StoreStr};
use bun_sema::hir::{DiagnosticKind, PatKind, TypeNode, TypeNodeKind};

use super::TypeSyntax;
use crate::lexer::{PropertyModifierKeyword, T};
use crate::p::P;
use crate::parser::SkipTypeParameterResult;
use crate::typescript::identifier::{Kind, kind_for_identifier};

#[inline]
fn loc(pos: u32) -> Loc {
    Loc { start: pos as i32 }
}

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    /// Whether to build type nodes. This is the only check ordinary builds pay for, once per top-level type.
    #[inline(always)]
    pub(crate) fn should_save_types(&self) -> bool {
        TYPESCRIPT
            && self
                .type_syntax
                .as_ref()
                .is_some_and(|syntax| syntax.save_types)
    }

    #[inline]
    pub(crate) fn type_syntax_mut(&mut self) -> &mut TypeSyntax<'a> {
        self.type_syntax.as_mut().expect("only called in keep mode")
    }

    /// Start offset of the current token.
    #[inline]
    pub(crate) fn token_start(&self) -> u32 {
        self.lexer.loc().start.max(0) as u32
    }

    /// The most recently parsed type.
    #[inline]
    pub(crate) fn last_type(&mut self) -> TypeId {
        self.type_syntax_mut().last_type
    }

    #[inline]
    pub(crate) fn clear_last_type(&mut self) {
        self.type_syntax_mut().last_type = TypeId::NONE;
    }

    #[inline]
    pub(crate) fn emit_type(&mut self, kind: TypeNodeKind, pos: u32) {
        let syntax = self.type_syntax_mut();
        syntax.last_type = syntax.b.file.ty(kind, pos, 0);
    }

    /// `finishNode`, of the type parsed last, unless it is finished: it ends where the token before the current one does.
    pub(crate) fn finish_last_type(&mut self) {
        let ty = self.last_type();
        if ty.is_some() && self.type_syntax_mut().b.file[ty].end == 0 {
            self.type_syntax_mut().b.file[ty].end = self.lexer.full_start().start as u32;
        }
    }

    /// Emits a reference to the type called `name`.
    pub(crate) fn emit_type_ref(&mut self, name: StoreStr, pos: u32) {
        let name = self.type_syntax_mut().b.add_names(&[Name {
            text: name,
            loc: loc(pos),
        }]);
        self.emit_type(
            TypeNodeKind::Ref {
                name,
                args: Types::EMPTY,
            },
            pos,
        );
    }

    /// The last parsed type, a single token, turns out to be the subject of a type predicate: its row goes, which was made last.
    pub(crate) fn take_back_single_token_type(&mut self) {
        let syntax = self.type_syntax_mut();
        let file = &mut syntax.b.file;
        if syntax.last_type.is_some() && syntax.last_type.idx() + 1 == file.types.len() {
            if let Some(TypeNode {
                kind: TypeNodeKind::Ref { name, .. },
                ..
            }) = file.types.pop()
                && name.range().end == file.names.len()
            {
                file.names.truncate(name.start as usize);
            }
        }
        syntax.last_type = TypeId::NONE;
    }

    /// Emits `param is T` or `asserts param is T`, where `T` is the last parsed type.
    pub(crate) fn emit_type_predicate(&mut self, param: StoreStr, asserts: bool, pos: u32) {
        let ty = self.last_type();
        if ty.is_some() {
            self.emit_predicate_of(param, ty, asserts, pos);
        }
    }

    /// `ty` is `NONE` for `asserts param`.
    pub(crate) fn emit_predicate_of(
        &mut self,
        param: StoreStr,
        ty: TypeId,
        asserts: bool,
        pos: u32,
    ) {
        let param = self.type_syntax_mut().b.identifier(&param, pos);
        self.emit_type(TypeNodeKind::Predicate { param, ty, asserts }, pos);
    }

    /// Emits `data` unless one of its child types is missing.
    #[inline]
    pub(crate) fn emit_type_if_complete(&mut self, parts: &[TypeId], data: TypeNodeKind, pos: u32) {
        if parts.iter().any(|part| part.is_none()) {
            return self.clear_last_type();
        }
        self.emit_type(data, pos);
    }

    /// Called on the first token of a type. Emits literals, keywords and plain names, which are a single token. Qualified names and type
    /// arguments are added later by `append_qualified_name` and `attach_type_args`.
    pub(crate) fn emit_single_token_type(&mut self) {
        let pos = self.token_start();
        let data = match self.lexer.token {
            T::TNumericLiteral => {
                let number = self.lexer.number;
                TypeNodeKind::NumberLit(self.type_syntax_mut().b.file.number(number))
            }
            T::TBigIntegerLiteral => {
                let text = self.lexer.identifier;
                TypeNodeKind::BigIntLit {
                    text: self.type_syntax_mut().b.atoms.intern(text),
                    negative: false,
                }
            }
            T::TStringLiteral | T::TNoSubstitutionTemplateLiteral => match self.string_token_text()
            {
                Some(text) => TypeNodeKind::StringLit(self.type_syntax_mut().b.atom(&text)),
                None => return self.clear_last_type(),
            },
            T::TTrue => TypeNodeKind::BoolLit(true),
            T::TFalse => TypeNodeKind::BoolLit(false),
            T::TNull => TypeNodeKind::Keyword(Keyword::Null),
            T::TVoid => TypeNodeKind::Keyword(Keyword::Void),
            T::TThis => TypeNodeKind::Keyword(Keyword::This),
            T::TIdentifier => match (
                keyword_type(self.lexer.identifier),
                kind_for_identifier(self.lexer.identifier),
            ) {
                (Some(keyword), _) => TypeNodeKind::Keyword(keyword),
                (None, None | Some(Kind::Normal)) => {
                    return self.emit_type_ref(StoreStr::new(self.lexer.identifier), pos);
                }
                // Either an operator or a plain name. The caller decides, and calls `emit_type_ref` for a name.
                (None, Some(_)) => return self.clear_last_type(),
            },
            // `x as const`
            T::TConst => return self.emit_type_ref(StoreStr::new(b"const"), pos),
            _ => return self.clear_last_type(),
        };
        self.emit_type(data, pos);
    }

    /// The text of the current identifier or keyword.
    pub(crate) fn token_text(&self) -> StoreStr {
        StoreStr::new(
            if matches!(self.lexer.token, T::TIdentifier | T::TPrivateIdentifier) {
                self.lexer.identifier
            } else {
                self.lexer.raw()
            },
        )
    }

    /// The cooked text of the current string or template token. `None` if it cannot be decoded.
    pub(crate) fn string_token_text(&mut self) -> Option<StoreStr> {
        Some(StoreStr::new(self.lexer.to_utf8_e_string().ok()?.slice8()))
    }

    /// Called after the `-` at `pos`.
    pub(crate) fn emit_negative_literal_type(&mut self, pos: u32) {
        let data = match self.lexer.token {
            T::TBigIntegerLiteral => {
                let text = self.lexer.identifier;
                TypeNodeKind::BigIntLit {
                    text: self.type_syntax_mut().b.atoms.intern(text),
                    negative: true,
                }
            }
            T::TNumericLiteral => {
                let number = -self.lexer.number;
                TypeNodeKind::NumberLit(self.type_syntax_mut().b.file.number(number))
            }
            _ => return self.clear_last_type(),
        };
        self.emit_type(data, pos);
    }

    // ───────────────────────────── unions, intersections, lists ─────────────────────────────

    /// Starts a union or intersection with the last parsed type as its first member. Does nothing if it has already started.
    pub(crate) fn begin_type_list(&mut self, from: &mut usize) {
        if *from == usize::MAX {
            *from = self.type_syntax_mut().type_stack.len();
            self.push_type_list_item();
        }
    }

    /// Pushes the last parsed type onto the current list.
    pub(crate) fn push_type_list_item(&mut self) {
        let syntax = self.type_syntax_mut();
        syntax.type_stack.push(syntax.last_type);
    }

    /// Pops the list that starts at `from`. `None` if any item is missing.
    fn finish_type_list(&mut self, from: usize) -> Option<Types> {
        let TypeSyntax { b, type_stack, .. } = self.type_syntax_mut();
        let list = if type_stack[from..].iter().any(|item| item.is_none()) {
            None
        } else {
            Some(b.add_id_list(&type_stack[from..]))
        };
        type_stack.truncate(from);
        list
    }

    /// Closes the pending intersection, if any. `has_leading_operator`: an `&` came before its first member, which makes an
    /// intersection of a single member too (`parseUnionOrIntersectionType`).
    pub(crate) fn finish_intersection(
        &mut self,
        from: &mut usize,
        pos: u32,
        has_leading_operator: &mut bool,
    ) {
        if std::mem::take(has_leading_operator) {
            self.begin_type_list(from);
        }
        if *from != usize::MAX {
            match self.finish_type_list(std::mem::replace(from, usize::MAX)) {
                Some(members) => self.emit_type(TypeNodeKind::Intersection(members), pos),
                None => self.clear_last_type(),
            }
            self.finish_last_type();
        }
    }

    /// Closes the pending intersection and then the pending union.
    pub(crate) fn finish_union_and_intersection(
        &mut self,
        intersection_base: &mut usize,
        intersection_pos: u32,
        has_leading_ampersand: &mut bool,
        union_base: &mut usize,
        pos: u32,
        has_leading_bar: &mut bool,
    ) {
        self.finish_intersection(intersection_base, intersection_pos, has_leading_ampersand);
        if std::mem::take(has_leading_bar) {
            self.begin_type_list(union_base);
        }
        if *union_base != usize::MAX {
            match self.finish_type_list(std::mem::replace(union_base, usize::MAX)) {
                Some(members) => self.emit_type(TypeNodeKind::Union(members), pos),
                None => self.clear_last_type(),
            }
            self.finish_last_type();
        }
    }

    /// Finishes `<A, B>`. The arguments are on the stack starting at `from`.
    pub(crate) fn finish_type_args(&mut self, from: usize) {
        let arguments = self.finish_type_list(from);
        self.type_syntax_mut().last_type_args = arguments;
    }

    // ───────────────────────────── names ─────────────────────────────

    /// Called on the name after a `.`. Extends the last parsed type reference.
    pub(crate) fn append_qualified_name(&mut self) {
        let name = Name {
            text: self.token_text(),
            loc: self.lexer.loc(),
        };
        self.append_name(name);
    }

    /// Called where the name after a `.` is missing (`parseRightSideOfDot`). An empty name stands for it.
    pub(crate) fn append_missing_qualified_name(&mut self) {
        let name = Name {
            text: StoreStr::EMPTY,
            loc: self.lexer.full_start(),
        };
        self.append_name(name);
    }

    /// Whether a `.` goes on from the last parsed type: it is a name without type arguments (`parseEntityName`), or `import(..)`.
    pub(crate) fn last_type_takes_qualifier(&mut self) -> bool {
        let reference = self.last_type();
        if reference.is_none() {
            return true;
        }
        match self.type_syntax_mut().b.file[reference].kind {
            // `import(T)` keeps `T` there.
            TypeNodeKind::Import { spec, .. } if spec.is_none() => true,
            TypeNodeKind::Ref { args, .. } | TypeNodeKind::Import { args, .. } => args.is_empty(),
            TypeNodeKind::Keyword(Keyword::Void | Keyword::Null | Keyword::This) => false,
            TypeNodeKind::Keyword(_) => true,
            _ => false,
        }
    }

    fn append_name(&mut self, name: Name) {
        let reference = self.last_type();
        if reference.is_none() {
            return;
        }
        let b = &mut self.type_syntax_mut().b;
        let TypeNode { kind, pos, .. } = b.file[reference];
        let (text, place) = (b.atom(&name.text), name.loc.start.max(0) as u32);
        let before = match kind {
            TypeNodeKind::Import { spec, name, .. } if spec.is_none() => name,
            TypeNodeKind::Ref { name, args } | TypeNodeKind::Import { name, args, .. }
                if args.is_empty() =>
            {
                name
            }
            // `void.x`, `null.x` and `this.x` are not qualified names. Ignore the suffix.
            TypeNodeKind::Keyword(Keyword::Void | Keyword::Null | Keyword::This) => return,
            // `string.x` is a qualified name whose first part is spelled like a keyword.
            TypeNodeKind::Keyword(keyword) => {
                let first = b.atoms.intern(keyword.text());
                b.file.entity_name([(first, pos)].into_iter())
            }
            _ => return self.clear_last_type(),
        };
        let name = b.file.append_to_entity_name(before, text, place);
        b.file[reference].end = 0;
        b.file[reference].kind = match kind {
            TypeNodeKind::Import {
                spec,
                args,
                is_typeof,
                mode,
                ..
            } => TypeNodeKind::Import {
                spec,
                name,
                args,
                is_typeof,
                mode,
            },
            _ => TypeNodeKind::Ref {
                name,
                args: Types::EMPTY,
            },
        };
    }

    /// The type parsed last, where type arguments may follow. Its row, which was made last, is taken back until they are read: a
    /// type is numbered after what is in it. Pass the result to `attach_type_args`.
    pub(crate) fn take_reference(&mut self) -> Option<TypeNode> {
        let syntax = self.type_syntax_mut();
        // `label: ...T[]` and `T!` leave a type that was not made last. It stays, and nothing attaches to it.
        if syntax.last_type.is_none() || syntax.last_type.idx() + 1 != syntax.b.file.types.len() {
            return None;
        }
        syntax.last_type = TypeId::NONE;
        syntax.b.file.types.pop()
    }

    /// Attaches the type arguments that were just parsed, if any, to `reference`.
    pub(crate) fn attach_type_args(&mut self, reference: Option<TypeNode>, has_arguments: bool) {
        let syntax = self.type_syntax_mut();
        let Some(mut node) = reference else {
            if has_arguments {
                syntax.last_type = TypeId::NONE;
            }
            return;
        };
        syntax.last_type = TypeId::NONE;
        if has_arguments {
            node.end = 0;
            match (&mut node.kind, syntax.last_type_args.take()) {
                // The type arguments of `import(T)` are never looked at.
                (TypeNodeKind::Import { spec, .. }, Some(_)) if spec.is_none() => {}
                (
                    TypeNodeKind::Ref { args, .. } | TypeNodeKind::Import { args, .. },
                    Some(given),
                ) => *args = given,
                _ => return,
            }
        }
        syntax.last_type = syntax.b.file.add_type_node(node);
    }

    /// Called on each name in `typeof a.b.c`.
    pub(crate) fn push_typeof_name(&mut self) {
        // An empty name stands for a missing one.
        let is_name =
            self.lexer.is_identifier_or_keyword() || self.lexer.token == T::TPrivateIdentifier;
        let name = Name {
            text: if is_name {
                self.token_text()
            } else {
                StoreStr::EMPTY
            },
            loc: self.lexer.loc(),
        };
        self.type_syntax_mut().name_stack.push(name);
    }

    /// Finishes `typeof a.b.c<Args>`. The names are on the stack starting at `names_base`.
    pub(crate) fn emit_typeof_type(&mut self, names_base: usize, has_arguments: bool, pos: u32) {
        let TypeSyntax {
            name_stack,
            last_type_args,
            ..
        } = self.type_syntax_mut();
        // `typeof a.`: what is before the last dot is still looked up (`parseRightSideOfDot`). `typeof` before no name has the one,
        // which is missing (`parseEntityName`). Any other missing name makes the type unusable.
        let required = (name_stack.len() - names_base).saturating_sub(1);
        let is_complete = name_stack[names_base..]
            .iter()
            .take(required)
            .all(|name| !name.text.is_empty());
        let names: smallvec::SmallVec<[Name; 4]> = name_stack.drain(names_base..).collect();
        if !is_complete {
            return self.clear_last_type();
        }
        let args = match (has_arguments, last_type_args.take()) {
            (false, _) => Types::EMPTY,
            (true, Some(args)) => args,
            (true, None) => return self.clear_last_type(),
        };
        let data = self
            .type_syntax_mut()
            .b
            .add_typeof(&names, args, has_arguments);
        self.emit_type(data, pos);
    }

    // ───────────────────────────── other types ─────────────────────────────

    /// Called on the specifier of `import("specifier")`. Returns its text and offset.
    pub(crate) fn import_type_specifier(&mut self) -> Option<(StoreStr, u32)> {
        if self.lexer.token != T::TStringLiteral {
            return None;
        }
        Some((self.string_token_text()?, self.token_start()))
    }

    /// Called after `{ with: { "resolution-mode": "import" } }`, which the skipper parsed as an object type. Reads the resolution mode
    /// from those nodes (`GetResolutionModeOverride`), and where `assert` is written instead of `with`. `None` if the attributes are not
    /// in that form.
    pub(crate) fn import_type_attributes(&mut self) -> Option<ImportTypeAttributes> {
        let syntax = self.type_syntax_mut();
        let (file, atoms) = (&syntax.b.file, syntax.b.atoms);
        let only_property = |members: Members| {
            let &[member] = &file.members[members.range()] else {
                return None;
            };
            match (member.kind, member.key) {
                (MemberKind::Property, bun_sema::hir::PropKey::Name(name)) => {
                    Some((atoms.bytes(name), member.ty, loc(member.name_pos)))
                }
                _ => None,
            }
        };
        let Some(ObjectTypeBody::Members(outer)) = syntax.last_object_type else {
            return None;
        };
        let (keyword, attributes, keyword_loc) = only_property(outer)?;
        let TypeNodeKind::Object(attributes) = file.types.get(attributes.idx())?.kind else {
            return None;
        };
        if keyword != b"with" && keyword != b"assert" {
            return None;
        }
        let mode = match only_property(attributes) {
            Some((b"resolution-mode", value, _)) => {
                match file.types.get(value.idx()).map(|value| value.kind) {
                    Some(TypeNodeKind::StringLit(value)) if atoms.bytes(value) == b"import" => {
                        ResolutionMode::Import
                    }
                    Some(TypeNodeKind::StringLit(value)) if atoms.bytes(value) == b"require" => {
                        ResolutionMode::Require
                    }
                    _ => ResolutionMode::None,
                }
            }
            _ => ResolutionMode::None,
        };
        Some((mode, (keyword == b"assert").then_some(keyword_loc), None))
    }

    /// Emits `import("specifier")`. A qualified name and type arguments are added later, as for a type reference.
    /// `argument` is what is written instead of a string literal, and `NONE` if `specifier` is given.
    pub(crate) fn emit_import_type(
        &mut self,
        specifier: Option<(StoreStr, u32)>,
        argument: TypeId,
        attributes: Option<ImportTypeAttributes>,
        is_typeof: bool,
        pos: u32,
    ) {
        let specifier = if argument.is_some() {
            Some((StoreStr::EMPTY, pos))
        } else {
            specifier
        };
        let (Some((specifier, specifier_pos)), Some(attributes)) = (specifier, attributes) else {
            return self.clear_last_type();
        };
        let import = self.type_syntax_mut().b.add_import_type(
            (&specifier, specifier_pos),
            argument,
            attributes,
            is_typeof,
        );
        self.emit_type(import, pos);
    }

    /// Emits `infer name`. The constraint, if present, is the last parsed type.
    pub(crate) fn emit_infer_type(
        &mut self,
        name: StoreStr,
        name_pos: u32,
        has_constraint: bool,
        pos: u32,
    ) {
        let constraint = if has_constraint {
            self.last_type()
        } else {
            TypeId::NONE
        };
        if has_constraint && constraint.is_none() {
            return self.clear_last_type();
        }
        let param = TypeParam {
            name,
            loc: loc(name_pos),
            start: loc(name_pos),
            end: self.lexer.full_start(),
            constraint,
            default: TypeId::NONE,
            flags: Flags::empty(),
            modifiers: Span::EMPTY,
        };
        let param = self.type_syntax_mut().b.add_type_param(param);
        self.emit_type(TypeNodeKind::Infer(param), pos);
    }

    pub(crate) fn emit_tuple_type(&mut self, elements: &[TupleElement], pos: u32) {
        if elements.iter().any(|element| element.ty.is_none()) {
            return self.clear_last_type();
        }
        let tuple = self.type_syntax_mut().b.add_tuple(elements);
        self.emit_type(tuple, pos);
    }

    /// `parseTupleElementType`: if the last parsed type is a postfix `T?`, removes that node and returns `T`.
    pub(crate) fn optional_tuple_element_type(&mut self) -> Option<TypeId> {
        let syntax = self.type_syntax_mut();
        let types = &mut syntax.b.file.types;
        match types.get(syntax.last_type.idx())?.kind {
            TypeNodeKind::JSDoc {
                ty,
                is_nullable: true,
                is_postfix: true,
            } => {
                types.truncate(syntax.last_type.idx());
                Some(ty)
            }
            _ => None,
        }
    }

    /// Wraps the last parsed type in JSDoc's `?` (`is_nullable`) or `!`, written after it (`is_postfix`) or before it. The result
    /// starts at `pos`.
    pub(crate) fn emit_jsdoc_type(&mut self, is_nullable: bool, is_postfix: bool, pos: u32) {
        let ty = self.last_type();
        if ty.is_some() {
            let kind = TypeNodeKind::JSDoc {
                ty,
                is_nullable,
                is_postfix,
            };
            self.emit_type(kind, pos);
        }
    }

    /// `*`
    pub(crate) fn emit_jsdoc_all_type(&mut self, pos: u32) {
        // JSDoc types can only be used inside documentation comments.
        self.type_syntax_mut()
            .b
            .check_jsdoc_type_is_in_js_file(pos, 8020);
        self.emit_type(TypeNodeKind::Keyword(Keyword::Any), pos);
    }

    /// `label: ...T`, where `T` is the last parsed type.
    pub(crate) fn emit_rest_type(&mut self, pos: u32) {
        let end = self.lexer.full_start().start as u32;
        let syntax = self.type_syntax_mut();
        if syntax.last_type.is_some() {
            // `checkNamedTupleMember`. The element is required (`getTupleElementFlags`).
            syntax.b.file.error(DiagnosticKind::Grammar, pos, end, 5087);
            syntax.last_type = syntax.b.rest_element_type(syntax.last_type);
        }
    }

    /// `label: T?`
    pub(crate) fn emit_optional_type(&mut self, operand: TypeId, pos: u32) {
        let end = self.lexer.full_start().start as u32;
        let b = &mut self.type_syntax_mut().b;
        // `checkNamedTupleMember`. The element is required (`getTupleElementFlags`), and `getTypeFromOptionalTypeNode` adds `undefined`.
        b.file.error(DiagnosticKind::Grammar, pos, end, 5086);
        let union = b.union_with_keyword(operand, Keyword::Undefined, pos);
        self.emit_type(union, pos);
    }

    /// `interface I extends expression`. The end of `checkInterfaceDeclaration` reports 2499 for it.
    pub(crate) fn emit_heritage_expression(&mut self, expression: Expr, pos: u32) {
        self.emit_type(TypeNodeKind::Error, pos);
        let node = self.last_type();
        let part = super::clone_types::PendingPart::HeritageExpression(node, expression);
        self.type_syntax_mut().b.pending.push(part);
    }

    pub(crate) fn emit_template_type(
        &mut self,
        texts: &[Option<StoreStr>],
        types: &[TypeId],
        pos: u32,
    ) {
        let decoded: Option<smallvec::SmallVec<[StoreStr; 4]>> = texts.iter().copied().collect();
        let Some(texts) = decoded
            .filter(|texts| texts.len() == types.len() + 1 && types.iter().all(|ty| ty.is_some()))
        else {
            return self.clear_last_type();
        };
        let template = self.type_syntax_mut().b.add_template(types, &texts);
        self.emit_type(template, pos);
    }

    // ───────────────────────────── bindings, parameters, function types ─────────────────────────────

    /// Called on an identifier binding.
    pub(crate) fn emit_identifier_binding(&mut self) {
        let (name, loc, end) = (
            self.token_text(),
            self.lexer.loc(),
            self.lexer.range().end(),
        );
        let syntax = self.type_syntax_mut();
        let name = syntax.b.identifier(&name, loc.start as u32);
        syntax.last_binding = syntax.b.add_pattern(PatKind::Ident(name), loc, end);
    }

    /// `createMissingIdentifier`: a name of no length at `loc`.
    pub(crate) fn emit_missing_binding(&mut self, loc: bun_ast::Loc) {
        let syntax = self.type_syntax_mut();
        let name = syntax.b.atom(b"");
        syntax.last_binding = syntax.b.add_pattern(PatKind::Ident(name), loc, loc);
    }

    /// `{ name }`, after the name.
    pub(crate) fn emit_shorthand_binding(&mut self, property: &PatternProperty) {
        let end = self.lexer.full_start();
        let syntax = self.type_syntax_mut();
        syntax.last_binding = match property.key {
            PropertyKey::Name(name) => {
                let name = syntax.b.identifier(&name, property.loc.start as u32);
                syntax
                    .b
                    .add_pattern(PatKind::Ident(name), property.loc, end)
            }
            _ => PatternId::NONE,
        };
    }

    /// Called on the comma of an elided array element.
    pub(crate) fn emit_array_hole(&mut self) -> PatternElement {
        let (loc, end) = (self.lexer.loc(), self.lexer.full_start());
        let pattern = (self.type_syntax_mut().b).add_pattern(PatKind::Missing, loc, end);
        PatternElement {
            pattern,
            default: None,
            is_rest: false,
            loc,
            end,
        }
    }

    pub(crate) fn emit_array_binding(&mut self, elements: &[PatternElement], pos: u32) {
        let end = self.lexer.full_start();
        let syntax = self.type_syntax_mut();
        syntax.last_binding = PatternId::NONE;
        if elements.iter().all(|element| element.pattern.is_some()) {
            let elements = syntax.b.add_pattern_elements(elements);
            syntax.last_binding = syntax.b.add_pattern(elements, loc(pos), end);
        }
    }

    /// The current token as a property key, if it is an identifier, keyword, string or number.
    pub(crate) fn simple_property_key(&mut self) -> PropertyKey {
        match self.lexer.token {
            T::TStringLiteral | T::TNoSubstitutionTemplateLiteral => self
                .string_token_text()
                .map_or(PropertyKey::None, PropertyKey::Name),
            T::TNumericLiteral => PropertyKey::Number(self.lexer.number),
            T::TBigIntegerLiteral => PropertyKey::BigInt,
            _ if self.lexer.is_identifier_or_keyword() => PropertyKey::Name(self.token_text()),
            _ => PropertyKey::None,
        }
    }

    pub(crate) fn emit_object_binding(&mut self, properties: &[PatternProperty], pos: u32) {
        let end = self.lexer.full_start();
        let syntax = self.type_syntax_mut();
        syntax.last_binding = PatternId::NONE;
        if properties.iter().all(|property| {
            property.value.is_some()
                && (property.is_rest || !matches!(property.key, PropertyKey::None))
        }) {
            let properties = syntax.b.add_pattern_properties(properties);
            syntax.last_binding = syntax.b.add_pattern(properties, loc(pos), end);
        }
    }

    pub(crate) fn add_param_modifiers(&mut self, modifiers: &[Modifier]) -> Span<Modifier> {
        self.type_syntax_mut().b.ts.add_modifiers(modifiers)
    }

    /// Finishes a parameter list. `None` if any parameter is unusable.
    pub(crate) fn finish_params(&mut self, parameters: Option<&[Param]>) {
        let syntax = self.type_syntax_mut();
        syntax.last_params = parameters.map(|parameters| syntax.b.add_params(parameters));
    }

    /// Finishes `<T, U>`. `None` if any type parameter is unusable.
    pub(crate) fn finish_type_params(&mut self, parameters: Option<&[TypeParam]>) {
        let syntax = self.type_syntax_mut();
        syntax.last_type_params = parameters.map(|parameters| syntax.b.add_type_params(parameters));
    }

    /// Saves what precedes the `(` of a function type: `new`, `abstract new` and type parameters. `pos` is the offset after `new`,
    /// `start` that of the first word.
    pub(crate) fn set_fn_type_head(
        &mut self,
        kind: SignatureKind,
        flags: Flags,
        type_parameters: SkipTypeParameterResult,
        pos: u32,
        start: u32,
    ) {
        let syntax = self.type_syntax_mut();
        let type_params = match type_parameters {
            SkipTypeParameterResult::DidNotSkipAnything => Some(TypeParams::EMPTY),
            _ => syntax.last_type_params.take(),
        };
        syntax.pending_fn_type_head = Some(FnTypeHead {
            kind,
            flags,
            type_params,
            pos,
            start,
        });
    }

    /// Emits `(params) => T`, where `T` is the last parsed type.
    pub(crate) fn emit_fn_type(
        &mut self,
        head: Option<FnTypeHead>,
        open_paren: u32,
        parameters: Option<Params>,
    ) {
        let head = head.unwrap_or(FnTypeHead {
            kind: SignatureKind::FunctionType,
            flags: Flags::empty(),
            type_params: Some(TypeParams::EMPTY),
            pos: open_paren,
            start: open_paren,
        });
        let return_type = self.last_type();
        let (Some(type_params), Some(params), true) =
            (head.type_params, parameters, return_type.is_some())
        else {
            return self.clear_last_type();
        };
        let signature = self.type_syntax_mut().b.add_signature(Signature {
            kind: head.kind,
            flags: head.flags,
            type_params,
            params,
            return_type,
            body: None,
            open_paren_loc: loc(open_paren),
            loc: loc(head.pos),
        });
        self.type_syntax_mut().b.file[signature].start = head.start;
        self.emit_type(TypeNodeKind::Fn(signature), head.start);
    }

    // ───────────────────────────── object type members ─────────────────────────────

    /// Reads the identifier, keyword, string, number or private name at the current token.
    pub(crate) fn read_member_word(&mut self) -> MemberWord {
        MemberWord {
            token: self.lexer.token,
            key: match self.lexer.token {
                T::TPrivateIdentifier => PropertyKey::Private(StoreStr::new(self.lexer.identifier)),
                _ => self.simple_property_key(),
            },
            pos: self.token_start(),
            full_start: self.lexer.token_full_start as u32,
            modifier: if self.lexer.token == T::TIdentifier {
                PropertyModifierKeyword::find(self.lexer.raw())
            } else {
                None
            },
            newline_before: self.lexer.has_newline_before,
        }
    }

    /// Emits the signature of a method, accessor, call signature or construct signature.
    fn emit_signature(
        &mut self,
        member: &TypeMemberParts,
        kind: SignatureKind,
        flags: Flags,
        pos: u32,
    ) -> Option<SignatureId> {
        let params = member.parameters??;
        let type_params = member.type_parameters.unwrap_or(Some(TypeParams::EMPTY))?;
        let return_type = member.ty.unwrap_or(TypeId::NONE);
        if member.ty.is_some() && return_type.is_none() {
            return None;
        }
        Some(self.type_syntax_mut().b.add_signature(Signature {
            kind,
            flags,
            type_params,
            params,
            return_type,
            body: None,
            open_paren_loc: loc(member.open_paren),
            loc: loc(pos),
        }))
    }

    /// `finishNode`, of the member added last, if it is not finished. `end`: `TokenFullStart` of the token after it.
    /// `parseTypeMemberSemicolon` is part of the member.
    pub(crate) fn end_type_member(&self, kept: &mut ObjectTypeBuilder, end: Loc) {
        if let Some(member) = kept.members.last_mut()
            && member.end == Loc::EMPTY
        {
            member.end = end;
        }
    }

    /// Adds a finished member to the object type being built.
    pub(crate) fn finish_type_member(
        &mut self,
        member: &TypeMemberParts,
        kept: &mut ObjectTypeBuilder,
    ) {
        // The skipper reads "x \n y: T" as one run of words. A word that is not a modifier is a property of its own, and a line break
        // ends it.
        if let Some(name_index) = member.first_bare_property() {
            let (bare, rest) = member.words.split_at(name_index + 1);
            let newline_after = rest
                .first()
                .map_or(member.newline_before_bracket, |next| next.newline_before);
            if !newline_after {
                kept.is_complete = false;
                return;
            }
            let bare = TypeMemberParts {
                start: bare[0].pos,
                full_start: bare[0].full_start,
                words: bare.into(),
                ..Default::default()
            };
            self.finish_type_member(&bare, kept);
            let (start, full_start) = match rest.first() {
                Some(next) => (next.pos, next.full_start),
                None => (member.bracket_pos, member.bracket_full_start),
            };
            self.end_type_member(kept, loc(full_start));
            let rest = TypeMemberParts {
                start,
                full_start,
                words: rest.into(),
                is_accessor: false,
                ..member.clone()
            };
            return self.finish_type_member(&rest, kept);
        }
        let built = self.build_type_member(member);
        match (built, &mut kept.mapped) {
            // `parseMappedType` reads the members after `[K in T]: X`, and nothing comes of them but an error at the first.
            (Some(Ok(extra)), Some(mapped)) => {
                // `GetErrorRangeForNode`: at the name of a property or an accessor.
                let has_name = matches!(
                    extra.kind,
                    MemberKind::Property | MemberKind::Getter | MemberKind::Setter
                );
                mapped.extra_member_loc.get_or_insert_with(|| {
                    if has_name {
                        extra.loc
                    } else {
                        loc(member.start)
                    }
                });
                kept.members.push(extra);
            }
            (Some(Ok(member)), None) => kept.members.push(member),
            (Some(Err(mapped)), None) if kept.members.is_empty() => kept.mapped = Some(mapped),
            _ => kept.is_complete = false,
        }
    }

    /// Attaches the body that follows the accessor added last.
    pub(crate) fn add_accessor_body(
        &mut self,
        kept: &ObjectTypeBuilder,
        body: &bun_ast::G::FnBody,
    ) {
        if let Some(accessor) = kept
            .members
            .last()
            .filter(|accessor| kept.is_complete && accessor.signature.is_some())
        {
            let end = self.lexer.full_start();
            self.type_syntax_mut().b.add_signature_body(
                accessor.signature,
                FunctionBody {
                    loc: body.loc,
                    end,
                    stmts: body.stmts,
                },
            );
        }
    }

    /// Turns the words before a member's name into modifiers. `None` if one of them is not a modifier (`parseModifiers`): only `static`
    /// may be followed by a line break, and a second `static` is a name.
    fn member_modifiers(
        &mut self,
        before: &[MemberWord],
        newline_before_name: bool,
    ) -> Option<(Flags, Span<Modifier>)> {
        let mut flags = Flags::empty();
        let mut modifiers: smallvec::SmallVec<[Modifier; 4]> = smallvec::SmallVec::new();
        for (i, word) in before.iter().enumerate() {
            let flag = modifier_flag(word.modifier?)?;
            let newline_after = before
                .get(i + 1)
                .map_or(newline_before_name, |next| next.newline_before);
            if newline_after && flag != Flags::STATIC
                || flag == Flags::STATIC && flags.contains(Flags::STATIC)
            {
                return None;
            }
            flags |= flag;
            modifiers.push(Modifier {
                flag,
                loc: loc(word.pos),
                decorator: None,
            });
        }
        Some((flags, self.type_syntax_mut().b.ts.add_modifiers(&modifiers)))
    }

    /// Builds one member. `Err` is the body of a mapped type. `None` means unusable.
    pub(crate) fn build_type_member(
        &mut self,
        member: &TypeMemberParts,
    ) -> Option<Result<Member, MappedType>> {
        if !member.is_complete {
            return None;
        }
        // The type after `:`, if any.
        let ty = match member.ty {
            Some(ty) if ty.is_none() => return None,
            Some(ty) => ty,
            None => TypeId::NONE,
        };
        let mut made = Member {
            kind: MemberKind::Property,
            key: PropertyKey::None,
            flags: Flags::empty(),
            modifiers: Span::EMPTY,
            ty,
            initializer: member.initializer,
            index_signature_errors: member.index_signature_errors,
            signature: SignatureId::NONE,
            loc: loc(member.start),
            start: loc(member.start),
            full_start: loc(member.full_start),
            end: Loc::EMPTY,
        };
        if member.bracket_kind == BracketKind::IndexParameters {
            let (flags, modifiers) =
                self.member_modifiers(&member.words, member.newline_before_bracket)?;
            let params = member.parameters??;
            made.flags |= flags;
            made.modifiers = modifiers;
            made.kind = MemberKind::IndexSignature;
            made.signature = self.type_syntax_mut().b.add_signature(Signature {
                kind: SignatureKind::IndexSignature,
                flags: made.flags,
                type_params: TypeParams::EMPTY,
                params,
                return_type: ty,
                body: None,
                open_paren_loc: loc(member.bracket_pos),
                loc: loc(member.bracket_pos),
            });
            return Some(Ok(made));
        }
        if member.bracket_kind != BracketKind::Nothing && member.computed_name.is_none() {
            let (flags, modifiers) =
                self.member_modifiers(&member.words, member.newline_before_bracket)?;
            let has_readonly = flags == Flags::READONLY;
            let PropertyKey::Name(name) = member.bracket_name.key else {
                return None;
            };
            if !matches!(member.bracket_name.token, T::TIdentifier)
                || member.parameters.is_some()
                || member.type_parameters.is_some()
            {
                return None;
            }
            let name_loc = loc(member.bracket_name.pos);
            match member.bracket_kind {
                BracketKind::Mapped(constraint, name_type, end) => {
                    // Only `readonly` may precede the `[` of a mapped type.
                    if constraint.is_none() || !(flags.is_empty() || has_readonly) {
                        return None;
                    }
                    let modifier = |sign: Option<bool>, exists: bool| match (sign, exists) {
                        (None, false) => Some(MappedModifier::None),
                        (None | Some(true), true) => Some(MappedModifier::Add),
                        (Some(false), true) => Some(MappedModifier::Remove),
                        (Some(_), false) => None,
                    };
                    let (readonly, optional) = (
                        modifier(member.leading_sign, has_readonly)?,
                        modifier(member.trailing_sign, member.is_optional)?,
                    );
                    let param = TypeParam {
                        name,
                        loc: name_loc,
                        start: name_loc,
                        end,
                        constraint,
                        default: TypeId::NONE,
                        flags: Flags::empty(),
                        modifiers: Span::EMPTY,
                    };
                    let param = self.type_syntax_mut().b.add_type_param(param);
                    return Some(Err(MappedType {
                        param,
                        name_type: name_type?,
                        ty,
                        readonly,
                        optional,
                        extra_member_loc: None,
                        members: Members::EMPTY,
                    }));
                }
                BracketKind::Index(key_type) => {
                    if key_type.is_none()
                        || member.leading_sign.is_some()
                        || member.trailing_sign.is_some()
                        || member.is_optional
                    {
                        return None;
                    }
                    made.flags |= flags;
                    made.modifiers = modifiers;
                    let ast = &mut self.type_syntax_mut().b;
                    let name_end = Loc {
                        start: name_loc.start + name.len() as i32,
                    };
                    let name = ast.identifier(&name, name_loc.start as u32);
                    let pattern = ast.add_pattern(PatKind::Ident(name), name_loc, name_end);
                    let params = ast.add_params(&[Param {
                        pattern,
                        ty: key_type,
                        ..Param::at(name_loc)
                    }]);
                    made.kind = MemberKind::IndexSignature;
                    made.signature = ast.add_signature(Signature {
                        kind: SignatureKind::IndexSignature,
                        flags: made.flags,
                        type_params: TypeParams::EMPTY,
                        params,
                        return_type: ty,
                        body: None,
                        open_paren_loc: loc(member.bracket_pos),
                        loc: loc(member.bracket_pos),
                    });
                    return Some(Ok(made));
                }
                _ => return None,
            }
        }
        if member.leading_sign.is_some() {
            return None;
        }
        let has_signature = member.parameters.is_some();
        let (before, word) = match (member.computed_name, member.words.split_last()) {
            // `[name]: T`, `readonly [name]: T`, `get [name](): T`
            (Some(name), _) => {
                let bracket = MemberWord {
                    key: PropertyKey::Computed(name),
                    pos: member.bracket_pos,
                    full_start: member.bracket_full_start,
                    token: T::TOpenBracket,
                    newline_before: member.newline_before_bracket,
                    modifier: None,
                };
                (&member.words[..], bracket)
            }
            // `(a: A): R`
            (None, None) => {
                made.kind = MemberKind::CallSignature;
                made.ty = TypeId::NONE;
                made.signature = self.emit_signature(
                    member,
                    SignatureKind::CallSignature,
                    Flags::empty(),
                    member.start,
                )?;
                return Some(Ok(made));
            }
            // `new (a: A): R`
            (None, Some((word, [])))
                if word.token == T::TNew && has_signature && !member.is_optional =>
            {
                made.kind = MemberKind::ConstructSignature;
                made.ty = TypeId::NONE;
                made.signature = self.emit_signature(
                    member,
                    SignatureKind::ConstructSignature,
                    Flags::empty(),
                    member.start,
                )?;
                return Some(Ok(made));
            }
            (None, Some((word, before))) => (before, *word),
        };
        if matches!(word.key, PropertyKey::None) {
            return None;
        }
        made.key = word.key;
        made.loc = loc(word.pos);
        if matches!(word.token, T::TStringLiteral) {
            made.flags |= Flags::STRING_NAME;
        }
        if member.is_optional {
            made.flags |= Flags::OPTIONAL;
        }
        let mut signature_kind = SignatureKind::Method;
        let before = match before {
            [accessor] if member.is_accessor && has_signature => {
                let is_getter = accessor.modifier == Some(PropertyModifierKeyword::PGet);
                made.kind = if is_getter {
                    MemberKind::Getter
                } else {
                    MemberKind::Setter
                };
                signature_kind = if is_getter {
                    SignatureKind::Getter
                } else {
                    SignatureKind::Setter
                };
                &[][..]
            }
            before => before,
        };
        let (flags, modifiers) = self.member_modifiers(before, word.newline_before)?;
        made.flags |= flags;
        made.modifiers = modifiers;
        if has_signature {
            if made.kind == MemberKind::Property {
                made.kind = MemberKind::Method;
            }
            made.ty = TypeId::NONE;
            made.signature = self.emit_signature(member, signature_kind, made.flags, word.pos)?;
        } else if member.type_parameters.is_some() {
            return None;
        }
        Some(Ok(made))
    }

    /// Finishes an object type.
    pub(crate) fn finish_object_type(&mut self, kept: ObjectTypeBuilder) {
        let is_in_class = self.allow_private_identifiers;
        let syntax = self.type_syntax_mut();
        syntax.b.classes_around = u32::from(is_in_class);
        syntax.last_object_type = match kept {
            ObjectTypeBuilder {
                is_complete: false, ..
            } => None,
            ObjectTypeBuilder {
                mapped: Some(mut mapped),
                members,
                ..
            } => {
                mapped.members = syntax.b.add_members(&members);
                Some(ObjectTypeBody::Mapped(mapped))
            }
            ObjectTypeBuilder { members, .. } => {
                Some(ObjectTypeBody::Members(syntax.b.add_members(&members)))
            }
        };
    }

    // ───────────────────────────── statements ─────────────────────────────

    /// Called before each statement. Pass the result to `end_statement`.
    #[inline]
    pub(crate) fn begin_statement(&mut self) -> usize {
        if !self.should_save_types() {
            return 0;
        }
        let syntax = self.type_syntax_mut();
        syntax.last_statement = StatementId::NONE;
        std::mem::replace(
            &mut syntax.statement_modifiers_base,
            syntax.statement_modifiers.len(),
        )
    }

    /// Called after each statement, whose `loc` is `loc`.
    #[inline]
    pub(crate) fn end_statement(&mut self, outer_modifiers_base: usize, loc: &mut Loc) {
        if !self.should_save_types() {
            return;
        }
        let base = self.type_syntax_mut().statement_modifiers_base;
        self.end_parameter_modifiers(base, loc);
        self.type_syntax_mut().statement_modifiers_base = outer_modifiers_base;
    }

    /// The statement at `loc` that only exists in TypeScript, and was emitted last.
    #[inline]
    pub(crate) fn type_script_statement(&mut self, loc: Loc) -> bun_ast::Stmt {
        let syntax = match &mut self.type_syntax {
            Some(syntax) => std::mem::replace(&mut syntax.last_statement, StatementId::NONE),
            None => StatementId::NONE,
        };
        let syntax = bun_ast::ts_syntax::StatementId(syntax.index() as u32);
        self.s(bun_ast::S::TypeScript { syntax }, loc)
    }

    /// Called when the modifier at `loc` has been recognized as part of the current statement. So is the `export` of an export
    /// declaration or assignment, and the `default` after it.
    #[inline]
    pub(crate) fn push_statement_modifier(&mut self, flag: Flags, loc: Loc) {
        if self.should_save_types() {
            self.type_syntax_mut().statement_modifiers.push(Modifier {
                flag,
                loc,
                decorator: None,
            });
        }
    }

    /// `ModifierToFlag`, of the modifier keyword at the current token (`is_modifier_kind`).
    pub(crate) fn modifier_flag_here(&self) -> Flags {
        match self.lexer.token {
            T::TConst => Flags::CONST,
            T::TDefault => Flags::DEFAULT,
            T::TExport => Flags::EXPORT,
            T::TIn => Flags::IN,
            _ if self.lexer.raw() == b"out" => Flags::OUT,
            _ => PropertyModifierKeyword::find(self.lexer.raw())
                .and_then(modifier_flag)
                .unwrap_or(Flags::empty()),
        }
    }

    /// How many modifiers are pushed. Pass it to `end_parameter_modifiers`.
    pub(crate) fn pushed_modifiers(&self) -> usize {
        match &self.type_syntax {
            Some(syntax) => syntax.statement_modifiers.len(),
            None => 0,
        }
    }

    /// `modifiers` are those of the parameter whose name has the `loc` `loc`.
    pub(crate) fn note_parameter_modifiers(&mut self, loc: &mut Loc, modifiers: &[Modifier]) {
        if self.should_save_types() && !modifiers.is_empty() {
            let list = self.type_syntax_mut().b.ts.add_modifiers(modifiers);
            self.note_modifiers(loc, list);
        }
    }

    /// Those pushed since there were `base` are the modifiers of the statement, or of the parameter or the member whose name it is,
    /// that has the `loc` `loc`.
    pub(crate) fn end_parameter_modifiers(&mut self, base: usize, loc: &mut Loc) {
        if !self.should_save_types() {
            return;
        }
        let syntax = self.type_syntax_mut();
        if syntax.statement_modifiers.len() > base {
            let list = syntax
                .b
                .ts
                .add_modifiers(&syntax.statement_modifiers[base..]);
            syntax.statement_modifiers.truncate(base);
            self.note_modifiers(loc, list);
        }
    }

    /// Those pushed since there were `base` are the modifiers of nothing.
    pub(crate) fn drop_modifiers(&mut self, base: usize) {
        if let Some(syntax) = &mut self.type_syntax {
            syntax.statement_modifiers.truncate(base);
        }
    }

    /// The same for a decorator, whose `@` is at `loc`, of a statement that is no class.
    pub(crate) fn push_statement_decorator(&mut self, decorator: Expr, loc: Loc) {
        if self.should_save_types() {
            self.type_syntax_mut().statement_modifiers.push(Modifier {
                flag: Flags::empty(),
                loc,
                decorator: Some(decorator),
            });
        }
    }

    pub(super) fn emit_statement(&mut self, data: StatementData, keyword_loc: Loc) {
        let TypeSyntax {
            b,
            statement_modifiers,
            statement_modifiers_base,
            last_statement,
            ..
        } = self.type_syntax_mut();
        let modifiers =
            b.ts.add_modifiers(&statement_modifiers[*statement_modifiers_base..]);
        *last_statement = b.ts.add_statement(Statement {
            data,
            modifiers,
            loc: keyword_loc,
        });
    }

    /// `type_params` and `members` are `None` if unusable, in which case nothing is emitted.
    pub(crate) fn emit_interface(
        &mut self,
        name: Name,
        type_params: Option<TypeParams>,
        extends: &[TypeId],
        other_heritage: &[TypeId],
        heritage_errors: [Option<(Loc, u32)>; 2],
        keyword_loc: Loc,
    ) {
        let members = self.type_syntax_mut().last_object_type.take();
        let (Some(type_params), Some(ObjectTypeBody::Members(members)), true) =
            (type_params, members, extends.iter().all(|ty| ty.is_some()))
        else {
            return;
        };
        let ast = &mut self.type_syntax_mut().b;
        let others: smallvec::SmallVec<[TypeId; 4]> = other_heritage
            .iter()
            .copied()
            .filter(|ty| ty.is_some())
            .collect();
        for &ty in extends.iter().chain(&others) {
            ast.heritage_type(ty);
        }
        let extends = ast.add_id_list(extends);
        let other_heritage = ast.add_id_list(&others);
        let interface = ast.ts.add_interface(Interface {
            name,
            type_params,
            extends,
            other_heritage,
            heritage_errors,
            members,
        });
        self.emit_statement(StatementData::Interface(interface), keyword_loc);
    }

    /// The aliased type is the last parsed type, which starts at `type_loc`.
    pub(crate) fn emit_type_alias(
        &mut self,
        name: Name,
        type_params: Option<TypeParams>,
        type_loc: Loc,
        keyword_loc: Loc,
    ) {
        let ty = self.last_type();
        let (Some(type_params), true) = (type_params, ty.is_some()) else {
            return;
        };
        // `parseTypeAliasDeclaration`: `intrinsic` directly after the `=`, and not before a dot, is a keyword.
        let file = &mut self.type_syntax_mut().b.file;
        if let TypeNode {
            kind: TypeNodeKind::Ref { name, args },
            pos,
            ..
        } = file[ty]
            && pos == type_loc.start as u32
            && args.is_empty()
            && file.texts(name).eq([bun_sema::atom::known::intrinsic])
        {
            file[ty].kind = TypeNodeKind::Keyword(Keyword::Intrinsic);
        }
        let alias = self.type_syntax_mut().b.ts.add_type_alias(TypeAlias {
            name,
            type_params,
            ty,
        });
        self.emit_statement(StatementData::TypeAlias(alias), keyword_loc);
    }

    /// The type parameters that `skip_type_script_type_parameters` just parsed. `None` if unusable.
    pub(crate) fn take_type_params(
        &mut self,
        result: SkipTypeParameterResult,
    ) -> Option<TypeParams> {
        match result {
            SkipTypeParameterResult::DidNotSkipAnything => Some(TypeParams::EMPTY),
            _ => self.type_syntax_mut().last_type_params.take(),
        }
    }

    /// Emits the object or mapped type that was just parsed.
    pub(crate) fn emit_object_type(&mut self, pos: u32) {
        match self.type_syntax_mut().last_object_type.take() {
            Some(ObjectTypeBody::Members(members)) => {
                self.emit_type(TypeNodeKind::Object(members), pos)
            }
            Some(ObjectTypeBody::Mapped(mapped)) => {
                let mapped = self.type_syntax_mut().b.add_mapped_type(mapped);
                self.emit_type(mapped, pos)
            }
            None => self.clear_last_type(),
        }
    }
}

/// Of `import("m", { with: { .. } })`: the resolution mode, where `assert` is written instead of `with`, and the attributes.
pub(crate) type ImportTypeAttributes = (
    ResolutionMode,
    Option<Loc>,
    Option<crate::sema::ts_syntax::ImportAttributes>,
);

/// An identifier, keyword, string, number or private name at the start of an object type member. It is either a modifier or the member's
/// name.
#[derive(Copy, Clone)]
pub(crate) struct MemberWord {
    token: T,
    key: PropertyKey,
    pos: u32,
    full_start: u32,
    modifier: Option<PropertyModifierKeyword>,
    newline_before: bool,
}

impl Default for MemberWord {
    fn default() -> Self {
        MemberWord {
            token: T::TEndOfFile,
            key: PropertyKey::None,
            pos: 0,
            full_start: 0,
            modifier: None,
            newline_before: false,
        }
    }
}

/// What a `[...]` at the start of an object type member contains.
#[derive(Copy, Clone, PartialEq, Eq, Default)]
pub(crate) enum BracketKind {
    /// No brackets.
    #[default]
    Nothing,
    /// `[expression]`
    Computed,
    /// `[name: Type]`
    Index(TypeId),
    /// Tolerant mode: the parameter list of an index signature, well formed or not. It is in `TypeMemberParts::parameters`.
    IndexParameters,
    /// `[name in Constraint as NameType]`. The name type is `None` if it is unusable. Where the constraint ends.
    Mapped(TypeId, Option<TypeId>, Loc),
}

/// The pieces of one object type member, collected while the skipper walks over it.
#[derive(Clone)]
pub(crate) struct TypeMemberParts {
    pub(crate) start: u32,
    /// `TokenFullStart` of the token at `start`.
    pub(crate) full_start: u32,
    /// False if the member contains unusable syntax.
    pub(crate) is_complete: bool,
    pub(crate) is_accessor: bool,
    /// `+` (`true`) or `-` before the member, and after `]`.
    pub(crate) leading_sign: Option<bool>,
    pub(crate) trailing_sign: Option<bool>,
    /// Leading words: modifiers, `get` or `set`, and then the member's name unless a `[` follows.
    pub(crate) words: smallvec::SmallVec<[MemberWord; 4]>,
    pub(crate) bracket_pos: u32,
    pub(crate) bracket_full_start: u32,
    pub(crate) newline_before_bracket: bool,
    /// The first token after `[`.
    pub(crate) bracket_name: MemberWord,
    pub(crate) bracket_kind: BracketKind,
    /// The expression in `[expression]`.
    pub(crate) computed_name: Option<Expr>,
    /// The expression in `name: T = expression`.
    pub(crate) initializer: Option<Expr>,
    pub(crate) is_optional: bool,
    /// Outer `None`: no type parameters. Inner `None`: unusable.
    pub(crate) type_parameters: Option<Option<TypeParams>>,
    pub(crate) open_paren: u32,
    pub(crate) parameters: Option<Option<Params>>,
    /// `check_index_signature_parameters`
    pub(crate) index_signature_errors: [Option<(u32, u32)>; 2],
    /// The type after `:`. `Some(NONE)` means unusable.
    pub(crate) ty: Option<TypeId>,
}

impl Default for TypeMemberParts {
    fn default() -> Self {
        TypeMemberParts {
            start: 0,
            full_start: 0,
            is_complete: true,
            is_accessor: false,
            leading_sign: None,
            trailing_sign: None,
            words: smallvec::SmallVec::new(),
            bracket_pos: 0,
            bracket_full_start: 0,
            newline_before_bracket: false,
            bracket_name: MemberWord::default(),
            bracket_kind: BracketKind::Nothing,
            computed_name: None,
            initializer: None,
            is_optional: false,
            type_parameters: None,
            open_paren: 0,
            parameters: None,
            index_signature_errors: [None; 2],
            ty: None,
        }
    }
}

impl TypeMemberParts {
    pub(crate) fn add_word(&mut self, word: MemberWord) {
        self.words.push(word);
    }

    /// The index of the first word that is the name of a property although more words or a `[` follow it.
    fn first_bare_property(&self) -> Option<usize> {
        let has_bracket = self.bracket_kind != BracketKind::Nothing;
        let last_name = if has_bracket {
            self.words.len()
        } else {
            self.words.len().saturating_sub(1)
        };
        (0..last_name).find(|&i| {
            let newline_after = self
                .words
                .get(i + 1)
                .map_or(self.newline_before_bracket, |next| next.newline_before);
            match self.words[i].modifier {
                None => true,
                Some(PropertyModifierKeyword::PGet | PropertyModifierKeyword::PSet) => {
                    !(self.is_accessor && i == 0)
                }
                Some(PropertyModifierKeyword::PStatic) => false,
                Some(_) => newline_after,
            }
        })
    }

    /// Nothing but `readonly` precedes the `[`, as in a mapped type.
    pub(crate) fn has_only_readonly(&self) -> bool {
        self.words
            .iter()
            .all(|word| word.modifier == Some(PropertyModifierKeyword::PReadonly))
    }
}

/// Members collected for the object type being parsed.
pub(crate) struct ObjectTypeBuilder {
    pub(crate) is_complete: bool,
    members: Vec<Member>,
    mapped: Option<MappedType>,
}

impl ObjectTypeBuilder {
    /// No member has been added yet.
    pub(crate) fn is_empty(&self) -> bool {
        self.members.is_empty() && self.mapped.is_none() && self.is_complete
    }
}

impl Default for ObjectTypeBuilder {
    fn default() -> Self {
        ObjectTypeBuilder {
            is_complete: true,
            members: Vec::new(),
            mapped: None,
        }
    }
}

#[derive(Copy, Clone)]
pub(crate) enum ObjectTypeBody {
    Members(Members),
    Mapped(MappedType),
}

/// `new <T>`, `abstract new`, `<T>`
#[derive(Copy, Clone)]
pub(crate) struct FnTypeHead {
    kind: SignatureKind,
    flags: Flags,
    /// `None` if unusable.
    type_params: Option<TypeParams>,
    pos: u32,
    start: u32,
}

impl FnTypeHead {
    /// Whether its type parameters are among the first `rows`.
    pub(super) fn is_within(&self, rows: usize) -> bool {
        self.type_params.is_none_or(|list| list.range().end <= rows)
    }
}

/// `None` for `get` and `set`, which are not modifiers.
pub(crate) fn modifier_flag(keyword: PropertyModifierKeyword) -> Option<Flags> {
    Some(match keyword {
        PropertyModifierKeyword::PReadonly => Flags::READONLY,
        PropertyModifierKeyword::PPublic => Flags::PUBLIC,
        PropertyModifierKeyword::PPrivate => Flags::PRIVATE,
        PropertyModifierKeyword::PProtected => Flags::PROTECTED,
        PropertyModifierKeyword::PStatic => Flags::STATIC,
        PropertyModifierKeyword::PAbstract => Flags::ABSTRACT,
        PropertyModifierKeyword::PDeclare => Flags::AMBIENT,
        PropertyModifierKeyword::POverride => Flags::OVERRIDE,
        PropertyModifierKeyword::PAccessor => Flags::ACCESSOR,
        PropertyModifierKeyword::PAsync => Flags::ASYNC,
        PropertyModifierKeyword::PGet | PropertyModifierKeyword::PSet => return None,
    })
}

/// The keyword type that an identifier token spells, such as `string`.
pub(crate) fn keyword_type(identifier: &[u8]) -> Option<Keyword> {
    Some(match kind_for_identifier(identifier)? {
        Kind::PrimitiveAny => Keyword::Any,
        Kind::PrimitiveUnknown => Keyword::Unknown,
        Kind::PrimitiveNever => Keyword::Never,
        Kind::PrimitiveUndefined => Keyword::Undefined,
        Kind::PrimitiveString => Keyword::String,
        Kind::PrimitiveNumber => Keyword::Number,
        Kind::PrimitiveBoolean => Keyword::Boolean,
        Kind::PrimitiveBigint => Keyword::BigInt,
        Kind::PrimitiveSymbol => Keyword::Symbol,
        Kind::PrimitiveObject => Keyword::Object,
        _ => return None,
    })
}
