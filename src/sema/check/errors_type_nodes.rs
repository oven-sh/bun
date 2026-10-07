//! Type nodes, and indexed access:
//! 1257 1265 1266 2574 (tuple types), 1338 2838 (`infer`), 1354 (`readonly`), 2795 (`intrinsic`),
//! 2526 (`this`), 1021 1268 1337 (index signatures), 18016 (private names), 1176 (interfaces),
//! 1099 1009 (type argument lists), 2848 2635 (instantiation expressions), 2536 4105 2542 2862 2514
//! (`T[K]`, `a[k]`).
//!
//! Follows `checkTupleType`, `checkInferType`, `getThisType`, `checkTypeAliasDeclaration`,
//! `checkObjectTypeForDuplicateDeclarations`, `checkPropertySignature`, `checkMethodDeclaration`,
//! `checkIndexedAccessIndexType`, `getPropertyTypeForIndexType`, `checkExpressionWithTypeArguments`
//! and `getInstantiationExpressionType` of TypeScript 7.0.2's checker.go, and
//! `checkGrammarIndexSignatureParameters`, `checkGrammarTypeArguments`,
//! `checkGrammarInterfaceDeclaration` and `checkGrammarTypeOperatorNode` of its grammarchecks.go.
//!
//! What the HIR of a file does not store (parentheses around types, the position of a type argument
//! list) is read from the source text.

use super::*;
use crate::bind::{Decl, MemberOwner, Parent};

/// `hasParseDiagnostics`: the parser or the scanner reported an error in the file, so
/// `grammarErrorOnNode` and similar functions report nothing.
/// `parse_for_sema` sets the flag by the origin of each error, so a code the parser shares with
/// `grammarErrorOnNode` (1005 ..) does not count.
pub(super) fn has_parse_diagnostics(hir: &hir::File) -> bool {
    hir.has_parse_diagnostics || hir.has_errors
}

// ───────────────────────────── the text ─────────────────────────────

/// The position after the string or the template that starts at `pos`.
fn end_of_string(text: &[u8], pos: usize) -> Option<usize> {
    let quote = text[pos];
    let mut at = pos + 1;
    loop {
        match *text.get(at)? {
            b'\\' => at += 2,
            c if c == quote => return Some(at + 1),
            b'$' if quote == b'`' && text.get(at + 1) == Some(&b'{') => {
                at = end_of_brackets(text, at + 1)?
            }
            _ => at += 1,
        }
    }
}

/// Position of the `>` that closes the type argument list whose last type is at `pos`.
fn end_of_type_arguments(text: &[u8], pos: usize) -> Option<usize> {
    let (mut depth, mut at) = (0usize, pos);
    loop {
        at = skip_trivia(text, at);
        match *text.get(at)? {
            b'<' | b'(' | b'[' | b'{' => depth += 1,
            b'=' if text.get(at + 1) == Some(&b'>') => at += 1,
            b'>' if depth == 0 => return Some(at),
            // Closes parentheses around the type, which are not stored.
            b')' if depth == 0 => {}
            b'>' | b')' | b']' | b'}' => depth = depth.checked_sub(1)?,
            b'"' | b'\'' | b'`' => {
                at = end_of_string(text, at)?;
                continue;
            }
            _ => {}
        }
        at += 1;
    }
}

/// The start in the source of the type `node`. Neither the parentheses around a type nor a `|` or a
/// `&` before its only member are stored. Only for a type that follows a token that is none of
/// these: a whole element or argument, a return type, a constraint, a default.
pub(super) fn start_of_type(hir: &hir::File, node: TypeNodeId) -> u32 {
    let text: &[u8] = &hir.text;
    let mut at = hir[node].pos as usize;
    // `(T)`, `| T`: a bar before the whole type is a leading bar.
    loop {
        let end = skip_trivia_back(text, at);
        if !matches!(text[..end].last(), Some(b'(' | b'|' | b'&')) {
            return at as u32;
        }
        at = end - 1;
    }
}

