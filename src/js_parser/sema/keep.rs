//! Keep mode for TypeScript type syntax.
//!
//! By default the parser skips types. When `TypeSyntax::save_types` is set, the same skip functions
//! in `parse/parse_skip_typescript.rs` also build the checker's HIR nodes, by calling the helpers
//! in this file under `if KEEP` (`clone_types.rs` builds them).
//!
//! Each function that parses a type stores the result in `TypeSyntax::last_type`, and the caller
//! reads it from there. `NONE` means there is no usable type, which only happens for invalid code.
//! `NONE` propagates to the enclosing type.

use crate::sema::ts_syntax::{
    Flags, FunctionBody, Interface, Keyword, MappedModifier, MappedType, Member, MemberKind,
    Members, Modifier, Name, Param, Params, PatternElement, PatternId, PatternProperty,
    PropertyKey, ResolutionMode, Signature, SignatureId, SignatureKind, Span, Statement,
    StatementData, StatementId, TupleElement, TypeAlias, TypeId, TypeParam, TypeParams, Types,
};
use bun_ast::{Expr, Loc, StoreStr};
use bun_sema::hir::{DiagnosticKind, ExprId, JSDocTypeKind, PatKind, TypeNode, TypeNodeKind};

use super::TypeSyntax;
use crate::lexer::{PropertyModifierKeyword, T};
use crate::p::P;
use crate::parser::SkipTypeParameterResult;
use crate::typescript::identifier::{Kind, kind_for_identifier};

