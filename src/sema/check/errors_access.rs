//! Errors about `a.b` and `a[k]`: `a` may be null, there is no `b`, or `b` is not for whoever is asking. The last two as well of what
//! a pattern takes out of an object, and the second of what a type looks up in another.
//!
//! Follows `checkPropertyAccessExpressionOrQualifiedName`, `reportNonexistentProperty`, `checkPropertyAccessibilityAtLocation`,
//! `checkElementAccessExpression`, `getPropertyTypeForIndexType`, and `checkVariableLikeDeclaration` with
//! `getBindingElementTypeFromParentType` as far as the elements of patterns go, of TypeScript 7.0.2's checker.go.

use super::errors::is_close;
use super::explain::Line;
use super::sink::held;
use super::*;
use crate::bind::{FnOwner, MemberOwner, Parent, PatParent};
use smallvec::SmallVec;

/// What a type of the standard library got with each version of it: `(lib, properties)`.
type Features = &'static [(&'static str, &'static [&'static str])];

#[rustfmt::skip]
const TYPED_ARRAY_FEATURES: Features = &[
    ("es2022", &["at"]),
    ("es2023", &["findLastIndex", "findLast", "toReversed", "toSorted", "toSpliced", "with"]),
];

/// The properties of the standard library that came with a version of it, by type. `getFeatureMap`
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