/// Position of `implements` in the head of the interface whose name is at `name_pos`. `None` if
/// there is none, or if a second `extends` comes first: `checkGrammarInterfaceDeclaration` stops at
/// whichever comes first.
fn implements_in_interface_head(text: &[u8], name_pos: usize) -> Option<usize> {
    let mut at = word_end(text, name_pos);
    let (mut depth, mut seen_extends, mut previous) = (0usize, false, 0u8);
    loop {
        at = skip_trivia(text, at);
        let c = *text.get(at)?;
        match c {
            b'{' if depth == 0 => return None,
            b'<' | b'(' | b'[' | b'{' => depth += 1,
            b'>' if previous == b'=' => {}
            b'>' | b')' | b']' | b'}' => depth = depth.checked_sub(1)?,
            b'"' | b'\'' | b'`' => {
                at = end_of_string(text, at)?;
                previous = c;
                continue;
            }
            _ if !word_at(text, at).is_empty() => {
                let start = at;
                at += word_at(text, at).len();
                if depth == 0 && previous != b'.' {
                    match &text[start..at] {
                        b"implements" => return Some(start),
                        b"extends" if seen_extends => return None,
                        b"extends" => seen_extends = true,
                        _ => {}
                    }
                }
                previous = c;
                continue;
            }
            _ => {}
        }
        previous = c;
        at += 1;
    }
}

// ───────────────────────────── syntax ─────────────────────────────

/// `getArrayElementTypeNode`: `X` for `X[]`, `[...X[]]`, `[...[...X[]]]`.
pub(super) fn array_element_type_node(hir: &hir::File, node: TypeNodeId) -> Option<TypeNodeId> {
    if node.is_none() {
        return None;
    }
    match hir[node].kind {
        TypeNodeKind::Array(element) => Some(element),
        TypeNodeKind::Tuple(elems) if elems.len() == 1 && hir[elems.at(0)].has_dots => {
            rest_element_type_node(hir, &hir[elems.at(0)])
        }
        _ => None,
    }
}

/// `getArrayElementTypeNode(node.Type())` for an element that starts with `...`: a `RestType`, or a
/// `NamedTupleMember` with a `DotDotDotToken`. The type in `...name: ...T` is a `RestType`, that in
/// `...name: T?` an `OptionalType`.
pub(super) fn rest_element_type_node(hir: &hir::File, elem: &TupleElem) -> Option<TypeNodeId> {
    match elem.member_type {
        TupleMemberType::Plain => array_element_type_node(hir, elem.written),
        TupleMemberType::Rest | TupleMemberType::Optional => None,
    }
}

/// `getTupleElementFlags`. Of the elements without a name only those without `...` are optional.
fn tuple_element_flags(hir: &hir::File, elem: &TupleElem) -> ElemFlags {
    if elem.optional {
        ElemFlags::OPTIONAL
    } else if !elem.has_dots {
        ElemFlags::REQUIRED
    } else if rest_element_type_node(hir, elem).is_some() {
        ElemFlags::REST
    } else {
        ElemFlags::VARIADIC
    }
}

impl Checker<'_, '_> {
    pub(super) fn check_x_typenodes(&mut self, file: FileId) {
        let hir = self.hir(file);
        // The text of the default library is not stored.
        if hir.text.is_empty() {
            return;
        }
        let exprs = self.exprs_by_kind(file);
        self.check_instantiation_expressions(file, &exprs);
        self.check_instantiations_after_instanceof(file, &exprs);
    }

    // ───────────────────────────── tuple types ─────────────────────────────

    /// `checkTupleType`: 2574, 1265 1266 1257.
    pub(super) fn check_tuple_type(&mut self, file: FileId, elems: Span<TupleElemId>) {
        let hir = self.hir(file);
        // The text of the default library is not stored.
        if hir.text.is_empty() {
            return;
        }
        let (mut seen_optional, mut seen_rest) = (false, false);
        for e in elems.iter() {
            let elem = &hir[e];
            let mut flags = tuple_element_flags(hir, elem);
            if flags.contains(ElemFlags::VARIADIC) {
                let ty = self.type_from_node(file, elem.ty);
                if !self.is_array_like(ty) {
                    let at = (file, elem.start, self.end_of_tuple_elem(file, e));
                    self.error_at(at, 2574, &[]);
                    break;
                }
                if self.is_array(ty)
                    || matches!(self.data(ty), TypeData::Tuple { flags, .. } if flags.iter().any(|f| f.contains(ElemFlags::REST)))
                {
                    flags |= ElemFlags::REST;
                }
            }
            let code = if flags.contains(ElemFlags::REST) {
                if !std::mem::replace(&mut seen_rest, true) {
                    continue;
                }
                1265
            } else if flags.contains(ElemFlags::OPTIONAL) {
                seen_optional = true;
                if !seen_rest {
                    continue;
                }
                1266
            } else if flags.contains(ElemFlags::REQUIRED) && seen_optional {
                1257
            } else {
                continue;
            };
            let at = (file, elem.start, self.end_of_tuple_elem(file, e));
            self.grammar_error_at(at, code, &[]);
            break;
        }
    }

