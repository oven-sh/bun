//! Errors about `a.b` and `a[k]`: `a` may be null, `b` does not exist, or `b` is not accessible at
//! that location. The last two also apply to the properties a binding pattern destructures, and the
//! second to indexed access types.
//!
//! Follows `checkPropertyAccessExpressionOrQualifiedName`, `reportNonexistentProperty`,
//! `checkPropertyAccessibilityAtLocation`, `checkElementAccessExpression`,
//! `getPropertyTypeForIndexType`, and `checkVariableLikeDeclaration` with
//! `getBindingElementTypeFromParentType` for binding elements, of TypeScript 7.0.2's checker.go.

use super::enclosing_declaration::Enclosing;
use super::errors::is_close;
use super::errors_names_and_exports::fully_qualified_name;
use super::explain::Line;
use super::sink::held;
use super::*;
use crate::bind::{Decl, FnOwner, MemberOwner, Parent, PatParent, ScopeId};
use bun_core::strings;
use smallvec::SmallVec;

/// The properties each version of the standard library added to one of its types: `(lib,
/// properties)`.
type Features = &'static [(&'static str, &'static [&'static str])];

#[rustfmt::skip]
const TYPED_ARRAY_FEATURES: Features = &[
    ("es2022", &["at"]),
    ("es2023", &["findLastIndex", "findLast", "toReversed", "toSorted", "toSpliced", "with"]),
];

/// The standard library properties introduced by each version, keyed by type. `getFeatureMap`
#[rustfmt::skip]
const LIBRARY_FEATURES: &[(&str, Features)] = &[
    ("Array", &[
        ("es2015", &["find", "findIndex", "fill", "copyWithin", "entries", "keys", "values"]),
        ("es2016", &["includes"]),
        ("es2019", &["flat", "flatMap"]),
        ("es2022", &["at"]),
        ("es2023", &["findLastIndex", "findLast", "toReversed", "toSorted", "toSpliced", "with"]),
    ]),
    ("ArrayBuffer", &[
        ("es2024", &["maxByteLength", "resizable", "resize", "detached", "transfer", "transferToFixedLength"]),
    ]),
    ("Atomics", &[
        ("es2017", &[
            "add", "and", "compareExchange", "exchange", "isLockFree", "load", "or", "store", "sub", "wait", "notify", "xor",
        ]),
        ("es2024", &["waitAsync"]),
    ]),
    ("SharedArrayBuffer", &[
        ("es2017", &["byteLength", "slice"]),
        ("es2024", &["growable", "maxByteLength", "grow"]),
    ]),
    ("RegExp", &[
        ("es2015", &["flags", "sticky", "unicode"]),
        ("es2018", &["dotAll"]),
        ("es2024", &["unicodeSets"]),
    ]),
    ("RegExpConstructor", &[("es2025", &["escape"])]),
    ("Reflect", &[
        ("es2015", &[
            "apply", "construct", "defineProperty", "deleteProperty", "get", "getOwnPropertyDescriptor", "getPrototypeOf", "has",
            "isExtensible", "ownKeys", "preventExtensions", "set", "setPrototypeOf",
        ]),
    ]),
    ("ArrayConstructor", &[
        ("es2015", &["from", "of"]),
        ("esnext", &["fromAsync"]),
    ]),
    ("ObjectConstructor", &[
        ("es2015", &["assign", "getOwnPropertySymbols", "keys", "is", "setPrototypeOf"]),
        ("es2017", &["values", "entries", "getOwnPropertyDescriptors"]),
        ("es2019", &["fromEntries"]),
        ("es2022", &["hasOwn"]),
        ("es2024", &["groupBy"]),
    ]),
    ("NumberConstructor", &[
        ("es2015", &["isFinite", "isInteger", "isNaN", "isSafeInteger", "parseFloat", "parseInt"]),
    ]),
    ("Math", &[
        ("es2015", &[
            "clz32", "imul", "sign", "log10", "log2", "log1p", "expm1", "cosh", "sinh", "tanh", "acosh", "asinh", "atanh", "hypot",
            "trunc", "fround", "cbrt",
        ]),
        ("es2025", &["f16round"]),
    ]),
    ("Map", &[
        ("es2015", &["entries", "keys", "values"]),
        ("esnext", &["getOrInsert", "getOrInsertComputed"]),
    ]),
    ("MapConstructor", &[("es2024", &["groupBy"])]),
    ("Set", &[
        ("es2015", &["entries", "keys", "values"]),
        ("es2025", &[
            "union", "intersection", "difference", "symmetricDifference", "isSubsetOf", "isSupersetOf", "isDisjointFrom",
        ]),
    ]),
    ("PromiseConstructor", &[
        ("es2015", &["all", "race", "reject", "resolve"]),
        ("es2020", &["allSettled"]),
        ("es2021", &["any"]),
        ("es2024", &["withResolvers"]),
        ("es2025", &["try"]),
    ]),
    ("Symbol", &[
        ("es2015", &["for", "keyFor"]),
        ("es2019", &["description"]),
    ]),
    ("WeakMap", &[("esnext", &["getOrInsert", "getOrInsertComputed"])]),
    ("String", &[
        ("es2015", &[
            "codePointAt", "includes", "endsWith", "normalize", "repeat", "startsWith", "anchor", "big", "blink", "bold", "fixed",
            "fontcolor", "fontsize", "italics", "link", "small", "strike", "sub", "sup",
        ]),
        ("es2017", &["padStart", "padEnd"]),
        ("es2019", &["trimStart", "trimEnd", "trimLeft", "trimRight"]),
        ("es2020", &["matchAll"]),
        ("es2021", &["replaceAll"]),
        ("es2022", &["at"]),
        ("es2024", &["isWellFormed", "toWellFormed"]),
    ]),
    ("StringConstructor", &[("es2015", &["fromCodePoint", "raw"])]),
    ("DateTimeFormat", &[("es2017", &["formatToParts"])]),
    ("Promise", &[("es2018", &["finally"])]),
    ("RegExpMatchArray", &[("es2018", &["groups"])]),
    ("RegExpExecArray", &[("es2018", &["groups"])]),
    ("Intl", &[
        ("es2018", &["PluralRules"]),
        ("es2020", &["RelativeTimeFormat", "Locale", "DisplayNames"]),
        ("es2021", &["ListFormat", "DateTimeFormat"]),
        ("es2022", &["Segmenter"]),
        ("es2025", &["DurationFormat"]),
    ]),
    ("NumberFormat", &[("es2018", &["formatToParts"])]),
    ("SymbolConstructor", &[
        ("es2020", &["matchAll"]),
        ("esnext", &["metadata", "dispose", "asyncDispose"]),
    ]),
    ("DataView", &[
        ("es2020", &["setBigInt64", "setBigUint64", "getBigInt64", "getBigUint64"]),
        ("es2025", &["setFloat16", "getFloat16"]),
    ]),
    ("RelativeTimeFormat", &[("es2020", &["format", "formatToParts", "resolvedOptions"])]),
    ("Int8Array", TYPED_ARRAY_FEATURES),
    ("Uint8Array", TYPED_ARRAY_FEATURES),
    ("Uint8ClampedArray", TYPED_ARRAY_FEATURES),
    ("Int16Array", TYPED_ARRAY_FEATURES),
    ("Uint16Array", TYPED_ARRAY_FEATURES),
    ("Int32Array", TYPED_ARRAY_FEATURES),
    ("Uint32Array", TYPED_ARRAY_FEATURES),
    ("Float32Array", TYPED_ARRAY_FEATURES),
    ("Float64Array", TYPED_ARRAY_FEATURES),
    ("BigInt64Array", TYPED_ARRAY_FEATURES),
    ("BigUint64Array", TYPED_ARRAY_FEATURES),
    ("Error", &[("es2022", &["cause"])]),
    ("ErrorConstructor", &[("esnext", &["isError"])]),
    ("Uint8ArrayConstructor", &[("esnext", &["fromBase64", "fromHex"])]),
    ("Date", &[("esnext", &["toTemporalInstant"])]),
];

