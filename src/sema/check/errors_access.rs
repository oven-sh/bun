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

/// `isSuper` and `writing` of `checkPropertyAccessibilityAtLocation`
#[derive(Copy, Clone)]
pub(super) struct PropertyAccess {
    /// The property is accessed through `super`.
    pub(super) is_super: bool,
    /// The access assigns to the property.
    pub(super) writing: bool,
}

impl<'p> Checker<'p, '_> {
    /// Private names that are reserved or misplaced. The errors in `a.b` and `a[k]` are reported
    /// where its type is computed.
    pub(super) fn check_property_accesses(&mut self, file: FileId) {
        // FOR SPEED: a private name is written with a `#`.
        if !strings::contains_char(&self.hir(file).text, b'#') {
            return;
        }
        self.check_private_identifiers(file);
        self.check_private_names(file);
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

    /// `checkPrivateIdentifier` of binder.go, 18012, for every `PrivateIdentifier` of the file. The
    /// binder visits every node of the tree, whether or not the checker does.
    /// `parsePrivateIdentifier`: it is an expression, the name in `a.#x`, or the name of a member,
    /// of a property of an object literal, of the property a binding element reads or of a member
    /// of an enum.
    fn check_private_identifiers(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // "Report error only if there are no parse errors in file"
        if has_parse_diagnostics(hir) {
            return;
        }
        let index = self.exprs_by_kind(file);
        let expressions = (index.of(ExprTag::PrivateIdentifier).iter())
            .chain(index.of(ExprTag::Dot))
            .map(|&e| {
                let pos = match hir[e].kind {
                    ExprKind::Dot { name_pos, .. } => name_pos,
                    _ => hir[e].pos,
                };
                (pos, !matches!(bound.expr_parent[e.idx()], Parent::None))
            });
        let members = (hir.members.iter().zip(bound.member_owner.iter()))
            .map(|(member, owner)| (member.name_pos, !matches!(owner, MemberOwner::None)));
        // The name of `{ a }` is an expression, and `{ ...a }` has none.
        let properties =
            (hir.props.iter().zip(bound.prop_owner.iter())).map(|(property, owner)| {
                let has_name = !matches!(property.kind, PropKind::Shorthand | PropKind::Spread);
                (property.pos, has_name && owner.is_some())
            });
        let elements = hir.pat_props.iter().map(|element| {
            let is_bound = !matches!(bound.pat_parent[element.value.idx()], PatParent::None);
            (element.key_pos, is_bound)
        });
        let enum_members = (hir.enum_members.iter().zip(bound.enum_member_owner.iter()))
            .map(|(member, owner)| (member.pos, owner.is_some()));
        let names = expressions
            .chain(members)
            .chain(properties)
            .chain(elements)
            .chain(enum_members);
        for (pos, is_bound) in names {
            if is_bound && is_private_constructor_name(&hir.text, pos) {
                self.error_at((file, pos, 0), 18012, &[]);
            }
        }
    }

    /// Misplaced private names: 18016 1451 (`checkGrammarPrivateIdentifierExpression`), 18024
    /// (`checkEnumMember`).
    fn check_private_names(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `checkEnumMember`: a plain error.
        for (i, member) in hir.enum_members.iter().enumerate() {
            if bound.enum_member_owner[i].is_some() && is_private_name_at(hir, member.pos) {
                self.error_at((file, member.pos, 0), 18024, &[]);
            }
        }
        // The rest are grammar errors.
        if has_parse_diagnostics(hir) {
            return;
        }
        let index = self.exprs_by_kind(file);
        for &e in index.of(ExprTag::PrivateIdentifier) {
            let (parent, pos) = (bound.expr_parent[e.idx()], hir[e].pos);
            if bound.is_unchecked(e.idx()) {
                continue;
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
            let call = match self.access_to_string(file, self.hir(file).child(obj)) {
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
                // `indexType.symbol`
                let symbol = match symbol {
                    UniqueSymbolDeclaration::Variable(variable) => Some(variable),
                    UniqueSymbolDeclaration::Member(file, member) => {
                        Some(self.symbol_of_member(file, member))
                    }
                    UniqueSymbolDeclaration::SymbolConstructor => self
                        .global_type_symbol(known::SymbolConstructor)
                        .and_then(|constructor| self.files().member(constructor, name)),
                };
                let symbol_name = match symbol {
                    Some(symbol) => {
                        let at = Some(Enclosing::at_scope(file, ScopeId(0)));
                        fully_qualified_name(self, symbol, at)
                    }
                    None => self.atom_text(name),
                };
                (2339, cat!(b"[", symbol_name, b"]"))
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

    /// `tryGetPropertyAccessOrIdentifierToString`. `None`: the empty string. No receiver of an
    /// element access is a `JsxNamespacedName`.
    fn access_to_string(&self, file: FileId, expr: Node) -> Option<Vec<u8>> {
        let hir = self.hir(file);
        match (hir.kind(expr), hir.data(expr)) {
            (Kind::PropertyAccessExpression, _) => {
                let base = self.access_to_string(file, hir.expression(expr))?;
                // `entityNameToString`: the name as it is written.
                let name = self.declaration_name_at(file, hir.start(hir.name(expr)));
                Some(cat!(base, b".", name))
            }
            (Kind::ElementAccessExpression, NodeData::Expr(access)) => {
                let base = self.access_to_string(file, hir.expression(expr))?;
                let ExprKind::Index { index, .. } = hir[access].kind else {
                    return None;
                };
                // `IsPropertyName`, `GetPropertyNameForPropertyNameNode`
                let name = match (hir.kind(hir.child(index)), hir[index].kind) {
                    (Kind::Identifier, ExprKind::Ident(name))
                    | (Kind::StringLiteral, ExprKind::String(name)) => self.atom_text(name),
                    (Kind::PrivateIdentifier, ExprKind::PrivateIdentifier(name)) => {
                        self.written_name(name).to_vec()
                    }
                    (Kind::NumericLiteral, ExprKind::Number(n)) => {
                        crate::atom::number_to_string(hir.numbers[n as usize])
                    }
                    _ => return None,
                };
                Some(cat!(base, b".", name))
            }
            (Kind::Identifier, NodeData::Expr(identifier)) => match hir[identifier].kind {
                ExprKind::Ident(name) if name != known::empty => Some(self.atom_text(name)),
                _ => None,
            },
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
        let hir = self.hir(file);
        let ExprKind::Ident(name) = hir[index].kind else {
            return false;
        };
        // `getResolvedSymbol`
        let symbol = self
            .symbol_of_identifier(file, index, name)
            .and_then(|found| self.value_symbol_of_identifier(file, index, name, found));
        let Some(symbol) = symbol else {
            return false;
        };
        if !self.files().flags(symbol).intersects(SymFlags::VARIABLE) {
            return false;
        }
        let (mut child, mut node) = (hir.child(index), hir.parent(hir.child(index)));
        while node.is_some() {
            if let NodeData::Stmt(s) = hir.data(node)
                && let StmtKind::ForIn { expr, body, .. } = hir[s].kind
                && child == hir.node(body)
                && self.get_for_in_variable_symbol(file, s) == Some(symbol)
            {
                let over = self.get_type_of_expression(file, expr);
                if self.has_numeric_property_names(over) {
                    return true;
                }
            }
            (child, node) = (node, hir.parent(node));
        }
        false
    }

    /// `getForInVariableSymbol`
    fn get_for_in_variable_symbol(&mut self, file: FileId, statement: StmtId) -> Option<Sym> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let StmtKind::ForIn { left, .. } = hir[statement].kind else {
            return None;
        };
        match hir[left].kind {
            StmtKind::Var(declarations) => {
                let name = hir[declarations.iter().next()?].pat;
                if !matches!(hir[name].kind, PatKind::Ident(_)) {
                    return None;
                }
                // `getSymbolOfDeclaration`
                let declared = bound.pat_symbol[name.idx()].some()?;
                Some(self.files().sym(file, declared))
            }
            // `(i)` is not an `Identifier`.
            StmtKind::Expr(e) if !is_parenthesized(hir, e) => {
                let ExprKind::Ident(name) = hir[e].kind else {
                    return None;
                };
                // `getResolvedSymbol`
                self.symbol_of_identifier(file, e, name)
                    .and_then(|found| self.value_symbol_of_identifier(file, e, name, found))
            }
            _ => None,
        }
    }

    /// `hasNumericPropertyNames`
    fn has_numeric_property_names(&mut self, ty: TypeId) -> bool {
        let ty = self.reduced_apparent_type(ty);
        matches!(self.index_signatures_of(ty)[..], [(TypeId::NUMBER, _)])
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
                                PropertyAccess {
                                    is_super,
                                    writing: false,
                                },
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

    /// `getSymbolOfDeclaration(memberDecl).Declarations[0]` for the member `written` of an object
    /// literal. `combineSymbolTables`: the declarations of the early bound symbol come first, so
    /// only a late bound member has to ask for the merged symbol.
    pub(super) fn first_declaration_of_literal_member(
        &mut self,
        file: FileId,
        written: PropId,
    ) -> PropId {
        if !matches!(self.hir(file)[written].key, PropKey::Computed(_)) {
            return self.bound(file).declarations_of_literal_member(written)[0];
        }
        let declarations = self.declarations_of_member(file, Decl::Property(written));
        match declarations.first() {
            Some(&(_, Decl::Property(first))) => first,
            _ => written,
        }
    }

    /// The position of `Declarations[0]` of the symbol of the member `written` of an object literal.
    pub(super) fn first_declaration_pos_of_literal_property(
        &mut self,
        file: FileId,
        written: PropId,
    ) -> u32 {
        let first = self.first_declaration_of_literal_member(file, written);
        self.hir(file)[first].pos
    }

    /// `declareSymbol`: the type parameters of a class or an interface are among its `members`, so
    /// a member of an instance that has the name of one is a later declaration of the same symbol.
    pub(super) fn type_parameter_merged_with_member(
        &self,
        file: FileId,
        member: MemberId,
        name: Atom,
    ) -> Option<(FileId, u32)> {
        let (hir, bound, files) = (self.hir(file), self.bound(file), self.files());
        let (type_params, symbol) = match bound.member_owner[member.idx()] {
            MemberOwner::Class(c) => (hir[c].type_params, bound.class_symbol[c.idx()]),
            MemberOwner::Interface(i) => (hir[i].type_params, bound.interface_symbol[i.idx()]),
            MemberOwner::None | MemberOwner::TypeLiteral(_) => return None,
        };
        let own = type_params.iter().find(|&it| hir[it].name == name)?;
        if hir[member].flags.contains(Flags::STATIC) {
            return None;
        }
        let first = symbol.is_some().then(|| {
            let declarations = files.decls(files.canonical(files.sym(file, symbol)));
            declarations.into_iter().find_map(|(file, declaration)| {
                let hir = self.hir(file);
                let type_params = declaration.type_params_of_class_or_interface(hir)?;
                let found = type_params.iter().find(|&it| hir[it].name == name)?;
                Some((file, hir[found].pos))
            })
        });
        Some(first.flatten().unwrap_or((file, hir[own].pos)))
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
                Some((file, Decl::Member(first))) => Some(
                    self.type_parameter_merged_with_member(file, first, prop.name)
                        .unwrap_or_else(|| (file, self.hir(file)[first].name_pos)),
                ),
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
        let Some((prop, mapper)) = self.get_property_of_object_type(object, name) else {
            return false;
        };
        let ty = self.type_of_prop(prop, mapper);
        let Some(sig) = self.single_call_signature(ty) else {
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
        // "Missing array binding elements have no name"
        if matches!(hir[element].kind, PatKind::Missing) {
            return;
        }
        let parent_type = self.type_for_binding_element_parent(file, element, pattern);
        // `PropertyNameOrName`, if that is not a pattern, and `getLiteralTypeFromPropertyName` of
        // it.
        let own_name = match hir[element].kind {
            PatKind::Ident(name) => Some((self.string_literal(name, false), hir[element].pos)),
            _ => None,
        };
        let name = match bound.pat_parent[element.idx()] {
            PatParent::Prop(_, p) if !hir[p].is_rest => self
                .literal_type_from_property_name(file, hir[p].key, hir[p].name_kind)
                .map(|key| (key, hir[p].pos)),
            _ => own_name,
        };
        let Some((expr_type, at_name)) = name else {
            return;
        };
        let Some(name_text) = self.property_name_of_type(expr_type) else {
            return;
        };
        if self.get_property_of_type(parent_type, name_text).is_none() {
            return;
        }
        let initializer = bound.pat_parent[pattern.idx()].initializer(hir);
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
            PropertyAccess {
                is_super,
                writing: false,
            },
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
        let promised = match self.is_global_ref(containing, known::Promise, 1) {
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

    /// `getDeclarationModifierFlagsFromSymbolEx`: the setter's modifiers for a write access,
    /// otherwise the getter's, otherwise those of the value declaration.
    pub(super) fn get_declaration_modifier_flags_from_symbol_ex(
        &mut self,
        prop: &Prop,
        writing: bool,
    ) -> Flags {
        match (Self::value_declaration(prop), &prop.source) {
            (Some(&PropSource::Symbol(sym)), _) => {
                let flags = match self.files().value_declaration(sym) {
                    Some((f, Decl::ParameterProperty(p))) => self.hir(f)[p].flags,
                    // Only accessors need the declaration list: the accessor in use determines the flags.
                    Some((f, Decl::Member(m)))
                        if self.files().flags(sym).intersects(SymFlags::ACCESSOR) =>
                    {
                        let declared = self.members_of_symbol(sym);
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
                if flags.intersects(accessibility) && self.declaring_class_of_symbol(sym).is_none()
                {
                    flags.difference(accessibility)
                } else {
                    flags
                }
            }
            (None, PropSource::Intersected(..)) => {
                let mut parts: SmallVec<[&Prop; 4]> = SmallVec::new();
                super::relate::for_each_property(prop, &mut |p| parts.push(p));
                self.modifier_flags_of_synthetic_property(&parts)
            }
            _ => Flags::empty(),
        }
    }

    /// `getDeclarationModifierFlagsFromSymbolEx` where `CheckFlagsSynthetic`: private if one of
    /// `parts` is, else public if one is, else protected, and static if one is.
    fn modifier_flags_of_synthetic_property(&mut self, parts: &[&Prop]) -> Flags {
        let (mut some, mut is_public) = (Flags::empty(), false);
        for part in parts {
            let modifiers = self.get_declaration_modifier_flags_from_symbol_ex(part, false);
            some |= modifiers;
            is_public |= !modifiers.intersects(Flags::PRIVATE | Flags::PROTECTED);
        }
        let access = if some.contains(Flags::PRIVATE) {
            Flags::PRIVATE
        } else if is_public {
            Flags::empty()
        } else {
            Flags::PROTECTED
        };
        access | (some & Flags::STATIC)
    }

    /// `getPropertyOfObjectType`
    pub(super) fn get_property_of_object_type(
        &mut self,
        ty: TypeId,
        name: Atom,
    ) -> Option<(&'p Prop<'p>, MapperId)> {
        if self.flags(ty) & tf::OBJECT == 0 {
            return None;
        }
        self.prop_ref(ty, name)
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
            PropertyAccess { is_super, writing },
            containing,
            name,
            Some(&error_node),
        );
    }

    /// `checkPropertyAccessibilityAtLocation` for the property `name` of `containing`, accessed at
    /// `location`, inside the node `at` represents (`Parent::Expr(e)`: by `e` itself).
    /// `error_node`: evaluated for its position only if there is an error.
    pub(super) fn check_property_accessibility_at_location(
        &mut self,
        file: FileId,
        location: Node,
        at: Parent,
        access: PropertyAccess,
        containing: TypeId,
        name: Atom,
        error_node: Option<&dyn Fn(&Self) -> (FileId, u32, u32)>,
    ) -> bool {
        let PropertyAccess { is_super, writing } = access;
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
        // `markPropertyAsReferenced` comes before every `checkPropertyAccessibility`. Only an `a.b`
        // can be a write-only access.
        if error_node.is_some()
            && first.flags.contains(PropFlags::PRIVATE)
            && matches!(first.source, PropSource::Symbol(symbol) if symbol.file != file)
        {
            let node_for_check_write_only = match self.hir(file).data(location) {
                NodeData::Expr(e) => Some(e),
                _ => None,
            };
            self.mark_property_as_referenced(file, containing, name, node_for_check_write_only);
        }
        let hidden = Flags::PRIVATE | Flags::PROTECTED;
        // If all of them share one declaration, its modifiers are used
        // (`createUnionOrIntersectionProperty`).
        let is_declared_once = parts.len() == 1 || parts.iter().all(|p| p.source == first.source);
        let flags = if is_declared_once {
            self.get_declaration_modifier_flags_from_symbol_ex(first, writing)
        } else {
            self.modifier_flags_of_synthetic_property(&parts)
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
        let hir = self.hir(file);
        // "Referencing abstract properties within their own constructors is not allowed"
        if flags.contains(Flags::ABSTRACT)
            // `symbolHasNonMethodDeclaration`
            && !first.flags.contains(PropFlags::METHOD)
            && (hir.is_this_property(location)
                || is_this_initialized_object_binding_expression(hir, location)
                || hir.kind(hir.parent(location)) == Kind::ObjectBindingPattern
                    && is_this_initialized_declaration(hir, hir.parent(hir.parent(location))))
            && let Some(class) = self.declaring_class(first)
            && is_node_used_during_class_initialization(hir, location)
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
            if declaring.iter().all(|&d| self.has_base(declared_type, d)) {
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
                && declaring.iter().all(|&d| self.has_base(this, d))
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
        if self.has_base(through, enclosing_class) {
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

/// `isThisInitializedObjectBindingExpression`
fn is_this_initialized_object_binding_expression(hir: &File, node: Node) -> bool {
    matches!(
        hir.kind(node),
        Kind::ShorthandPropertyAssignment | Kind::PropertyAssignment
    ) && matches!(hir.data(hir.parent(hir.parent(node))), NodeData::Expr(e)
        if matches!(hir[e].kind, ExprKind::Assign { op: None, value, .. }
            if hir.kind(hir.child(value)) == Kind::ThisKeyword))
}

/// `isThisInitializedDeclaration`
fn is_this_initialized_declaration(hir: &File, node: Node) -> bool {
    hir.kind(node) == Kind::VariableDeclaration
        && hir.kind(hir.initializer(node)) == Kind::ThisKeyword
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

/// Whether a `PrivateIdentifier` starts at `pos` and its `node.Text()` is `#constructor`.
fn is_private_constructor_name(text: &[u8], pos: u32) -> bool {
    text.get(pos as usize) == Some(&b'#')
        && *super::spans::unescaped_identifier(word_at(text, pos as usize + 1)) == *b"constructor"
}

/// `SymbolName`: a `#x` as in the source, without the part that distinguishes it from the `#x` of
/// another class.
fn as_written(name: &[u8]) -> &[u8] {
    crate::atom::written_name(name)
}