    /// `checkTemplateLiteralType` compares each placeholder with `templateConstraintType`: 2322.
    pub(super) fn check_template_literal_type(&mut self, file: FileId, types: IdList<TypeNodeId>) {
        let hir = self.hir(file);
        if hir.text.is_empty() {
            return;
        }
        let constraint = self.template_constraint_type();
        for placeholder in hir.ids(types) {
            let ty = self.type_from_node(file, placeholder);
            let start = start_of_type(hir, placeholder);
            let error_node = (
                file,
                start,
                self.end_of_type_node_from(file, placeholder, start),
            );
            self.check_type_assignable_to(ty, constraint, Some(error_node), None);
        }
    }

    // ───────────────────────────── instantiation depth ─────────────────────────────

    // ───────────────────────────── `infer`, `readonly`, `this`, `intrinsic` ─────────────────────────────

    /// `checkInferType`: 1338, 2838.
    pub(super) fn check_infer_type(&mut self, file: FileId, node: TypeNodeId, param: TypeParamId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let is_extends_type = |n: Node| {
            matches!(hir.data(hir.parent(n)), NodeData::Type(parent)
            if matches!(hir[parent].kind, TypeNodeKind::Cond { extends, .. } if hir.node(extends) == n))
        };
        if hir.find_ancestor(hir.node(node), is_extends_type).is_none() {
            let at = (file, hir[node].pos, self.end_of_type_node(file, node));
            self.grammar_error_at(at, 1338, &[]);
            return;
        }
        // Several occurrences of `infer T` declare one type parameter: reported once for all of
        // them (`typeParametersChecked`).
        let symbol = bound.type_param_symbol[param.idx()];
        if symbol.is_none() {
            return;
        }
        // The type of an index signature is bound twice, so a declaration in it is listed twice.
        let decls = &bound.symbols[symbol.idx()].decls;
        if decls.first() != Some(&Decl::TypeParam(param)) || decls.iter().all(|d| *d == decls[0]) {
            return;
        }
        // `areTypeParametersIdentical`
        let target = self.type_param(file, param);
        let Some(expected) = self.constraint_of_type_param(target) else {
            return;
        };
        let declarations = decls.iter().filter_map(|d| match *d {
            Decl::TypeParam(p) => Some(p),
            _ => None,
        });
        for p in declarations.clone() {
            if hir[p].constraint.is_none() {
                continue;
            }
            let own = self.type_from_node(file, hir[p].constraint);
            if !self.is_identical(own, expected) {
                for p in declarations {
                    let name = self.place_of_token(file, hir[p].pos);
                    self.error_at(name, 2838, &[Arg::Atom(hir[p].name)]);
                }
                return;
            }
        }
    }