impl Checker<'_, '_> {
    /// `a[k]`, property lookups by binding patterns and indexed access types, and misplaced private
    /// names. Errors in `a.b` are reported where its type is computed (`type_of_property_access`).
    pub(super) fn check_property_accesses(&mut self, file: FileId) {
        self.check_private_names(file);
    }

    /// `checkAndReportErrorForExtendingInterface`
    pub(super) fn check_and_report_error_for_extending_interface(
        &mut self,
        file: FileId,
        e: ExprId,
    ) -> bool {
        if !self.is_extending_interface(file, e) {
            return false;
        }
        let name = self.entity_name_around(file, e);
        let node = (file, self.start_of(file, e), self.end_of_expr(file, e));
        self.error_at(node, 2689, &[Arg::Bytes(&name)]);
        true
    }

    /// `getEntityNameForExtendingInterface`: the source text of the whole entity name that `e` is,
    /// or is a left part of.
    pub(super) fn entity_name_around(&self, file: FileId, e: ExprId) -> Vec<u8> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut top = e;
        while let Parent::Expr(parent) = bound.expr_parent[top.idx()]
            && parent.is_some()
            && matches!(hir[parent].kind, ExprKind::Dot { .. })
        {
            top = parent;
        }
        self.source_text(file, self.start_of(file, top), self.end_of_expr(file, top))
    }

    /// `DeclarationNameToString` of the name at `pos`.
    pub(super) fn declaration_name_at(&self, file: FileId, pos: u32) -> Vec<u8> {
        self.source_text(file, pos, self.end_of_name_at(file, pos))
    }

    /// The name of a property whose declaration cannot be read: a `#x` as in the source,
    /// `[Symbol.iterator]` for a symbol-named property.
    fn name_of_unread_property(&self, name: Atom) -> Vec<u8> {
        let bytes = self.atoms().bytes(name);
        let Some(symbol) = bytes.strip_prefix(crate::atom::SYMBOL_NAME_PREFIX) else {
            return as_written(bytes).to_vec();
        };
        match strings::index_of_char_usize(symbol, b'@') {
            Some(at) => cat!(b"[", symbol[..at], b"]"),
            None => cat!(b"[Symbol.", symbol, b"]"),
        }
    }

    /// Misplaced private names: 18016 1451 (`checkGrammarPrivateIdentifierExpression`), 18012
    /// (`checkPrivateIdentifier` of binder.go), 18024 (`checkEnumMember`).
    /// A bare `#x` is an `ExprKind::String` whose source text starts with `#`.
    fn check_private_names(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // Empty for a declaration file.
        let text = &hir.text[..];
        // `checkEnumMember`: a plain error.
        for (i, member) in hir.enum_members.iter().enumerate() {
            if bound.enum_member_owner[i].is_some() && is_private_name_at(hir, member.pos) {
                self.error_at((file, member.pos, 0), 18024, &[]);
            }
        }
        // The rest are grammar errors, and the binder also reports nothing in a file with parse diagnostics.
        if has_parse_diagnostics(hir) {
            return;
        }
        for (i, member) in hir.members.iter().enumerate() {
            if !matches!(bound.member_owner[i], MemberOwner::None)
                && is_private_constructor_name(text, member.name_pos)
            {
                self.error_at((file, member.name_pos, 0), 18012, &[]);
            }
        }
        let index = self.exprs_by_kind(file);
        for &e in index.of(ExprTag::Dot) {
            let ExprKind::Dot { name_pos, .. } = hir[e].kind else {
                continue;
            };
            if is_private_name_at(hir, name_pos)
                && !bound.is_unchecked(e.idx())
                && is_private_constructor_name(text, name_pos)
            {
                self.error_at((file, name_pos, 0), 18012, &[]);
            }
        }
        for &e in index.of(ExprTag::String) {
            let (parent, pos) = (bound.expr_parent[e.idx()], hir[e].pos);
            if !is_private_name_at(hir, pos) || bound.is_unchecked(e.idx()) {
                continue;
            }
            // JSX text may start with `#`.
            if matches!(parent, Parent::Expr(owner) if owner.is_some() && matches!(hir[owner].kind, ExprKind::Jsx(_)))
            {
                continue;
            }
            if is_private_constructor_name(text, pos) {
                self.error_at((file, pos, 0), 18012, &[]);
            }
            if self.enclosing_classes(file, e).is_empty() {
                self.error_at((file, pos, 0), 18016, &[]);
                continue;
            }
            // Parentheses count as a separate parent node.
            let is_allowed = !is_parenthesized(self.hir(file), e)
                && match parent {
                    // `IsExpressionNode`: only as the left operand of `in`.
                    Parent::Expr(owner) if owner.is_some() => {
                        matches!(hir[owner].kind, ExprKind::Binary { op: BinOp::In, left, .. } if left == e)
                    }
                    // `IsForInStatement(privId.Parent)`: the statement reports 2406 itself.
                    Parent::Stmt(s) if s.is_some() => match hir[s].kind {
                        StmtKind::ForIn { .. } => true,
                        StmtKind::Expr(_) => {
                            matches!(bound.stmt_parent[s.idx()], Parent::Stmt(outer)
                                    if outer.is_some() && matches!(hir[outer].kind, StmtKind::ForIn { left, .. } if left == s))
                        }
                        _ => false,
                    },
                    _ => false,
                };
            if !is_allowed {
                self.error_at((file, pos, 0), 1451, &[]);
            }
        }
    }

    /// `place_of_expr`
    pub(super) fn place_inside_parentheses(&self, file: FileId, e: ExprId) -> (FileId, u32, u32) {
        self.place_of_expr(file, e)
    }

    /// `getPropertyTypeForIndexType`: the `noImplicitAny` errors for `a[k]` at `e` when the lookup
    /// finds nothing: 2576 7015 2551 7052 7053. `keys`: `indexType` and `fullIndexType`.
    pub(super) fn report_implicit_any_element(
        &mut self,
        (file, e): (FileId, ExprId),
        object: TypeId,
        (key, keys): (TypeId, TypeId),
        name: Option<Atom>,
    ) {
        let ExprKind::Index { obj, index, .. } = self.hir(file)[e].kind else {
            return;
        };
        let at_access = self.place_inside_parentheses(file, e);
        let at_index = self.span_of_parenthesized_expr(file, index);
        let is_target = self.is_assignment_target(file, e);
        if let Some(name) = name
            && self.static_side_has(object, name)
        {
            let container = self.type_to_string(object);
            let member = cat!(
                container,
                b"[",
                self.source_text(file, at_index.1, at_index.2),
                b"]"
            );
            let args = [Arg::Atom(name), Arg::Bytes(&container), Arg::Bytes(&member)];
            self.error_at(at_access, 2576, &args);
        } else if self.index_type_of_type(object, TypeId::NUMBER).is_some() {
            self.error_at(at_index, 7015, &[]);
        } else if let Some(name) = name
            && let Some(suggestion) =
                self.spelling_suggestion_for_property(object, name, None, true)
        {
            let suggestion = self.name_of_unread_property(suggestion);
            let args = [Arg::Atom(name), Arg::Type(object), Arg::Bytes(&suggestion)];
            self.error_at(at_index, 2551, &args);
        } else if self.has_accessor_method_for(object, key, is_target) {
            let method: &[u8] = if is_target { b"set" } else { b"get" };
            let call = match self.access_to_string(file, obj) {
                Some(receiver) => cat!(receiver, b".", method),
                None => method.to_vec(),
            };
            self.error_at(at_access, 7052, &[Arg::Type(object), Arg::Bytes(&call)]);
        } else {
            let under = (self.lines_under_implicit_any_element(file, object, key)).pop();
            let under = under.map(|line| Reported::new(at_access, line.code, line.args));
            let args = [Arg::Type(keys), Arg::Type(object)];
            let diagnostic = self.new_diagnostic_chain(under, at_access, 7053, &args);
            self.add_diagnostic(diagnostic);
        }
    }

    /// The messages `getPropertyTypeForIndexType` chains under 7053.
    fn lines_under_implicit_any_element(
        &mut self,
        file: FileId,
        object: TypeId,
        key: TypeId,
    ) -> Vec<Line> {
        let (code, first) = match *self.data(key) {
            TypeData::EnumLit { .. } => (2339, cat!(b"[", self.type_to_string(key), b"]")),
            TypeData::UniqueSymbol { symbol, name } => {
                // `getFullyQualifiedName` of the symbol, as seen from the access.
                let at = Some(Enclosing::at_scope(file, ScopeId(0)));
                let parent = match symbol {
                    UniqueSymbolDeclaration::Variable(variable) => {
                        self.files().symbol_parent(variable)
                    }
                    UniqueSymbolDeclaration::Member(file, member) => {
                        self.symbol_of_member_owner(file, member)
                    }
                    UniqueSymbolDeclaration::SymbolConstructor => {
                        self.global_type_symbol(known::SymbolConstructor)
                    }
                };
                let name = self.atom_text(name);
                (
                    2339,
                    match parent {
                        Some(parent) => cat!(
                            b"[",
                            fully_qualified_name(self, parent, at),
                            b".",
                            name,
                            b"]"
                        ),
                        None => cat!(b"[", name, b"]"),
                    },
                )
            }
            TypeData::StringLit { .. } | TypeData::NumberLit { .. } => {
                match self.property_name_of_type(key) {
                    Some(name) => (2339, self.atom_text(name)),
                    None => return Vec::new(),
                }
            }
            _ if key == TypeId::STRING || key == TypeId::NUMBER => (7054, self.type_to_string(key)),
            _ => return Vec::new(),
        };
        vec![Line {
            code,
            args: held(vec![first, self.type_to_string(object)]),
            level: 1,
        }]
    }

    /// `tryGetPropertyAccessOrIdentifierToString`
    fn access_to_string(&self, file: FileId, e: ExprId) -> Option<Vec<u8>> {
        if is_parenthesized(self.hir(file), e) {
            return None;
        }
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Ident(name) => Some(self.atom_text(name)),
            ExprKind::Dot { obj, name, .. } => {
                let receiver = self.access_to_string(file, obj)?;
                Some(cat!(receiver, b".", self.atoms().bytes(name)))
            }
            // `IsPropertyName`
            ExprKind::Index { obj, index, .. } if !is_parenthesized(self.hir(file), index) => {
                let receiver = self.access_to_string(file, obj)?;
                let name = match hir[index].kind {
                    ExprKind::Ident(name) | ExprKind::String(name) => self.atom_text(name),
                    ExprKind::Number(n) => crate::atom::number_to_string(hir.numbers[n as usize]),
                    _ => return None,
                };
                Some(cat!(receiver, b".", name))
            }
            _ => None,
        }
    }

    /// `getReducedApparentType`
    pub(super) fn reduced_apparent_type(&mut self, ty: TypeId) -> TypeId {
        let ty = self.reduced(ty);
        let apparent = self.apparent_type(ty);
        if !self.never_in_progress.is_empty() {
            self.reduce_apparent_type_of_intersection_in_progress(apparent);
        }
        self.reduced(apparent)
    }

    /// Whether `name` is a global `let`, `const`, class or enum (`SymbolFlagsBlockScoped`): those
    /// are not properties of `globalThis`.
    pub(super) fn is_block_scoped_global(&self, name: Atom) -> bool {
        self.files().globals.get(name).is_some_and(|&global| {
            self.files()
                .flags(global)
                .intersects(SymFlags::BLOCK_SCOPED_VARIABLE | SymFlags::CLASS | SymFlags::ENUM)
        })
    }

    /// `getIndexInfosOfType`: the key type of each index signature of `ty`, which is an apparent
    /// type, and whether it is readonly.
    pub(super) fn index_signatures_of(&mut self, ty: TypeId) -> SmallVec<[(TypeId, bool); 4]> {
        let parts = self.parts(ty);
        (self.union_index_infos(parts).iter())
            .map(|info| (info.key, info.readonly))
            .collect()
    }

    /// `getApplicableIndexInfo` among `infos`, or else the string index signature, which is the
    /// fallback where none applies: its key type, and whether it is readonly.
    /// `findApplicableIndexInfo`: the string index signature counts only where no other applies,
    /// and several applicable signatures are combined into one with the key type `unknown`,
    /// readonly if all of them are.
    fn index_signature_for_key(
        &mut self,
        infos: &[(TypeId, bool)],
        key: TypeId,
    ) -> Option<(TypeId, bool)> {
        let mut found: Option<(TypeId, bool)> = None;
        for &(to, is_readonly) in infos {
            if to != TypeId::STRING && self.is_applicable_index_type(key, to) {
                found = Some(match found {
                    None => (to, is_readonly),
                    Some((_, are_readonly)) => (TypeId::UNKNOWN, are_readonly && is_readonly),
                });
            }
        }
        found.or_else(|| infos.iter().copied().find(|info| info.0 == TypeId::STRING))
    }

    /// `getApplicableIndexInfoForName(ty, name).isReadonly`
    pub(super) fn is_index_info_for_name_readonly(&mut self, ty: TypeId, name: Atom) -> bool {
        let infos = self.index_signatures_of(ty);
        let key = self.string_literal(name, false);
        self.index_signature_for_key(&infos, key)
            .is_some_and(|(_, is_readonly)| is_readonly)
    }

    /// `isForInVariableForNumericPropertyNames`: `i` in `for (i in a) a[i]`, where `a` has numeric
    /// property names.
    pub(super) fn is_for_in_variable_for_numeric_names(
        &mut self,
        file: FileId,
        index: ExprId,
    ) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let ExprKind::Ident(_) = hir[index].kind else {
            return false;
        };
        let symbol = bound.expr_symbol[index.idx()];
        if symbol.is_none() {
            return false;
        }
        let (mut child, mut node) = (hir.child(index), hir.parent(hir.child(index)));
        while node.is_some() {
            if let NodeData::Stmt(s) = hir.data(node)
                && let StmtKind::ForIn { left, expr, body } = hir[s].kind
                && child == hir.node(body)
            {
                // `getForInVariableSymbol`
                let variable = match hir[left].kind {
                    StmtKind::Var(decls) => decls
                        .iter()
                        .next()
                        .map(|d| bound.pat_symbol[hir[d].pat.idx()]),
                    StmtKind::Expr(x) if matches!(hir[x].kind, ExprKind::Ident(_)) => {
                        Some(bound.expr_symbol[x.idx()])
                    }
                    _ => None,
                };
                if variable == Some(symbol) {
                    // `hasNumericPropertyNames`: its only index signature is a number index
                    // signature.
                    let over = self.get_type_of_expression(file, expr);
                    let over = self.reduced_apparent_type(over);
                    if matches!(self.index_signatures_of(over)[..], [(TypeId::NUMBER, _)]) {
                        return true;
                    }
                }
            }
            (child, node) = (node, hir.parent(node));
        }
        false
    }

    /// `typeHasStaticProperty`
    fn static_side_has(&mut self, instance: TypeId, name: Atom) -> bool {
        let TypeData::Ref { target, .. } = *self.data(instance) else {
            return false;
        };
        if !self.files().flags(target).contains(SymFlags::CLASS) {
            return false;
        }
        let statics = self.type_of_symbol(target);
        // `prototype`, and what a namespace merged with the class exports, are not declared `static`.
        self.prop_ref(statics, name).is_some_and(|(prop, _)| {
            matches!(
                self.value_declaration_of_prop(prop),
                Some((_, Decl::Member(_)))
            )
        })
    }

    /// The suggested property. `closest`: the one `GetSpellingSuggestion` selects, rather than the
    /// first acceptable candidate.
    fn spelling_suggestion_for_property(
        &mut self,
        object: TypeId,
        name: Atom,
        access: Option<(FileId, ExprId)>,
        closest: bool,
    ) -> Option<Atom> {
        let text = as_written(self.atoms().bytes(name));
        let access = access.and_then(|(file, e)| match self.hir(file)[e].kind {
            ExprKind::Dot { obj, chain, .. } => Some((file, e, obj, chain)),
            _ => None,
        });
        let mut candidates: Vec<(((u8, (bool, u32, u32)), &[u8]), Atom)> = Vec::new();
        // `getPropertiesOfUnionOrIntersectionType`: for a union, the properties all its members
        // have, which are a subset of those of the first member. A member with index signatures may
        // cover through them a property that only the next member declares.
        for &member in self.parts(object) {
            let member = self.apparent_type(member);
            let Some(members) = self.members(member) else {
                break;
            };
            for prop in &members.shape().props {
                let candidate = as_written(self.atoms().bytes(prop.name));
                if candidate.starts_with(crate::atom::SYMBOL_NAME_PREFIX)
                    || !is_close(text, candidate)
                    || self.is_union(object)
                        && !self.get_property_of_type(object, prop.name).is_some()
                {
                    continue;
                }
                let is_within_reach = match access {
                    None => true,
                    Some((file, e, obj, chain)) => {
                        // `isPropertyAccessible`: a `#x` is accessible inside the class that
                        // declares it, and not in an optional chain.
                        let is_private_name = matches!(self.value_declaration_of_prop(prop), Some((f, Decl::Member(m)))
                            if matches!(self.hir(f)[m].key, PropKey::Private(_)));
                        if is_private_name {
                            chain == Chain::No
                                && self.declaring_class(prop).is_some_and(|class| {
                                    self.enclosing_classes(file, e)
                                        .into_iter()
                                        .any(|c| self.class_sym(file, c) == class)
                                })
                        } else {
                            let is_super = matches!(self.hir(file)[obj].kind, ExprKind::Super);
                            self.check_property_accessibility_at_location(
                                file,
                                self.hir(file).node(e),
                                Parent::Expr(e),
                                is_super,
                                false,
                                object,
                                prop.name,
                                None,
                            )
                        }
                    }
                };
                if !is_within_reach {
                    continue;
                }
                if !closest {
                    return Some(prop.name);
                }
                // `compareSymbols` breaks ties between equally close candidates.
                candidates.push(((self.order_of_property(prop), candidate), prop.name));
            }
            if members.shape().index.is_empty() {
                break;
            }
        }
        get_spelling_suggestion(text, candidates.iter(), |c| c.0.1, |a, b| a.0.cmp(&b.0))
            .map(|found| found.1)
    }

    /// `GetErrorRangeForNode(suggestion.ValueDeclaration)` for the property `suggestion` of `object`.
    /// `createUnionOrIntersectionProperty`: a property with different declarations in the members
    /// of a union has no such declaration.
    fn span_of_suggested_property(
        &mut self,
        object: TypeId,
        suggestion: Atom,
    ) -> Option<(FileId, u32, u32)> {
        let mut declared = None;
        for &member in self.parts(object) {
            let member = self.apparent_type(member);
            let Some((prop, _)) = self.prop_ref(member, suggestion) else {
                continue;
            };
            let Some(declaration) = self.value_declaration_of_prop(prop) else {
                continue;
            };
            if *declared.get_or_insert(declaration) != declaration {
                return None;
            }
        }
        let (file, decl) = declared?;
        let (start, end) = self.error_range_of_declaration(file, decl)?;
        Some((file, start, end))
    }

    /// `GetErrorRangeForNode(symbol.ValueDeclaration)`. `None`: `sym` has no value declaration.
    pub(super) fn span_of_value_declaration(&self, sym: Sym) -> Option<(FileId, u32, u32)> {
        let (file, decl) = self
            .files()
            .value_declaration(self.files().canonical(sym))?;
        let (start, end) = self.error_range_of_declaration(file, decl)?;
        Some((file, start, end))
    }

    /// The position of `Declarations[0]` of the symbol of the member `written` of an object literal.
    pub(super) fn first_declaration_pos_of_literal_property(
        &self,
        file: FileId,
        written: PropId,
    ) -> u32 {
        let first = self.bound(file).declarations_of_literal_member(written)[0];
        self.hir(file)[first].pos
    }

    /// The position of the first declaration of `prop`, in `compareSymbols` order: a property
    /// without a declaration sorts last.
    pub(super) fn order_of_property(&mut self, prop: &Prop) -> (u8, (bool, u32, u32)) {
        let declared = match &prop.source {
            PropSource::Literal(file, literal) => Some((
                *file,
                self.first_declaration_pos_of_literal_property(*file, *literal),
            )),
            PropSource::Symbol(symbol) => match self.files().value_declaration(*symbol) {
                Some((file, Decl::Member(first))) => Some((file, self.hir(file)[first].name_pos)),
                Some((file, Decl::ParameterProperty(first))) => {
                    Some((file, self.hir(file)[first].pos))
                }
                Some((file, Decl::Expando(first) | Decl::ThisProperty(first))) => {
                    Some((file, self.hir(file)[first].pos))
                }
                // Not by symbol id: the binder declares the functions of a block before the rest of
                // it.
                _ => (self.files().decls_of(*symbol).first().copied())
                    .map(|(file, decl)| (file, self.files().start_of_declaration(file, decl))),
            },
            PropSource::Intersected(_, parts)
            | PropSource::Copy(_, parts, _)
            | PropSource::ReverseMapped(_, parts)
                if !parts.is_empty() =>
            {
                return self.order_of_property(&parts[0]);
            }
            PropSource::Mapped(..) => {
                return match prop.declared_by_modifiers_property().first() {
                    Some(first) => self.order_of_property(first),
                    None => (1, (false, 0, 0)),
                };
            }
            _ => None,
        };
        declared.map_or((1, (false, 0, 0)), |(file, pos)| {
            (0, self.place_in_program_order(file, pos))
        })
    }

    /// `getSuggestionForNonexistentIndexSignature`: it has a `get` or a `set` method that accepts
    /// the key.
    fn has_accessor_method_for(&mut self, object: TypeId, key: TypeId, is_written: bool) -> bool {
        let Some(name) = self
            .atoms()
            .lookup(if is_written { b"set" } else { b"get" })
        else {
            return false;
        };
        let Some((prop, mapper)) = self.prop_ref(object, name) else {
            return false;
        };
        let ty = self.type_of_prop(prop, mapper);
        let Some(sig) = self.single_call_signature(ty, false) else {
            return false;
        };
        let params = self.sig_params(sig);
        self.min_argument_count(&params) >= 1
            && self
                .param_type_at(&params, 0)
                .is_some_and(|p| self.is_assignable(key, p))
    }

    /// `checkVariableLikeDeclaration` for the binding element whose name is `element`, in
    /// `pattern`: "check private/protected variable access".
    pub(super) fn check_binding_element_accessibility(
        &mut self,
        file: FileId,
        pattern: PatId,
        element: PatId,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `PropertyNameOrName`, if that is not a pattern, and `getLiteralTypeFromPropertyName` of
        // it.
        let own_name = match hir[element].kind {
            PatKind::Ident(name) => Some((self.string_literal(name, false), hir[element].pos)),
            _ => None,
        };
        let name = match bound.pat_parent[element.idx()] {
            PatParent::Prop(_, p) if !hir[p].is_rest => match hir[p].key {
                PropKey::Name(name) => Some((self.string_literal(name, false), hir[p].pos)),
                PropKey::Computed(k) => {
                    let key = self.type_of_expr(file, k);
                    Some((self.regular(key), hir[p].pos))
                }
                PropKey::Private(_) | PropKey::None => None,
            },
            _ => own_name,
        };
        let Some((expr_type, at_name)) = name else {
            return;
        };
        let Some(name_text) = self.property_name_of_type(expr_type) else {
            return;
        };
        let parent_type = self.type_for_binding_element_parent(file, element, pattern);
        if self.get_property_of_type(parent_type, name_text).is_none() {
            return;
        }
        let initializer = match bound.pat_parent[pattern.idx()] {
            PatParent::Var(d) => hir[d].init,
            PatParent::Param(param) => hir[param].default,
            PatParent::Prop(_, prop) => hir[prop].default,
            PatParent::Elem(_, elem) => hir[elem].default,
            PatParent::None => ExprId::NONE,
        };
        let is_super = initializer.is_some() && matches!(hir[initializer].kind, ExprKind::Super);
        // `GetRootDeclaration`: the location the access is checked from.
        let at = match bound.pat_parent[root_pattern(bound, pattern).idx()] {
            PatParent::Var(d) => Parent::VarInit(d),
            PatParent::Param(param) => Parent::ParamDefault(param),
            _ => return,
        };
        let error_node = |c: &Self| (file, at_name, c.end_of_name_at(file, at_name));
        self.check_property_accessibility_at_location(
            file,
            hir.parent(hir.node(element)),
            at,
            is_super,
            false,
            parent_type,
            name_text,
            Some(&error_node),
        );
    }

    /// `reportNonexistentProperty`. `e`: the `a.b` whose name is at `start`, or the `#b` at
    /// `start`.
    pub(super) fn report_nonexistent_property(
        &mut self,
        file: FileId,
        e: ExprId,
        name: Atom,
        start: u32,
        containing: TypeId,
        is_unchecked_js: bool,
    ) {
        // `NodeCheckFlagsTypeChecked`: the error is already being built.
        if self
            .reporting_nonexistent
            .iter()
            .any(|r| r.0 == file && r.1 == e)
        {
            return;
        }
        // `typeToStringEx` returns "?" and `addDiagnostic` discards the diagnostic.
        let is_discarded = self.serialization_level >= super::sink::MAX_SERIALIZATION_LEVEL;
        let created = self.non_existent_properties.insert((file, e), is_discarded);
        if created.unwrap_or(is_discarded) {
            self.non_existent_properties.insert((file, e), true);
            return;
        }
        self.reporting_nonexistent.push((file, e, self.stack.len()));
        let dropped: Vec<bool> = self
            .frames
            .iter()
            .map(|frame| frame.drops_reported)
            .collect();
        // Printing runs behind a boundary that no cycle crosses (`with_printer`). In tsgo printing
        // closes cycles, and so does this call the first time. The error is rebuilt where it was
        // dropped along with a result that was not cached, which tsgo does not need.
        let reprinting = std::mem::replace(&mut self.reprinting, created.is_some());
        let at = self.place_of_token(file, start);
        let missing = self.declaration_name_at(file, start);
        // The static side and the promised type are queried for a `#x` by its source text, which is
        // not the name of any property.
        let is_private = self.is_private_name(name);
        // `TypeFlagsPrimitive`: `boolean`, and an enum, which is the union of its members.
        let is_enum = match self
            .parts(containing)
            .first()
            .map(|&first| self.data(first))
        {
            Some(&TypeData::EnumLit { member, .. } | &TypeData::Enum { symbol: member, .. }) => {
                self.enum_type_of_member(member) == containing
            }
            _ => false,
        };
        let mut chain = None;
        if !is_private && !self.is_boolean(containing) && !is_enum && self.is_union(containing) {
            for &subtype in self.parts(containing) {
                let apparent = self.apparent_type(subtype);
                if self.type_of_property(apparent, name).is_none() {
                    let args = [Arg::Bytes(&missing), Arg::Type(subtype)];
                    chain = Some(self.new_diagnostic_chain(None, at, 2339, &args));
                    break;
                }
            }
        }
        let container = self.reduced(containing);
        let container = self.type_to_string(container);
        let args = [Arg::Bytes(&missing), Arg::Bytes(&container)];
        let apparent = self.apparent_type(containing);
        let diagnostic = if !is_private && self.static_side_has(containing, name) {
            let member = cat!(container, b".", missing);
            let args = [args[0], args[1], Arg::Bytes(&member)];
            self.new_diagnostic_chain(chain, at, 2576, &args)
        } else if self.is_property_of_promised_type(containing, name) {
            let mut diagnostic = self.new_diagnostic_chain(chain, at, 2339, &args);
            diagnostic.add_related_info(self.new_diagnostic(at, 2773, &[]));
            diagnostic
        } else if let Some(lib) = self.library_with_property(apparent, name) {
            let args = [args[0], args[1], Arg::Text(lib)];
            self.new_diagnostic_chain(chain, at, 2550, &args)
        } else if let Some((suggestion, declared_at)) =
            self.suggested_symbol_for_nonexistent_property(file, e, name, apparent)
        {
            let suggested = self.name_of_unread_property(suggestion);
            let args = [args[0], args[1], Arg::Bytes(&suggested)];
            let code = if is_unchecked_js { 2568 } else { 2551 };
            let mut diagnostic = self.new_diagnostic_chain(chain, at, code, &args);
            if let Some(declared_at) = declared_at {
                let declared = self.new_diagnostic(declared_at, 2728, &[Arg::Bytes(&suggested)]);
                diagnostic.add_related_info(declared);
            }
            diagnostic
        } else {
            let chain = self.elaborate_never_intersection(chain, at, containing);
            let code = if self.container_seems_to_be_empty_dom_element(containing) {
                2812
            } else {
                2339
            };
            self.new_diagnostic_chain(chain, at, code, &args)
        };
        self.reporting_nonexistent.pop();
        self.reprinting = reprinting;
        // A query re-entered while building the message is no reason to roll the message back.
        for (frame, dropped) in self.frames.iter_mut().zip(dropped) {
            frame.drops_reported = dropped;
        }
        self.add_error_or_suggestion(!is_unchecked_js || diagnostic.code != 2568, diagnostic);
    }

    /// `getSuggestedSymbolForNonexistentProperty` for the name in `e` and the apparent type that
    /// lacks it: the suggested property, and `GetErrorRangeForNode` of its `ValueDeclaration`.
    /// Inaccessible properties are omitted only for a property access expression, which the `a.b`
    /// of `typeof a.b` in a type is not.
    fn suggested_symbol_for_nonexistent_property(
        &mut self,
        file: FileId,
        e: ExprId,
        name: Atom,
        apparent: TypeId,
    ) -> Option<(Atom, Option<(FileId, u32, u32)>)> {
        let is_access = matches!(self.hir(file)[e].kind, ExprKind::Dot { .. })
            && !self.bound(file).is_in_type_query(e);
        let inspected = self.reduced(apparent);
        let suggestion = self.spelling_suggestion_for_property(
            inspected,
            name,
            is_access.then_some((file, e)),
            true,
        )?;
        Some((
            suggestion,
            self.span_of_suggested_property(inspected, suggestion),
        ))
    }

    /// `containerSeemsToBeEmptyDomElement`
    fn container_seems_to_be_empty_dom_element(&mut self, containing: TypeId) -> bool {
        // `everyContainedType`: the members of a union, or of an intersection.
        let contained: &[TypeId] = match self.data(containing) {
            TypeData::Union(parts) | TypeData::Intersection(parts) => &parts[..],
            _ => std::slice::from_ref(&containing),
        };
        !self.p.files.options.has_dom_lib()
            && contained.iter().all(|&m| match self.data(m) {
                // A class expression need not have a name.
                TypeData::Ref { target, .. } if self.files().symbol(*target).name.is_some() => {
                    let name = self.atoms().bytes(self.files().symbol(*target).name);
                    matches!(name, b"EventTarget" | b"Node" | b"Element")
                        || name.starts_with(b"HTML") && name.ends_with(b"Element")
                }
                _ => false,
            })
            && self.is_empty_object_type(containing)
    }

    /// Whether the promised type of `containing` has `name`: an `await` is missing.
    /// `GetPromisedTypeOfPromise`
    fn is_property_of_promised_type(&mut self, containing: TypeId, name: Atom) -> bool {
        // It is queried for a `#x` by its source text, which is not the name of any property.
        if self.is_private_name(name) {
            return false;
        }
        let promised = match self.is_global_ref(containing, known::Promise) {
            Some(&[promised]) => Some(promised),
            _ => self.thenable_value(containing),
        };
        match promised {
            Some(promised) => {
                let promised = self.apparent_type(promised);
                self.get_property_of_type(promised, name).is_some()
            }
            None => false,
        }
    }

    /// `getSuggestedLibForNonExistentProperty`: the library version that added `name` to
    /// `apparent`. It is keyed by the symbol of the type, whatever kind of type that is.
    fn library_with_property(&self, apparent: TypeId, name: Atom) -> Option<&'static str> {
        let container = match *self.data(apparent) {
            TypeData::Ref { target, .. } => target,
            TypeData::Anon {
                origin:
                    Origin::Module(s)
                    | Origin::Namespace { module: s, .. }
                    | Origin::ClassStatic(s)
                    | Origin::Function(s)
                    | Origin::EnumObject(s),
                ..
            } => s,
            _ => return None,
        };
        let container = self.files().symbol(container).name;
        if container.is_none() {
            return None;
        }
        let (container, missing) = (self.atoms().bytes(container), self.atoms().bytes(name));
        let mut types = LIBRARY_FEATURES.iter();
        let (_, features) = types.find(|(ty, _)| ty.as_bytes() == container)?;
        features
            .iter()
            .find(|(_, props)| props.iter().any(|prop| prop.as_bytes() == missing))
            .map(|&(lib, _)| lib)
    }

    /// `elaborateNeverIntersection`
    pub(super) fn elaborate_never_intersection(
        &mut self,
        chain: Option<Reported>,
        at: (FileId, u32, u32),
        ty: TypeId,
    ) -> Option<Reported> {
        if !self.is_intersection(ty) || !self.is_never_intersection(ty) {
            return chain;
        }
        let Some((code, prop)) = self.why_never_intersection(ty) else {
            return chain;
        };
        let written = self.type_to_string_without_reduction(ty);
        let args = [Arg::Bytes(&written), Arg::Prop(prop)];
        Some(self.new_diagnostic_chain(chain, at, code, &args))
    }

    /// The classes enclosing `e`, innermost first.
    pub(super) fn enclosing_classes(&self, file: FileId, e: ExprId) -> Vec<ClassId> {
        let hir = self.hir(file);
        Self::classes_from(hir, hir.get_containing_class(hir.node(e)))
    }

    /// `class`, then `GetContainingClass` applied repeatedly.
    fn classes_from(hir: &File, mut class: Node) -> Vec<ClassId> {
        let mut classes = Vec::new();
        while class.is_some() {
            classes.push(hir.class_of(class));
            class = hir.get_containing_class(class);
        }
        classes
    }

    /// The same for a direct child of `parent`. `Parent::Expr(e)` represents `e` itself: only what
    /// encloses it counts.
    pub(super) fn classes_around(&self, file: FileId, parent: Parent) -> Vec<ClassId> {
        let hir = self.hir(file);
        let innermost = match parent {
            Parent::Expr(e) => hir.get_containing_class(hir.node(e)),
            _ => hir.find_ancestor(hir.node(parent), |n| hir.kind(n).is_class_like()),
        };
        Self::classes_from(hir, innermost)
    }

    /// `lookupSymbolForPrivateIdentifierDeclaration`: the class enclosing the `a.#b` at `e` that
    /// declares `#b`, and the declaration. Instance members take precedence.
    pub(super) fn lookup_symbol_for_private_identifier_declaration(
        &self,
        file: FileId,
        e: ExprId,
        name: Atom,
    ) -> Option<(ClassId, MemberId)> {
        let hir = self.hir(file);
        let &class = self.bound(file).private_class.get(&e)?;
        let declared = |is_static: bool| {
            hir[class].members.iter().find(|&m| {
                hir[m].key == PropKey::Private(name)
                    && hir[m].flags.contains(Flags::STATIC) == is_static
            })
        };
        Some((class, declared(false).or_else(|| declared(true))?))
    }

    /// The class that declares the first property of `ty` whose private name has the same source
    /// text as `name`.
    fn class_of_private_property(&mut self, ty: TypeId, name: Atom) -> Option<(FileId, ClassId)> {
        let ty = self.apparent_type(ty);
        if let TypeData::Union(parts) = self.data(ty) {
            // A property common to all members is declared by a single class.
            let first = self.class_of_private_property(*parts.first()?, name)?;
            return parts[1..]
                .iter()
                .all(|&p| self.class_of_private_property(p, name) == Some(first))
                .then_some(first);
        }
        let atoms = &self.atoms();
        let written = as_written(atoms.bytes(name));
        let members = self.members(ty)?;
        for prop in &members.shape().props {
            if as_written(atoms.bytes(prop.name)) != written {
                continue;
            }
            let Some((file, Decl::Member(m))) = self.value_declaration_of_prop(prop) else {
                continue;
            };
            let MemberOwner::Class(c) = self.bound(file).member_owner[m.idx()] else {
                continue;
            };
            let member = &self.hir(file)[m];
            // Static private members are not inherited.
            let is_of_a_base = member.flags.contains(Flags::STATIC)
                && !matches!(self.data(ty), TypeData::Anon { origin: Origin::ClassStatic(sym), .. } if *sym == self.class_sym(file, c));
            if matches!(member.key, PropKey::Private(_)) && !is_of_a_base {
                return Some((file, c));
            }
        }
        None
    }

    /// `checkPrivateIdentifierPropertyAccess` for the `a.#b` at `e`, whose name is at `start`.
    /// `lexical`: the result of `lookup_symbol_for_private_identifier_declaration`.
    pub(super) fn check_private_identifier_property_access(
        &mut self,
        file: FileId,
        e: ExprId,
        left: TypeId,
        name: Atom,
        start: u32,
        lexical: Option<(ClassId, MemberId)>,
    ) -> bool {
        let Some((declared_in, type_class)) = self.class_of_private_property(left, name) else {
            return false;
        };
        let hir = self.hir(file);
        let at = self.place_of_token(file, start);
        let diag_name = self.declaration_name_at(file, start);
        // `FindAncestor(lexicalClass, n == typeClass)`
        if let Some((lexical_class, shadowing)) = lexical
            && declared_in == file
            && self
                .classes_around_private_name(file, e)
                .iter()
                .skip_while(|&&class| class != lexical_class)
                .any(|&class| class == type_class)
        {
            // Private names with the same source text have a distinct name per class.
            let atoms = &self.atoms();
            let written = as_written(atoms.bytes(name));
            let suggestion = hir[type_class].members.iter().find(|&m| {
                matches!(hir[m].key, PropKey::Private(key) if as_written(atoms.bytes(key)) == written)
            });
            let args = [Arg::Bytes(&diag_name)];
            let shadowing = self.place_of_token(file, hir[shadowing].name_pos);
            let shadowing = self.new_diagnostic(shadowing, 18017, &args);
            let suggestion = suggestion.map(|m| self.place_of_token(file, hir[m].name_pos));
            let suggestion = suggestion.map(|place| self.new_diagnostic(place, 18018, &args));
            let diagnostic = self.error_at(at, 18014, &[args[0], Arg::Type(left)]);
            diagnostic.add_related_info(shadowing);
            if let Some(suggestion) = suggestion {
                diagnostic.add_related_info(suggestion);
            }
            return true;
        }
        let class = self.class_sym(declared_in, type_class);
        self.error_at(at, 18013, &[Arg::Bytes(&diag_name), Arg::Sym(class)]);
        true
    }
    /// `getContainingClassExcludingClassDecorators`, then `GetContainingClass` applied repeatedly:
    /// the classes in which the private name of `e`, an `a.#b`, is resolved.
    pub(super) fn classes_around_private_name(&self, file: FileId, e: ExprId) -> Vec<ClassId> {
        let hir = self.hir(file);
        Self::classes_from(
            hir,
            hir.get_containing_class_excluding_class_decorators(hir.node(e)),
        )
    }

    /// `IsWriteAccess`
    pub(super) fn is_write_access(&self, file: FileId, e: ExprId) -> bool {
        self.bound(file).is_write_access(self.hir(file), e)
    }

    /// `getDeclarationModifierFlagsFromSymbolEx` for a property backed by a single symbol. Uses the setter's modifiers for a write
    /// access, otherwise the getter's, otherwise those of the value declaration.
    fn get_declaration_modifier_flags_from_symbol_ex(
        &mut self,
        prop: &Prop,
        writing: bool,
    ) -> Flags {
        match &prop.source {
            PropSource::Symbol(sym) => {
                let flags = match self.files().value_declaration(*sym) {
                    Some((f, Decl::ParameterProperty(p))) => self.hir(f)[p].flags,
                    // Only accessors need the declaration list: the accessor in use determines the flags.
                    Some((f, Decl::Member(m)))
                        if self.files().flags(*sym).intersects(SymFlags::ACCESSOR) =>
                    {
                        let declared = self.members_of_symbol(*sym);
                        let of_kind = |kind: MemberKind| {
                            (declared.iter().copied()).find(|&(f, m)| self.hir(f)[m].kind == kind)
                        };
                        let setter = of_kind(MemberKind::Setter).filter(|_| writing);
                        let (f, m) = setter
                            .or_else(|| of_kind(MemberKind::Getter))
                            .unwrap_or((f, m));
                        self.hir(f)[m].flags
                    }
                    Some((f, Decl::Member(m))) => self.hir(f)[m].flags,
                    // JSDoc modifiers of the first assignment.
                    Some((f, Decl::ThisProperty(first) | Decl::Expando(first))) => {
                        self.hir(f).jsdoc_modifiers_of(first)
                    }
                    _ => return Flags::empty(),
                };
                // Accessibility modifiers only apply to class members.
                let accessibility = Flags::PRIVATE | Flags::PROTECTED | Flags::PUBLIC;
                if flags.intersects(accessibility) && self.declaring_class(prop).is_none() {
                    flags.difference(accessibility)
                } else {
                    flags
                }
            }
            _ => Flags::empty(),
        }
    }

    /// `checkPropertyAccessibility` for the `a.b` at `e`, whose name is at `name_pos`.
    pub(super) fn check_property_accessibility(
        &mut self,
        file: FileId,
        e: ExprId,
        is_super: bool,
        containing: TypeId,
        name: Atom,
        name_pos: u32,
    ) {
        let (at, writing) = (Parent::Expr(e), self.is_write_access(file, e));
        let error_node = |c: &Self| c.place_of_token(file, name_pos);
        self.check_property_accessibility_at_location(
            file,
            self.hir(file).node(e),
            at,
            is_super,
            writing,
            containing,
            name,
            Some(&error_node),
        );
    }

    /// `checkPropertyAccessibilityAtLocation` for the property `name` of `containing`, accessed at
    /// `location`, inside the node `at` represents (`Parent::Expr(e)`: by `e` itself), which
    /// assigns to it if `writing`. `error_node`: evaluated for its position only if there is an
    /// error.
    pub(super) fn check_property_accessibility_at_location(
        &mut self,
        file: FileId,
        location: Node,
        at: Parent,
        is_super: bool,
        writing: bool,
        containing: TypeId,
        name: Atom,
        error_node: Option<&dyn Fn(&Self) -> (FileId, u32, u32)>,
    ) -> bool {
        // `forEachProperty`: a property of a union or of an intersection is composed of the
        // properties of the members.
        let mut parts: SmallVec<[&Prop; 4]> = SmallVec::new();
        for &member in self.parts(containing) {
            let member = self.apparent_type(member);
            let Some((prop, _)) = self.prop_ref(member, name) else {
                return true;
            };
            super::relate::for_each_property(prop, &mut |p| parts.push(p));
        }
        let Some(&first) = parts.first() else {
            return true;
        };
        // Every `a.b` reaches this point. `PropFlags` has the modifiers of the declaration that
        // represents a property.
        if !is_super && !(parts.iter()).any(|p| p.flags.intersects(PropFlags::MAY_BE_OUT_OF_REACH))
        {
            return true;
        }
        let hidden = Flags::PRIVATE | Flags::PROTECTED;
        // If all of them share one declaration, its modifiers are used
        // (`createUnionOrIntersectionProperty`). Otherwise it is private if any of them is, else
        // public if any is, else protected, and static if any is.
        let is_declared_once = parts.len() == 1 || parts.iter().all(|p| p.source == first.source);
        let flags = if is_declared_once {
            self.get_declaration_modifier_flags_from_symbol_ex(first, writing)
        } else {
            let (mut some, mut is_public) = (Flags::empty(), false);
            for part in &parts {
                let modifiers = self.get_declaration_modifier_flags_from_symbol_ex(part, false);
                some |= modifiers;
                is_public |= !modifiers.intersects(hidden);
            }
            let access = if some.contains(Flags::PRIVATE) {
                Flags::PRIVATE
            } else if is_public {
                Flags::empty()
            } else {
                Flags::PROTECTED
            };
            access | (some & Flags::STATIC)
        };
        let is_static = flags.contains(Flags::STATIC);
        if is_super {
            if flags.contains(Flags::ABSTRACT) {
                let class = self
                    .declaring_class(first)
                    .map(|class| self.declared_type(class));
                return self.report_inaccessible(error_node, 2513, first, class.as_slice());
            }
            // `isClassInstanceProperty`: a field is set on the instance and does not exist on the
            // parent's prototype. An `accessor` does.
            let is_field = |&(f, m): &(FileId, MemberId)| {
                let member = &self.hir(f)[m];
                member.kind == MemberKind::Property
                    && !member.flags.contains(Flags::ACCESSOR)
                    && matches!(self.bound(f).member_owner[m.idx()], MemberOwner::Class(_))
            };
            // In JavaScript so is a property declared by `this.name = value`.
            let is_assigned_field = |f: FileId, e: ExprId| {
                crate::bind::assignment_declaration_kind(self.hir(f), e)
                    == crate::bind::JsDeclarationKind::ThisProperty
            };
            if !is_static
                && parts.iter().any(|p| match &p.source {
                    PropSource::Symbol(sym) => {
                        (self.files().decls_of(*sym).iter()).any(|&(f, decl)| match decl {
                            Decl::Member(m) => is_field(&(f, m)),
                            Decl::Expando(e) | Decl::ThisProperty(e) => is_assigned_field(f, e),
                            _ => false,
                        })
                    }
                    _ => false,
                })
            {
                return self.report_inaccessible(error_node, 2855, first, &[]);
            }
        }
        // "Referencing abstract properties within their own constructors is not allowed"
        if flags.contains(Flags::ABSTRACT)
            // `symbolHasNonMethodDeclaration`
            && !first.flags.contains(PropFlags::METHOD)
            && is_this_property_or_initialized_by_this(self.hir(file), self.bound(file), location)
            && let Some(class) = self.declaring_class(first)
            && is_node_used_during_class_initialization(self.hir(file), location)
        {
            if let Some(error_node) = error_node {
                self.error_at(error_node(self), 2715, &[Arg::Prop(first), Arg::Sym(class)]);
            }
            return false;
        }
        if !flags.intersects(hidden) {
            return true;
        }
        let classes = match at {
            Parent::Expr(e) if e.is_some() => self.enclosing_classes(file, e),
            _ => self.classes_around(file, at),
        };
        let enclosing: Vec<Sym> = classes
            .into_iter()
            .map(|c| self.class_sym(file, c))
            .collect();
        if flags.contains(Flags::PRIVATE) {
            // With several declarations, it reduces an intersection to `never` and is not a
            // property of a union.
            let declaring = self.declaring_class(first).filter(|_| is_declared_once);
            let Some(declaring) = declaring.filter(|declaring| !enclosing.contains(declaring))
            else {
                return true;
            };
            let class = self.declared_type(declaring);
            return self.report_inaccessible(error_node, 2341, first, &[class]);
        }
        if is_super {
            return true;
        }
        // `isClassDerivedFromDeclaringClasses`: the classes that declare those of them that are protected.
        let mut declaring: Vec<Sym> = Vec::new();
        for part in &parts {
            if self
                .get_declaration_modifier_flags_from_symbol_ex(part, writing)
                .contains(Flags::PROTECTED)
            {
                let Some(class) = self.declaring_class(part) else {
                    return true;
                };
                declaring.push(class);
            }
        }
        // The innermost enclosing class that is, or derives from, each of them.
        let mut enclosing_class = None;
        for class in enclosing {
            let declared_type = self.declared_type(class);
            if declaring
                .iter()
                .all(|&d| self.has_base(declared_type, d, 0))
            {
                enclosing_class = Some(class);
                break;
            }
        }
        // `getEnclosingClassFromThisParameter`: or the function's `this` type, declared or
        // contextual, is an instance of such a class.
        if enclosing_class.is_none()
            && !is_static
            && let Some(Ok(func)) = self.this_container_from(file, at)
        {
            let sig = self.sig_of_fn(file, func);
            let this = match self.sig_this_type(sig) {
                // The constraint, if the declared type is a type parameter.
                Some(written) if matches!(self.data(written), TypeData::TypeParam(..)) => {
                    self.constraint_of_type_param(written)
                }
                Some(written) => Some(written),
                // `getContextualThisParameterType`
                None => match self.bound(file).fns[func.idx()].owner {
                    FnOwner::Expr(owner) => self.contextual_this_parameter_type(file, func, owner),
                    _ => None,
                },
            };
            if let Some(this) = this
                && let TypeData::Ref { target, .. } = *self.data(this)
                && declaring.iter().all(|&d| self.has_base(this, d, 0))
            {
                enclosing_class = Some(target);
            }
        }
        let Some(enclosing_class) = enclosing_class else {
            // `getDeclaringClass`: a property synthesized from several declarations has no parent.
            let class = self.declaring_class(first).filter(|_| is_declared_once);
            let class = class.map_or(containing, |class| self.declared_type(class));
            return self.report_inaccessible(error_node, 2445, first, &[class]);
        };
        if is_static {
            return true;
        }
        // And only through an instance of that class, which a union is not (`hasBaseType`). The
        // caller passes `getApparentType`: of `this & X`, which `this is X` narrows `this` to, it
        // is the intersection of the class and `X`.
        let through = if self.is_deferred(containing) {
            self.base_constraint(containing)
        } else {
            self.apparent_type_of_intersection(containing)
        };
        if self.has_base(through, enclosing_class, 0) {
            return true;
        }
        let class = self.declared_type(enclosing_class);
        self.report_inaccessible(error_node, 2446, first, &[class, through])
    }

    /// `if errorNode != nil { c.error_at(errorNode, .., c.symbolToString(prop), ..) }; return false`
    fn report_inaccessible(
        &mut self,
        error_node: Option<&dyn Fn(&Self) -> (FileId, u32, u32)>,
        code: u32,
        prop: &Prop,
        types: &[TypeId],
    ) -> bool {
        if let Some(error_node) = error_node {
            let mut args: SmallVec<[Arg; 3]> = smallvec::smallvec![Arg::Prop(prop)];
            args.extend(types.iter().map(|&ty| Arg::Type(ty)));
            self.error_at(error_node(self), code, &args);
        }
        false
    }
}