#[inline]
fn loc(pos: u32) -> Loc {
    Loc { start: pos as i32 }
}

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool, const SEMA: bool>
    P<'a, TYPESCRIPT, SCAN_ONLY, SEMA>
{
    /// Whether to build type nodes. This is the only check ordinary builds pay for, once per top-level type.
    #[inline(always)]
    pub(crate) fn should_save_types(&self) -> bool {
        SEMA && self
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
        self.type_syntax_mut().set_last_type(TypeId::NONE);
    }

    #[inline]
    pub(crate) fn emit_type(&mut self, kind: TypeNodeKind, pos: u32) {
        let syntax = self.type_syntax_mut();
        let ty = syntax.b.file.ty(kind, pos, 0);
        syntax.set_last_type(ty);
    }

    /// `finishNode` for the last parsed type, unless it is already finished: it ends at the end of
    /// the previous token.
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

    /// The last parsed type, a single token, turned out to be the parameter name of a type
    /// predicate. Removes its node, which is the most recent one.
    pub(crate) fn take_back_single_token_type(&mut self) {
        self.type_syntax_mut().take_back_single_token_type();
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
            T::TStringLiteral => match self.string_token_text() {
                Some(text) => TypeNodeKind::StringLit(self.type_syntax_mut().b.atom(&text)),
                None => return self.clear_last_type(),
            },
            // `parseLiteralTypeNode` does not rescan the token.
            T::TNoSubstitutionTemplateLiteral => {
                let raw = self.lexer.string_literal_raw_content;
                let text = self.lexer.cooked_template_contents(raw);
                TypeNodeKind::StringLit(self.type_syntax_mut().b.atom(&text))
            }
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
            if matches!(
                self.lexer.token,
                T::TIdentifier | T::TPrivateIdentifier | T::TEscapedKeyword
            ) {
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
        self.type_syntax_mut().finish_type_list(from)
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

    /// Called where the name after a `.` is missing (`parseRightSideOfDot`). An empty name
    /// represents it.
    pub(crate) fn append_missing_qualified_name(&mut self) {
        let name = Name {
            text: StoreStr::EMPTY,
            loc: self.lexer.full_start(),
        };
        self.append_name(name);
    }

    /// Whether a `.` can continue the last parsed type: it is a name without type arguments
    /// (`parseEntityName`).
    pub(crate) fn last_type_takes_qualifier(&mut self) -> bool {
        let reference = self.last_type();
        if reference.is_none() {
            return true;
        }
        match self.type_syntax_mut().b.file[reference].kind {
            TypeNodeKind::Ref { args, .. } => args.is_empty(),
            TypeNodeKind::Keyword(Keyword::Void | Keyword::Null | Keyword::This) => false,
            TypeNodeKind::Keyword(_) => true,
            _ => false,
        }
    }

    fn append_name(&mut self, name: Name) {
        self.type_syntax_mut().append_name(name);
    }

    /// Takes the last parsed type at a point where type arguments may follow. Its node, the most
    /// recent one, is removed until they are parsed, because a node is numbered after its children.
    /// Pass the result to `attach_type_args`.
    pub(crate) fn take_reference(&mut self) -> Option<TypeNode> {
        let syntax = self.type_syntax_mut();
        // `label: ...T[]` and `T!` leave a type that is not the most recent node. It stays in
        // place, and nothing attaches to it.
        if syntax.last_type.is_none() || syntax.last_type.idx() + 1 != syntax.b.file.types.len() {
            return None;
        }
        syntax.set_last_type(TypeId::NONE);
        syntax.b.file.types.pop()
    }

    /// Attaches the type arguments that were just parsed, if any, to `reference`.
    pub(crate) fn attach_type_args(&mut self, reference: Option<TypeNode>, has_arguments: bool) {
        self.type_syntax_mut()
            .attach_type_args(reference, has_arguments);
    }

    /// Called on each name in `typeof a.b.c`.
    pub(crate) fn push_typeof_name(&mut self) {
        // An empty name represents a missing one.
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
        self.type_syntax_mut()
            .emit_typeof_type(names_base, has_arguments, pos);
    }

    // ───────────────────────────── other types ─────────────────────────────

    /// Called on the specifier of `import("specifier")`. Returns its text and offset.
    pub(crate) fn import_type_specifier(&mut self) -> Option<(StoreStr, u32)> {
        if self.lexer.token != T::TStringLiteral {
            return None;
        }
        Some((self.string_token_text()?, self.token_start()))
    }

    /// `IsLiteralImportTypeNode`: whether the last parsed type, the argument of `import(..)`, is
    /// nothing but the string literal `specifier`. Then its node is removed.
    pub(crate) fn take_back_import_type_specifier(
        &mut self,
        specifier: Option<(StoreStr, u32)>,
    ) -> bool {
        let argument = self.last_type();
        let Some((_, specifier_pos)) = specifier.filter(|_| argument.is_some()) else {
            return false;
        };
        let TypeNode { kind, pos, .. } = self.type_syntax_mut().b.file[argument];
        let is_literal = matches!(kind, TypeNodeKind::StringLit(_)) && pos == specifier_pos;
        if is_literal {
            self.take_back_single_token_type();
        }
        is_literal
    }

    /// Called after `{ with: { "resolution-mode": "import" } }`, which the skipper parsed as an
    /// object type. Reads the resolution mode from those nodes (`GetResolutionModeOverride`), and
    /// the position of `assert` if it is used instead of `with`. `None` if the attributes are not
    /// in that form.
    pub(crate) fn import_type_attributes(&mut self) -> Option<ImportTypeAttributes> {
        self.type_syntax_mut().import_type_attributes()
    }

    /// Emits `import("specifier")`. A qualified name and type arguments are added later, as for a
    /// type reference.
    /// `argument` is the type in place of a string literal, and `NONE` if `specifier` is given.
    /// `argument_range`: its start and end as written.
    pub(crate) fn emit_import_type(
        &mut self,
        specifier: Option<(StoreStr, u32)>,
        (argument, argument_range): (TypeId, (u32, u32)),
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
            (argument, argument_range),
            attributes,
            is_typeof,
        );
        self.emit_type(import, pos);
    }

    /// Emits `unique T`, where `T` is the last parsed type. Its first token is at `operand_pos`,
    /// which is a parenthesis if `T` starts after it.
    pub(crate) fn emit_unique_type(&mut self, operand_pos: u32, pos: u32) {
        let operand = self.last_type();
        if operand.is_none() {
            return;
        }
        let TypeNode {
            kind, pos: start, ..
        } = self.type_syntax_mut().b.file[operand];
        if matches!(kind, TypeNodeKind::Keyword(Keyword::Symbol)) && start == operand_pos {
            self.take_back_single_token_type();
            return self.emit_type(TypeNodeKind::UniqueSymbol, pos);
        }
        self.emit_type(TypeNodeKind::Unique(operand), pos);
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
        self.type_syntax_mut().optional_tuple_element_type()
    }

    /// Wraps the last parsed type in JSDoc's `?` (`Nullable`) or `!` (`NonNullable`), placed after
    /// it or before it. The result starts at `pos`.
    pub(crate) fn emit_jsdoc_type(&mut self, kind: JSDocTypeKind, postfix: Postfix, pos: u32) {
        let ty = self.last_type();
        if ty.is_some() {
            let kind = TypeNodeKind::JSDoc {
                ty,
                kind,
                is_postfix: postfix == Postfix::Yes,
            };
            self.emit_type(kind, pos);
        }
    }

    /// `*`
    pub(crate) fn emit_jsdoc_all_type(&mut self, pos: u32) {
        // JSDoc types can only be used inside documentation comments.
        self.type_syntax_mut()
            .b
            .check_jsdoc_type_is_in_js_file(pos, pos + 1, 8020);
        self.emit_type(TypeNodeKind::Keyword(Keyword::Any), pos);
    }

    /// `label: ...T`, where `T` is the last parsed type.
    pub(crate) fn emit_rest_type(&mut self, pos: u32) {
        let end = self.lexer.full_start().start as u32;
        let syntax = self.type_syntax_mut();
        if syntax.last_type.is_some() {
            // `checkNamedTupleMember`. The element is required (`getTupleElementFlags`).
            syntax.b.file.error(DiagnosticKind::Grammar, pos, end, 5087);
            let ty = syntax.b.rest_element_type(syntax.last_type);
            syntax.set_last_type(ty);
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

    /// `interface I extends expression<Args>`, `class C implements expression<Args>`. The checker
    /// reports it (2499, 2500). `has_arguments`: type arguments follow the expression, and are the
    /// last ones parsed.
    pub(crate) fn emit_heritage_expression(
        &mut self,
        expression: Expr,
        has_arguments: bool,
        pos: u32,
    ) {
        let args = match has_arguments {
            true => self.take_saved_type_argument_list(),
            false => Types::EMPTY,
        };
        let expr = ExprId::NONE;
        self.emit_type(TypeNodeKind::Heritage { expr, args }, pos);
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

    /// `createMissingIdentifier`: an empty name at `loc`.
    pub(crate) fn emit_missing_binding(&mut self, loc: bun_ast::Loc) {
        let syntax = self.type_syntax_mut();
        let name = syntax.b.atom(b"");
        syntax.last_binding = syntax.b.add_pattern(PatKind::Ident(name), loc, loc);
    }

    /// `{ name }`, `{ ...name }`, after the name.
    pub(crate) fn emit_shorthand_binding(&mut self, property: &PatternProperty) {
        let end = self.lexer.full_start();
        let syntax = self.type_syntax_mut();
        syntax.last_binding = match property.key {
            PropertyKey::Name(name) => {
                let name = syntax.b.identifier(&name, property.key_loc.start as u32);
                syntax
                    .b
                    .add_pattern(PatKind::Ident(name), property.key_loc, end)
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

    /// The current token as a property key, if it is an identifier, keyword, string, number or
    /// private name.
    pub(crate) fn simple_property_key(&mut self) -> PropertyKey {
        match self.lexer.token {
            T::TStringLiteral | T::TNoSubstitutionTemplateLiteral => self
                .string_token_text()
                .map_or(PropertyKey::None, PropertyKey::Name),
            T::TNumericLiteral => PropertyKey::Number(self.lexer.number),
            T::TBigIntegerLiteral => PropertyKey::BigInt,
            T::TPrivateIdentifier => PropertyKey::Private(StoreStr::new(self.lexer.identifier)),
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
            key: self.simple_property_key(),
            pos: self.token_start(),
        }
    }

    /// `createMissingIdentifier`, at a token that is not the name of a member.
    pub(crate) fn missing_member_word(&self) -> MemberWord {
        MemberWord {
            token: T::TIdentifier,
            key: PropertyKey::Name(StoreStr::EMPTY),
            pos: self.lexer.token_full_start as u32,
        }
    }

    /// Adds a finished member to the object type being built.
    pub(crate) fn finish_type_member(
        &mut self,
        member: &TypeMemberParts,
        kept: &mut ObjectTypeBuilder,
    ) {
        self.type_syntax_mut().finish_type_member(member, kept);
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
            let syntax = self.type_syntax_mut();
            // The modifiers of every declaration being parsed.
            let mut around = syntax.statement_modifiers.iter();
            let is_ambient = around.any(|modifier| modifier.flag == Flags::AMBIENT);
            syntax.b.add_signature_body(
                accessor.signature,
                FunctionBody {
                    loc: body.loc,
                    end,
                    stmts: body.stmts,
                    is_ambient,
                },
            );
        }
    }

    /// Builds one member. `Err` is the body of a mapped type. `None` means unusable.
    pub(crate) fn build_type_member(
        &mut self,
        member: &TypeMemberParts,
    ) -> Option<Result<Member, MappedType>> {
        self.type_syntax_mut().build_type_member(member)
    }

    /// Finishes an object type.
    pub(crate) fn finish_object_type(&mut self, kept: ObjectTypeBuilder) {
        let is_in_class = self.allow_private_identifiers;
        self.type_syntax_mut().finish_object_type(kept, is_in_class);
    }
}

impl TypeSyntax<'_> {
    #[inline]
    pub(crate) fn set_last_type(&mut self, ty: TypeId) {
        self.last_type = ty;
        self.last_type_lacks_parameters = false;
    }

    /// `typeHasArrowFunctionBlockingParseError`, for the last parsed type. A type in parentheses has no node of its own.
    pub(crate) fn last_type_blocks_arrow_function(&self) -> bool {
        if self.last_type_lacks_parameters {
            return true;
        }
        let file = &self.b.file;
        let mut ty = self.last_type;
        while ty.is_some() {
            match file[ty].kind {
                TypeNodeKind::Ref { name, .. }
                    if file[name.at(0)].text == bun_sema::atom::known::empty =>
                {
                    return true;
                }
                TypeNodeKind::Fn(signature) => ty = file[signature].ret,
                _ => break,
            }
        }
        false
    }

    /// Removes the node of the last parsed type, which is the most recent one, and its name.
    fn take_back_single_token_type(&mut self) {
        let file = &mut self.b.file;
        if self.last_type.is_some() && self.last_type.idx() + 1 == file.types.len() {
            if let Some(TypeNode {
                kind: TypeNodeKind::Ref { name, .. },
                ..
            }) = file.types.pop()
                && name.range().end == file.names.len()
            {
                file.names.truncate(name.start as usize);
            }
        }
        self.set_last_type(TypeId::NONE);
    }

    /// Pops the list that starts at `from` in `type_stack`. `None` if any item is missing.
    fn finish_type_list(&mut self, from: usize) -> Option<Types> {
        let TypeSyntax { b, type_stack, .. } = self;
        let list = if type_stack[from..].iter().any(|item| item.is_none()) {
            None
        } else {
            Some(b.add_id_list(&type_stack[from..]))
        };
        type_stack.truncate(from);
        list
    }

    /// Extends the last parsed type reference with `name`, the name after a `.`.
    fn append_name(&mut self, name: Name) {
        let reference = self.last_type;
        if reference.is_none() {
            return;
        }
        let b = &mut self.b;
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
            _ => {
                self.set_last_type(TypeId::NONE);
                return;
            }
        };
        let name = b.file.append_to_entity_name(before, text, place);
        b.file[reference].end = 0;
        b.file[reference].kind = match kind {
            TypeNodeKind::Import {
                spec,
                args,
                is_typeof,
                mode,
                attributes,
                ..
            } => TypeNodeKind::Import {
                spec,
                name,
                args,
                is_typeof,
                mode,
                attributes,
            },
            _ => TypeNodeKind::Ref {
                name,
                args: Types::EMPTY,
            },
        };
    }

    /// Adds `reference` again, with the type arguments that were just parsed, if any.
    fn attach_type_args(&mut self, reference: Option<TypeNode>, has_arguments: bool) {
        let Some(mut node) = reference else {
            if has_arguments {
                self.set_last_type(TypeId::NONE);
            }
            return;
        };
        self.set_last_type(TypeId::NONE);
        if has_arguments {
            node.end = 0;
            match (&mut node.kind, self.last_type_args.take()) {
                // The type arguments of `import(T)` are never checked.
                (TypeNodeKind::Import { spec, .. }, Some(_)) if spec.is_none() => {}
                (
                    TypeNodeKind::Ref { args, .. } | TypeNodeKind::Import { args, .. },
                    Some(actual),
                ) => *args = actual,
                _ => return,
            }
        }
        let ty = self.b.file.add_type_node(node);
        self.set_last_type(ty);
    }

    /// Emits `typeof a.b.c<Args>` at `pos`. The names are in `name_stack` starting at `names_base`.
    fn emit_typeof_type(&mut self, names_base: usize, has_arguments: bool, pos: u32) {
        let names: smallvec::SmallVec<[Name; 4]> = self.name_stack.drain(names_base..).collect();
        self.set_last_type(TypeId::NONE);
        let args = match (has_arguments, self.last_type_args.take()) {
            (false, _) => Types::EMPTY,
            (true, Some(args)) => args,
            (true, None) => return,
        };
        let data = self.b.add_typeof(&names, args, has_arguments);
        let ty = self.b.file.ty(data, pos, 0);
        self.set_last_type(ty);
    }

    /// `GetResolutionModeOverride`, from the nodes of the object type parsed last.
    fn import_type_attributes(&self) -> Option<ImportTypeAttributes> {
        let (file, atoms) = (&self.b.file, self.b.atoms);
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
        let Some(ObjectTypeBody::Members(outer)) = self.last_object_type else {
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

    /// If the last parsed type is a postfix `T?`, removes that node and returns `T`.
    fn optional_tuple_element_type(&mut self) -> Option<TypeId> {
        let types = &mut self.b.file.types;
        match types.get(self.last_type.idx())?.kind {
            TypeNodeKind::JSDoc {
                ty,
                kind: JSDocTypeKind::Nullable,
                is_postfix: true,
            } => {
                types.truncate(self.last_type.idx());
                Some(ty)
            }
            _ => None,
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
        Some(self.b.add_signature(Signature {
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

    /// Adds `member` to `kept`, the object type being built.
    fn finish_type_member(&mut self, member: &TypeMemberParts, kept: &mut ObjectTypeBuilder) {
        let built = self.build_type_member(member);
        match (built, &mut kept.mapped) {
            // `parseMappedType` parses the members after `[K in T]: X` and only reports an error at
            // the first.
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

    /// Builds one member. `Err` is the body of a mapped type. `None` means unusable.
    fn build_type_member(
        &mut self,
        member: &TypeMemberParts,
    ) -> Option<Result<Member, MappedType>> {
        // The type after `:`, if any.
        let ty = match member.ty {
            Some(ty) if ty.is_none() => return None,
            Some(ty) => ty,
            None => TypeId::NONE,
        };
        let mut flags = Flags::empty();
        for modifier in &member.modifiers {
            flags |= modifier.flag;
        }
        let mut created = Member {
            kind: MemberKind::Property,
            key: PropertyKey::None,
            flags,
            modifiers: self.b.ts.add_modifiers(&member.modifiers),
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
            let params = member.parameters??;
            created.kind = MemberKind::IndexSignature;
            created.signature = self.b.add_signature(Signature {
                kind: SignatureKind::IndexSignature,
                flags: created.flags,
                type_params: TypeParams::EMPTY,
                params,
                return_type: ty,
                body: None,
                open_paren_loc: loc(member.bracket_pos),
                loc: loc(member.bracket_pos),
            });
            return Some(Ok(created));
        }
        if member.bracket_kind != BracketKind::Nothing && member.computed_name.is_none() {
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
                    if constraint.is_none() {
                        return None;
                    }
                    // Only `readonly` precedes the `[` of a mapped type.
                    let has_readonly = flags == Flags::READONLY;
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
                    let param = self.b.add_type_param(param);
                    return Some(Err(MappedType {
                        param,
                        name_type: name_type?,
                        ty,
                        readonly,
                        optional,
                        is_readonly_with_plus: member.leading_sign == Some(true),
                        is_optional_with_plus: member.trailing_sign == Some(true),
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
                    let ast = &mut self.b;
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
                    created.kind = MemberKind::IndexSignature;
                    created.signature = ast.add_signature(Signature {
                        kind: SignatureKind::IndexSignature,
                        flags: created.flags,
                        type_params: TypeParams::EMPTY,
                        params,
                        return_type: ty,
                        body: None,
                        open_paren_loc: loc(member.bracket_pos),
                        loc: loc(member.bracket_pos),
                    });
                    return Some(Ok(created));
                }
                _ => return None,
            }
        }
        if member.leading_sign.is_some() {
            return None;
        }
        let has_signature = member.parameters.is_some();
        let word = match (member.computed_name, member.name) {
            // `[name]: T`, `get [name](): T`
            (Some(name), _) => MemberWord {
                key: PropertyKey::Computed(name),
                pos: member.bracket_pos,
                token: T::TOpenBracket,
            },
            // `(a: A): R`
            (None, None) => {
                created.kind = MemberKind::CallSignature;
                created.ty = TypeId::NONE;
                created.signature = self.emit_signature(
                    member,
                    SignatureKind::CallSignature,
                    Flags::empty(),
                    member.start,
                )?;
                return Some(Ok(created));
            }
            // `new (a: A): R`
            (None, Some(word))
                if word.token == T::TNew
                    && has_signature
                    && !member.is_optional
                    && member.modifiers.is_empty()
                    && member.accessor.is_none() =>
            {
                created.kind = MemberKind::ConstructSignature;
                created.ty = TypeId::NONE;
                created.signature = self.emit_signature(
                    member,
                    SignatureKind::ConstructSignature,
                    Flags::empty(),
                    member.start,
                )?;
                return Some(Ok(created));
            }
            (None, Some(word)) => word,
        };
        if matches!(word.key, PropertyKey::None) {
            return None;
        }
        created.key = word.key;
        created.loc = loc(word.pos);
        if matches!(word.token, T::TStringLiteral) {
            created.flags |= Flags::STRING_NAME;
        }
        if member.is_optional {
            created.flags |= Flags::OPTIONAL;
        }
        if has_signature {
            let signature_kind = member.accessor.unwrap_or(SignatureKind::Method);
            created.kind = match signature_kind {
                SignatureKind::Getter => MemberKind::Getter,
                SignatureKind::Setter => MemberKind::Setter,
                _ => MemberKind::Method,
            };
            created.ty = TypeId::NONE;
            created.signature =
                self.emit_signature(member, signature_kind, created.flags, word.pos)?;
        } else if member.type_parameters.is_some() {
            return None;
        }
        Some(Ok(created))
    }

    /// Stores `kept` in `last_object_type`. `is_in_class`: the object type is inside a class.
    fn finish_object_type(&mut self, kept: ObjectTypeBuilder, is_in_class: bool) {
        self.b.classes_around = u32::from(is_in_class);
        self.last_object_type = match kept {
            ObjectTypeBuilder {
                is_complete: false, ..
            } => None,
            ObjectTypeBuilder {
                mapped: Some(mut mapped),
                members,
                ..
            } => {
                mapped.members = self.b.add_members(&members);
                Some(ObjectTypeBody::Mapped(mapped))
            }
            ObjectTypeBuilder { members, .. } => {
                Some(ObjectTypeBody::Members(self.b.add_members(&members)))
            }
        };
    }

    /// Emits the statement `data`, whose keyword is at `keyword_loc`, with the modifiers of the current statement.
    pub(super) fn emit_statement(&mut self, data: StatementData, keyword_loc: Loc) {
        let TypeSyntax {
            b,
            statement_modifiers,
            statement_modifiers_base,
            last_statement,
            ..
        } = self;
        let modifiers =
            b.ts.add_modifiers(&statement_modifiers[*statement_modifiers_base..]);
        *last_statement = b.ts.add_statement(Statement {
            data,
            modifiers,
            loc: keyword_loc,
        });
    }

    /// Emits an interface whose body is the object type parsed last.
    fn emit_interface(
        &mut self,
        name: Name,
        type_params: Option<TypeParams>,
        extends: &[TypeId],
        other_heritage: &[TypeId],
        heritage_errors: [Option<(Loc, u32)>; 2],
        keyword_loc: Loc,
    ) {
        let members = self.last_object_type.take();
        let (Some(type_params), Some(ObjectTypeBody::Members(members)), true) =
            (type_params, members, extends.iter().all(|ty| ty.is_some()))
        else {
            return;
        };
        let ast = &mut self.b;
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

    /// Emits an alias of the last parsed type.
    fn emit_type_alias(&mut self, name: Name, type_params: Option<TypeParams>, keyword_loc: Loc) {
        let ty = self.last_type;
        let (Some(type_params), true) = (type_params, ty.is_some()) else {
            return;
        };
        let alias = self.b.ts.add_type_alias(TypeAlias {
            name,
            type_params,
            ty,
        });
        self.emit_statement(StatementData::TypeAlias(alias), keyword_loc);
    }
}

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool, const SEMA: bool>
    P<'a, TYPESCRIPT, SCAN_ONLY, SEMA>
{
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
        match self.token() {
            T::TConst => Flags::CONST,
            T::TDefault => Flags::DEFAULT,
            T::TExport => Flags::EXPORT,
            T::TIn => Flags::IN,
            _ if self.lexer.identifier == b"out" => Flags::OUT,
            _ => PropertyModifierKeyword::find(self.lexer.identifier)
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

    /// `modifiers` are those of the parameter whose name has the `loc` `loc`, or the keywords among
    /// those of the class expression whose `class` has it.
    pub(crate) fn note_parameter_modifiers(&mut self, loc: &mut Loc, modifiers: &[Modifier]) {
        if self.should_save_types() && !modifiers.is_empty() {
            let list = self.type_syntax_mut().b.ts.add_modifiers(modifiers);
            self.note_modifiers(loc, list);
        }
    }

    /// The modifiers pushed since the stack had `base` entries belong to the statement at `loc`, or
    /// to the parameter or member whose name is at `loc`.
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

    /// Discards the modifiers pushed since the stack had `base` entries.
    pub(crate) fn drop_modifiers(&mut self, base: usize) {
        if SEMA && let Some(syntax) = &mut self.type_syntax {
            syntax.statement_modifiers.truncate(base);
        }
    }

    /// The same for a decorator, whose `@` is at `loc`, of a statement that is not a class.
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
        self.type_syntax_mut().emit_statement(data, keyword_loc);
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
        self.type_syntax_mut().emit_interface(
            name,
            type_params,
            extends,
            other_heritage,
            heritage_errors,
            keyword_loc,
        );
    }

    /// Called on the `intrinsic` that is the whole type of an alias (`parseKeywordTypeNode`).
    pub(crate) fn emit_intrinsic_keyword(&mut self) {
        let pos = self.token_start();
        self.emit_type(TypeNodeKind::Keyword(Keyword::Intrinsic), pos);
    }

    /// The aliased type is the last parsed type.
    pub(crate) fn emit_type_alias(
        &mut self,
        name: Name,
        type_params: Option<TypeParams>,
        keyword_loc: Loc,
    ) {
        self.type_syntax_mut()
            .emit_type_alias(name, type_params, keyword_loc);
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

/// Whether the `?` or `!` of a JSDoc type comes after the type.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Postfix {
    No,
    Yes,
}

/// Of `import("m", { with: { .. } })`: the resolution mode, the position of `assert` if it is used
/// instead of `with`, and the attributes.
pub(crate) type ImportTypeAttributes = (
    ResolutionMode,
    Option<Loc>,
    Option<crate::sema::ts_syntax::ImportAttributes>,
);

/// An identifier, keyword, string, number or private name: the name of an object type member, or the first token in its brackets.
#[derive(Copy, Clone)]
pub(crate) struct MemberWord {
    token: T,
    key: PropertyKey,
    pos: u32,
}

impl Default for MemberWord {
    fn default() -> Self {
        MemberWord {
            token: T::TEndOfFile,
            key: PropertyKey::None,
            pos: 0,
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
    /// `[name in Constraint as NameType]`. The name type is `None` if it is unusable. The `Loc` is
    /// the end of the constraint.
    Mapped(TypeId, Option<TypeId>, Loc),
}

/// The pieces of one object type member, collected while the skipper walks over it.
#[derive(Default)]
pub(crate) struct TypeMemberParts {
    pub(crate) start: u32,
    /// `TokenFullStart` of the token at `start`.
    pub(crate) full_start: u32,
    /// `parseModifiers`. Of a mapped type: its `readonly`.
    pub(crate) modifiers: Vec<Modifier>,
    /// `Getter` or `Setter`, after `get` or `set`.
    pub(crate) accessor: Option<SignatureKind>,
    /// `+` (`true`) or `-` before the member, and after `]`.
    pub(crate) leading_sign: Option<bool>,
    pub(crate) trailing_sign: Option<bool>,
    /// `parsePropertyName`, unless the name is in brackets.
    pub(crate) name: Option<MemberWord>,
    pub(crate) bracket_pos: u32,
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

impl TypeMemberParts {
    /// Nothing but `readonly` precedes the `[`, as in a mapped type.
    pub(crate) fn has_only_readonly(&self) -> bool {
        self.modifiers
            .iter()
            .all(|modifier| modifier.flag == Flags::READONLY)
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

    /// `finishNode` for the most recently added member, unless it is already finished. `end`:
    /// `TokenFullStart` of the next token.
    /// `parseTypeMemberSemicolon` is part of the member.
    pub(crate) fn end_member(&mut self, end: Loc) {
        if let Some(member) = self.members.last_mut()
            && member.end == Loc::EMPTY
        {
            member.end = end;
        }
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