    /// `checkGrammarTypeOperatorNode`
    pub(super) fn check_grammar_type_operator_node(&mut self, file: FileId, node: TypeNodeId) {
        let hir = self.hir(file);
        // The text of the default library is not stored.
        if hir.text.is_empty() {
            return;
        }
        if let TypeNodeKind::Unique(inner) = hir[node].kind {
            // `unique (symbol)` applies `unique` to a parenthesized type.
            let operand = skip_trivia(&hir.text, hir[node].pos as usize + b"unique".len()) as u32;
            let end = self.end_of_type_node_from(file, inner, operand);
            self.grammar_error_at((file, operand, end), 1005, &[Arg::Text("symbol")]);
            return;
        }
        if let TypeNodeKind::Readonly(inner) = hir[node].kind {
            // `readonly (string[])` applies `readonly` to a parenthesized type.
            let operand = skip_trivia(&hir.text, hir[node].pos as usize + b"readonly".len());
            if !matches!(
                hir[inner].kind,
                TypeNodeKind::Array(_) | TypeNodeKind::Tuple(_)
            ) || hir[inner].pos as usize != operand
            {
                self.grammar_error_at(self.place_of_token(file, hir[node].pos), 1354, &[]);
            }
            return;
        }
        // `WalkUpParenthesizedTypes(node.Parent)`: parentheses are not stored.
        let parent = hir.parent(hir.node(node));
        let (name, code) = match hir.data(parent) {
            NodeData::VarDecl(d) => {
                if !matches!(hir[hir[d].pat].kind, PatKind::Ident(_)) {
                    (None, 1333)
                // `isVariableDeclarationInVariableStatement`
                } else if hir.kind(hir.parent(hir.parent(parent))) != Kind::VariableStatement {
                    (None, 1334)
                // `NodeFlagsConst` is one of the two bits of `NodeFlagsAwaitUsing`.
                } else if !matches!(hir[d].kind, VarKind::Const | VarKind::AwaitUsing) {
                    (Some(self.place_of_token(file, hir[hir[d].pat].pos)), 1332)
                } else {
                    return;
                }
            }
            NodeData::Member(m) if hir[m].kind == MemberKind::Property => {
                let (needs, code) = match self.bound(file).member_owner[m.idx()] {
                    MemberOwner::Class(_) => (Flags::STATIC | Flags::READONLY, 1331),
                    _ => (Flags::READONLY, 1330),
                };
                if hir[m].flags.contains(needs) {
                    return;
                }
                (
                    Some((file, hir[m].name_pos, self.end_of_member_name(file, m))),
                    code,
                )
            }
            _ => (None, 1335),
        };
        let at = name.unwrap_or_else(|| (file, hir[node].pos, self.end_of_type_node(file, node)));
        self.grammar_error_at(at, code, &[]);
    }

    /// `checkTypeAliasDeclaration`: 2795.
    pub(super) fn check_intrinsic_alias(&mut self, file: FileId, alias: AliasId) {
        let hir = self.hir(file);
        let alias = &hir[alias];
        if hir.text.is_empty()
            || alias.ty.is_none()
            || !matches!(
                hir[alias.ty].kind,
                TypeNodeKind::Keyword(Keyword::Intrinsic)
            )
        {
            return;
        }
        // It is a keyword only directly after the `=`: in parentheses it is an ordinary name.
        let start = hir[alias.ty].pos;
        if !hir.text[..skip_trivia_back(&hir.text, start as usize)].ends_with(b"=") {
            return;
        }
        let name = self.atoms().bytes(alias.name);
        let is_provided = match alias.type_params.len() {
            0 => name == b"BuiltinIteratorReturn",
            1 => matches!(
                name,
                b"Uppercase" | b"Lowercase" | b"Capitalize" | b"Uncapitalize" | b"NoInfer"
            ),
            _ => false,
        };
        if !is_provided {
            self.error_at(self.place_of_token(file, start), 2795, &[]);
        }
    }

    // ───────────────────────────── members ─────────────────────────────