/// `isThisProperty(location) || isThisInitializedObjectBindingExpression(location) || IsObjectBindingPattern(location.Parent) &&
/// isThisInitializedDeclaration(location.Parent.Parent)`
fn is_this_property_or_initialized_by_this(hir: &File, bound: &Bound, location: Node) -> bool {
    let is_this = |node: Node| hir.kind(node) == Kind::ThisKeyword;
    let around = hir.parent(hir.parent(location));
    match hir.kind(location) {
        Kind::PropertyAccessExpression | Kind::ElementAccessExpression => {
            // In `typeof this.a` it is a qualified name.
            is_this(hir.expression(location))
                && !matches!(hir.data(location), NodeData::Expr(e) if bound.is_in_type_query(e))
        }
        Kind::ShorthandPropertyAssignment | Kind::PropertyAssignment => {
            matches!(hir.data(around), NodeData::Expr(e)
                if matches!(hir[e].kind, ExprKind::Assign { op: None, value, .. } if is_this(hir.node(value))))
        }
        _ => {
            hir.kind(hir.parent(location)) == Kind::ObjectBindingPattern
                && hir.kind(around) == Kind::VariableDeclaration
                && is_this(hir.initializer(around))
        }
    }
}

/// `isNodeUsedDuringClassInitialization`
fn is_node_used_during_class_initialization(hir: &File, node: Node) -> bool {
    use std::ops::ControlFlow;
    let found = hir.find_ancestor_or_quit(node, |element| {
        let kind = hir.kind(element);
        let has_body = || !matches!(hir[hir.function_of(element)].body, FnBody::None);
        if kind == Kind::Constructor && has_body() || kind == Kind::PropertyDeclaration {
            ControlFlow::Break(true)
        } else if kind.is_class_like() || kind.is_function_like_declaration() {
            ControlFlow::Break(false)
        } else {
            ControlFlow::Continue(())
        }
    });
    found.is_some()
}

/// Whether the private name at `pos` is `#constructor`.
fn is_private_constructor_name(text: &[u8], pos: u32) -> bool {
    text.get(pos as usize) == Some(&b'#') && is_word_at(text, pos as usize + 1, b"constructor")
}

/// `SymbolName`: a `#x` as in the source, without the part that distinguishes it from the `#x` of
/// another class.
fn as_written(name: &[u8]) -> &[u8] {
    if name.first() != Some(&b'#') {
        return name;
    }
    &name[..bun_core::strings::index_of_any(name, b"@'").unwrap_or(name.len())]
}
