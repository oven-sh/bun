//! Errors about `a.b` and `a[k]`: `a` may be null, there is no `b`, or `b` is not for whoever is asking. The last two as well of what
//! a pattern takes out of an object, and the second of what a type looks up in another.
//!
//! Follows `checkPropertyAccessExpressionOrQualifiedName`, `reportNonexistentProperty`, `checkPropertyAccessibilityAtLocation`,
//! `checkElementAccessExpression`, `getPropertyTypeForIndexType`, and `checkVariableLikeDeclaration` with
//! `getBindingElementTypeFromParentType` as far as the elements of patterns go, of TypeScript 7.0.2's checker.go.

use super::errors::{Diagnostic, is_close};
use super::errors_order::Named;
use super::explain::Line;
use super::*;
use crate::bind::{ClassOwner, FnOwner, MemberOwner, Parent, PatParent, ScopeId, ScopeKind};
use smallvec::{SmallVec, smallvec};

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

/// What `checkPropertyAccessibilityAtLocation` objects to.
struct Inaccessible {
    code: u32,
    /// The property, or the first of those it is made of.
    prop: Prop,
    /// The class the message names: the one that declares the property; for 2446, the one around.
    class: Option<Sym>,
    /// What the property was asked of.
    containing: TypeId,
}

impl Checker<'_> {
    /// 2339 2551 2550 2576 2812 7017 2689; 2542; 18046 to 18050, 2531 to 2533, 2571; 2341 2445 2446 2513 2855.
    pub(super) fn check_property_accesses(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        self.check_private_names(file, out);
        self.check_lookups_by_name(file, out);
        self.check_element_accesses(file, out);
        let (hir, bound) = (self.hir(file), self.bound(file));
        let strict_null_checks = self.p.files.options.strict_null_checks;
        let index = self.exprs_by_kind(file);
        for &e in index.of(ExprTag::Dot) {
            let ExprKind::Dot {
                obj,
                name,
                name_pos,
                chain,
            } = hir[e].kind
            else {
                continue;
            };
            let parent = bound.expr_parent[e.idx()];
            if bound.is_unchecked(e.idx()) {
                continue;
            }
            let text = self.files().atoms.bytes(name);
            // `check_private_name_access` checks `a.#b` and its receiver; `check_private_names` adds 18016 and 18012.
            if text.first() == Some(&b'#') {
                continue;
            }
            let is_name_missing = text.is_empty();
            let (receiver, _) = self.chain_receiver(file, obj, chain);
            if !self.is_known(receiver) || self.is_uncertain(file, obj) {
                continue;
            }
            // `checkNonNullExpression`, of `super` as of anything else.
            let left = self.check_not_nullish(file, obj, receiver, out);
            // `right.Text() != ""`: the parser reports a missing name. Only the receiver is checked.
            if is_name_missing {
                continue;
            }
            // What is in error is not looked into, which what is nothing but `null` or `undefined` is whatever the options
            // (`checkNonNullType`).
            if self.is_any(left) || self.every_type(left, |_, m| m.is_null() || m.is_undefined()) {
                continue;
            }
            // `isMethodAccessForCall`
            let is_called = matches!(parent, Parent::Expr(p)
                if matches!(hir[p].kind, ExprKind::Call(c) | ExprKind::New(c) if hir[c].callee == e));
            // `IsAssignmentTarget`, which what is called is not.
            let is_assigned = !is_called && self.is_written(file, e);
            // `getWidenedType`: what is assigned to, or called, is looked up in the type a variable would get.
            let looked_into = if is_called || is_assigned {
                self.regular_object(left)
            } else {
                left
            };
            let apparent = self.apparent_type(looked_into);
            let apparent = self.reduced(apparent);
            // `getApparentType`: without strictNullChecks `unknown` is `{}`.
            let apparent = if apparent == TypeId::UNKNOWN && !strict_null_checks {
                TypeId::EMPTY_OBJECT
            } else {
                apparent
            };
            if self.is_any(apparent) || !self.is_known(apparent) {
                continue;
            }
            // What may be anything at all has nothing that can be counted on.
            let is_unconstrained = strict_null_checks
                && self.is_deferred(left)
                && self.base_constraint(left) == TypeId::UNKNOWN;
            if is_unconstrained {
                out.push(Diagnostic {
                    start: name_pos,
                    code: 2339,
                });
                self.explain_no_property(file, e, left, name, name_pos, 2339);
                continue;
            }
            // Through what a type parameter extends an index signature can be read, not written: `getApplicableIndexInfoForName`
            // is not asked.
            let no_index_signatures = is_assigned
                && self.is_generic_object_type(left)
                && !matches!(self.data(left), TypeData::ThisParam(_));
            if self.type_of_property(apparent, name).is_none()
                || no_index_signatures && !self.has_property_of_type(apparent, name)
            {
                // `getPropertyOfTypeEx` with `includeTypeOnlyMembers`: what a qualified name in `typeof a.b` is looked up with.
                if bound.is_in_type_query(e)
                    && self.type_only_member_of_module(apparent, name).is_some()
                {
                    continue;
                }
                // `isJSLiteralType(leftType)`: a property missing from a JS literal type is `any`, read or written. `isUncheckedJS` is
                // only true in plain JavaScript, where `check_file` drops every code reported below.
                if self.is_js_literal_type(left) {
                    continue;
                }
                // A global that is scoped to blocks is no property of `globalThis`. Anything else it lacks is `any`, without anybody saying so.
                if matches!(
                    self.data(left),
                    TypeData::Anon {
                        origin: Origin::GlobalThis,
                        ..
                    }
                ) {
                    if self.is_block_scoped_global(name) {
                        out.push(Diagnostic {
                            start: name_pos,
                            code: 2339,
                        });
                        self.explain(name_pos, 2339, |c| {
                            vec![c.atom_text(name), c.type_to_string(left)]
                        });
                    } else if self.p.files.options.no_implicit_any {
                        out.push(Diagnostic {
                            start: name_pos,
                            code: 7017,
                        });
                    }
                    continue;
                }
                // `checkAndReportErrorForExtendingInterface`
                if self.is_extending_interface(file, e) {
                    let start = self.start_of(file, e);
                    out.push(Diagnostic { start, code: 2689 });
                    let end = self.end_of_expr(file, e);
                    self.explain_to(start, end, 2689, |c| vec![c.entity_name_around(file, e)]);
                    continue;
                }
                let containing = if matches!(self.data(left), TypeData::ThisParam(_)) {
                    apparent
                } else {
                    left
                };
                let code = self.why_no_property(file, e, containing, name);
                out.push(Diagnostic {
                    start: name_pos,
                    code,
                });
                self.explain_no_property(file, e, containing, name, name_pos, code);
                continue;
            }
            // `isDeleteTarget`
            let is_deleted = matches!(parent, Parent::Expr(p) if matches!(hir[p].kind, ExprKind::Unary { op: UnOp::Delete, .. }));
            // A name that only an index signature answers for, which is not written through if it says `readonly`.
            if (is_assigned || is_deleted) && !self.has_property_of_type(apparent, name) {
                let infos = self.index_signatures_of(apparent);
                let key = self.string_literal(name, false);
                if self
                    .index_signature_for_key(&infos, key)
                    .is_some_and(|(_, is_readonly)| is_readonly)
                {
                    let start = self.start_inside_parentheses(file, e);
                    out.push(Diagnostic { start, code: 2542 });
                    let end = self.end_inside_parentheses(file, e);
                    self.explain_to(start, end, 2542, |c| vec![c.type_to_string(apparent)]);
                }
                continue;
            }
            let is_super = matches!(hir[obj].kind, ExprKind::Super);
            let writing = !is_called && self.is_write_access(file, e);
            if let Some(code) =
                self.why_not_accessible(file, Parent::Expr(e), is_super, writing, apparent, name)
            {
                out.push(Diagnostic {
                    start: name_pos,
                    code,
                });
                self.explain(name_pos, code, |c| {
                    c.names_in_inaccessibility(
                        file,
                        Parent::Expr(e),
                        is_super,
                        writing,
                        apparent,
                        name,
                    )
                });
            }
        }
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

    /// Private names out of place: 18016 1451 (`checkGrammarPrivateIdentifierExpression`), 18016 for `a.#b` on `any` outside every class
    /// (`checkPropertyAccessExpressionOrQualifiedName`), 18012 (`checkPrivateIdentifier` of binder.go), 18024 (`checkEnumMember`).
    /// A bare `#x` is an `ExprKind::String` whose source text starts with `#`.
    fn check_private_names(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // Empty for a declaration file.
        let text = &hir.text[..];
        // `checkEnumMember`: a plain error.
        for (i, member) in hir.enum_members.iter().enumerate() {
            if bound.enum_member_owner[i].is_some() && is_private_name_at(hir, member.pos) {
                out.push(Diagnostic {
                    start: member.pos,
                    code: 18024,
                });
            }
        }
        // The rest are grammar errors, and the binder also reports nothing in a file with parse diagnostics.
        if has_parse_diagnostics(hir) {
            return;
        }
        for (i, member) in hir.members.iter().enumerate() {
            if !matches!(bound.member_owner[i], MemberOwner::None)
                && is_private_constructor_name(text, member.pos)
            {
                out.push(Diagnostic {
                    start: member.pos,
                    code: 18012,
                });
            }
        }
        let index = self.exprs_by_kind(file);
        for &e in index.of(ExprTag::Dot) {
            let ExprKind::Dot {
                obj,
                name_pos,
                chain,
                ..
            } = hir[e].kind
            else {
                continue;
            };
            if !is_private_name_at(hir, name_pos) || bound.is_unchecked(e.idx()) {
                continue;
            }
            if is_private_constructor_name(text, name_pos) {
                out.push(Diagnostic {
                    start: name_pos,
                    code: 18012,
                });
            }
            if bound.is_in_type_query(e) || !self.classes_around_private_name(file, e).is_empty() {
                continue;
            }
            let (receiver, _) = self.chain_receiver(file, obj, chain);
            if !self.is_known(receiver) || self.is_uncertain(file, obj) {
                continue;
            }
            let apparent = self.apparent_type(receiver);
            if self.is_any(apparent) {
                out.push(Diagnostic {
                    start: name_pos,
                    code: 18016,
                });
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
                out.push(Diagnostic {
                    start: pos,
                    code: 18012,
                });
            }
            if self.enclosing_classes(file, e).is_empty() {
                out.push(Diagnostic {
                    start: pos,
                    code: 18016,
                });
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
                out.push(Diagnostic {
                    start: pos,
                    code: 1451,
                });
            }
        }
    }

    /// `a[k]`: 18046 to 18050, 2531 to 2533, 2571; 2493 2339 2537 2538, 2542, 7015 7052 7053 2551 2576.
    /// `checkIndexedAccess`, `checkElementAccessExpression`, `getIndexedAccessTypeOrUndefined`, and `getPropertyTypeForIndexType`
    /// where an expression does the looking up.
    fn check_element_accesses(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let no_implicit_any = self.p.files.options.no_implicit_any;
        let by_kind = self.exprs_by_kind(file);
        for &e in by_kind.of(ExprTag::Index) {
            let ExprKind::Index { obj, index, chain } = hir[e].kind else {
                continue;
            };
            let i = e.idx();
            if bound.is_unchecked(i) {
                continue;
            }
            // `checkNonNullExpression`: that the object is there comes first, whatever the key.
            let (receiver, _) = self.chain_receiver(file, obj, chain);
            if !self.is_known(receiver) || self.is_uncertain(file, obj) {
                continue;
            }
            let object = self.check_not_nullish(file, obj, receiver, out);
            // `getWidenedType`: what is assigned to, or called, is looked up in the type a variable would get.
            let object = if self.is_written_or_called(file, e) {
                self.regular_object(object)
            } else {
                object
            };
            // `checkIdentifier`: the missing argument of `a[]` is `errorType`, a key of type `any`.
            let mut keys = self.type_of_expr(file, index);
            if !self.is_known(keys) || self.is_uncertain(file, index) {
                continue;
            }
            // `getIndexedAccessTypeOrUndefined`: before it is asked whether the key puts the answer off.
            let reduced = self.reduced(object);
            keys = self.key_into_string_index_only(reduced, keys);
            // What is in error is not looked into, which what is nothing but `null` or `undefined` is whatever the options
            // (`checkNonNullType`). A key that waits for its type parameters puts the answer off.
            if self.is_error_type(object)
                || object.is_null()
                || object.is_undefined()
                || self.is_generic(keys)
            {
                continue;
            }
            let apparent = if object.is_any() {
                Some(object)
            } else {
                self.type_looked_into(object)
            };
            let Some(apparent) = apparent else {
                continue;
            };
            if self.is_for_in_variable_for_numeric_names(file, index) {
                keys = TypeId::NUMBER;
            }
            // A `const enum` is looked into with a string literal. Anything else is 2476, and in error.
            let is_const_enum = matches!(*self.data(apparent), TypeData::Anon { origin: Origin::EnumObject(sym), .. }
                if self.files().decls_of(sym).iter().any(|&(f, d)| matches!(d, crate::bind::Decl::Enum(id) if self.hir(f)[id].flags.contains(Flags::CONST))));
            if is_const_enum && !is_string_literal_like(hir, index) {
                continue;
            }
            // `IsAssignmentTarget`
            let is_target = self.is_written(file, e);
            // `isDeleteTarget`
            let is_written = is_target
                || matches!(bound.expr_parent[i], Parent::Expr(p) if matches!(hir[p].kind, ExprKind::Unary { op: UnOp::Delete, .. }));
            // `bindDeferredExpandoAssignment`: the access is the target of an assignment that declares a property of a function or class.
            let is_expando_declaration = matches!(bound.expr_parent[i], Parent::Expr(p)
                if matches!(hir[p].kind, ExprKind::Assign { target, .. } if target == e)
                    && (bound.declared_fn_keyed_expandos.iter().any(|x| x.2 == p) || bound.fn_expr_keyed_expandos.iter().any(|x| x.2 == p)));
            // `AccessFlagsNoIndexSignatures`: what waits for its type parameters is not written to through a signature of what it extends.
            let no_index_signatures = is_target
                && self.is_generic_object_type(object)
                && !matches!(self.data(object), TypeData::ThisParam(_));
            let (at_access, at_index) = (
                self.start_inside_parentheses(file, e),
                self.start_of(file, index),
            );
            let infos = self.index_signatures_of(apparent);
            // What is missing for one member of a union of keys is `any`, which is not said again of the members after it.
            let mut was_missing = false;
            let mut parts: SmallVec<[TypeId; 8]> = if keys == TypeId::BOOLEAN {
                smallvec![keys]
            } else {
                SmallVec::from_slice(self.parts(keys))
            };
            parts.sort_by(|&a, &b| self.compare_types(a, b));
            for key in parts {
                let name = self.property_name_of_type(key);
                if let Some(name) = name {
                    // Whether it can be written to is asked of the property (2540), not of a signature.
                    if self.has_property_of_type(apparent, name) {
                        continue;
                    }
                    // A number for a name, and nothing but tuples to look it up in.
                    if self.is_numeric_name(name) && self.every_type(apparent, |c, m| c.is_tuple(m))
                    {
                        let place: f64 = self.files().atoms.text(name).parse().unwrap_or(f64::NAN);
                        if let Some(code) = self.past_the_end_of_tuples(apparent, name) {
                            out.push(Diagnostic {
                                start: at_index,
                                code,
                            });
                            let end = self.end_of_expr(file, index);
                            self.explain_to(at_index, end, code, |c| {
                                c.names_in_no_lookup(code, apparent, key)
                            });
                        }
                        // Below zero in a tuple that ends: 2514, and `undefined`.
                        if place < 0.0
                            && matches!(self.data(apparent), TypeData::Tuple { flags, .. } if !flags.iter().any(|f| f.intersects(ElemFlags::REST | ElemFlags::VARIADIC)))
                        {
                            continue;
                        }
                        if place >= 0.0 {
                            // `errorIfWritingToReadonlyIndex`
                            if is_written
                                && infos.iter().any(|info| info.0 == TypeId::NUMBER && info.1)
                            {
                                out.push(Diagnostic {
                                    start: at_access,
                                    code: 2542,
                                });
                                let end = self.end_inside_parentheses(file, e);
                                self.explain_to(at_access, end, 2542, |c| {
                                    vec![c.type_to_string(apparent)]
                                });
                            }
                            continue;
                        }
                    }
                }
                let plain = self.constraint_for_operator(key);
                let is_key_like = self.is_key_like(key);
                let is_literal_key =
                    self.is_literal(key) && (self.is_string_like(key) || self.is_number_like(key));
                // `objectType.flags&(TypeFlagsAny|TypeFlagsNever) != 0`: they have every key that is string-, number- or symbol-like.
                if is_key_like && (apparent == TypeId::NEVER || apparent.is_any()) {
                    continue;
                }
                if is_key_like
                    && let Some((by, is_readonly)) = self.index_signature_for_key(&infos, key)
                {
                    if no_index_signatures && by != TypeId::NUMBER {
                        // 2862, which is said with what else there is to say of keys.
                        was_missing = true;
                    } else if by == TypeId::STRING
                        && !self.is_any(key)
                        && !self
                            .every_type(plain, |c, m| c.is_string_like(m) || c.is_number_like(m))
                    {
                        // The signature for strings stands in for symbols, which is an error all the same.
                        out.push(Diagnostic {
                            start: at_index,
                            code: 2538,
                        });
                        let end = self.end_of_expr(file, index);
                        self.explain_to(at_index, end, 2538, |c| vec![c.type_to_string(key)]);
                    } else if is_written && is_readonly {
                        out.push(Diagnostic {
                            start: at_access,
                            code: 2542,
                        });
                        let end = self.end_inside_parentheses(file, e);
                        self.explain_to(at_access, end, 2542, |c| vec![c.type_to_string(apparent)]);
                    }
                    continue;
                }
                // `isJSLiteralType(objectType)`: a key that finds nothing in a JS literal type gives `any`.
                if self.is_js_literal_type(apparent) {
                    continue;
                }
                // Nothing about `any` is said of a `const enum`: the member is missing, whatever the options.
                if is_key_like && !is_const_enum {
                    // `lateBindMember`: the assignment declares the property that `key` names.
                    if is_expando_declaration && name.is_some() {
                        continue;
                    }
                    if self.is_object_literal_type(apparent) {
                        if no_implicit_any && is_literal_key {
                            out.push(Diagnostic {
                                start: at_access,
                                code: 2339,
                            });
                            let end = self.end_inside_parentheses(file, e);
                            self.explain_another(at_access, end, 2339, |c| {
                                c.names_in_no_lookup(2339, apparent, key)
                            });
                            continue;
                        }
                        if key == TypeId::STRING || key == TypeId::NUMBER {
                            continue;
                        }
                    }
                    if matches!(
                        self.data(apparent),
                        TypeData::Anon {
                            origin: Origin::GlobalThis,
                            ..
                        }
                    ) && name.is_some_and(|n| self.is_block_scoped_global(n))
                    {
                        out.push(Diagnostic {
                            start: at_access,
                            code: 2339,
                        });
                        let end = self.end_inside_parentheses(file, e);
                        self.explain_to(at_access, end, 2339, |c| {
                            c.names_in_no_lookup(2339, apparent, key)
                        });
                        was_missing = true;
                        continue;
                    }
                    let is_said = no_implicit_any && !was_missing;
                    was_missing = true;
                    if !is_said {
                        continue;
                    }
                    let (end_of_access, end_of_index) = (
                        self.end_inside_parentheses(file, e),
                        self.end_of_expr(file, index),
                    );
                    if let Some(name) = name
                        && self.static_side_has(apparent, name)
                    {
                        out.push(Diagnostic {
                            start: at_access,
                            code: 2576,
                        });
                        self.explain_to(at_access, end_of_access, 2576, |c| {
                            let container = c.type_to_string(apparent);
                            let written = c.source_text(file, at_index, end_of_index);
                            let member = format!("{container}[{written}]");
                            vec![c.atom_text(name), container, member]
                        });
                    } else if infos.iter().any(|info| info.0 == TypeId::NUMBER) {
                        out.push(Diagnostic {
                            start: at_index,
                            code: 7015,
                        });
                        self.explain_to(at_index, end_of_index, 7015, |_| Vec::new());
                    } else if name.is_some_and(|n| self.is_property_misspelt(apparent, n, None)) {
                        out.push(Diagnostic {
                            start: at_index,
                            code: 2551,
                        });
                        self.explain_to(at_index, end_of_index, 2551, |c| {
                            let mut names = c.names_in_no_lookup(2339, apparent, key);
                            names.push(
                                match name.and_then(|n| c.property_meant(apparent, n, None, true)) {
                                    Some(meant) => c.name_of_unread_property(meant),
                                    None => String::new(),
                                },
                            );
                            names
                        });
                    } else if self.has_accessor_method_for(apparent, key, is_target) {
                        out.push(Diagnostic {
                            start: at_access,
                            code: 7052,
                        });
                        self.explain_to(at_access, end_of_access, 7052, |c| {
                            let method = if is_target { "set" } else { "get" };
                            let call = match c.access_to_string(file, obj) {
                                Some(receiver) => format!("{receiver}.{method}"),
                                None => method.to_owned(),
                            };
                            vec![c.type_to_string(apparent), call]
                        });
                    } else {
                        out.push(Diagnostic {
                            start: at_access,
                            code: 7053,
                        });
                        self.explain_to(at_access, end_of_access, 7053, |c| {
                            vec![c.type_to_string(keys), c.type_to_string(apparent)]
                        });
                        self.explain_chain(at_access, 7053, |c| {
                            c.lines_under_implicit_any_element(apparent, key)
                        });
                    }
                    continue;
                }
                let code = if is_literal_key {
                    2339
                } else if key == TypeId::STRING || key == TypeId::NUMBER {
                    2537
                } else {
                    2538
                };
                out.push(Diagnostic {
                    start: at_index,
                    code,
                });
                let end = self.end_of_expr(file, index);
                self.explain_to(at_index, end, code, |c| {
                    // `indexNode.Kind == KindBigIntLiteral`
                    if matches!(hir[index].kind, ExprKind::BigInt(_))
                        && !is_parenthesized(c.hir(file), index)
                    {
                        return vec!["bigint".to_owned()];
                    }
                    c.names_in_no_lookup(code, apparent, key)
                });
                was_missing = true;
            }
        }
    }

    /// What goes into the message `getPropertyTypeForIndexType` has for `key`, which finds nothing in `object`: 2339 2493 2537 2538.
    pub(super) fn names_in_no_lookup(
        &mut self,
        code: u32,
        object: TypeId,
        key: TypeId,
    ) -> Vec<String> {
        let name = match self.property_name_of_type(key) {
            Some(name) => self.atom_text(name),
            None => String::new(),
        };
        match code {
            2339 => vec![name, self.type_to_string(object)],
            2493 => {
                // `getTypeReferenceArity`
                let length = match self.data(object) {
                    TypeData::Tuple { elems, .. } => elems.len(),
                    _ => 0,
                };
                vec![self.type_to_string(object), length.to_string(), name]
            }
            2537 => vec![self.type_to_string(object), self.type_to_string(key)],
            2538 => vec![self.type_to_string(key)],
            _ => Vec::new(),
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
            args: vec![first, self.type_to_string(object)],
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

    /// `getReducedApparentType`, of what an expression or a pattern looks into. `None`: it is `any`, or the answer is put off.
    fn type_looked_into(&mut self, object: TypeId) -> Option<TypeId> {
        // What waits for its type parameters is looked into through what it extends.
        let looked_into = if self.has_type_variables(object) {
            self.map_type(object, |c, m| {
                // Of `T & { a: 1 }`, what `T` extends and `{ a: 1 }`.
                if let TypeData::Intersection(parts) = c.data(m) {
                    let parts: Vec<TypeId> = parts
                        .iter()
                        .map(|&p| {
                            if c.is_deferred(p) {
                                c.base_constraint(p)
                            } else {
                                p
                            }
                        })
                        .collect();
                    let whole = c.intersection(&parts);
                    return c.apparent_type(whole);
                }
                // What extends nothing extends `unknown`.
                if c.is_deferred(m) && c.base_constraint(m) == TypeId::UNKNOWN {
                    return TypeId::UNKNOWN;
                }
                c.apparent_type(m)
            })
        } else {
            object
        };
        let apparent = self.reduced_apparent_type(looked_into);
        // `getApparentType`: without strictNullChecks `unknown` is `{}`. With them it has nothing at all.
        let apparent = if apparent == TypeId::UNKNOWN && !self.p.files.options.strict_null_checks {
            TypeId::EMPTY_OBJECT
        } else {
            apparent
        };
        // `shouldDeferIndexedAccessType`: of the objects only a tuple with `...T` in it puts the answer off.
        if !self.is_known(apparent)
            || self.is_any(apparent)
            || self.some_type(apparent, |c, m| {
                c.is_deferred(m) || c.is_generic_tuple_type(m)
            })
        {
            return None;
        }
        Some(apparent)
    }

    /// `getReducedApparentType`
    fn reduced_apparent_type(&mut self, ty: TypeId) -> TypeId {
        let ty = self.reduced(ty);
        let apparent = self.apparent_type(ty);
        self.reduced(apparent)
    }

    /// Whether `name` is a global `let`, `const`, class or enum (`SymbolFlagsBlockScoped`): those are no properties of `globalThis`.
    fn is_block_scoped_global(&self, name: Atom) -> bool {
        self.files().globals.get(&name).is_some_and(|&global| {
            self.files()
                .flags(global)
                .intersects(SymFlags::BLOCK_SCOPED_VARIABLE | SymFlags::CLASS | SymFlags::ENUM)
        })
    }

    /// Whether `getPropertyOfType` finds `name` in `ty`, which is an apparent type. In a union (`createUnionOrIntersectionProperty`)
    /// a member declares it, and each of the others has a signature for the name, which the name of a symbol never has, or is an
    /// object literal that leaves it out. What is private or protected in a member, and not the same declaration in all, is not there.
    pub(super) fn has_property_of_type(&mut self, ty: TypeId, name: Atom) -> bool {
        let is_late_bound = self.files().atoms.is_symbol_name(name);
        let mut is_declared = false;
        for &part in self.parts(ty) {
            let part = self.apparent_type(part);
            let Some(members) = self.members(part) else {
                return false;
            };
            if self.property_in(&members, name).is_some() {
                is_declared = true;
                continue;
            }
            // `getApplicableIndexInfoForName`
            let literal = self.string_literal(name, false);
            if !(!is_late_bound
                && members
                    .shape()
                    .index
                    .iter()
                    .any(|info| self.is_applicable_index_type(literal, info.key)))
                && !self.is_closed_object_literal_type(part)
            {
                return false;
            }
        }
        let parts = self.parts(ty);
        is_declared && !(parts.len() > 1 && self.is_hidden_in_union(parts, name))
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

    /// `isApplicableIndexType`: whether a signature for `target` covers the key `source`.
    pub(super) fn is_applicable_index_type(&mut self, source: TypeId, target: TypeId) -> bool {
        self.is_assignable(source, target)
            || target == TypeId::STRING && self.is_assignable(source, TypeId::NUMBER)
            || target == TypeId::NUMBER
                && (self.is_numeric_string_type(source)
                    || matches!(*self.data(source), TypeData::StringLit { value, .. } | TypeData::EnumLit { value: EnumValue::String(value), .. }
                        if self.is_numeric_name(value)))
    }

    /// `getPropertyTypeForIndexType`: what is said of the numeric name `name` where `object` is a tuple, or a union of tuples, that
    /// all end, and none has an element by that name: 2493 of a tuple, 2339 of a union. (Below zero in a tuple is 2514, which is
    /// said of `a[k]` and `T[K]` with what else there is to say of keys, and of a pattern by `why_no_lookup`.)
    pub(super) fn past_the_end_of_tuples(&self, object: TypeId, name: Atom) -> Option<u32> {
        if !self.is_numeric_name(name)
            || !self.every_type(object, |c, m| {
                matches!(c.data(m), TypeData::Tuple { flags, .. } if !flags.iter().any(|f| f.intersects(ElemFlags::REST | ElemFlags::VARIADIC)))
            })
        {
            return None;
        }
        let place: f64 = self.files().atoms.text(name).parse().ok()?;
        // `createUnionOrIntersectionProperty`: what one member has is a property of the union.
        if place >= 0.0
            && place.fract() == 0.0
            && self.some_type(object, |c, m| matches!(c.data(m), TypeData::Tuple { elems, .. } if (place as usize) < elems.len()))
        {
            return None;
        }
        if self.is_union(object) {
            Some(2339)
        } else if place < 0.0 {
            None
        } else {
            Some(2493)
        }
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
        // The expression and the statement gone out of last. A computed name is known by the one; by the other, whether it is the body
        // of a loop that is come out of, which is all of it that counts.
        let (mut below, mut child) = (index, StmtId::NONE);
        let mut parent = bound.expr_parent[index.idx()];
        loop {
            parent = match parent {
                Parent::None | Parent::File => return false,
                Parent::Expr(x) if x.is_none() => return false,
                Parent::Expr(x) => {
                    below = x;
                    bound.expr_parent[x.idx()]
                }
                Parent::Key(_) | Parent::MemberKey => match self.what_is_named(file, parent, below)
                {
                    Named::Property(literal) | Named::Function(literal) => Parent::Expr(literal),
                    Named::Element(element) => Parent::PatPropDefault(element),
                    Named::Member(member) => Parent::MemberInit(member),
                    Named::Unknown => return false,
                },
                Parent::Stmt(s) if s.is_some() => {
                    if let StmtKind::ForIn { left, expr, body } = hir[s].kind
                        && child.is_some()
                        && child == body
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
                    child = s;
                    bound.stmt_parent[s.idx()]
                }
                _ => self.outward(file, parent),
            };
        }
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

    /// `getSuggestionForNonexistentProperty`, `getSuggestedSymbolForNonexistentProperty`: whether whoever wrote `name` may have meant
    /// a property of `object`, which is an apparent type. Given the `a.b` it is written in, only what is within reach there counts
    /// (`isValidPropertyAccessForCompletions`).
    fn is_property_misspelt(
        &mut self,
        object: TypeId,
        name: Atom,
        access: Option<(FileId, ExprId)>,
    ) -> bool {
        self.property_meant(object, name, access, false).is_some()
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
        let mut best: Option<(f64, ((u8, FileId, u32), &[u8]), Atom)> = None;
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
                    || self.is_union(object) && !self.has_property_of_type(object, prop.name)
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
                            self.why_not_accessible(
                                file,
                                Parent::Expr(e),
                                is_super,
                                false,
                                object,
                                prop.name,
                            )
                            .is_none()
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
                let distance = edit_distance(text, candidate);
                let order = (self.order_of_property(prop), candidate);
                if best.is_none_or(|(least, first, _)| {
                    distance < least || distance == least && order < first
                }) {
                    best = Some((distance, order, prop.name));
                }
            }
            if members.shape().index.is_empty() {
                break;
            }
        }
        best.map(|found| found.2)
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
                Some(self.place_of_token(file, self.hir(file)[member].pos))
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
            | PropSource::Copy(..) => None,
        }
    }

    /// `GetErrorRangeForNode(symbol.ValueDeclaration)`. `None`: nothing declares `sym` as a value.
    pub(super) fn place_where_value_is_declared(&self, sym: Sym) -> Option<(FileId, u32, u32)> {
        use crate::bind::Decl;
        let sym = self.files().canonical(sym);
        let flags = self.files().flags(sym);
        let is_assignment = |decl: Decl| matches!(decl, Decl::ExportsProperty(_));
        // `SetValueDeclaration`: the first that declares a value. An assignment gives way to any other declaration, and a namespace
        // to what is no namespace.
        let mut found: Option<(FileId, Decl)> = None;
        for &(file, decl) in self.files().decls_of(sym).iter() {
            let declares = match decl {
                Decl::Var(_)
                | Decl::Param(_)
                | Decl::ExportsProperty(_)
                | Decl::CommonJsVariable => SymFlags::VARIABLE,
                Decl::Fn(_) => SymFlags::FUNCTION,
                Decl::Class(_) => SymFlags::CLASS,
                Decl::Enum(_) => SymFlags::ENUM,
                Decl::EnumMember(_) => SymFlags::ENUM_MEMBER,
                Decl::Module(m) if self.bound(file).module_instantiated[m.idx()] => {
                    SymFlags::VALUE_MODULE
                }
                _ => continue,
            };
            // What the name refuses is listed among its declarations, and adds nothing to its flags.
            if !flags.intersects(declares) {
                continue;
            }
            let takes_over = found.is_none_or(|(_, first)| {
                is_assignment(first) && !is_assignment(decl)
                    || matches!(first, Decl::Module(_)) && !matches!(decl, Decl::Module(_))
            });
            if takes_over {
                found = Some((file, decl));
            }
        }
        let (file, decl) = found?;
        let hir = self.hir(file);
        let start = match decl {
            Decl::Var(pat) => hir[pat].pos,
            Decl::Param(pat) => match self.bound(file).pat_parent[pat.idx()] {
                // All of the parameter, with what is written before its name.
                PatParent::Param(param) => {
                    return Some((file, hir[param].pos, self.end_of_param(file, param)));
                }
                _ => hir[pat].pos,
            },
            Decl::Fn(f) => hir[f].name_pos,
            Decl::Class(c) => hir[c].name_pos,
            Decl::Enum(e) => hir[e].name_pos,
            Decl::EnumMember(m) => hir[m].pos,
            Decl::Module(m) => hir[m].name_pos,
            // All of the assignment, or of the call.
            Decl::ExportsProperty(e) => {
                return Some((file, self.start_of(file, e), self.end_of_expr(file, e)));
            }
            // `declareCommonJSVariable`: the file, which goes by its first token.
            Decl::CommonJsVariable => {
                let start = self.skip_trivia_from(file, 0);
                return Some((file, start, self.end_of_token_at(file, start)));
            }
            _ => return None,
        };
        Some(self.place_of_token(file, start))
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
                .map(|&(file, member)| (file, self.hir(file)[member].pos)),
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
            PropSource::Intersected(_, parts) | PropSource::Copy(_, parts, _)
                if !parts.is_empty() =>
            {
                return self.order_of_property(&parts[0]);
            }
            PropSource::Mapped(of, _) => {
                return match self.synthetic_origin_of_mapped_property(*of, prop.name) {
                    Some(origin) => self.order_of_property(&origin),
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

    /// What a pattern takes out of something has to be within reach: 2341 2445 2446. What an object pattern takes out, and what a type
    /// looks up in another, has to be there: 2339 2493 2514 2537 2538.
    fn check_lookups_by_name(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for p in 0..hir.pats.len() {
            if matches!(hir.pats[p].kind, PatKind::Object(_) | PatKind::Array(_)) {
                self.check_lookups_of_pattern(file, PatId(p as u32), out);
            }
        }
        // `getTypeFromIndexedAccessTypeNode`
        for t in 0..hir.types.len() {
            let TypeNodeKind::IndexedAccess { obj, index } = hir.types[t].kind else {
                continue;
            };
            if bound.is_unchecked_type(t) {
                continue;
            }
            let (object, keys) = (
                self.type_from_node(file, obj),
                self.type_from_node(file, index),
            );
            let (object, keys) = (self.force(object), self.force(keys));
            // `shouldDeferIndexedAccessType`
            if !self.is_known(object)
                || !self.is_known(keys)
                || self.is_generic(object)
                || self.is_generic(keys)
            {
                continue;
            }
            let apparent = self.reduced_apparent_type(object);
            // Each member of a union of keys is answered for by itself, whatever is wrong with the others.
            for &key in self.parts(keys) {
                let Some(code) = self.why_no_lookup(apparent, key, false) else {
                    continue;
                };
                // Below zero in a tuple is said with what else there is to say of keys.
                if code == 2514 {
                    continue;
                }
                out.push(Diagnostic {
                    start: hir[index].pos,
                    code,
                });
                // `boolean` is not taken apart (`getIndexedAccessTypeOrUndefined`).
                let key = if keys == TypeId::BOOLEAN { keys } else { key };
                let end = self.end_of_type_node(file, index);
                self.explain_another(hir[index].pos, end, code, |c| {
                    c.names_in_no_lookup(code, apparent, key)
                });
            }
        }
    }

    /// `checkVariableLikeDeclaration` and `getBindingElementTypeFromParentType`, of the elements of `pattern`.
    fn check_lookups_of_pattern(
        &mut self,
        file: FileId,
        pattern: PatId,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let first = match hir[pattern].kind {
            PatKind::Object(props) if !props.is_empty() => hir[props.at(0)].value,
            PatKind::Array(elems) if !elems.is_empty() => hir[elems.at(0)].pat,
            _ => return,
        };
        // `GetRootDeclaration`: the variable or the parameter it is part of, which is where it is asked from.
        let mut root = pattern;
        while let PatParent::Prop(outer, _) | PatParent::Elem(outer, _) =
            bound.pat_parent[root.idx()]
        {
            root = outer;
        }
        let around = match bound.pat_parent[root.idx()] {
            PatParent::Var(d) => Parent::VarInit(d),
            PatParent::Param(param) => Parent::ParamDefault(param),
            _ => return,
        };
        // Whether that is a parameter of what has no body; one that nothing types, so that it is what its pattern makes of it
        // (`getTypeFromBindingPattern`); one that was widened before its pattern was looked at.
        let (mut has_no_body, mut is_implied, mut is_widened) = (false, false, false);
        // The default of the parameter, where that is all that says what it is.
        let mut says = ExprId::NONE;
        if let Parent::ParamDefault(param) = around {
            let func = bound.param_fn[param.idx()];
            let owner = bound.fns[func.idx()].owner;
            if matches!(owner, FnOwner::None) {
                return;
            }
            has_no_body = matches!(hir[func].body, FnBody::None)
                && !hir[func].flags.contains(Flags::BODY_DROPPED);
            if hir[param].ty.is_none() {
                // Of a setter the getter says.
                if hir[func].kind == FnKind::Setter {
                    return;
                }
                match self.contextual_param_type(
                    file,
                    func,
                    (param.0 - hir[func].params.start) as usize,
                ) {
                    // `assignParameterType`: where nothing but `unknown` is expected the pattern says what it is.
                    Some(TypeId::UNKNOWN) => is_implied = true,
                    // `assignContextualParameterTypes` weighs what is expected against the default: not looked into. Nor is what is
                    // expected in terms of type parameters.
                    Some(expected)
                        if hir[param].default.is_some() || self.has_type_variables(expected) =>
                    {
                        return;
                    }
                    Some(_) => {}
                    None => {
                        if let FnOwner::Expr(function) = owner {
                            // Nothing is expected of the function, as far as can be told.
                            if !self.is_context_known(file, function) {
                                return;
                            }
                            // `assignParameterType`: its parameters get their types, widened, before their patterns are looked at.
                            is_widened = true;
                        }
                        says = hir[param].default;
                        is_implied = says.is_none();
                    }
                }
            }
        }
        // `getTypeForBindingElementParent`
        let given = if is_implied && pattern == root {
            self.type_implied_by_pattern(file, pattern)
                .unwrap_or(TypeId::ANY)
        } else {
            self.type_for_binding_element_parent(file, first, pattern)
        };
        if !self.is_known(given)
            || self.is_any(given)
            || says.is_some() && self.is_uncertain(file, says)
        {
            return;
        }
        let Some(declared) = self.type_looked_into(given) else {
            return;
        };
        let initializer = match bound.pat_parent[pattern.idx()] {
            PatParent::Var(d) => hir[d].init,
            PatParent::Param(param) => hir[param].default,
            PatParent::Prop(_, prop) => hir[prop].default,
            PatParent::Elem(_, elem) => hir[elem].default,
            PatParent::None => ExprId::NONE,
        };
        let is_super = initializer.is_some() && matches!(hir[initializer].kind, ExprKind::Super);
        let props = match hir[pattern].kind {
            PatKind::Object(props) => props,
            PatKind::Array(elems) => {
                for elem in elems.iter() {
                    // `PropertyNameOrName`: what an element is bound to passes for the name of a property.
                    let binding = hir[elem].pat;
                    if let PatKind::Ident(name) = hir[binding].kind
                        && self.has_property_of_type(declared, name)
                        && let Some(code) =
                            self.why_not_accessible(file, around, is_super, false, declared, name)
                    {
                        out.push(Diagnostic {
                            start: hir[binding].pos,
                            code,
                        });
                        self.explain(hir[binding].pos, code, |c| {
                            c.names_in_inaccessibility(
                                file, around, is_super, false, declared, name,
                            )
                        });
                    }
                }
                return;
            }
            _ => return,
        };
        // What has an initializer that cannot be `undefined` is not `undefined`: whether it can has to be known.
        if self.p.files.options.strict_null_checks
            && initializer.is_some()
            && self.some_type(given, |_, m| m.is_undefined())
        {
            let ty = self.type_of_expr(file, initializer);
            if !self.is_known(ty) || self.is_uncertain(file, initializer) {
                return;
            }
        }
        // What is within reach is asked of what is taken apart as it is declared, what is there of what is left of it.
        let taken_apart = self.type_pattern_takes_apart(file, pattern, given);
        let looked_into = if taken_apart == given {
            Some(declared)
        } else {
            self.type_looked_into(taken_apart)
        };
        let Some(looked_into) = looked_into else {
            return;
        };
        // An identifier directly in the pattern of `const { a } = require("m")` is an alias (`getTypeOfAlias`), so
        // `getBindingElementTypeFromParentType` never looks it up in the initializer.
        let binds_aliases = matches!(bound.pat_parent[pattern.idx()], PatParent::Var(d) if self.external_module_require_argument(file, d).is_some());
        for prop in props.iter() {
            let prop = &hir[prop];
            // A renamed element in a parameter of what has no body is told off for that (2842), and not looked at.
            if has_no_body
                && !prop.is_rest
                && prop.pos != hir[prop.value].pos
                && matches!(hir[prop.value].kind, PatKind::Ident(_))
            {
                continue;
            }
            // `getLiteralTypeFromPropertyName` of `PropertyNameOrName`, and where that is written. `...rest` goes by its own name.
            let (keys, at_name) = match prop.key {
                _ if prop.is_rest => match hir[prop.value].kind {
                    PatKind::Ident(name) => (self.string_literal(name, false), hir[prop.value].pos),
                    _ => continue,
                },
                PropKey::Name(name) => (self.string_literal(name, false), prop.pos),
                PropKey::Computed(k) => {
                    let keys = self.type_of_expr(file, k);
                    if !self.is_known(keys) || self.is_uncertain(file, k) {
                        continue;
                    }
                    (self.regular(keys), prop.pos)
                }
                PropKey::Private(_) | PropKey::None => continue,
            };
            let name = self.property_name_of_type(keys);
            let is_declared = name.is_some_and(|name| self.has_property_of_type(declared, name));
            if is_declared
                && let Some(name) = name
                && let Some(code) =
                    self.why_not_accessible(file, around, is_super, false, declared, name)
            {
                out.push(Diagnostic {
                    start: at_name,
                    code,
                });
                let end = self.end_of_name_at(file, at_name);
                self.explain_to(at_name, end, code, |c| {
                    c.names_in_inaccessibility(file, around, is_super, false, declared, name)
                });
            }
            // What a pattern implies is the type of an object literal until it is widened: it may lack what has a default.
            if prop.is_rest || is_declared || is_implied && !is_widened && prop.default.is_some() {
                continue;
            }
            if binds_aliases && matches!(hir[prop.value].kind, PatKind::Ident(_)) {
                continue;
            }
            // `shouldDeferIndexedAccessType`
            if self.is_generic(keys) {
                continue;
            }
            // `getIndexNodeForAccessExpression`: of a computed name, what is in the brackets. `["a"]` is kept as the name `a`.
            let at = match prop.key {
                PropKey::Computed(k) => self.start_of(file, k),
                _ if hir.text.get(prop.pos as usize) == Some(&b'[') => {
                    let inside = &hir.text[prop.pos as usize + 1..];
                    prop.pos + 1 + (inside.len() - inside.trim_ascii_start().len()) as u32
                }
                _ => prop.pos,
            };
            for &key in self.parts(keys) {
                let Some(code) = self.why_no_lookup(looked_into, key, prop.default.is_some())
                else {
                    continue;
                };
                // A bigint is no name for a property, whatever it reads as.
                let is_bigint = code == 2339
                    && matches!(prop.key, PropKey::Name(_))
                    && is_bigint_literal(&hir.text, at);
                let code = if is_bigint { 2538 } else { code };
                out.push(Diagnostic { start: at, code });
                let end = match prop.key {
                    PropKey::Computed(k) => self.end_of_expr(file, k),
                    _ => self.end_of_name_at(file, at),
                };
                // `boolean` is not taken apart (`getIndexedAccessTypeOrUndefined`).
                let key = if keys == TypeId::BOOLEAN { keys } else { key };
                self.explain_to(at, end, code, |c| {
                    if is_bigint {
                        vec!["bigint".to_owned()]
                    } else {
                        c.names_in_no_lookup(code, looked_into, key)
                    }
                });
            }
        }
    }

    /// `getPropertyTypeForIndexType`, where it is not an expression that does the looking up: what is wrong with looking `key`, which
    /// is no union, up in `object`, which is an apparent type. `allows_missing`: what is looked for has a default.
    pub(super) fn why_no_lookup(
        &mut self,
        object: TypeId,
        key: TypeId,
        allows_missing: bool,
    ) -> Option<u32> {
        if let Some(name) = self.property_name_of_type(key) {
            if self.has_property_of_type(object, name) {
                return None;
            }
            // A number for a name, and nothing but tuples to look it up in.
            if self.is_numeric_name(name) && self.every_type(object, |c, m| c.is_tuple(m)) {
                if !allows_missing && let Some(code) = self.past_the_end_of_tuples(object, name) {
                    return Some(code);
                }
                if !self.files().atoms.bytes(name).starts_with(b"-") {
                    return None;
                }
                // Below zero in a tuple that ends. In any other the signature for numbers answers.
                if !allows_missing
                    && matches!(self.data(object), TypeData::Tuple { flags, .. } if !flags.iter().any(|f| f.intersects(ElemFlags::REST | ElemFlags::VARIADIC)))
                {
                    return Some(2514);
                }
            }
        }
        if self.is_key_like(key) {
            // `any` and `never` have whatever can be a key at all.
            if self.is_any(object) || object == TypeId::NEVER {
                return None;
            }
            let infos = self.index_signatures_of(object);
            if let Some((by, _)) = self.index_signature_for_key(&infos, key) {
                // The signature for strings stands in for symbols, which is an error all the same.
                let stands_in = by == TypeId::STRING
                    && !self.is_assignable(key, TypeId::NUMBER)
                    && !self.is_assignable(key, TypeId::STRING);
                return stands_in.then_some(2538);
            }
        }
        if allows_missing && self.is_object_literal_type(object) {
            return None;
        }
        // `isJSLiteralType(objectType)`: a key that finds nothing in a JS literal type gives `any`.
        if self.is_js_literal_type(object) {
            return None;
        }
        Some(
            if self.is_literal(key) && (self.is_string_like(key) || self.is_number_like(key)) {
                2339
            } else if key == TypeId::STRING || key == TypeId::NUMBER {
                2537
            } else {
                2538
            },
        )
    }

    /// `reportNonexistentProperty`: what is said of `name`, written at `e`, which `containing` has nothing by.
    pub(super) fn why_no_property(
        &mut self,
        file: FileId,
        e: ExprId,
        containing: TypeId,
        name: Atom,
    ) -> u32 {
        // The static side and what is promised are asked for a `#x` by its text, which is the name of no property.
        let is_private = self.files().atoms.bytes(name).first() == Some(&b'#');
        // `typeHasStaticProperty`
        if !is_private
            && let TypeData::Ref { target, .. } = *self.data(containing)
            && self.files().flags(target).contains(SymFlags::CLASS)
        {
            let statics = self.intern(TypeData::Anon {
                origin: Origin::ClassStatic(target),
                mapper: MapperId::IDENTITY,
            });
            if self
                .prop_ref(statics, name)
                .is_some_and(|(prop, _)| matches!(prop.source, PropSource::Members(_)))
            {
                return 2576;
            }
        }
        // The same message, with a hint.
        if self.is_property_of_what_is_promised(containing, name) {
            return 2339;
        }
        let apparent = self.apparent_type(containing);
        if self.library_with_property(apparent, name).is_some() {
            return 2550;
        }
        // `getSuggestedSymbolForNonexistentProperty`: it is for a property access that what is out of reach is left out, which the
        // `a.b` of `typeof a.b` in a type is not.
        let is_access = matches!(self.hir(file)[e].kind, ExprKind::Dot { .. })
            && !self.bound(file).is_in_type_query(e);
        let looked_into = self.reduced(apparent);
        if self.is_property_misspelt(looked_into, name, is_access.then_some((file, e))) {
            return 2551;
        }
        // `containerSeemsToBeEmptyDomElement`. `everyContainedType`: the members of a union, or of an intersection.
        let contained: &[TypeId] = match self.data(containing) {
            TypeData::Union(parts) | TypeData::Intersection(parts) => &parts[..],
            _ => std::slice::from_ref(&containing),
        };
        if !self.p.files.options.has_dom_lib()
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
        {
            return 2812;
        }
        2339
    }

    /// It is what `containing` promises that has `name`: `await` was forgotten. `GetPromisedTypeOfPromise`
    fn is_property_of_what_is_promised(&mut self, containing: TypeId, name: Atom) -> bool {
        // It is asked for a `#x` by its text, which is the name of no property.
        if self.files().atoms.bytes(name).first() == Some(&b'#') {
            return false;
        }
        let promised = match self.is_global_ref(containing, known::Promise) {
            Some(&[promised]) => Some(promised),
            _ => self.thenable_value(containing),
        };
        match promised {
            Some(promised) => {
                let promised = self.apparent_type(promised);
                self.has_property_of_type(promised, name)
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

    /// What `reportNonexistentProperty` puts into the message `why_no_property` chose, which is `code`, and under it. `start`: where
    /// `name` is written.
    pub(super) fn explain_no_property(
        &mut self,
        file: FileId,
        e: ExprId,
        containing: TypeId,
        name: Atom,
        start: u32,
        code: u32,
    ) {
        self.explain(start, code, |c| {
            let missing = c.declaration_name_at(file, start);
            let reduced = c.reduced(containing);
            let container = c.type_to_string(reduced);
            let last = match code {
                2576 => format!("{container}.{missing}"),
                2550 => {
                    let apparent = c.apparent_type(containing);
                    c.library_with_property(apparent, name)
                        .unwrap_or_default()
                        .to_owned()
                }
                2551 => {
                    let is_access = matches!(c.hir(file)[e].kind, ExprKind::Dot { .. })
                        && !c.bound(file).is_in_type_query(e);
                    let apparent = c.apparent_type(containing);
                    let looked_into = c.reduced(apparent);
                    let access = is_access.then_some((file, e));
                    match c.property_meant(looked_into, name, access, true) {
                        Some(meant) => c.name_of_unread_property(meant),
                        None => String::new(),
                    }
                }
                _ => return vec![missing, container],
            };
            vec![missing, container, last]
        });
        if code == 2551 {
            self.relate(start, code, |c| {
                let is_access = matches!(c.hir(file)[e].kind, ExprKind::Dot { .. })
                    && !c.bound(file).is_in_type_query(e);
                let apparent = c.apparent_type(containing);
                let looked_into = c.reduced(apparent);
                let access = is_access.then_some((file, e));
                let Some(meant) = c.property_meant(looked_into, name, access, true) else {
                    return Vec::new();
                };
                match c.place_of_property_meant(looked_into, meant) {
                    Some(place) => vec![c.declared_here(place, c.name_of_unread_property(meant))],
                    None => Vec::new(),
                }
            });
        }
        self.explain_chain(start, code, |c| {
            // The first member of a union that lacks it.
            let is_private = c.files().atoms.bytes(name).first() == Some(&b'#');
            // `TypeFlagsPrimitive`: `boolean`, and an enum, which is the union of its members.
            let is_enum = match c.parts(containing).first().map(|&first| c.data(first)) {
                Some(
                    &TypeData::EnumLit { member, .. } | &TypeData::Enum { symbol: member, .. },
                ) => c.enum_type_of_member(member) == containing,
                _ => false,
            };
            if !is_private && containing != TypeId::BOOLEAN && !is_enum && c.is_union(containing) {
                for &member in c.parts(containing) {
                    let apparent = c.apparent_type(member);
                    if c.type_of_property(apparent, name).is_none() {
                        return vec![Line {
                            code: 2339,
                            args: vec![
                                c.declaration_name_at(file, start),
                                c.type_to_string(member),
                            ],
                            level: 1,
                        }];
                    }
                }
            }
            match code {
                2339 | 2812 => {
                    let chain =
                        c.elaborate_never_intersection(None, (file, start, start), containing);
                    super::explain::lines_of(chain.into_iter().collect())
                }
                _ => Vec::new(),
            }
        });
        if code == 2339 {
            self.relate(start, code, |c| {
                if !c.is_property_of_what_is_promised(containing, name) {
                    return Vec::new();
                }
                vec![super::explain::Related {
                    at: Some(c.place_of_token(file, start)),
                    code: 2773,
                    args: Vec::new(),
                }]
            });
        }
    }

    /// `elaborateNeverIntersection`
    pub(super) fn elaborate_never_intersection(
        &mut self,
        chain: Option<Reported>,
        at: (FileId, u32, u32),
        ty: TypeId,
    ) -> Option<Reported> {
        let TypeData::Intersection(parts) = self.data(ty) else {
            return chain;
        };
        if !self.is_never_intersection(ty) {
            return chain;
        }
        let Some(members) = self.members(ty) else {
            return chain;
        };
        let (mut discriminant, mut private) = (None, None);
        for prop in &members.shape().props {
            let PropSource::Intersected(_, of) = &prop.source else {
                continue;
            };
            // `isConflictingPrivateProperty`
            if private.is_none()
                && prop.flags.contains(PropFlags::PRIVATE)
                && Self::value_declaration(prop).is_none()
            {
                private = Some(prop);
            }
            // `isDiscriminantWithNeverType`
            if prop.flags.contains(PropFlags::OPTIONAL)
                || self.type_of_prop(prop, members.mapper) != TypeId::NEVER
            {
                continue;
            }
            let mut types = Vec::with_capacity(of.len());
            for part in of.iter() {
                types.push(self.type_of_prop(part, MapperId::IDENTITY));
            }
            if !types.contains(&TypeId::NEVER)
                && types.iter().any(|&t| t != types[0])
                && types.iter().any(|&t| {
                    t == TypeId::BOOLEAN
                        || self.is_pattern_literal(t)
                        || self.every_type(t, |c, m| c.is_unit(m))
                })
            {
                discriminant = Some(prop);
                break;
            }
        }
        let (code, prop) = match (discriminant, private) {
            (Some(prop), _) => (18031, prop),
            (None, Some(prop)) => (18032, prop),
            (None, None) => return chain,
        };
        // `TypeFormatFlagsNoTypeReduction`: the members as they are written down, and not `never`.
        let mut written = Vec::with_capacity(parts.len());
        for &part in parts.iter() {
            written.push(self.type_to_string(part));
        }
        let (written, prop) = (written.join(" & "), self.prop_to_string(prop));
        let args = [Arg::Text(&written), Arg::Text(&prop)];
        Some(self.new_diagnostic_chain(chain, at, code, &args))
    }

    /// The classes `e` is written in, from the inside out.
    pub(super) fn enclosing_classes(&self, file: FileId, e: ExprId) -> Vec<ClassId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // The operand of a `typeof` in a type hangs on the function, namespace or file around, whatever class it is written in.
        if bound.is_in_type_query(e) {
            let mut top = e;
            while let Parent::Expr(x) = bound.expr_parent[top.idx()]
                && x.is_some()
            {
                top = x;
            }
            if let Some(node) = hir
                .types
                .iter()
                .position(|t| matches!(t.kind, TypeNodeKind::Typeof { expr, .. } if expr == top))
            {
                return Self::classes_around_scope(bound, bound.type_scope[node]);
            }
        }
        self.classes_around(file, Parent::Expr(e))
    }

    /// The classes `scope` is in, from the inside out.
    fn classes_around_scope(bound: &Bound, mut scope: ScopeId) -> Vec<ClassId> {
        let mut classes = Vec::new();
        while scope.is_some() {
            if let ScopeKind::Class(class) = bound.scopes[scope.idx()].kind {
                classes.push(class);
            }
            scope = bound.scopes[scope.idx()].parent;
        }
        classes
    }

    /// `GetContainingClass`, again and again. `Parent::Expr(e)` stands for `e` itself: it is what is around it that counts.
    pub(super) fn classes_around(&self, file: FileId, parent: Parent) -> Vec<ClassId> {
        self.classes_around_from(file, parent, false)
    }

    /// `getContainingClassExcludingClassDecorators`, then `GetContainingClass` again and again: the classes the private name of `e`,
    /// an `a.#b`, is looked up in.
    fn classes_around_private_name(&self, file: FileId, e: ExprId) -> Vec<ClassId> {
        self.classes_around_from(file, Parent::Expr(e), true)
    }

    /// `excludes_class_decorators`: a decorator of a class is not in that class, if no other class is in between.
    fn classes_around_from(
        &self,
        file: FileId,
        mut parent: Parent,
        excludes_class_decorators: bool,
    ) -> Vec<ClassId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut classes = Vec::new();
        let around_class = |class: ClassId| match bound.class_owner[class.idx()] {
            ClassOwner::Expr(x) => Parent::Expr(x),
            ClassOwner::Stmt(s) => bound.stmt_parent[s.idx()],
        };
        let in_member =
            |member: MemberId, classes: &mut Vec<ClassId>| match bound.member_owner[member.idx()] {
                MemberOwner::Class(class) => {
                    classes.push(class);
                    around_class(class)
                }
                _ => Parent::None,
            };
        // An enum, an interface or a type literal has no place among the expressions: the scopes tell what it is written in.
        let scope_of = |kind: ScopeKind| {
            bound
                .scopes
                .iter()
                .position(|s| s.kind == kind)
                .map_or(ScopeId::NONE, |s| ScopeId(s as u32))
        };
        // The expression gone out of last: a computed name is known by it.
        let mut top = ExprId::NONE;
        loop {
            parent = match parent {
                Parent::Expr(x) if x.is_some() => {
                    top = x;
                    bound.expr_parent[x.idx()]
                }
                Parent::Stmt(s) if s.is_some() => bound.stmt_parent[s.idx()],
                Parent::VarInit(d) => Parent::Stmt(bound.var_stmt[d.idx()]),
                Parent::PatPropDefault(_) | Parent::PatElemDefault(_) => self.outward(file, parent),
                Parent::Prop(p) => Parent::Expr(bound.prop_owner[p.idx()]),
                Parent::Case(c) => Parent::Stmt(bound.case_stmt[c.idx()]),
                Parent::MemberInit(member) => in_member(member, &mut classes),
                Parent::EnumInit(member) => {
                    let scope = scope_of(ScopeKind::Enum(bound.enum_member_owner[member.idx()]));
                    classes.extend(Self::classes_around_scope(bound, scope));
                    return classes;
                }
                // What a class extends and its decorators are part of it.
                Parent::ClassExtends(class) | Parent::Decorator(class, _) => {
                    let is_excluded = excludes_class_decorators
                        && classes.is_empty()
                        && matches!(parent, Parent::Decorator(_, DecoratorOwner::Class(_)));
                    if !is_excluded {
                        classes.push(class);
                    }
                    around_class(class)
                }
                // So is the computed name of a member.
                Parent::MemberKey if top.is_some() => match hir
                    .members
                    .iter()
                    .position(|m| m.key == PropKey::Computed(top))
                {
                    Some(m) => {
                        let scope = match bound.member_owner[m] {
                            MemberOwner::Class(_) => {
                                parent = in_member(MemberId(m as u32), &mut classes);
                                continue;
                            }
                            MemberOwner::Interface(x) => scope_of(ScopeKind::Interface(x)),
                            MemberOwner::TypeLiteral(t) => bound.type_scope[t.idx()],
                            MemberOwner::None => ScopeId::NONE,
                        };
                        classes.extend(Self::classes_around_scope(bound, scope));
                        return classes;
                    }
                    // Of a method or an accessor of an object literal.
                    None => match hir
                        .props
                        .iter()
                        .position(|p| p.key == PropKey::Computed(top))
                    {
                        Some(p) => Parent::Expr(bound.prop_owner[p]),
                        None => return classes,
                    },
                },
                Parent::Key(owner) if owner.is_some() => Parent::Expr(owner),
                // In a pattern.
                Parent::Key(_) if top.is_some() => match hir
                    .pat_props
                    .iter()
                    .position(|p| p.key == PropKey::Computed(top))
                {
                    Some(p) => self.outward(file, Parent::PatPropDefault(PatPropId(p as u32))),
                    None => return classes,
                },
                Parent::FnBody(_) | Parent::ParamDefault(_) => {
                    let f = match parent {
                        Parent::FnBody(f) => f,
                        Parent::ParamDefault(p) => bound.param_fn[p.idx()],
                        _ => unreachable!(),
                    };
                    match bound.fns[f.idx()].owner {
                        FnOwner::Expr(x) if x.is_some() => Parent::Expr(x),
                        FnOwner::Stmt(s) if s.is_some() => bound.stmt_parent[s.idx()],
                        FnOwner::Member(member) => in_member(member, &mut classes),
                        _ => return classes,
                    }
                }
                _ => return classes,
            };
        }
    }

    /// `IsWriteAccess`: the left of `=` or of an operator that assigns, the operand of `++` or `--`, the variable of `for..in/of`, or
    /// an element, or the value of a property, of a literal that is one of these. Neither `!` nor `...` is seen through (`accessKind`).
    fn is_write_access(&self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut at = e;
        loop {
            match bound.expr_parent[at.idx()] {
                Parent::Expr(parent) if parent.is_some() => match hir[parent].kind {
                    ExprKind::Assign { target, .. } => return target == at,
                    ExprKind::Unary {
                        op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                        ..
                    } => return true,
                    ExprKind::Array(_) => at = parent,
                    _ => return false,
                },
                Parent::Prop(p)
                    if hir[p].kind == PropKind::Init
                        && matches!(hir[bound.prop_owner[p.idx()]].kind, ExprKind::Object(_)) =>
                {
                    at = bound.prop_owner[p.idx()];
                }
                Parent::Stmt(s) if s.is_some() => {
                    return matches!(bound.stmt_parent[s.idx()], Parent::Stmt(l) if l.is_some()
                        && matches!(hir[l].kind, StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if left == s));
                }
                _ => return false,
            }
        }
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

    /// `checkPropertyAccessibilityAtLocation`, for the property `name` of `containing`, asked for in what `at` stands for
    /// (`Parent::Expr(e)`: by `e` itself), which writes to it if `writing`.
    pub(super) fn why_not_accessible(
        &mut self,
        file: FileId,
        at: Parent,
        is_super: bool,
        writing: bool,
        containing: TypeId,
        name: Atom,
    ) -> Option<u32> {
        self.inaccessibility(file, at, is_super, writing, containing, name)
            .map(|found| found.code)
    }

    /// What goes into the message `why_not_accessible` chose.
    pub(super) fn names_in_inaccessibility(
        &mut self,
        file: FileId,
        at: Parent,
        is_super: bool,
        writing: bool,
        containing: TypeId,
        name: Atom,
    ) -> Vec<String> {
        let Some(found) = self.inaccessibility(file, at, is_super, writing, containing, name)
        else {
            return Vec::new();
        };
        let mut names = vec![self.prop_to_string(&found.prop)];
        match found.class {
            Some(class) => {
                let class = self.declared_type(class);
                names.push(self.type_to_string(class));
            }
            None if found.code == 2445 => names.push(self.type_to_string(found.containing)),
            None => {}
        }
        if found.code == 2446 {
            names.push(self.type_to_string(found.containing));
        }
        names
    }

    /// `why_not_accessible`, with what the message names.
    fn inaccessibility(
        &mut self,
        file: FileId,
        at: Parent,
        is_super: bool,
        writing: bool,
        containing: TypeId,
        name: Atom,
    ) -> Option<Inaccessible> {
        // `forEachProperty`: a property of a union or of an intersection is made of those of the members.
        let mut parts: SmallVec<[&Prop; 4]> = SmallVec::new();
        for &member in self.parts(containing) {
            let member = self.apparent_type(member);
            let (prop, _) = self.prop_ref(member, name)?;
            properties_intersected(prop, &mut parts);
        }
        let first = *parts.first()?;
        let found = |code: u32, class: Option<Sym>, containing: TypeId| Inaccessible {
            code,
            prop: first.clone(),
            class,
            containing,
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
                return Some(found(2513, self.declaring_class(first), containing));
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
                return Some(found(2855, None, containing));
            }
        }
        if !flags.intersects(hidden) {
            return None;
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
            if !is_declared_once {
                return None;
            }
            let declaring = self.declaring_class(first)?;
            return (!enclosing.contains(&declaring))
                .then(|| found(2341, Some(declaring), containing));
        }
        if is_super {
            return None;
        }
        // `isClassDerivedFromDeclaringClasses`: the classes that declare those of them that are protected.
        let mut declaring: Vec<Sym> = Vec::new();
        for part in &parts {
            if self
                .modifiers_of_property(part, writing)
                .contains(Flags::PROTECTED)
            {
                declaring.push(self.declaring_class(part)?);
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
            let class = if is_declared_once {
                self.declaring_class(first)
            } else {
                None
            };
            return Some(found(2445, class, containing));
        };
        if is_static {
            return None;
        }
        // And only through an instance of that class, which a union is not (`hasBaseType`).
        let through = if self.is_deferred(containing) {
            self.base_constraint(containing)
        } else {
            containing
        };
        (!self.has_base(through, enclosing_class, 0))
            .then(|| found(2446, Some(enclosing_class), through))
    }
}

/// `forEachProperty`: the properties a property of an intersection is made of; any other, itself.
fn properties_intersected<'a>(prop: &'a Prop, out: &mut SmallVec<[&'a Prop; 4]>) {
    match &prop.source {
        PropSource::Intersected(_, parts) => parts
            .iter()
            .for_each(|part| properties_intersected(part, out)),
        _ => out.push(prop),
    }
}

/// Whether the private name written at `pos` is `#constructor`.
fn is_private_constructor_name(text: &[u8], pos: u32) -> bool {
    text.get(pos as usize) == Some(&b'#') && is_word_at(text, pos as usize + 1, b"constructor")
}

/// Whether what is written at `at` is a bigint literal: a number that ends in `n`.
fn is_bigint_literal(text: &[u8], at: u32) -> bool {
    let written = text.get(at as usize..).unwrap_or_default();
    let end = written
        .iter()
        .position(|b| !b.is_ascii_alphanumeric() && *b != b'_')
        .unwrap_or(written.len());
    written.first().is_some_and(u8::is_ascii_digit) && written[..end].ends_with(b"n")
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