impl Checker<'_> {
    /// `a[k]`, what patterns and types look up by name, and private names out of place. What is wrong with `a.b` is reported where
    /// its type is worked out (`type_of_property_access`).
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
        self.error_at(node, 2689, &[Arg::Text(&name)]);
        true
    }

    /// `getEntityNameForExtendingInterface`: the whole of the dotted name that `e` is, or is the left part of, as it is written.
    pub(super) fn entity_name_around(&self, file: FileId, e: ExprId) -> String {
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

    /// `DeclarationNameToString` of the name written at `pos`.
    pub(super) fn declaration_name_at(&self, file: FileId, pos: u32) -> String {
        self.source_text(file, pos, self.end_of_name_at(file, pos))
    }

    /// The name of a property whose declaration cannot be read: a `#x` as it is written, `[Symbol.iterator]` for what a symbol names.
    fn name_of_unread_property(&self, name: Atom) -> String {
        let bytes = self.files().atoms.bytes(name);
        let Some(symbol) = bytes.strip_prefix(crate::atom::SYMBOL_NAME_PREFIX) else {
            return String::from_utf8_lossy(as_written(bytes)).into_owned();
        };
        let symbol = String::from_utf8_lossy(symbol);
        match symbol.split_once('@') {
            Some((variable, _)) => format!("[{variable}]"),
            None => format!("[Symbol.{symbol}]"),
        }
    }

    /// Private names out of place: 18016 1451 (`checkGrammarPrivateIdentifierExpression`), 18012 (`checkPrivateIdentifier` of
    /// binder.go), 18024 (`checkEnumMember`).
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
            // Parentheses are a parent of their own.
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

    /// Where an error points at the expression `e`.
    pub(super) fn place_inside_parentheses(&self, file: FileId, e: ExprId) -> (FileId, u32, u32) {
        (
            file,
            self.start_inside_parentheses(file, e),
            self.end_inside_parentheses(file, e),
        )
    }

    /// `getPropertyTypeForIndexType`, where `noImplicitAny` has something to say of `a[k]`, written at `e`, that finds nothing: 2576 7015
    /// 2551 7052 7053. `keys`: `indexType` and `fullIndexType`.
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
        let at_index = (
            file,
            self.start_of(file, index),
            self.end_of_expr(file, index),
        );
        let is_target = self.is_written(file, e);
        if let Some(name) = name
            && self.static_side_has(object, name)
        {
            let container = self.type_to_string(object);
            let member = format!(
                "{container}[{}]",
                self.source_text(file, at_index.1, at_index.2)
            );
            let args = [Arg::Atom(name), Arg::Text(&container), Arg::Text(&member)];
            self.error_at(at_access, 2576, &args);
        } else if self.index_type_of_type(object, TypeId::NUMBER).is_some() {
            self.error_at(at_index, 7015, &[]);
        } else if let Some(name) = name
            && let Some(meant) = self.property_meant(object, name, None, true)
        {
            let meant = self.name_of_unread_property(meant);
            let args = [Arg::Atom(name), Arg::Type(object), Arg::Text(&meant)];
            self.error_at(at_index, 2551, &args);
        } else if self.has_accessor_method_for(object, key, is_target) {
            let method = if is_target { "set" } else { "get" };
            let call = match self.access_to_string(file, obj) {
                Some(receiver) => format!("{receiver}.{method}"),
                None => method.to_owned(),
            };
            self.error_at(at_access, 7052, &[Arg::Type(object), Arg::Text(&call)]);
        } else {
            let under = self.lines_under_implicit_any_element(object, key).pop();
            let under = under.map(|line| Reported::new(at_access, line.code, line.args));
            let args = [Arg::Type(keys), Arg::Type(object)];
            let diagnostic = self.new_diagnostic_chain(under, at_access, 7053, &args);
            self.add_diagnostic(diagnostic);
        }
    }

    /// What `getPropertyTypeForIndexType` puts under 7053.
    fn lines_under_implicit_any_element(&mut self, object: TypeId, key: TypeId) -> Vec<Line> {
        let (code, first) = match *self.data(key) {
            TypeData::EnumLit { .. } => (2339, format!("[{}]", self.type_to_string(key))),
            TypeData::UniqueSymbol { name, .. } => (2339, format!("[{}]", self.atom_text(name))),
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
    fn access_to_string(&self, file: FileId, e: ExprId) -> Option<String> {
        if is_parenthesized(self.hir(file), e) {
            return None;
        }
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Ident(name) => Some(self.atom_text(name)),
            ExprKind::Dot { obj, name, .. } => {
                let receiver = self.access_to_string(file, obj)?;
                Some(format!("{receiver}.{}", self.atom_text(name)))
            }
            // `IsPropertyName`
            ExprKind::Index { obj, index, .. } if !is_parenthesized(self.hir(file), index) => {
                let receiver = self.access_to_string(file, obj)?;
                let name = match hir[index].kind {
                    ExprKind::Ident(name) | ExprKind::String(name) => self.atom_text(name),
                    ExprKind::Number(n) => crate::atom::number_to_string(hir.numbers[n as usize]),
                    _ => return None,
                };
                Some(format!("{receiver}.{name}"))
            }
            _ => None,
        }
    }

    /// `getReducedApparentType`
    pub(super) fn reduced_apparent_type(&mut self, ty: TypeId) -> TypeId {
        let ty = self.reduced(ty);
        let apparent = self.apparent_type(ty);
        self.reduced(apparent)
    }

    /// Whether `name` is a global `let`, `const`, class or enum (`SymbolFlagsBlockScoped`): those are no properties of `globalThis`.
    pub(super) fn is_block_scoped_global(&self, name: Atom) -> bool {
        self.files().globals.get(&name).is_some_and(|&global| {
            self.files()
                .flags(global)
                .intersects(SymFlags::BLOCK_SCOPED_VARIABLE | SymFlags::CLASS | SymFlags::ENUM)
        })
    }

    /// `getIndexInfosOfType`: the key of each index signature of `ty`, which is an apparent type, and whether it is readonly.
    /// Of a union (`getUnionIndexInfos`), those of its first member that all the others have, readonly if one of them is.
    pub(super) fn index_signatures_of(&mut self, ty: TypeId) -> SmallVec<[(TypeId, bool); 4]> {
        let mut infos: SmallVec<[(TypeId, bool); 4]> = SmallVec::new();
        for (at, &part) in self.parts(ty).iter().enumerate() {
            let part = self.apparent_type(part);
            let members = self.members(part);
            let own: &[IndexInfo] = match &members {
                Some(members) => &members.shape().index,
                None => &[],
            };
            if at == 0 {
                infos.extend(own.iter().map(|info| (info.key, info.readonly)));
                continue;
            }
            infos.retain(|info| match own.iter().find(|other| other.key == info.0) {
                Some(other) => {
                    info.1 |= other.readonly;
                    true
                }
                None => false,
            });
        }
        infos
    }

    /// `getApplicableIndexInfo` among `infos`, or else the signature for strings, which stands in where none applies: its key, and
    /// whether it is readonly. `findApplicableIndexInfo`: the signature for strings counts only where no other applies, and several
    /// that apply are one, with `unknown` for a key, that is readonly if all of them are.
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

    /// `isForInVariableForNumericPropertyNames`: `i` in `for (i in a) a[i]`, where `a` has numbers for names.
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
                    // `hasNumericPropertyNames`: the one index signature it has is for numbers.
                    let over = self.type_of_expr(file, expr);
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
        self.prop_ref(statics, name)
            .is_some_and(|(prop, _)| matches!(prop.source, PropSource::Members(_)))
    }

    /// The property that may have been meant. `closest`: the one `GetSpellingSuggestion` settles on, and not the first that will do.
    fn property_meant(
        &mut self,
        object: TypeId,
        name: Atom,
        access: Option<(FileId, ExprId)>,
        closest: bool,
    ) -> Option<Atom> {
        let text = as_written(self.files().atoms.bytes(name));
        let access = access.and_then(|(file, e)| match self.hir(file)[e].kind {
            ExprKind::Dot { obj, chain, .. } => Some((file, e, obj, chain)),
            _ => None,
        });
        let mut candidates: Vec<(((u8, FileId, u32), &[u8]), Atom)> = Vec::new();
        // `getPropertiesOfUnionOrIntersectionType`: of a union, what all its members have, which is among what the first has. A
        // member with index signatures may have by them what only the next declares.
        for &member in self.parts(object) {
            let member = self.apparent_type(member);
            let Some(members) = self.members(member) else {
                break;
            };
            for prop in &members.shape().props {
                let candidate = as_written(self.files().atoms.bytes(prop.name));
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
                        // `isPropertyAccessible`: a `#x` is within reach in the class that declares it, and not in an optional chain.
                        let is_private_name = matches!(&prop.source, PropSource::Members(declared)
                            if declared.first().is_some_and(|&(f, m)| matches!(self.hir(f)[m].key, PropKey::Private(_))));
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
                // `compareSymbols` decides between two that are as close.
                candidates.push(((self.order_of_property(prop), candidate), prop.name));
            }
            if members.shape().index.is_empty() {
                break;
            }
        }
        get_spelling_suggestion(text, candidates.iter(), |c| c.0.1, |a, b| a.0.cmp(&b.0))
            .map(|found| found.1)
    }

    /// `GetErrorRangeForNode(suggestion.ValueDeclaration)`, of the property `meant` of `object`. `createUnionOrIntersectionProperty`:
    /// what the members of a union declare in several places has no such declaration.
    fn place_of_property_meant(
        &mut self,
        object: TypeId,
        meant: Atom,
    ) -> Option<(FileId, u32, u32)> {
        let mut declared = None;
        for &member in self.parts(object) {
            let member = self.apparent_type(member);
            let Some((prop, _)) = self.prop_ref(member, meant) else {
                continue;
            };
            let Some(source) = Self::value_declaration(prop) else {
                continue;
            };
            if *declared.get_or_insert(source) != source {
                return None;
            }
        }
        match *declared? {
            PropSource::Members(ref members) => {
                let &(file, member) = members.first()?;
                Some(self.place_of_token(file, self.hir(file)[member].name_pos))
            }
            // All of the parameter, with its modifiers.
            PropSource::Parameter(file, param) => Some((
                file,
                self.hir(file)[param].pos,
                self.end_of_param(file, param),
            )),
            PropSource::Literal(file, prop) => {
                Some(self.place_of_token(file, self.hir(file)[prop].pos))
            }
            PropSource::Symbol(sym) => self.place_where_value_is_declared(sym),
            // All of the assignment.
            PropSource::Assigned(file, ref assignments) => {
                let &first = assignments.first()?;
                Some((
                    file,
                    self.start_of(file, first),
                    self.end_of_expr(file, first),
                ))
            }
            PropSource::Type(_)
            | PropSource::Intersected(..)
            | PropSource::Mapped(..)
            | PropSource::Copy(..)
            | PropSource::ReverseMapped(..) => None,
        }
    }

    /// `GetErrorRangeForNode(symbol.ValueDeclaration)`. `None`: nothing declares `sym` as a value.
    pub(super) fn place_where_value_is_declared(&self, sym: Sym) -> Option<(FileId, u32, u32)> {
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
        let hir = self.hir(file);
        // The nodes of a JSON file have no positions. `json_to_hir` numbers its properties in source order.
        if hir.kind == FileKind::Json {
            first.0
        } else {
            hir[first].pos
        }
    }

    /// Where `prop` is first declared, as `compareSymbols` orders symbols: what has no declaration comes last.
    pub(super) fn order_of_property(&mut self, prop: &Prop) -> (u8, FileId, u32) {
        let declared = match &prop.source {
            PropSource::Members(declared) => declared
                .first()
                .map(|&(file, member)| (file, self.hir(file)[member].name_pos)),
            PropSource::Parameter(file, param) => Some((*file, self.hir(*file)[*param].pos)),
            PropSource::Literal(file, literal) => Some((
                *file,
                self.first_declaration_pos_of_literal_property(*file, *literal),
            )),
            PropSource::Assigned(file, assignments) => assignments
                .first()
                .map(|&assignment| (*file, self.hir(*file)[assignment].pos)),
            // Not by the number of the symbol: the binder declares the functions of a block before the rest of it.
            PropSource::Symbol(symbol) => {
                super::errors::place_of_first_declaration(self.files(), *symbol)
                    .map(|(_, file, pos)| (file, pos))
            }
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
                    None => (1, FileId(0), 0),
                };
            }
            _ => None,
        };
        declared.map_or((1, FileId(0), 0), |(file, pos)| (0, file, pos))
    }

    /// `getSuggestionForNonexistentIndexSignature`: it has a `get`, or a `set`, that takes the key.
    fn has_accessor_method_for(&mut self, object: TypeId, key: TypeId, is_written: bool) -> bool {
        let Some(name) = self
            .files()
            .atoms
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

    /// `checkVariableLikeDeclaration`, of the binding element whose name is `element`, in `pattern`: "check private/protected variable
    /// access".
    pub(super) fn check_binding_element_accessibility(
        &mut self,
        file: FileId,
        pattern: PatId,
        element: PatId,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `PropertyNameOrName`, if that is no pattern, and `getLiteralTypeFromPropertyName` of it.
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
        // `GetRootDeclaration`: where it is asked from.
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

    /// `reportNonexistentProperty`. `e`: the `a.b` whose name is written at `start`, or the `#b` that is.
    pub(super) fn report_nonexistent_property(
        &mut self,
        file: FileId,
        e: ExprId,
        name: Atom,
        start: u32,
        containing: TypeId,
        is_unchecked_js: bool,
    ) {
        // `NodeCheckFlagsTypeChecked`: the error is being made.
        if self
            .reporting_nonexistent
            .iter()
            .any(|r| r.0 == file && r.1 == e)
        {
            return;
        }
        // `typeToStringEx` says "?" and `addDiagnostic` discards.
        let is_discarded = self.serialization_level >= super::sink::MAX_SERIALIZATION_LEVEL;
        let made = self.non_existent_properties.insert((file, e), is_discarded);
        if made.unwrap_or(is_discarded) {
            self.non_existent_properties.insert((file, e), true);
            return;
        }
        self.reporting_nonexistent.push((file, e, self.stack.len()));
        let dropped: Vec<bool> = self
            .frames
            .iter()
            .map(|frame| frame.drops_reported)
            .collect();
        // Printing is behind a barrier that no circle passes (`with_printer`). In tsgo it closes them: so does this one, the first
        // time. The error is made again where it was dropped with an answer that was not kept, which tsgo has no need of.
        if made.is_none() {
            self.serialization_level += 1;
            self.printing_closes_circles = true;
            let printed = self.reduced(containing);
            self.type_to_string(printed);
            self.printing_closes_circles = false;
            self.serialization_level -= 1;
        }
        let at = self.place_of_token(file, start);
        let missing = self.declaration_name_at(file, start);
        // The static side and what is promised are asked for a `#x` by its text, which is the name of no property.
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
                    let args = [Arg::Text(&missing), Arg::Type(subtype)];
                    chain = Some(self.new_diagnostic_chain(None, at, 2339, &args));
                    break;
                }
            }
        }
        let container = self.reduced(containing);
        let container = self.type_to_string(container);
        let args = [Arg::Text(&missing), Arg::Text(&container)];
        let apparent = self.apparent_type(containing);
        let diagnostic = if !is_private && self.static_side_has(containing, name) {
            let member = format!("{container}.{missing}");
            let args = [args[0], args[1], Arg::Text(&member)];
            self.new_diagnostic_chain(chain, at, 2576, &args)
        } else if self.is_property_of_what_is_promised(containing, name) {
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
            let args = [args[0], args[1], Arg::Text(&suggested)];
            let code = if is_unchecked_js { 2568 } else { 2551 };
            let mut diagnostic = self.new_diagnostic_chain(chain, at, code, &args);
            if let Some(declared_at) = declared_at {
                let declared = self.new_diagnostic(declared_at, 2728, &[Arg::Text(&suggested)]);
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
        // What the making of the message comes back to is no reason to take the message back.
        for (frame, dropped) in self.frames.iter_mut().zip(dropped) {
            frame.drops_reported = dropped;
        }
        self.add_error_or_suggestion(!is_unchecked_js || diagnostic.code != 2568, diagnostic);
    }

    /// `getSuggestedSymbolForNonexistentProperty`, of the name written in `e` and the apparent type of what lacks it: the property
    /// that may have been meant, and `GetErrorRangeForNode` of its `ValueDeclaration`. It is for a property access that what is out
    /// of reach is left out, which the `a.b` of `typeof a.b` in a type is not.
    fn suggested_symbol_for_nonexistent_property(
        &mut self,
        file: FileId,
        e: ExprId,
        name: Atom,
        apparent: TypeId,
    ) -> Option<(Atom, Option<(FileId, u32, u32)>)> {
        let is_access = matches!(self.hir(file)[e].kind, ExprKind::Dot { .. })
            && !self.bound(file).is_in_type_query(e);
        let looked_into = self.reduced(apparent);
        let meant = self.property_meant(looked_into, name, is_access.then_some((file, e)), true)?;
        Some((meant, self.place_of_property_meant(looked_into, meant)))
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
                    let name = self.files().atoms.bytes(self.files().symbol(*target).name);
                    matches!(name, b"EventTarget" | b"Node" | b"Element")
                        || name.starts_with(b"HTML") && name.ends_with(b"Element")
                }
                _ => false,
            })
            && self.is_empty_object_type(containing)
    }

    /// It is what `containing` promises that has `name`: `await` was forgotten. `GetPromisedTypeOfPromise`
    fn is_property_of_what_is_promised(&mut self, containing: TypeId, name: Atom) -> bool {
        // It is asked for a `#x` by its text, which is the name of no property.
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

    /// `getSuggestedLibForNonExistentProperty`: the version of the library that `name` came to `apparent` with. It goes by the symbol
    /// of the type, whatever kind of type that is.
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
        let container = self.files().atoms.text(container);
        let missing = self.files().atoms.text(name);
        let (_, features) = LIBRARY_FEATURES.iter().find(|(ty, _)| *ty == container)?;
        features
            .iter()
            .find(|(_, props)| props.contains(&&*missing))
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
        let args = [Arg::Text(&written), Arg::Prop(&prop)];
        Some(self.new_diagnostic_chain(chain, at, code, &args))
    }

    /// The classes `e` is written in, from the inside out.
    pub(super) fn enclosing_classes(&self, file: FileId, e: ExprId) -> Vec<ClassId> {
        let hir = self.hir(file);
        Self::classes_from(hir, hir.get_containing_class(hir.node(e)))
    }

    /// `class`, and `GetContainingClass` again and again.
    fn classes_from(hir: &File, mut class: Node) -> Vec<ClassId> {
        let mut classes = Vec::new();
        while class.is_some() {
            classes.push(hir.class_of(class));
            class = hir.get_containing_class(class);
        }
        classes
    }

    /// The same, of what is directly in `parent`. `Parent::Expr(e)` stands for `e` itself: it is what is around it that counts.
    pub(super) fn classes_around(&self, file: FileId, parent: Parent) -> Vec<ClassId> {
        let hir = self.hir(file);
        let innermost = match parent {
            Parent::Expr(e) => hir.get_containing_class(hir.node(e)),
            _ => hir.find_ancestor(hir.node(parent), |n| hir.kind(n).is_class_like()),
        };
        Self::classes_from(hir, innermost)
    }

    /// `lookupSymbolForPrivateIdentifierDeclaration`: the class around the `a.#b` at `e` that declares `#b`, and the declaration.
    /// What the instances have comes first.
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

    /// The class that declares the first property of `ty` that goes by a private name written like `name`.
    fn class_of_private_property(&mut self, ty: TypeId, name: Atom) -> Option<(FileId, ClassId)> {
        let ty = self.apparent_type(ty);
        if let TypeData::Union(parts) = self.data(ty) {
            // What all members have is what one class declares.
            let first = self.class_of_private_property(*parts.first()?, name)?;
            return parts[1..]
                .iter()
                .all(|&p| self.class_of_private_property(p, name) == Some(first))
                .then_some(first);
        }
        let atoms = &self.files().atoms;
        let written = as_written(atoms.bytes(name));
        let members = self.members(ty)?;
        for prop in &members.shape().props {
            if as_written(atoms.bytes(prop.name)) != written {
                continue;
            }
            let PropSource::Members(declarations) = &prop.source else {
                continue;
            };
            let Some(&(file, m)) = declarations.first() else {
                continue;
            };
            let MemberOwner::Class(c) = self.bound(file).member_owner[m.idx()] else {
                continue;
            };
            let member = &self.hir(file)[m];
            // What is static and private is not inherited.
            let is_of_a_base = member.flags.contains(Flags::STATIC)
                && !matches!(self.data(ty), TypeData::Anon { origin: Origin::ClassStatic(sym), .. } if *sym == self.class_sym(file, c));
            if matches!(member.key, PropKey::Private(_)) && !is_of_a_base {
                return Some((file, c));
            }
        }
        None
    }

    /// `checkPrivateIdentifierPropertyAccess`, of the `a.#b` at `e`, whose name is written at `start`. `lexical`: what
    /// `lookup_symbol_for_private_identifier_declaration` found.
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
            // Each class has a name of its own for what is written alike.
            let atoms = &self.files().atoms;
            let written = as_written(atoms.bytes(name));
            let meant = hir[type_class].members.iter().find(|&m| {
                matches!(hir[m].key, PropKey::Private(key) if as_written(atoms.bytes(key)) == written)
            });
            let args = [Arg::Text(&diag_name)];
            let shadowing = self.place_of_token(file, hir[shadowing].name_pos);
            let shadowing = self.new_diagnostic(shadowing, 18017, &args);
            let meant = meant.map(|m| self.place_of_token(file, hir[m].name_pos));
            let meant = meant.map(|place| self.new_diagnostic(place, 18018, &args));
            let diagnostic = self.error_at(at, 18014, &[args[0], Arg::Type(left)]);
            diagnostic.add_related_info(shadowing);
            if let Some(meant) = meant {
                diagnostic.add_related_info(meant);
            }
            return true;
        }
        let class = self.class_sym(declared_in, type_class);
        self.error_at(at, 18013, &[Arg::Text(&diag_name), Arg::Sym(class)]);
        true
    }
    /// `getContainingClassExcludingClassDecorators`, then `GetContainingClass` again and again: the classes the private name of `e`,
    /// an `a.#b`, is looked up in.
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

    /// `getDeclarationModifierFlagsFromSymbolEx`, of a property that is declared in one place: what is written on its setter if it is
    /// written to, or else on its getter, or else on the first of its declarations.
    fn modifiers_of_property(&self, prop: &Prop, writing: bool) -> Flags {
        match &prop.source {
            PropSource::Members(declared) => {
                let of_kind = |kind: MemberKind| {
                    declared
                        .iter()
                        .copied()
                        .find(|&(f, m)| self.hir(f)[m].kind == kind)
                };
                let setter = if writing {
                    of_kind(MemberKind::Setter)
                } else {
                    None
                };
                let Some((f, m)) = setter
                    .or_else(|| of_kind(MemberKind::Getter))
                    .or_else(|| declared.first().copied())
                else {
                    return Flags::empty();
                };
                let flags = self.hir(f)[m].flags;
                // Only a class keeps things to itself.
                match self.bound(f).member_owner[m.idx()] {
                    MemberOwner::Class(_) => flags,
                    _ => flags.difference(Flags::PRIVATE | Flags::PROTECTED | Flags::PUBLIC),
                }
            }
            PropSource::Parameter(f, p) => self.hir(*f)[*p].flags,
            // The modifiers of the first assignment. Only a member of a class is private or protected.
            PropSource::Assigned(f, declared) => {
                let Some(&first) = declared.first() else {
                    return Flags::empty();
                };
                let modifiers = self.hir(*f).jsdoc_modifiers_of(first);
                if modifiers.is_empty()
                    || self.bound(*f).this_property(self.hir(*f), first).is_some()
                {
                    modifiers
                } else {
                    modifiers.difference(Flags::PRIVATE | Flags::PROTECTED | Flags::PUBLIC)
                }
            }
            _ => Flags::empty(),
        }
    }

    /// `checkPropertyAccessibility`, of the `a.b` at `e`, whose name is written at `name_pos`.
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

    /// `checkPropertyAccessibilityAtLocation`, for the property `name` of `containing`, asked for at `location`, in what `at` stands
    /// for (`Parent::Expr(e)`: by `e` itself), which writes to it if `writing`. `error_node`: asked where it is only if there is an
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
        // `forEachProperty`: a property of a union or of an intersection is made of those of the members.
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
        let hidden = Flags::PRIVATE | Flags::PROTECTED;
        // With one declaration for all of them it goes by that (`createUnionOrIntersectionProperty`). Otherwise it is private if one of
        // them is, else public if one is, else protected, and static if one is.
        let is_declared_once = parts.len() == 1 || parts.iter().all(|p| p.source == first.source);
        let flags = if is_declared_once {
            self.modifiers_of_property(first, writing)
        } else {
            let (mut some, mut is_public) = (Flags::empty(), false);
            for part in &parts {
                let modifiers = self.modifiers_of_property(part, false);
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
            // `isClassInstanceProperty`: a field is set on the instance, there is nothing of it in the parent's prototype. An
            // `accessor` is there.
            let is_field = |&(f, m): &(FileId, MemberId)| {
                let member = &self.hir(f)[m];
                member.kind == MemberKind::Property
                    && !member.flags.contains(Flags::ACCESSOR)
                    && matches!(self.bound(f).member_owner[m.idx()], MemberOwner::Class(_))
            };
            // In JavaScript so is what `this.name = value` declares.
            let is_assigned_field = |f: FileId, e: ExprId| {
                crate::bind::assignment_declaration_kind(self.hir(f), e)
                    == crate::bind::JsDeclarationKind::ThisProperty
            };
            if !is_static
                && parts.iter().any(|p| match &p.source {
                    PropSource::Members(declared) => declared.iter().any(|d| is_field(d)),
                    PropSource::Assigned(f, declared) => {
                        declared.iter().any(|&e| is_assigned_field(*f, e))
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
            // Declared in several places, it makes `never` of an intersection and is no property of a union.
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
                .modifiers_of_property(part, writing)
                .contains(Flags::PROTECTED)
            {
                let Some(class) = self.declaring_class(part) else {
                    return true;
                };
                declaring.push(class);
            }
        }
        // The innermost class around that is, or derives from, each of them.
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
        // `getEnclosingClassFromThisParameter`: or the function says, or is expected, to be called on an instance of such a class.
        if enclosing_class.is_none()
            && !is_static
            && let Some(Ok(func)) = self.this_container_from(file, at)
        {
            let sig = self.sig_of_fn(file, func);
            let this = match self.sig_this_type(sig) {
                // What a type parameter extends, if that is what is written.
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
            // `getDeclaringClass`: what is put together from several declarations has no parent.
            let class = self.declaring_class(first).filter(|_| is_declared_once);
            let class = class.map_or(containing, |class| self.declared_type(class));
            return self.report_inaccessible(error_node, 2445, first, &[class]);
        };
        if is_static {
            return true;
        }
        // And only through an instance of that class, which a union is not (`hasBaseType`).
        let through = if self.is_deferred(containing) {
            self.base_constraint(containing)
        } else {
            containing
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

/// Whether the private name written at `pos` is `#constructor`.
fn is_private_constructor_name(text: &[u8], pos: u32) -> bool {
    text.get(pos as usize) == Some(&b'#') && is_word_at(text, pos as usize + 1, b"constructor")
}

/// `SymbolName`: a `#x` as it is written, without what tells it from the `#x` of another class.
fn as_written(name: &[u8]) -> &[u8] {
    if name.first() != Some(&b'#') {
        return name;
    }
    &name[..name
        .iter()
        .position(|&b| b == b'@' || b == b'\'')
        .unwrap_or(name.len())]
}