    /// `checkGrammarIndexSignatureParameters`, starting at the check of the parameter's type: 1337
    /// 1268 1021.
    pub(super) fn check_grammar_index_signature_parameters(&mut self, file: FileId, m: MemberId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if has_parse_diagnostics(hir) {
            return;
        }
        let member = &hir[m];
        if member.kind != MemberKind::IndexSignature
            || member.func.is_none()
            || matches!(bound.member_owner[m.idx()], MemberOwner::None)
        {
            return;
        }
        let func = &hir[member.func];
        // `checkGrammarModifiers` runs first, and if it reports an error nothing else is reported.
        if self.grammar_error_in_modifiers(file, m).is_some() || func.params.len() != 1 {
            return;
        }
        // A parameter that is not exactly `name: type` has already been reported.
        let param = &hir[func.params.at(0)];
        if !param.flags.is_empty() || param.default.is_some() || param.ty.is_none() {
            return;
        }
        let keys = self.type_from_node(file, param.ty);
        // `TypeFlagsStringOrNumberLiteralOrUnique`. An enum is the union of its members, whatever else is in it.
        let mut is_literal = false;
        for &t in self.parts(keys) {
            is_literal |= match *self.data(t) {
                TypeData::StringLit { .. }
                | TypeData::NumberLit { .. }
                | TypeData::EnumLit { .. }
                | TypeData::UniqueSymbol { .. } => true,
                TypeData::Enum { symbol: of, .. } => {
                    self.files().exports(of).into_iter().any(|(_, member)| {
                        let ty = if self.files().flags(member).contains(SymFlags::ENUM_MEMBER) {
                            self.enum_member_type(member)
                        } else {
                            TypeId::NEVER
                        };
                        matches!(self.data(ty), TypeData::EnumLit { .. })
                    })
                }
                _ => false,
            };
        }
        let name = hir[param.pat].pos;
        if is_literal || self.is_generic(keys) {
            self.error_at(self.place_of_token(file, name), 1337, &[]);
        } else if !self
            .parts(keys)
            .iter()
            .all(|&t| self.is_valid_index_key_type(t))
            || keys.is_never()
        {
            self.error_at(self.place_of_token(file, name), 1268, &[]);
        } else if member.ty.is_none() {
            self.error_at((file, member.start, member.loc.end), 1021, &[]);
        }
    }

    /// `checkPropertySignature`, `checkMethodDeclaration`: 18016 for a signature with a private name. A property signature is always
    /// an error, a method signature only outside every class, an accessor signature never.
    pub(super) fn check_private_name_in_signature(&mut self, file: FileId, m: MemberId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let member = &hir[m];
        // Outside every class the front end gives a private name no key (`getDeclarationName`), so
        // the source text decides.
        let is_private = match member.key {
            PropKey::Private(_) => true,
            PropKey::None => is_private_name_at(hir, member.name_pos),
            _ => false,
        };
        if !is_private
            || !matches!(
                bound.member_owner[m.idx()],
                MemberOwner::Interface(_) | MemberOwner::TypeLiteral(_)
            )
        {
            return;
        }
        match member.kind {
            MemberKind::Property => {
                self.error_at(self.place_of_token(file, member.name_pos), 18016, &[]);
            }
            // `GetErrorRangeForNode` has no case for a method signature: the error starts at the first modifier.
            MemberKind::Method if !self.is_signature_inside_a_class(file, m) => {
                self.error_at((file, member.start, member.loc.end), 18016, &[]);
            }
            _ => {}
        }
    }

    /// `checkGrammarInterfaceDeclaration`: 1176.
    pub(super) fn check_grammar_interface_declaration(&mut self, file: FileId, i: InterfaceId) {
        let hir = self.hir(file);
        if has_parse_diagnostics(hir) {
            return;
        }
        let interface = &hir[i];
        let Some(keyword) = implements_in_interface_head(&hir.text, interface.name_pos as usize)
        else {
            return;
        };
        // `checkGrammarModifiers` runs first, and if it reports an error nothing else is reported.
        if self
            .grammar_error_in_modifiers(file, interface.stmt)
            .is_none()
        {
            self.error_at(self.place_of_token(file, keyword as u32), 1176, &[]);
        }
    }

    // ───────────────────────────── instantiation expressions ─────────────────────────────

    /// `checkExpressionWithTypeArguments` for an `f<T>` that is not called: 1009, 2848 for `a
    /// instanceof B<T>`, 2635.
    fn check_instantiation_expressions(&mut self, file: FileId, exprs: &ExprsByKind) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for i in exprs.of(ExprTag::Instantiation).iter().map(|e| e.idx()) {
            let ExprKind::Instantiation { expr, .. } = hir.exprs[i].kind else {
                continue;
            };
            if bound.is_unchecked(i) {
                continue;
            }
            // Parentheses are not stored, so its direct parent is the result of
            // `WalkUpParenthesizedExpressions`.
            if matches!(bound.expr_parent[i], Parent::Expr(p) if matches!(hir[p].kind, ExprKind::Binary { op: BinOp::Instanceof, right, .. } if right.idx() == i))
            {
                let end = self.end_inside_parentheses(file, ExprId(i as u32));
                self.error_at((file, self.start_of(file, expr), end), 2848, &[]);
            }
        }
    }

    /// The same where the type arguments were not stored, because the list is empty or the parser
    /// bailed out: 2848. They are searched for after the name.
    fn check_instantiations_after_instanceof(&mut self, file: FileId, exprs: &ExprsByKind) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let text: &[u8] = &hir.text;
        for i in exprs.of(ExprTag::Binary).iter().map(|e| e.idx()) {
            let ExprKind::Binary {
                op: BinOp::Instanceof,
                right,
                ..
            } = hir.exprs[i].kind
            else {
                continue;
            };
            if bound.is_unchecked(i) {
                continue;
            }
            let (name, name_pos) = match hir[right].kind {
                ExprKind::Ident(name) => (name, hir[right].pos),
                ExprKind::Dot { name, name_pos, .. } => (name, name_pos),
                _ => continue,
            };
            let after = skip_trivia(text, name_pos as usize + self.atoms().bytes(name).len());
            if text.get(after) != Some(&b'<') || matches!(text.get(after + 1), Some(b'<' | b'=')) {
                continue;
            }
            // `a instanceof B < c` is a comparison. Within its own parentheses, the name would not
            // be the only content.
            let is_in_parentheses = is_parenthesized(hir, right);
            let is_compared = matches!(bound.expr_parent[i], Parent::Expr(p) if matches!(hir[p].kind, ExprKind::Binary { op: BinOp::Lt, left, .. } if left.idx() == i));
            if is_in_parentheses || !is_compared {
                let start = self.start_inside_parentheses(file, right);
                let end =
                    end_of_type_arguments(text, after + 1).map_or(0, |close| close as u32 + 1);
                self.error_at((file, start, end), 2848, &[]);
            }
        }
    }

    // ───────────────────────────── `T[K]`, `a[k]` ─────────────────────────────

    /// `checkIndexedAccessType`
    pub(super) fn check_indexed_access_type(&mut self, file: FileId, node: TypeNodeId) {
        // The text of the default library is not stored.
        if self.hir(file).text.is_empty() {
            return;
        }
        // `getTypeFromIndexedAccessTypeNode`, which comes before `getConditionalFlowTypeOfType`.
        let whole = self.type_from_node(file, node);
        let whole = match *self.data(whole) {
            TypeData::Substitution { base, .. } => base,
            _ => whole,
        };
        let access_node = (
            file,
            self.hir(file)[node].pos,
            self.end_of_type_node(file, node),
        );
        self.check_indexed_access_index_type(whole, access_node, None);
    }

    /// `checkIndexedAccessIndexType` for a deferred indexed access type `object[keys]`: the error code (4105 or 2536) if `keys` cannot
    /// index `object`.
    pub(super) fn why_not_a_key_of(&mut self, object: TypeId, keys: TypeId) -> Option<u32> {
        let object_keys = self.keys_to_look_into(object);
        let has_number_index = self.index_type_of_type(object, TypeId::NUMBER).is_some();
        let fits = self.parts(keys).iter().all(|&key| {
            self.is_assignable(key, object_keys)
                || has_number_index && self.is_applicable_index_type(key, TypeId::NUMBER)
        });
        if fits {
            return None;
        }
        if self.is_generic_object_type(object)
            && let Some(name) = self.property_name_of_type(keys)
        {
            // `getConstituentProperty`
            let apparent = self.apparent_type(object);
            for &part in self.parts(apparent) {
                let part = self.apparent_type(part);
                if let Some((prop, _)) = self.prop_ref(part, name) {
                    if prop
                        .flags
                        .intersects(PropFlags::PRIVATE | PropFlags::PROTECTED)
                    {
                        return Some(4105);
                    }
                    break;
                }
            }
        }
        Some(2536)
    }

    /// `objectIndexType` of `checkIndexedAccessIndexType`: "skip index type deferral on remapping
    /// mapped types"
    fn keys_to_look_into(&mut self, object: TypeId) -> TypeId {
        if self.is_generic_mapped_type(object)
            && let Some(name_type) = self.mapped_name_type(object)
        {
            // `MappedTypeNameTypeKindRemapping`
            let param = self.mapped_type_param(object);
            if !self.is_assignable(name_type, param) {
                return self.get_index_type_for_mapped_type(object, IndexFlags::empty());
            }
        }
        self.keyof(object)
    }
}
