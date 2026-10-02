//! Types as they are written, and what looking one type up in another comes to:
//! 1257 1265 1266 2574 (tuple types), 2799 2800 (tuples too large), 2590 (unions too large), 2589 (instantiation depth),
//! 1338 2838 (`infer`), 1354 (`readonly`), 2795 (`intrinsic`), 2526 (`this`), 1021 1268 1337 (index signatures),
//! 7061 (mapped types), 2804 18016 (private names), 1176 (interfaces), 1099 1009 (lists of type arguments, `import()`),
//! 2848 2635 (instantiation expressions), 2536 4105 2542 2862 2514 (`T[K]`, `a[k]`).
//!
//! Follows `checkTupleType`, `TupleNormalizer.normalize`, `checkCrossProductUnion`, `removeSubtypes`, `instantiateTypeWithAlias`,
//! `checkInferType`, `getThisType`, `checkTypeAliasDeclaration`, `checkObjectTypeForDuplicateDeclarations`,
//! `checkPropertySignature`, `checkMethodDeclaration`, `checkIndexedAccessIndexType`, `getPropertyTypeForIndexType`,
//! `checkExpressionWithTypeArguments` and `getInstantiationExpressionType` of TypeScript 7.0.2's checker.go, and
//! `checkGrammarIndexSignatureParameters`, `checkGrammarTypeArguments`, `checkGrammarImportCallExpression`,
//! `checkGrammarInterfaceDeclaration`, `checkGrammarProperty` and `checkGrammarTypeOperatorNode` of its grammarchecks.go.
//!
//! What the summary of a file does not keep (parentheses around types, where a list of type arguments is) is read off the text.

use super::errors::Diagnostic;
use super::*;
use crate::bind::{Decl, MemberOwner, Parent};
use crate::resolve::ModuleKind;
use crate::util::FxHashSet;

/// `hasParseDiagnostics`: the parser or the scanner objected to something in the file, and `grammarErrorOnNode` and its like say nothing.
/// Of type syntax that was given up on it is not known whether they did. `parse_for_sema` sets the flag by the origin of each error,
/// so a code the parser shares with `grammarErrorOnNode` (1005 ..) does not count. Declaration files have no flag: there the codes tell.
pub(super) fn has_parse_diagnostics(hir: &hir::File) -> bool {
    hir.has_parse_diagnostics
        || hir.has_errors
        || hir.syntax_errors > 0
        || hir.kind == FileKind::Declaration && hir.early_errors.iter().any(|&(_, code)| {
            matches!(
                code,
                1002 | 1003 | 1005 | 1007 | 1010..=1012 | 1034 | 1068 | 1069 | 1084 | 1109 | 1110 | 1121 | 1124..=1132 | 1134..=1140
                    | 1142 | 1144..=1146 | 1160 | 1161 | 1177..=1181 | 1185 | 1198 | 1199 | 1206 | 1209 | 1223 | 1228 | 1260 | 1327
                    | 1328 | 1351..=1353 | 1357 | 1369 | 1381 | 1382 | 1385..=1390 | 1433..=1443 | 1453 | 1472 | 1477 | 1478
                    | 1486..=1490 | 2657 | 2754 | 2809 | 2819 | 2880 | 6188 | 6189 | 17002 | 17006..=17008 | 17014 | 17015 | 17021
                    | 18009 | 18016 | 18026 | 18029 | 18030
            )
        })
}

// ───────────────────────────── the text ─────────────────────────────

/// Past the string or the template that starts at `pos`.
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

/// Where the `>` is that closes the list of type arguments of which the type at `pos` is the last.
fn end_of_type_arguments(text: &[u8], pos: usize) -> Option<usize> {
    let (mut depth, mut at) = (0usize, pos);
    loop {
        at = skip_trivia(text, at);
        match *text.get(at)? {
            b'<' | b'(' | b'[' | b'{' => depth += 1,
            b'=' if text.get(at + 1) == Some(&b'>') => at += 1,
            b'>' if depth == 0 => return Some(at),
            // Of parentheses around the type, which are not kept.
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

/// Where the comma is that the list of type arguments `args` ends with, if it does: `<A, B,>`.
fn trailing_comma_of_type_arguments(hir: &hir::File, args: IdList<TypeNodeId>) -> Option<u32> {
    let last = hir.ids(args).next_back()?;
    let end = skip_trivia_back(
        &hir.text,
        end_of_type_arguments(&hir.text, hir[last].pos as usize)?,
    );
    hir.text[..end].ends_with(b",").then(|| end as u32 - 1)
}

/// What a text has of lists between `<` and `>` that `checkGrammarTypeArguments` objects to. A `<` or `>` that is an operator, or is
/// in a comment or a string, counts too: this only tells where there is nothing to look for.
#[derive(Copy, Clone, Default)]
struct OddLists {
    /// Some `<` is followed by `>`.
    has_empty: bool,
    /// Some `>` follows `,` or `<`.
    has_early_end: bool,
}

impl OddLists {
    fn written_in(text: &[u8]) -> OddLists {
        const CHUNK: usize = 64;
        let mut lists = OddLists::default();
        for (n, chunk) in text.chunks(CHUNK).enumerate() {
            if lists.has_empty && lists.has_early_end {
                break;
            }
            // `<` and `>` differ in one bit.
            if !chunk.iter().fold(false, |any, &c| any | (c | 2 == b'>')) {
                continue;
            }
            // Eight bytes at a time: a bit for each that is one of the two, and at times for the byte after one.
            let words = chunk.chunks_exact(8);
            let rest = words.remainder().len();
            for (w, word) in words.enumerate() {
                let word = u64::from_le_bytes(word.try_into().unwrap());
                let other = (word | 0x0202_0202_0202_0202) ^ 0x3e3e_3e3e_3e3e_3e3e;
                let mut found =
                    other.wrapping_sub(0x0101_0101_0101_0101) & !other & 0x8080_8080_8080_8080;
                while found != 0 {
                    let at = n * CHUNK + w * 8 + found.trailing_zeros() as usize / 8;
                    lists.look_at(text, at);
                    found &= found - 1;
                }
            }
            for i in chunk.len() - rest..chunk.len() {
                lists.look_at(text, n * CHUNK + i);
            }
        }
        lists
    }

    /// Takes note of what is at `at`, if it is `<` or `>`.
    fn look_at(&mut self, text: &[u8], at: usize) {
        let c = text[at];
        if c == b'<' && !self.has_empty {
            self.has_empty = text.get(skip_trivia(text, at + 1)) == Some(&b'>');
        } else if c == b'>' && !self.has_early_end {
            self.has_early_end =
                matches!(text[..skip_trivia_back(text, at)].last(), Some(b',' | b'<'));
        }
    }
}

/// Where the type `node`, which is all of an element or an argument, starts as it is written: parentheses around a type are not
/// kept.
fn start_of_type(hir: &hir::File, node: TypeNodeId) -> u32 {
    let text: &[u8] = &hir.text;
    let mut at = hir[node].pos as usize;
    // `(T)`, `| T`: a bar before the whole of a type leads it.
    loop {
        let end = skip_trivia_back(text, at);
        if !matches!(text[..end].last(), Some(b'(' | b'|' | b'&')) {
            return at as u32;
        }
        at = end - 1;
    }
}

/// Where an element of a tuple type starts: at its `...`, at its name, or at its type.
fn start_of_tuple_element(hir: &hir::File, elem: &TupleElem) -> u32 {
    let text: &[u8] = &hir.text;
    let before_dots = |at: usize| {
        let end = skip_trivia_back(text, at);
        if text[..end].ends_with(b"...") {
            end - 3
        } else {
            at
        }
    };
    let mut at = start_of_type(hir, elem.ty) as usize;
    if elem.rest {
        at = before_dots(at);
    }
    if elem.name.is_some() {
        let mut end = skip_trivia_back(text, at);
        if !text[..end].ends_with(b":") {
            return at as u32;
        }
        end = skip_trivia_back(text, end - 1);
        if text[..end].ends_with(b"?") {
            end = skip_trivia_back(text, end - 1);
        }
        at = word_start(text, end);
        if elem.rest {
            at = before_dots(at);
        }
    }
    at as u32
}

/// Where `implements` is written in the head of the interface whose name is at `name_pos`. `None` if it is not, or a second
/// `extends` comes first: `checkGrammarInterfaceDeclaration` stops at whichever it meets first.
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

// ───────────────────────────── what is written ─────────────────────────────

const TUPLE: u32 = 1 << 0;
const TEMPLATE: u32 = 1 << 1;
const INTERSECTION: u32 = 1 << 2;
const INFER: u32 = 1 << 3;
const READONLY: u32 = 1 << 4;
const UNIQUE_SYMBOL: u32 = 1 << 5;
const THIS: u32 = 1 << 6;
const INDEXED_ACCESS: u32 = 1 << 7;
const TYPEOF: u32 = 1 << 8;

/// Which of these kinds of types the file has any of.
fn kinds_of_types_written(hir: &hir::File) -> u32 {
    hir.types.iter().fold(0, |kinds, node| {
        kinds
            | match node.kind {
                TypeNodeKind::Tuple(_) => TUPLE,
                TypeNodeKind::Template { .. } => TEMPLATE,
                TypeNodeKind::Intersection(_) => INTERSECTION,
                TypeNodeKind::Infer(_) => INFER,
                TypeNodeKind::Readonly(_) => READONLY,
                TypeNodeKind::UniqueSymbol => UNIQUE_SYMBOL,
                TypeNodeKind::Keyword(Keyword::This) => THIS,
                TypeNodeKind::IndexedAccess { .. } => INDEXED_ACCESS,
                TypeNodeKind::Typeof { .. } => TYPEOF,
                _ => 0,
            }
    })
}

/// Whether the element starts with `...`. `name: ...T` does not, whatever else is wrong with it.
fn is_rest_element(hir: &hir::File, elem: &TupleElem) -> bool {
    // Of a declaration file the text is not kept.
    elem.rest
        && (elem.name.is_none()
            || hir.text.is_empty()
            || hir.text[start_of_tuple_element(hir, elem) as usize..].starts_with(b"..."))
}

/// `getArrayElementTypeNode`: `X` for `X[]`, `[...X[]]`, `[...[...X[]]]`.
pub(super) fn array_element_type_node(hir: &hir::File, node: TypeNodeId) -> Option<TypeNodeId> {
    if node.is_none() {
        return None;
    }
    match hir[node].kind {
        TypeNodeKind::Array(element) => Some(element),
        TypeNodeKind::Tuple(elems)
            if elems.len() == 1 && is_rest_element(hir, &hir[elems.at(0)]) =>
        {
            rest_element_type_node(hir, &hir[elems.at(0)])
        }
        _ => None,
    }
}

/// The same of what follows the `...` of an element. `...X[]?` is `...` of `X[]?`, which is not written as an array.
fn rest_element_type_node(hir: &hir::File, elem: &TupleElem) -> Option<TypeNodeId> {
    if elem.name.is_none() && elem.optional {
        None
    } else {
        array_element_type_node(hir, elem.ty)
    }
}

/// `getTupleElementFlags`
fn tuple_element_flags(hir: &hir::File, elem: &TupleElem) -> ElemFlags {
    if elem.name.is_some() && elem.optional {
        ElemFlags::OPTIONAL
    } else if is_rest_element(hir, elem) {
        if rest_element_type_node(hir, elem).is_some() {
            ElemFlags::REST
        } else {
            ElemFlags::VARIADIC
        }
    } else if elem.name.is_none() && elem.optional {
        ElemFlags::OPTIONAL
    } else {
        ElemFlags::REQUIRED
    }
}

/// `isVariadicTupleElement`: `...T`, where `T` is not written as an array.
fn is_variadic_element(hir: &hir::File, elem: &TupleElem) -> bool {
    tuple_element_flags(hir, elem) == ElemFlags::VARIADIC
}

/// A key that says which member is meant whatever the type parameters around it are.
fn is_plain_key(hir: &hir::File, node: TypeNodeId) -> bool {
    match hir[node].kind {
        TypeNodeKind::StringLit(_)
        | TypeNodeKind::NumberLit(_)
        | TypeNodeKind::Keyword(Keyword::String | Keyword::Number) => true,
        TypeNodeKind::Union(members) => hir.ids(members).all(|m| is_plain_key(hir, m)),
        _ => false,
    }
}

/// The arguments of the message `why_not_a_key_of` chose for `object[keys]`: of 4105 the name of the property, of 2536 both types.
fn arguments_of_refused_key(
    c: &mut Checker<'_>,
    code: u32,
    object: TypeId,
    keys: TypeId,
) -> Vec<String> {
    if code == 4105 {
        let name = c.property_name_of_type(keys);
        return name.map(|name| c.atom_text(name)).into_iter().collect();
    }
    vec![c.type_to_string(keys), c.type_to_string(object)]
}

impl Checker<'_> {
    pub(super) fn check_x_typenodes(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // The text of the default library is not kept.
        if hir.text.is_empty() {
            return;
        }
        let exprs = self.exprs_by_kind(file);
        let lists = if has_parse_diagnostics(hir) {
            OddLists::default()
        } else {
            OddLists::written_in(&hir.text)
        };
        self.check_private_names_of_both_kinds(file, out);
        self.check_private_names_in_signatures(file, out);
        self.check_members_next_to_a_mapping(file, out);
        self.check_type_argument_lists_of_calls(file, &exprs, lists, out);
        self.check_commas_of_import_calls(file, &exprs, out);
        self.check_instantiation_expressions(file, &exprs, out);
        self.check_instantiations_after_instanceof(file, &exprs, out);
        self.check_clauses_of_interfaces(file, out);
        self.check_keys_of_element_accesses(file, &exprs, out);
        self.check_size_of_array_literals(file, &exprs, out);
        self.check_subtype_reduction_of_array_literals(file, &exprs, out);
        self.check_contextual_property_cross_products(file, &exprs, out);
        self.check_excessive_depth(file, out);
        if hir.types.is_empty() {
            return;
        }
        let kinds = kinds_of_types_written(hir);
        let has = |any_of: u32| kinds & any_of != 0;
        let parents = if has(INFER | THIS) {
            Self::type_node_parents(hir, bound)
        } else {
            Vec::new()
        };
        self.check_instantiated_tuple_sizes(file, out);
        if has(TEMPLATE | TUPLE | INTERSECTION) {
            self.check_size_of_cross_products(file, out);
        }
        if has(TEMPLATE) {
            self.check_template_literal_type_nodes(file, out);
        }
        if has(INFER) {
            self.check_infer_type_nodes(file, &parents, out);
        }
        if has(READONLY | UNIQUE_SYMBOL) {
            self.check_type_operator_nodes(file, out);
        }
        self.check_type_argument_lists_of_types(file, lists, out);
        if has(THIS) {
            self.check_this_type_nodes(file, &parents, out);
        }
        self.check_intrinsic_aliases(file, out);
        self.check_keys_of_index_signatures(file, out);
        if has(TYPEOF) {
            self.check_instantiated_type_queries(file, out);
        }
    }

    // ───────────────────────────── tuple types ─────────────────────────────

    /// `checkTupleType`: 2574, 1265 1266 1257. And 2799, which `TupleNormalizer.normalize` says when the type is made.
    pub(super) fn check_tuple_type(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        elems: Span<TupleElemId>,
    ) {
        let hir = self.hir(file);
        // The text of the default library is not kept.
        if hir.text.is_empty() {
            return;
        }
        let (mut seen_optional, mut seen_rest) = (false, false);
        for e in elems.iter() {
            let elem = &hir[e];
            let mut flags = tuple_element_flags(hir, elem);
            if flags.contains(ElemFlags::VARIADIC) {
                let ty = self.type_from_node(file, elem.ty);
                let mut ty = ty;
                // `...T?`: `T?` is `T` or null.
                if elem.optional && self.p.files.options.strict_null_checks {
                    ty = self.union(&[ty, TypeId::NULL]);
                }
                // What a type parameter can be spread as goes by what it extends.
                let apparent = self.apparent_type(ty);
                if !self.is_known(ty) || !self.is_known(apparent) {
                    break;
                }
                let fits = self.answer_if_sure(|c| c.can_be_spread_in_a_tuple(ty));
                if fits != Some(true) {
                    if fits == Some(false) {
                        let start = start_of_tuple_element(hir, elem);
                        self.error((file, start, self.end_of_tuple_elem(file, e)), 2574, &[]);
                    }
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
            let start = start_of_tuple_element(hir, elem);
            self.grammar_error_on_node((file, start, self.end_of_tuple_elem(file, e)), code, &[]);
            break;
        }
        self.check_size_of_tuple_type(file, node, elems);
    }

    /// `isArrayLikeType`
    fn can_be_spread_in_a_tuple(&mut self, ty: TypeId) -> bool {
        if self.is_array(ty) {
            return true;
        }
        let list = self.readonly_array_of(TypeId::ANY);
        !ty.is_undefined() && !ty.is_null() && self.is_assignable(ty, list)
    }

    /// `TupleNormalizer.normalize`, of a tuple type as it is written: 2799.
    fn check_size_of_tuple_type(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        elems: Span<TupleElemId>,
    ) {
        let hir = self.hir(file);
        if !elems.iter().any(|e| is_variadic_element(hir, &hir[e])) {
            return;
        }
        let mut count = 0;
        for e in elems.iter() {
            let mut spread = 1;
            if is_variadic_element(hir, &hir[e]) {
                let ty = self.type_from_node(file, hir[e].ty);
                if !self.is_known(ty) {
                    return;
                }
                // One that is too large itself was refused where it was made, and is `any` from then on: one rest element.
                if let TypeData::Tuple { flags, .. } = self.data(ty)
                    && flags.len() < 10_000
                {
                    spread = flags.len();
                    if spread + count >= 10_000 {
                        let end = self.end_of_type_node(file, node);
                        self.error((file, hir[node].pos, end), 2799, &[]);
                        return;
                    }
                }
            }
            count += spread;
        }
    }

    /// `TupleNormalizer.normalize`, for a tuple type produced by instantiation: 2799 at the type node whose resolution produced it.
    fn check_instantiated_tuple_sizes(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for t in 0..hir.types.len() {
            if bound.is_unchecked_type(t)
                || !matches!(
                    hir.types[t].kind,
                    TypeNodeKind::Ref { .. }
                        | TypeNodeKind::Tuple(_)
                        | TypeNodeKind::IndexedAccess { .. }
                        | TypeNodeKind::Import { .. }
                )
            {
                continue;
            }
            let node = TypeNodeId(t as u32);
            self.type_from_node(file, node);
            if self.p.too_large_tuples.len() != 0
                && self.p.too_large_tuples.get(&(file, node)).is_some()
            {
                out.push(Diagnostic {
                    start: hir.types[t].pos,
                    code: 2799,
                });
                let end = self.end_of_type_node(file, node);
                self.explain_to(hir.types[t].pos, end, 2799, |_| vec![]);
            }
        }
    }

    /// The same of an array literal that comes to a tuple: 2800.
    fn check_size_of_array_literals(
        &mut self,
        file: FileId,
        exprs: &ExprsByKind,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for i in exprs.of(ExprTag::Array).iter().map(|e| e.idx()) {
            let ExprKind::Array(items) = hir.exprs[i].kind else {
                continue;
            };
            if bound.is_unchecked(i)
                || !hir
                    .ids(items)
                    .any(|x| matches!(hir[x].kind, ExprKind::Spread(_)))
            {
                continue;
            }
            // What is refused is `any`.
            let whole = self.type_of_expr(file, ExprId(i as u32));
            if !self.is_tuple(whole) && !self.has_any_flag(whole) {
                continue;
            }
            let mut count = 0;
            for item in hir.ids(items) {
                let mut spread = 1;
                if let ExprKind::Spread(inner) = hir[item].kind {
                    let ty = self.type_of_expr(file, inner);
                    if let TypeData::Tuple { flags, .. } = self.data(ty)
                        && flags.len() < 10_000
                    {
                        spread = flags.len();
                        if spread + count >= 10_000 {
                            out.push(Diagnostic {
                                start: hir.exprs[i].pos,
                                code: 2800,
                            });
                            let end = self.end_inside_parentheses(file, ExprId(i as u32));
                            self.explain_to(hir.exprs[i].pos, end, 2800, |_| vec![]);
                            break;
                        }
                    }
                }
                count += spread;
            }
        }
    }

    /// `removeSubtypes`: 2590 at an array literal (`c.currentNode`) that has too many element types to reduce.
    fn check_subtype_reduction_of_array_literals(
        &mut self,
        file: FileId,
        exprs: &ExprsByKind,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for i in exprs.of(ExprTag::Array).iter().map(|e| e.idx()) {
            if bound.is_unchecked(i) {
                continue;
            }
            let e = ExprId(i as u32);
            // `getUnionTypeWorker` returns the error type for a union that `removeSubtypes` refuses, so the literal is `any[]`.
            // This call also caches the types of the elements.
            let ty = self.type_of_expr(file, e);
            if !self
                .array_element(ty)
                .is_some_and(|ty| self.has_any_flag(ty))
            {
                continue;
            }
            // The cached type does not record the refusal. Build the union again to observe it.
            self.union_too_complex = false;
            self.type_of_expr_uncached(file, e);
            if std::mem::take(&mut self.union_too_complex) {
                out.push(Diagnostic {
                    start: hir.exprs[i].pos,
                    code: 2590,
                });
                let end = self.end_inside_parentheses(file, e);
                self.explain_to(hir.exprs[i].pos, end, 2590, |_| vec![]);
            }
        }
    }

    /// `checkTemplateLiteralType` compares each placeholder with `templateConstraintType`: 2322. And 2321, for a comparison made on the
    /// way that runs out of depth: it has no error node, and the template literal type is `currentNode`.
    fn check_template_literal_type_nodes(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let constraint = self.union(&[
            TypeId::STRING,
            TypeId::NUMBER,
            TypeId::BOOLEAN,
            TypeId::BIGINT,
            TypeId::NULL,
            TypeId::UNDEFINED,
        ]);
        for t in 0..hir.types.len() {
            let TypeNodeKind::Template { types, .. } = hir.types[t].kind else {
                continue;
            };
            if bound.is_unchecked_type(t) {
                continue;
            }
            self.relations_too_deep.clear();
            for placeholder in hir.ids(types) {
                let ty = self.type_from_node(file, placeholder);
                if self.is_known(ty)
                    && self.answer_if_sure(|c| c.is_assignable(ty, constraint)) == Some(false)
                {
                    let start = start_of_type(hir, placeholder);
                    let end = self.end_of_type_node_from(file, placeholder, start);
                    self.report_not_assignable_with_end(ty, constraint, start, end, 2322, out);
                }
            }
            for (source, target) in std::mem::take(&mut self.relations_too_deep) {
                let end = self.end_of_type_node(file, TypeNodeId(t as u32));
                let at = (file, hir.types[t].pos, end);
                self.error(at, 2321, &[Arg::Type(source), Arg::Type(target)]);
            }
            // Printing compares too.
            self.relations_too_deep.clear();
        }
    }

    /// `checkCrossProductUnion`, of a template literal type, a tuple type or an intersection type as it is written: 2590.
    fn check_size_of_cross_products(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for t in 0..hir.types.len() {
            if bound.is_unchecked_type(t) {
                continue;
            }
            let size = match hir.types[t].kind {
                // `getTemplateLiteralType`
                TypeNodeKind::Template { types, .. } => {
                    self.size_of_cross_product(file, hir.ids(types), false)
                }
                // `createNormalizedTupleType`: what is not spread counts for one.
                TypeNodeKind::Tuple(elems) => self.size_of_cross_product(
                    file,
                    elems
                        .iter()
                        .filter(|&e| is_variadic_element(hir, &hir[e]))
                        .map(|e| hir[e].ty),
                    false,
                ),
                // `getIntersectionType`
                TypeNodeKind::Intersection(members) => {
                    self.size_of_cross_product(file, hir.ids(members), true)
                }
                _ => continue,
            };
            if size >= 100_000 {
                out.push(Diagnostic {
                    start: hir.types[t].pos,
                    code: 2590,
                });
                let end = self.end_of_type_node(file, TypeNodeId(t as u32));
                self.explain_to(hir.types[t].pos, end, 2590, |_| vec![]);
            }
        }
    }

    /// `getCrossProductUnionSize`, of the types written at `nodes`. 0 where it cannot be told.
    fn size_of_cross_product(
        &mut self,
        file: FileId,
        nodes: impl Iterator<Item = TypeNodeId>,
        is_intersection: bool,
    ) -> usize {
        let mut types: Vec<TypeId> = Vec::new();
        for node in nodes {
            let ty = self.type_from_node(file, node);
            if !self.is_known(ty) || ty.is_never() {
                return 0;
            }
            // `addTypeToIntersection` adds a repeated type once.
            if !is_intersection || !types.contains(&ty) {
                types.push(ty);
            }
        }
        if is_intersection {
            // `getIntersectionTypeEx`: `(A | undefined) & (B | undefined)` is `A & B | undefined`. The same for `null`.
            if types
                .iter()
                .all(|&t| self.is_union(t) && self.contains_undefined(t))
            {
                for t in &mut types {
                    *t = self.filter(*t, |_, m| !m.is_undefined());
                }
            }
            if types
                .iter()
                .all(|&t| self.is_union(t) && self.parts(t).iter().any(|m| m.is_null()))
            {
                for t in &mut types {
                    *t = self.filter(*t, |_, m| !m.is_null());
                }
            }
            // The product is the size of the union only if no two combinations give the same type and none gives `never`. That is
            // certain only for object types that are all different.
            let mut seen_parts: Vec<TypeId> = Vec::new();
            for &ty in &types {
                for &part in self.parts(ty) {
                    if !self.is_object_type(part) || seen_parts.contains(&part) {
                        return 0;
                    }
                    seen_parts.push(part);
                }
            }
        }
        types.iter().fold(1usize, |size, &ty| {
            if self.is_union(ty) {
                size.saturating_mul(self.parts(ty).len())
            } else {
                size
            }
        })
    }

    /// `checkCrossProductUnion`, for the intersection that `getTypeOfPropertyOfContextualType` makes of the types the members of an
    /// intersection declare for a property of an object literal: 2590 at `c.currentNode`.
    fn check_contextual_property_cross_products(
        &mut self,
        file: FileId,
        exprs: &ExprsByKind,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // (start of the object literal, contextual intersection, property name, start and end of the error)
        let mut refused: Vec<(u32, TypeId, Atom, u32, u32)> = Vec::new();
        for i in exprs.of(ExprTag::Object).iter().map(|e| e.idx()) {
            let ExprKind::Object(props) = hir.exprs[i].kind else {
                continue;
            };
            if props.is_empty() || bound.is_unchecked(i) {
                continue;
            }
            // `contextual_type_for_object_literal`. Its last step leaves out members of a union and makes none: it is spared where no
            // member is an intersection.
            let literal = ExprId(i as u32);
            let Some(context) = self.contextual_type(file, literal) else {
                continue;
            };
            let context = self.map_type_unreduced(context, |c, m| {
                if c.is_deferred(m) {
                    c.base_constraint(m)
                } else {
                    m
                }
            });
            if !self
                .parts(context)
                .iter()
                .any(|&part| self.is_intersection(part))
            {
                continue;
            }
            let context = self.discriminate_by_object_members(file, literal, context);
            for &part in self.parts(context) {
                if !self.is_intersection(part) {
                    continue;
                }
                for p in props.iter() {
                    let prop = &hir[p];
                    // `checkObjectLiteral` defers accessors, and a spread has no property name.
                    if !matches!(
                        prop.kind,
                        PropKind::Init | PropKind::Shorthand | PropKind::Method
                    ) || prop.value.is_none()
                    {
                        continue;
                    }
                    let Some(name) = self.member_name(file, prop.key) else {
                        continue;
                    };
                    self.union_too_complex = false;
                    self.contextual_property(part, name);
                    if !std::mem::take(&mut self.union_too_complex) {
                        continue;
                    }
                    let (start, end) = match hir[prop.value].kind {
                        // These ask for their contextual type while `checkExpression` has them as the current node.
                        ExprKind::Fn(_) | ExprKind::Object(_) | ExprKind::Array(_)
                            if prop.kind == PropKind::Init =>
                        {
                            (
                                self.error_start_inside_parentheses(file, prop.value),
                                self.error_end_inside_parentheses(file, prop.value),
                            )
                        }
                        // `checkExpressionForMutableLocation` and `checkObjectLiteralMethod` ask while the object literal is the
                        // current node.
                        _ => (
                            hir.exprs[i].pos,
                            self.end_inside_parentheses(file, ExprId(i as u32)),
                        ),
                    };
                    refused.push((hir.exprs[i].pos, part, name, start, end));
                }
            }
        }
        // The callers of the step that failed store the error type in `c.intersectionTypes`, so one set of types is reported once, at
        // the first node in check order.
        refused.sort_by_key(|r| r.0);
        for (i, r) in refused.iter().enumerate() {
            if !refused[..i]
                .iter()
                .any(|earlier| (earlier.1, earlier.2) == (r.1, r.2))
            {
                out.push(Diagnostic {
                    start: r.3,
                    code: 2590,
                });
                self.explain_to(r.3, r.4, 2590, |_| vec![]);
            }
        }
    }

    // ───────────────────────────── instantiation depth ─────────────────────────────

    /// `instantiateTypeWithAlias`, `getConditionalType`: 2589 at `c.currentNode`. Resolves the type nodes and the expressions of `file`
    /// in the order `checkSourceElement` and `checkExpression` visit them, with `reports_depth` set, so that `excessively_deep`
    /// reports each limit at the first node that runs into it.
    fn check_excessive_depth(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // The check functions of these kinds call `getTypeFromTypeNode` on the node. `checkArrayType`, `checkTypeOperator`,
        // `checkConditionalType`, `checkInferType`, `checkSignatureDeclaration` and `checkTypePredicate` only visit its children.
        let is_resolved_when_checked = |t: usize| {
            !bound.is_unchecked_type(t)
                && matches!(
                    hir.types[t].kind,
                    TypeNodeKind::Ref { .. }
                        | TypeNodeKind::Import { .. }
                        | TypeNodeKind::Typeof { .. }
                        | TypeNodeKind::Tuple(_)
                        | TypeNodeKind::Union(_)
                        | TypeNodeKind::Intersection(_)
                        | TypeNodeKind::Template { .. }
                        | TypeNodeKind::IndexedAccess { .. }
                        | TypeNodeKind::Mapped(_)
                )
        };
        // Resolve every type node once, so that `has_excessive` is set if one of them hits a limit. A limit hit here is not cached and
        // is hit again below.
        for t in (0..hir.types.len()).filter(|&t| is_resolved_when_checked(t)) {
            self.type_from_node(file, TypeNodeId(t as u32));
        }
        if !self
            .p
            .has_excessive
            .load(std::sync::atomic::Ordering::Relaxed)
        {
            return;
        }
        // (start, rank, is a type node), in check order. The type nodes inside one outermost type node share its start and go children
        // first, which is id order. Expressions that start together go outermost first, which is reverse id order: a limit that
        // `resolveCall` hits before it checks the arguments is reported at the call.
        let parents = Self::type_node_parents(hir, bound);
        let mut order: Vec<(u32, u32, bool)> =
            Vec::with_capacity(hir.types.len() + hir.exprs.len());
        for t in (0..hir.types.len()).filter(|&t| is_resolved_when_checked(t)) {
            let mut outermost = TypeNodeId(t as u32);
            while parents[outermost.idx()].is_some() {
                outermost = parents[outermost.idx()];
            }
            order.push((hir[outermost].pos, t as u32, true));
        }
        for e in 0..hir.exprs.len() {
            if !bound.is_unchecked(e) {
                order.push((
                    self.start_of(file, ExprId(e as u32)),
                    u32::MAX - e as u32,
                    false,
                ));
            }
        }
        order.sort_unstable();
        self.reports_depth = true;
        for (_, rank, is_type_node) in order {
            if is_type_node {
                self.type_from_node(file, TypeNodeId(rank));
            } else {
                let e = ExprId(u32::MAX - rank);
                self.type_of_expr(file, e);
                self.relate_assignment_operands(file, e);
            }
        }
        self.reports_depth = false;
        // A limit reported at a node of another file is dropped.
        for (reported_in, start, end) in std::mem::take(&mut self.excessive_at) {
            if reported_in == file {
                out.push(Diagnostic { start, code: 2589 });
                self.note(start, end, 2589, Vec::new());
            }
        }
    }

    /// `checkAssignmentOperator`: compares the operands of the assignment `e` with `e` for `currentNode`. The comparison resolves
    /// members that `type_of_expr` leaves alone.
    fn relate_assignment_operands(&mut self, file: FileId, e: ExprId) {
        let hir = self.hir(file);
        let ExprKind::Assign {
            op: None,
            target,
            value,
        } = hir[e].kind
        else {
            return;
        };
        // `checkReferenceExpression`. What is no variable, or is a constant, has the error type.
        let is_reference = match hir[target].kind {
            ExprKind::Ident(name) => {
                self.symbol_of_identifier(file, target, name)
                    .is_some_and(|sym| {
                        let flags = self.files().flags(sym);
                        flags.intersects(SymFlags::VARIABLE) && !flags.contains(SymFlags::CONST)
                    })
            }
            ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. } => chain == Chain::No,
            _ => false,
        };
        // `[a = 1] = x`: a default, not an assignment.
        if !is_reference || self.is_assignment_target(file, e) {
            return;
        }
        let target_type = self.declared_type_of_reference(file, target);
        let source_type = self.type_of_expr(file, value);
        if self.is_known(source_type)
            && self.is_known(target_type)
            && self.enter(Query::Expr(file, e))
        {
            self.answer_if_sure(|c| c.is_assignable(source_type, target_type));
            self.leave();
        }
    }

    // ───────────────────────────── `infer`, `readonly`, `this`, `intrinsic` ─────────────────────────────

    /// `checkInferType`: 1338, 2838.
    fn check_infer_type_nodes(
        &mut self,
        file: FileId,
        parents: &[TypeNodeId],
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for t in 0..hir.types.len() {
            let TypeNodeKind::Infer(param) = hir.types[t].kind else {
                continue;
            };
            if bound.is_unchecked_type(t) {
                continue;
            }
            let mut at = TypeNodeId(t as u32);
            let is_in_extends = loop {
                let parent = parents[at.idx()];
                if parent.is_none() {
                    break false;
                }
                if matches!(hir[parent].kind, TypeNodeKind::Cond { extends, .. } if extends == at) {
                    break true;
                }
                at = parent;
            };
            if !is_in_extends {
                if !has_parse_diagnostics(hir) {
                    out.push(Diagnostic {
                        start: hir.types[t].pos,
                        code: 1338,
                    });
                    let end = self.end_of_type_node(file, TypeNodeId(t as u32));
                    self.explain_to(hir.types[t].pos, end, 1338, |_| vec![]);
                }
                continue;
            }
            // `infer T` written several times is one parameter: said once, of all of them.
            let symbol = bound.type_param_symbol[param.idx()];
            if symbol.is_none() {
                continue;
            }
            // What an index signature gives is bound twice, and one declaration in it is listed twice.
            let decls = &bound.symbols[symbol.idx()].decls;
            if decls.first() != Some(&Decl::TypeParam(param))
                || decls.iter().all(|d| *d == decls[0])
            {
                continue;
            }
            // `areTypeParametersIdentical`
            let target = self.type_param(file, param);
            let Some(wanted) = self.constraint_of_type_param(target) else {
                continue;
            };
            if !self.is_known(wanted) {
                continue;
            }
            let mut identical = true;
            for decl in decls {
                let Decl::TypeParam(p) = *decl else { continue };
                if hir[p].constraint.is_none() {
                    continue;
                }
                let own = self.type_from_node(file, hir[p].constraint);
                if !self.is_known(own) {
                    identical = true;
                    break;
                }
                match self.answer_if_sure(|c| c.is_identical(own, wanted)) {
                    Some(same) => identical &= same,
                    None => {
                        identical = true;
                        break;
                    }
                }
            }
            if !identical {
                out.extend(decls.iter().filter_map(|d| match *d {
                    Decl::TypeParam(p) => Some(Diagnostic {
                        start: hir[p].pos,
                        code: 2838,
                    }),
                    _ => None,
                }));
            }
        }
    }

    /// `checkGrammarTypeOperatorNode`: 1354 for `readonly`, 1330 1331 1332 1333 1334 1335 for `unique symbol`. The parser reports the
    /// 1005 of `unique` before anything else.
    fn check_type_operator_nodes(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if has_parse_diagnostics(hir) {
            return;
        }
        for (t, node) in hir.types.iter().enumerate() {
            let TypeNodeKind::Readonly(inner) = node.kind else {
                continue;
            };
            if bound.is_unchecked_type(t) {
                continue;
            }
            // `readonly (string[])` is `readonly` of something in parentheses.
            let operand = skip_trivia(&hir.text, node.pos as usize + b"readonly".len());
            if !matches!(
                hir[inner].kind,
                TypeNodeKind::Array(_) | TypeNodeKind::Tuple(_)
            ) || hir[inner].pos as usize != operand
            {
                out.push(Diagnostic {
                    start: node.pos,
                    code: 1354,
                });
            }
        }
        let is_unique_symbol =
            |t: TypeNodeId| t.is_some() && matches!(hir[t].kind, TypeNodeKind::UniqueSymbol);
        if !hir
            .types
            .iter()
            .any(|t| matches!(t.kind, TypeNodeKind::UniqueSymbol))
        {
            return;
        }
        // Where a `unique symbol` is the whole type of a variable or a property. Parentheses are not kept (`WalkUpParenthesizedTypes`).
        let mut annotations = FxHashSet::default();
        for (d, decl) in hir.var_decls.iter().enumerate() {
            if !is_unique_symbol(decl.ty) {
                continue;
            }
            annotations.insert(hir[decl.ty].pos);
            let stmt = bound.var_stmt[d];
            if stmt.is_none() {
                continue;
            }
            // `isVariableDeclarationInVariableStatement`: not in the head of a loop, nor in a `catch` clause.
            let is_in_variable_statement = matches!(hir[stmt].kind, StmtKind::Var(_))
                && !matches!(bound.stmt_parent[stmt.idx()], Parent::Stmt(owner) if owner.is_some() && matches!(
                    hir[owner].kind,
                    StmtKind::For { init: head, .. } | StmtKind::ForIn { left: head, .. } | StmtKind::ForOf { left: head, .. } if head == stmt
                ));
            if matches!(hir[decl.pat].kind, PatKind::Object(_) | PatKind::Array(_)) {
                out.push(Diagnostic {
                    start: hir[decl.ty].pos,
                    code: 1333,
                });
                let end = self.end_of_type_node(file, decl.ty);
                self.explain_to(hir[decl.ty].pos, end, 1333, |_| vec![]);
            } else if !is_in_variable_statement {
                out.push(Diagnostic {
                    start: hir[decl.ty].pos,
                    code: 1334,
                });
                let end = self.end_of_type_node(file, decl.ty);
                self.explain_to(hir[decl.ty].pos, end, 1334, |_| vec![]);
            } else if !matches!(decl.kind, VarKind::Const | VarKind::AwaitUsing) {
                // `NodeFlagsConst` is one of the two bits of `NodeFlagsAwaitUsing`.
                out.push(Diagnostic {
                    start: hir[decl.pat].pos,
                    code: 1332,
                });
            }
        }
        for (m, member) in hir.members.iter().enumerate() {
            if member.kind != MemberKind::Property || !is_unique_symbol(member.ty) {
                continue;
            }
            annotations.insert(hir[member.ty].pos);
            let code = match bound.member_owner[m] {
                MemberOwner::Class(_)
                    if !member.flags.contains(Flags::STATIC | Flags::READONLY) =>
                {
                    1331
                }
                MemberOwner::Interface(_) | MemberOwner::TypeLiteral(_)
                    if !member.flags.contains(Flags::READONLY) =>
                {
                    1330
                }
                _ => continue,
            };
            out.push(Diagnostic {
                start: member.name_pos,
                code,
            });
            let end = self.end_of_member_name(file, MemberId(m as u32));
            self.explain_to(member.name_pos, end, code, |_| vec![]);
        }
        for (t, node) in hir.types.iter().enumerate() {
            if matches!(node.kind, TypeNodeKind::UniqueSymbol)
                && !bound.is_unchecked_type(t)
                && !annotations.contains(&node.pos)
            {
                out.push(Diagnostic {
                    start: node.pos,
                    code: 1335,
                });
                let end = self.end_of_type_node(file, TypeNodeId(t as u32));
                self.explain_to(node.pos, end, 1335, |_| vec![]);
            }
        }
    }

    /// Whether `node` is in the type a JSDoc `@type` tag gives an assignment, and nothing resolves that type. `checkBinaryExpression`
    /// does not check it. It is resolved for the symbol the assignment declares, and `this.x = v` declares none in a function or
    /// outside of everything (`getThisClassAndSymbolTable`), and for what an operand is expected to be
    /// (`getContextualTypeForBinaryOperand`).
    fn is_in_unresolved_assignment_type(
        &self,
        file: FileId,
        node: TypeNodeId,
        parents: &[TypeNodeId],
    ) -> bool {
        let hir = self.hir(file);
        if !hir.is_in_jsdoc(hir[node].pos) {
            return false;
        }
        let mut root = node;
        while parents[root.idx()].is_some() {
            root = parents[root.idx()];
        }
        let assignment = hir.jsdoc_types.iter().find_map(|&(owner, ty)| match owner {
            JsDocTypeOwner::Assign(e) if ty == root => Some(e),
            _ => None,
        });
        let Some(assignment) = assignment else {
            return false;
        };
        let ExprKind::Assign { target, value, .. } = hir[assignment].kind else {
            return false;
        };
        let (ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }) = hir[target].kind else {
            return false;
        };
        matches!(hir[obj].kind, ExprKind::This)
            && match self.this_container(file, obj) {
                Some(Ok(func)) => matches!(hir[func].kind, FnKind::Decl | FnKind::Expr),
                Some(Err(_)) => false,
                None => true,
            }
            && !self.depends_on_context(file, value)
    }

    /// `getThisType`: 2526.
    fn check_this_type_nodes(
        &mut self,
        file: FileId,
        parents: &[TypeNodeId],
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for (t, node) in hir.types.iter().enumerate() {
            if matches!(node.kind, TypeNodeKind::Keyword(Keyword::This))
                && !bound.is_unchecked_type(t)
                && self.this_type_at(file, TypeNodeId(t as u32), bound.type_scope[t])
                    == TypeId::ERROR
                && !self.is_in_unresolved_assignment_type(file, TypeNodeId(t as u32), parents)
            {
                out.push(Diagnostic {
                    start: node.pos,
                    code: 2526,
                });
            }
        }
    }

    /// `checkTypeAliasDeclaration`: 2795.
    fn check_intrinsic_aliases(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for (a, alias) in hir.aliases.iter().enumerate() {
            if bound.alias_symbol[a].is_none()
                || alias.ty.is_none()
                || !matches!(
                    hir[alias.ty].kind,
                    TypeNodeKind::Keyword(Keyword::Intrinsic)
                )
            {
                continue;
            }
            // It is the keyword right after the `=` only: in parentheses it is a name like any other.
            let start = hir[alias.ty].pos;
            if !hir.text[..skip_trivia_back(&hir.text, start as usize)].ends_with(b"=") {
                continue;
            }
            let name = self.files().atoms.bytes(alias.name);
            let is_provided = match alias.type_params.len() {
                0 => name == b"BuiltinIteratorReturn",
                1 => matches!(
                    name,
                    b"Uppercase" | b"Lowercase" | b"Capitalize" | b"Uncapitalize" | b"NoInfer"
                ),
                _ => false,
            };
            if !is_provided {
                out.push(Diagnostic { start, code: 2795 });
            }
        }
    }

    // ───────────────────────────── members ─────────────────────────────

    /// `checkGrammarIndexSignatureParameters`, from where the type of the parameter is looked at: 1337 1268 1021.
    fn check_keys_of_index_signatures(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if has_parse_diagnostics(hir) {
            return;
        }
        for m in 0..hir.members.len() {
            let member = &hir.members[m];
            if member.kind != MemberKind::IndexSignature
                || member.func.is_none()
                || matches!(bound.member_owner[m], MemberOwner::None)
            {
                continue;
            }
            let func = &hir[member.func];
            // `checkGrammarModifiers` comes first, and what it objects to is all that is said.
            if hir
                .early_errors
                .iter()
                .any(|&(start, _)| (member.start..func.pos).contains(&start))
                || func.params.len() != 1
            {
                continue;
            }
            // A parameter that is not `name: type` and no more has been objected to by now.
            let param = &hir[func.params.at(0)];
            if !param.flags.is_empty() || param.default.is_some() || param.ty.is_none() {
                continue;
            }
            let keys = self.type_from_node(file, param.ty);
            if !self.is_known(keys) {
                continue;
            }
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
                out.push(Diagnostic {
                    start: name,
                    code: 1337,
                });
            } else if !self
                .parts(keys)
                .iter()
                .all(|&t| self.can_be_the_key_of_an_index_signature(t))
                || keys.is_never()
            {
                out.push(Diagnostic {
                    start: name,
                    code: 1268,
                });
            } else if member.ty.is_none() {
                out.push(Diagnostic {
                    start: member.start,
                    code: 1021,
                });
                let end = member.loc.end;
                self.explain_to(member.start, end, 1021, |_| vec![]);
            }
        }
    }

    /// `isValidIndexKeyType`
    fn can_be_the_key_of_an_index_signature(&mut self, ty: TypeId) -> bool {
        if matches!(ty, TypeId::STRING | TypeId::NUMBER | TypeId::SYMBOL)
            || self.is_pattern_literal(ty)
        {
            return true;
        }
        match self.data(ty) {
            TypeData::Intersection(parts) => {
                !self.is_generic(ty)
                    && parts
                        .iter()
                        .any(|&t| self.can_be_the_key_of_an_index_signature(t))
            }
            _ => false,
        }
    }

    /// `checkGrammarProperty`: 7061, of a property whose name is `[K in T]`. Said of the first member of whatever it is a member of.
    fn check_members_next_to_a_mapping(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if has_parse_diagnostics(hir) {
            return;
        }
        for (m, member) in hir.members.iter().enumerate() {
            let PropKey::Computed(name) = member.key else {
                continue;
            };
            if member.kind != MemberKind::Property
                || !matches!(hir[name].kind, ExprKind::Binary { op: BinOp::In, .. })
            {
                continue;
            }
            // `checkGrammarModifiers` comes first, and what it objects to is all that is said.
            let modifiers = member.start..member.name_pos;
            if hir
                .early_errors
                .iter()
                .any(|&(start, _)| modifiers.contains(&start))
            {
                continue;
            }
            let (all, is_in_class) = match bound.member_owner[m] {
                MemberOwner::Class(c) => (hir[c].members, true),
                MemberOwner::Interface(i) => (hir[i].members, false),
                MemberOwner::TypeLiteral(t) => match hir[t].kind {
                    TypeNodeKind::Object(members) => (members, false),
                    _ => continue,
                },
                MemberOwner::None => continue,
            };
            // `GetErrorRangeForNode`: at its name, if that is where an error about it goes. It is not for a method that is only declared.
            let first = &hir[all.at(0)];
            let start = match first.kind {
                MemberKind::Constructor | MemberKind::StaticBlock => first.start,
                MemberKind::Method if !is_in_class => first.start,
                _ => first.name_pos,
            };
            out.push(Diagnostic { start, code: 7061 });
            let end = match first.kind {
                MemberKind::Constructor => self.end_of_name_at(file, first.name_pos),
                MemberKind::Property | MemberKind::Getter | MemberKind::Setter => {
                    self.end_of_member_name(file, all.at(0))
                }
                MemberKind::Method if is_in_class => self.end_of_member_name(file, all.at(0)),
                _ => first.loc.end,
            };
            self.explain_to(start, end, 7061, |_| vec![]);
        }
    }

    /// The end of `checkObjectTypeForDuplicateDeclarations`: 2804, one private name for something static and something that is not.
    fn check_private_names_of_both_kinds(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for (c, class) in hir.classes.iter().enumerate() {
            if bound.class_symbol[c].is_none() {
                continue;
            }
            // 1 for what is not static, 2 for what is.
            let mut seen: Vec<(Atom, u8)> = Vec::new();
            for m in class.members.iter() {
                let PropKey::Private(name) = hir[m].key else {
                    continue;
                };
                let at = match seen.iter().position(|s| s.0 == name) {
                    Some(at) => at,
                    None => {
                        seen.push((name, 0));
                        seen.len() - 1
                    }
                };
                if seen[at].1 == 3 {
                    continue;
                }
                seen[at].1 |= if hir[m].flags.contains(Flags::STATIC) {
                    2
                } else {
                    1
                };
                if seen[at].1 == 3 {
                    // `reportDuplicateMemberErrors`
                    out.extend(
                        class
                            .members
                            .iter()
                            .filter(|&o| hir[o].key == PropKey::Private(name))
                            .map(|o| Diagnostic {
                                start: hir[o].name_pos,
                                code: 2804,
                            }),
                    );
                }
            }
        }
    }

    /// `checkPropertySignature`, `checkMethodDeclaration`: 18016 for a signature with a private name. A property signature is always
    /// an error, a method signature only outside every class, an accessor signature never.
    fn check_private_names_in_signatures(&self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for (m, member) in hir.members.iter().enumerate() {
            // Outside every class the front end gives a private name no key (`getDeclarationName`), so the text decides.
            let is_private = match member.key {
                PropKey::Private(_) => true,
                PropKey::None => is_private_name_at(hir, member.name_pos),
                _ => false,
            };
            if !is_private
                || !matches!(
                    bound.member_owner[m],
                    MemberOwner::Interface(_) | MemberOwner::TypeLiteral(_)
                )
            {
                continue;
            }
            match member.kind {
                MemberKind::Property => out.push(Diagnostic {
                    start: member.name_pos,
                    code: 18016,
                }),
                // `GetErrorRangeForNode` has no case for a method signature: the error starts at the first modifier.
                MemberKind::Method
                    if !self.is_signature_inside_a_class(file, MemberId(m as u32)) =>
                {
                    let start = member.start;
                    out.push(Diagnostic { start, code: 18016 });
                    let end = member.loc.end;
                    self.note(start, end, 18016, vec![]);
                }
                _ => {}
            }
        }
    }

    /// `checkGrammarInterfaceDeclaration`: 1176.
    fn check_clauses_of_interfaces(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if has_parse_diagnostics(hir) {
            return;
        }
        for (i, interface) in hir.interfaces.iter().enumerate() {
            if bound.interface_symbol[i].is_none() {
                continue;
            }
            let Some(keyword) =
                implements_in_interface_head(&hir.text, interface.name_pos as usize)
            else {
                continue;
            };
            // `checkGrammarModifiers` comes first, and what it objects to is all that is said.
            if self
                .grammar_error_in_modifiers(file, interface.stmt)
                .is_none()
            {
                out.push(Diagnostic {
                    start: keyword as u32,
                    code: 1176,
                });
            }
        }
    }

    // ───────────────────────────── lists between brackets ─────────────────────────────

    /// `checkGrammarTypeArguments`, of calls, `new`, instantiation expressions and JSX tags: 1009 for `f<T,>()`, 1099 for `f<>()`.
    fn check_type_argument_lists_of_calls(
        &mut self,
        file: FileId,
        exprs: &ExprsByKind,
        lists: OddLists,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if has_parse_diagnostics(hir) || !lists.has_empty && !lists.has_early_end {
            return;
        }
        let text: &[u8] = &hir.text;
        let none: &[ExprId] = &[];
        let calls = if lists.has_early_end {
            [exprs.of(ExprTag::Call), exprs.of(ExprTag::New)]
        } else {
            [none, none]
        };
        for i in calls.into_iter().flatten().map(|e| e.idx()) {
            let (ExprKind::Call(c) | ExprKind::New(c)) = hir.exprs[i].kind else {
                continue;
            };
            let call = &hir[c];
            if call.close_pos == u32::MAX || bound.is_unchecked(i) {
                continue;
            }
            // Back from the arguments: `(`, and before that the `>` of the list, if there is one.
            let inside = match hir.ids(call.args).next() {
                Some(first) => self.start_of(file, first),
                None => call.close_pos,
            };
            let open = skip_trivia_back(text, inside as usize);
            if !text[..open].ends_with(b"(") {
                continue;
            }
            let close = skip_trivia_back(text, open - 1);
            if !text[..close].ends_with(b">") {
                continue;
            }
            let last = skip_trivia_back(text, close - 1);
            match text[..last].last() {
                Some(b',') => out.push(Diagnostic {
                    start: last as u32 - 1,
                    code: 1009,
                }),
                Some(b'<') => {
                    out.push(Diagnostic {
                        start: last as u32 - 1,
                        code: 1099,
                    });
                    self.explain_to(last as u32 - 1, close as u32, 1099, |_| vec![]);
                }
                _ => {}
            }
        }
        let is_empty_list_at = |open: usize| {
            text.get(open) == Some(&b'<') && text.get(skip_trivia(text, open + 1)) == Some(&b'>')
        };
        // `checkGrammarExpressionWithTypeArguments`: `f<>` that is not called. An empty list is not kept, so it is read after the name.
        let names = if lists.has_empty {
            [exprs.of(ExprTag::Ident), exprs.of(ExprTag::Dot)]
        } else {
            [none, none]
        };
        for i in names.into_iter().flatten().map(|e| e.idx()) {
            let e = &hir.exprs[i];
            let (name, name_pos) = match e.kind {
                ExprKind::Ident(name) => (name, e.pos as usize),
                ExprKind::Dot { name, name_pos, .. } => (name, name_pos as usize),
                _ => continue,
            };
            if bound.is_unchecked(i) {
                continue;
            }
            let name = self.files().atoms.bytes(name);
            if !text
                .get(name_pos..)
                .is_some_and(|rest| rest.starts_with(name))
            {
                continue;
            }
            let open = skip_trivia(text, name_pos + name.len());
            if is_empty_list_at(open) {
                out.push(Diagnostic {
                    start: open as u32,
                    code: 1099,
                });
                let end = skip_trivia(text, open + 1) as u32 + 1;
                self.explain_to(open as u32, end, 1099, |_| vec![]);
            }
        }
        // `checkGrammarJsxElement`: the list after the name of an opening tag.
        for i in exprs.of(ExprTag::Jsx).iter().map(|e| e.idx()) {
            let e = &hir.exprs[i];
            let ExprKind::Jsx(j) = e.kind else { continue };
            if hir[j].tag.is_none() || bound.is_unchecked(i) {
                continue;
            }
            if !hir[j].type_args.is_empty() {
                if let Some(comma) = trailing_comma_of_type_arguments(hir, hir[j].type_args) {
                    out.push(Diagnostic {
                        start: comma,
                        code: 1009,
                    });
                }
                continue;
            }
            let name = skip_trivia(text, e.pos as usize + 1);
            let open = skip_trivia(text, jsx_tag_name_end(text, name));
            if is_empty_list_at(open) {
                out.push(Diagnostic {
                    start: open as u32,
                    code: 1099,
                });
                let end = skip_trivia(text, open + 1) as u32 + 1;
                self.explain_to(open as u32, end, 1099, |_| vec![]);
            }
        }
    }

    /// The same of references to types and of type queries: 1009 for `A<T,>`, 1099 for `A.B<>`.
    fn check_type_argument_lists_of_types(
        &mut self,
        file: FileId,
        lists: OddLists,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if has_parse_diagnostics(hir) || !lists.has_empty && !lists.has_early_end {
            return;
        }
        let text: &[u8] = &hir.text;
        for (t, node) in hir.types.iter().enumerate() {
            let (names, args, mut at) = match node.kind {
                TypeNodeKind::Ref { name, args } => (name.len(), args, node.pos as usize),
                TypeNodeKind::Typeof { name, args, .. } => {
                    (name.len(), args, node.pos as usize + b"typeof".len())
                }
                _ => continue,
            };
            if bound.is_unchecked_type(t) {
                continue;
            }
            if !args.is_empty() {
                if lists.has_early_end
                    && let Some(comma) = trailing_comma_of_type_arguments(hir, args)
                {
                    out.push(Diagnostic {
                        start: comma,
                        code: 1009,
                    });
                }
                continue;
            }
            if !lists.has_empty {
                continue;
            }
            // Past the name. The list is on the same line, or it is not a list.
            for i in 0..names {
                at = skip_trivia(text, at);
                if i > 0 && text.get(at) == Some(&b'.') {
                    at = skip_trivia(text, at + 1);
                }
                at = word_end(text, at);
            }
            let open = skip_trivia(text, at);
            if text.get(open) == Some(&b'<')
                && text.get(skip_trivia(text, open + 1)) == Some(&b'>')
                && !text[at..open].contains(&b'\n')
            {
                out.push(Diagnostic {
                    start: open as u32,
                    code: 1099,
                });
                let end = skip_trivia(text, open + 1) as u32 + 1;
                self.explain_to(open as u32, end, 1099, |_| vec![]);
            }
        }
    }

    /// `checkGrammarImportCallExpression`, as far as `import(a,)` goes: 1009.
    fn check_commas_of_import_calls(
        &mut self,
        file: FileId,
        exprs: &ExprsByKind,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let kind = self.p.files.options.module;
        let is_verbatim = self.p.files.options.verbatim_module_syntax;
        // With `es2015`, and with `commonjs` where modules are left as they are written, the call itself is the error. The others
        // have import attributes, and the comma with them.
        if has_parse_diagnostics(hir)
            || is_verbatim && kind == ModuleKind::CommonJs
            || kind.is_node()
            || matches!(
                kind,
                ModuleKind::Es2015 | ModuleKind::EsNext | ModuleKind::Preserve
            )
        {
            return;
        }
        let text: &[u8] = &hir.text;
        for &e in exprs.of(ExprTag::ImportCall) {
            if bound.is_unchecked(e.idx()) {
                continue;
            }
            let open = skip_trivia(text, hir[e].pos as usize + b"import".len());
            if text.get(open) != Some(&b'(') {
                continue;
            }
            let Some(close) = end_of_brackets(text, open).map(|end| end - 1) else {
                continue;
            };
            let last = skip_trivia_back(text, close);
            if text[..last].ends_with(b",") {
                out.push(Diagnostic {
                    start: last as u32 - 1,
                    code: 1009,
                });
            }
        }
    }

    // ───────────────────────────── instantiation expressions ─────────────────────────────

    /// `checkExpressionWithTypeArguments`, of `f<T>` that is not called: 1009, 2848 for `a instanceof B<T>`, 2635.
    fn check_instantiation_expressions(
        &mut self,
        file: FileId,
        exprs: &ExprsByKind,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let is_silent = has_parse_diagnostics(hir);
        for i in exprs.of(ExprTag::Instantiation).iter().map(|e| e.idx()) {
            let ExprKind::Instantiation { expr, type_args } = hir.exprs[i].kind else {
                continue;
            };
            if bound.is_unchecked(i) {
                continue;
            }
            if !is_silent && let Some(comma) = trailing_comma_of_type_arguments(hir, type_args) {
                out.push(Diagnostic {
                    start: comma,
                    code: 1009,
                });
            }
            // Parentheses are not kept: what it is directly part of is what `WalkUpParenthesizedExpressions` comes to.
            if matches!(bound.expr_parent[i], Parent::Expr(p) if matches!(hir[p].kind, ExprKind::Binary { op: BinOp::Instanceof, right, .. } if right.idx() == i))
            {
                out.push(Diagnostic {
                    start: self.start_of(file, expr),
                    code: 2848,
                });
                let end = self.end_inside_parentheses(file, ExprId(i as u32));
                self.explain_to(self.start_of(file, expr), end, 2848, |_| vec![]);
            }
            let ty = self.type_of_expr(file, expr);
            if !self.is_uncertain(file, expr) {
                self.check_type_arguments_apply(file, ty, type_args, out);
            }
        }
    }

    /// The same where the type arguments were not kept, being none or given up on: 2848. They are looked for after the name.
    fn check_instantiations_after_instanceof(
        &mut self,
        file: FileId,
        exprs: &ExprsByKind,
        out: &mut Vec<Diagnostic>,
    ) {
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
            let after = skip_trivia(
                text,
                name_pos as usize + self.files().atoms.bytes(name).len(),
            );
            if text.get(after) != Some(&b'<') || matches!(text.get(after + 1), Some(b'<' | b'=')) {
                continue;
            }
            // `a instanceof B < c` compares. In parentheses of its own, the name would not be all there is in them.
            let is_in_parentheses = is_parenthesized(hir, right);
            let is_compared = matches!(bound.expr_parent[i], Parent::Expr(p) if matches!(hir[p].kind, ExprKind::Binary { op: BinOp::Lt, left, .. } if left.idx() == i));
            if is_in_parentheses || !is_compared {
                let start = self.start_inside_parentheses(file, right);
                out.push(Diagnostic { start, code: 2848 });
                let end =
                    end_of_type_arguments(text, after + 1).map_or(0, |close| close as u32 + 1);
                self.explain_to(start, end, 2848, |_| vec![]);
            }
        }
    }

    /// `getInstantiationExpressionType`, of `typeof f<T>`: 2635.
    fn check_instantiated_type_queries(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for t in 0..hir.types.len() {
            let TypeNodeKind::Typeof {
                name, args, expr, ..
            } = hir.types[t].kind
            else {
                continue;
            };
            let scope = bound.type_scope[t];
            if args.is_empty() || bound.is_unchecked_type(t) {
                continue;
            }
            let mut ty = self.type_of_expr(file, expr);
            if ty == TypeId::UNRESOLVED {
                let names: Vec<Atom> = hir.ids(name).collect();
                ty = self.type_of_entity(file, scope, &names);
            }
            self.check_type_arguments_apply(file, ty, args, out);
        }
    }

    /// `getInstantiationExpressionType`: 2635 and 2344, of the type arguments `args` given to something of type `ty`.
    fn check_type_arguments_apply(
        &mut self,
        file: FileId,
        ty: TypeId,
        args: IdList<TypeNodeId>,
        out: &mut Vec<Diagnostic>,
    ) {
        if args.is_empty() || !self.is_known(ty) || self.is_error_type(ty) {
            return;
        }
        let hir = self.hir(file);
        // Whether any part takes the list, and the first that has signatures and does not.
        let mut found = (false, None);
        let mut applicable = Vec::new();
        self.note_whether_type_arguments_apply(ty, args.len(), &mut found, &mut applicable, 0);
        if !found.0 || found.1.is_some() {
            let start = start_of_type(hir, hir.id_at(args, 0));
            out.push(Diagnostic { start, code: 2635 });
            let error_type = if found.0 { found.1.unwrap_or(ty) } else { ty };
            let end = self.end_of_type_args(file, args);
            self.explain_to(start, end, 2635, |c| vec![c.type_to_string(error_type)]);
        }
        if applicable.is_empty() {
            return;
        }
        // `checkTypeArguments` reports for every applicable signature: 2344, or a more specific code.
        let given = self.types_from_nodes(file, args);
        if given.iter().any(|&t| !self.is_known(t)) {
            return;
        }
        for sig in applicable {
            let type_params = self.sig_type_params(sig);
            if let Ok(Some((index, argument, constraint))) =
                self.failing_type_argument(sig, &type_params, &given)
                && self.answer_if_sure(|c| c.is_assignable(argument, constraint)) == Some(false)
            {
                let node = hir.id_at(args, index);
                let start = start_of_type(hir, node);
                self.report_not_assignable_with_end(
                    argument,
                    constraint,
                    start,
                    self.end_of_type_node_from(file, node, start),
                    2344,
                    out,
                );
            }
        }
    }

    /// The `getInstantiatedType` closure of `getInstantiationExpressionType`. Collects the `applicable` signatures.
    fn note_whether_type_arguments_apply(
        &mut self,
        ty: TypeId,
        given: usize,
        found: &mut (bool, Option<TypeId>),
        applicable: &mut Vec<SigId>,
        depth: u32,
    ) {
        // Whether it has signatures, and whether any of them takes the list.
        let mut own = (false, false);
        self.note_signatures_that_take(ty, given, &mut own, found, applicable, depth);
        found.0 |= own.1;
        if own.0 && !own.1 && found.1.is_none() {
            found.1 = Some(ty);
        }
    }

    /// Its `getInstantiatedTypePart`.
    fn note_signatures_that_take(
        &mut self,
        ty: TypeId,
        given: usize,
        own: &mut (bool, bool),
        found: &mut (bool, Option<TypeId>),
        applicable: &mut Vec<SigId>,
        depth: u32,
    ) {
        if depth > 16 {
            return;
        }
        match self.data(ty) {
            TypeData::Union(parts) => {
                for &part in parts.iter() {
                    self.note_whether_type_arguments_apply(
                        part,
                        given,
                        found,
                        applicable,
                        depth + 1,
                    );
                }
            }
            TypeData::Intersection(parts) => {
                for &part in parts.iter() {
                    self.note_signatures_that_take(part, given, own, found, applicable, depth + 1);
                }
            }
            TypeData::TypeParam(..)
            | TypeData::ThisParam(_)
            | TypeData::IndexedAccess { .. }
            | TypeData::Cond { .. }
            | TypeData::Substitution { .. } => {
                if let Some(constraint) = self.base_constraint_of(ty) {
                    self.note_signatures_that_take(
                        constraint,
                        given,
                        own,
                        found,
                        applicable,
                        depth + 1,
                    );
                }
            }
            _ if self.is_object_type(ty) => {
                for construct in [false, true] {
                    for sig in self.signatures(ty, construct) {
                        own.0 = true;
                        // `hasCorrectTypeArgumentArity`
                        let params = self.sig_type_params(sig);
                        let least = params
                            .iter()
                            .rposition(|&p| {
                                self.type_param_decl(p)
                                    .is_none_or(|(_, decl)| decl.default.is_none())
                            })
                            .map_or(0, |last| last + 1);
                        if !params.is_empty() && (least..=params.len()).contains(&given) {
                            own.1 = true;
                            applicable.push(sig);
                        }
                    }
                }
            }
            _ => {}
        }
    }

    // ───────────────────────────── `T[K]`, `a[k]` ─────────────────────────────

    /// `checkIndexedAccessType`: 2536 4105. And 2514, which `getPropertyTypeForIndexType` says.
    pub(super) fn check_indexed_access_type(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        obj: TypeNodeId,
        index: TypeNodeId,
    ) {
        let hir = self.hir(file);
        // The text of the default library is not kept.
        if hir.text.is_empty() {
            return;
        }
        let (object, keys) = (
            self.type_from_node(file, obj),
            self.type_from_node(file, index),
        );
        // `shouldDeferIndexedAccessType`: written as a type, what waits for its type parameters is not looked into.
        if !self.is_generic_object_type(object) && self.is_negative_index_of_a_tuple(object, keys) {
            let start = start_of_type(hir, index);
            let end = self.end_of_type_node_from(file, index, start);
            self.error((file, start, end), 2514, &[]);
        }
        // `getTypeFromIndexedAccessTypeNode`, which comes before `getConditionalFlowTypeOfType`.
        let whole = self.type_from_node(file, node);
        let whole = match *self.data(whole) {
            TypeData::Substitution { base, .. } => base,
            _ => whole,
        };
        if let TypeData::IndexedAccess {
            obj: waiting,
            index: key,
            ..
        } = *self.data(whole)
            && let Some(code) = self.why_not_a_key_of(waiting, key)
        {
            let args = arguments_of_refused_key(self, code, waiting, key);
            let args: Vec<Arg> = args.iter().map(|arg| Arg::Text(arg)).collect();
            let end = self.end_of_type_node(file, node);
            self.error((file, hir[node].pos, end), code, &args);
        }
    }

    /// `checkIndexedAccessIndexType`, of the type `object[keys]` that waits for its type parameters: why `keys` cannot be used to
    /// look into `object`, 4105 or 2536. `None`: it can, or it cannot be told.
    pub(super) fn why_not_a_key_of(&mut self, object: TypeId, keys: TypeId) -> Option<u32> {
        if !self.is_known(object) || !self.is_known(keys) {
            return None;
        }
        // Of type parameters the answer goes by what they extend.
        let (apparent, key_bound) = (
            self.apparent_type(object),
            self.constraint_for_operator(keys),
        );
        let object_keys = self.keys_to_look_into(object);
        if !self.is_known(apparent) || !self.is_known(key_bound) || !self.is_known(object_keys) {
            return None;
        }
        let has_number_index = self.has_number_index_signature(object, 0);
        let fits = self.answer_if_sure(|c| {
            c.parts(keys).iter().all(|&key| {
                c.is_assignable(key, object_keys)
                    || has_number_index && c.is_key_for_index_signature(key, TypeId::NUMBER)
                    || {
                        // `A extends B ? A : never` is an `A` that is a `B`.
                        matches!(c.data(key), TypeData::Cond { .. }) && {
                            let [check, extends, yes, no] =
                                [0, 1, 2, 3].map(|piece| c.cond_piece(key, piece));
                            let passed = c.intersection(&[extends, check]);
                            yes == check
                                && c.is_assignable(passed, object_keys)
                                && c.is_assignable(no, object_keys)
                        }
                    }
            })
        });
        if fits != Some(false) {
            return None;
        }
        // `getReducedType`: nothing can be what it extends, and anything is a key of `never`.
        if self.has_conflicting_private_properties(apparent) {
            return None;
        }
        if self.is_generic_object_type(object)
            && let Some(name) = self.property_name_of_type(keys)
        {
            // `getConstituentProperty`
            for &part in self.parts(apparent) {
                let part = self.apparent_type(part);
                if let Some((prop, _)) = self.prop_of(part, name) {
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

    /// `isConflictingPrivateProperty`, of any property of the intersection `ty`: several declarations, one of them private.
    fn has_conflicting_private_properties(&mut self, ty: TypeId) -> bool {
        self.is_intersection(ty)
            && self.members(ty).is_some_and(|m| {
                m.shape().props.iter().any(|prop| match &prop.source {
                    PropSource::Intersected(_, parts) => {
                        parts.iter().any(|p| p.flags.contains(PropFlags::PRIVATE))
                            && parts.iter().any(|p| p.source != parts[0].source)
                    }
                    _ => false,
                })
            })
    }

    /// `keyof object`, as `checkIndexedAccessIndexType` has it: of a mapped type that renames its keys and does not know them yet,
    /// what `getIndexTypeForMappedType` makes of what it maps over.
    fn keys_to_look_into(&mut self, object: TypeId) -> TypeId {
        if let Some((file, node, _)) = self.mapped_origin(object)
            && self.is_generic(object)
            && let Some(name_type) = self.mapped_name_type(object)
        {
            let param = self.mapped_type_param(object);
            let over = self.mapped_keys(object);
            let constraint = self.hir(file)[self.mapped_decl(file, node).param].constraint;
            let is_keyof = constraint.is_some()
                && matches!(self.hir(file)[constraint].kind, TypeNodeKind::Keyof(_));
            if !is_keyof && self.is_generic(over) {
                // `MappedTypeNameTypeKindRemapping`
                match self.answer_if_sure(|c| c.is_assignable(name_type, param)) {
                    Some(true) => {}
                    Some(false) => {
                        let renamed: Vec<TypeId> = self
                            .parts(over)
                            .iter()
                            .map(|&key| {
                                let mapper = self.mapper_from(&[param], &[key]);
                                match self.instantiate(name_type, mapper) {
                                    TypeId::STRING => self.union(&[TypeId::STRING, TypeId::NUMBER]),
                                    name => name,
                                }
                            })
                            .collect();
                        return self.union(&renamed);
                    }
                    None => return TypeId::UNRESOLVED,
                }
            }
        }
        self.keyof(object)
    }

    /// `getIndexInfoOfType(ty, numberType) != nil`
    fn has_number_index_signature(&mut self, ty: TypeId, depth: u32) -> bool {
        if depth > 8 {
            return false;
        }
        let apparent = self.apparent_type(ty);
        match self.data(apparent) {
            TypeData::Union(parts) => parts
                .iter()
                .all(|&part| self.has_number_index_signature(part, depth + 1)),
            TypeData::Intersection(parts) => parts
                .iter()
                .any(|&part| self.has_number_index_signature(part, depth + 1)),
            _ => self.members(apparent).is_some_and(|m| {
                m.shape()
                    .index
                    .iter()
                    .any(|info| info.key == TypeId::NUMBER)
            }),
        }
    }

    /// `isApplicableIndexType`
    fn is_key_for_index_signature(&mut self, source: TypeId, target: TypeId) -> bool {
        if self.is_assignable(source, target)
            || target == TypeId::STRING && self.is_assignable(source, TypeId::NUMBER)
        {
            return true;
        }
        target == TypeId::NUMBER
            && match *self.data(source) {
                TypeData::StringLit { value, .. } => self.is_numeric_name(value),
                _ => source == self.template_type(&[known::empty, known::empty], &[TypeId::NUMBER]),
            }
    }

    /// From `getPropertyTypeForIndexType`: `[a, b][-1]`.
    fn is_negative_index_of_a_tuple(&mut self, object: TypeId, keys: TypeId) -> bool {
        if !self.is_known(object) || !self.is_known(keys) || self.is_generic(keys) {
            return false;
        }
        let object = self.reduced(object);
        let apparent = self.apparent_type(object);
        if !matches!(self.data(apparent), TypeData::Tuple { flags, .. } if !flags.iter().any(|f| f.intersects(ElemFlags::REST | ElemFlags::VARIADIC)))
        {
            return false;
        }
        self.parts(keys).iter().any(|&key| {
            self.property_name_of_type(key).is_some_and(|name| {
                self.files().atoms.bytes(name).starts_with(b"-") && self.is_numeric_name(name)
            })
        })
    }

    /// `checkElementAccessExpression`, for what it says of the key: 2514; 2536 4105 2542 where the type of the access is a deferred
    /// `T[K]`; 2862 where the object type is generic and the access is written to.
    fn check_keys_of_element_accesses(
        &mut self,
        file: FileId,
        exprs: &ExprsByKind,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for i in exprs.of(ExprTag::Index).iter().map(|e| e.idx()) {
            let ExprKind::Index { obj, index, chain } = hir.exprs[i].kind else {
                continue;
            };
            let e = ExprId(i as u32);
            if bound.is_unchecked(i) || matches!(hir[index].kind, ExprKind::Missing) {
                continue;
            }
            let (object, keys) = (self.type_of_expr(file, obj), self.type_of_expr(file, index));
            if !self.is_known(object)
                || !self.is_known(keys)
                || self.is_uncertain(file, obj)
                || self.is_uncertain(file, index)
            {
                continue;
            }
            // That it may be null or undefined is an error of its own, and does not stand in the way. `unknown` does.
            let object = self.non_null_type(object);
            if !self.is_known(object)
                || self.is_any(object)
                || object.is_never()
                || object == TypeId::UNKNOWN
            {
                continue;
            }
            if self.is_negative_index_of_a_tuple(object, keys) {
                out.push(Diagnostic {
                    start: self.start_of(file, index),
                    code: 2514,
                });
                let end = self.end_of_expr(file, index);
                self.explain_to(self.start_of(file, index), end, 2514, |_| vec![]);
                continue;
            }
            // `getAssignmentTargetKind(node) != AssignmentKindNone`
            let is_written = self.is_written(file, e);
            if !self.has_type_variables(object) && !self.has_type_variables(keys) {
                continue;
            }
            let at = self.start_inside_parentheses(file, e);
            if !self.is_generic(keys)
                && is_written
                && self.answer_if_sure(|c| c.is_written_through_an_index_signature(object, keys))
                    == Some(true)
            {
                out.push(Diagnostic {
                    start: at,
                    code: 2862,
                });
                let end = self.end_inside_parentheses(file, e);
                self.explain_to(at, end, 2862, |c| vec![c.type_to_string(object)]);
                continue;
            }
            let checked = self.type_of_expr(file, e);
            if self.is_uncertain(file, e) {
                continue;
            }
            // `checkIndexedAccessIndexType` is given the flow type of every element access, generic key or not, before the optional
            // chain adds `undefined`. It returns the error type for an index it refuses, so `checked` is `any` then.
            let whole = if chain == Chain::No && !self.has_any_flag(checked) {
                checked
            } else {
                self.type_of_element_access_unchecked(file, e).0
            };
            let TypeData::IndexedAccess {
                obj: waiting,
                index: key,
                ..
            } = *self.data(whole)
            else {
                continue;
            };
            match self.why_not_a_key_of(waiting, key) {
                Some(code) => {
                    out.push(Diagnostic { start: at, code });
                    let end = self.end_inside_parentheses(file, e);
                    self.explain_to(at, end, code, |c| {
                        arguments_of_refused_key(c, code, waiting, key)
                    });
                }
                None if is_written && self.is_known(waiting) && self.is_known(key) => {
                    if let Some((of, node, _)) = self.mapped_origin(waiting)
                        && self.mapped_decl(of, node).readonly == MappedModifier::Add
                    {
                        out.push(Diagnostic {
                            start: at,
                            code: 2542,
                        });
                        let end = self.end_inside_parentheses(file, e);
                        self.explain_to(at, end, 2542, |c| vec![c.type_to_string(waiting)]);
                    }
                }
                None => {}
            }
        }
    }

    /// `getPropertyTypeForIndexType` with `AccessFlagsWriting | AccessFlagsNoIndexSignatures`: whether all that `object`, which waits
    /// for its type parameters, has for one of `keys` is an index signature of what it extends, other than one for numbers.
    fn is_written_through_an_index_signature(&mut self, object: TypeId, keys: TypeId) -> bool {
        if !self.is_generic_object_type(object)
            || matches!(self.data(object), TypeData::ThisParam(_))
        {
            return false;
        }
        let apparent = self.apparent_type(object);
        let apparent = self.reduced(apparent);
        if !self.is_known(apparent) || self.is_any(apparent) || apparent.is_never() {
            return false;
        }
        let Some(members) = self.members(apparent) else {
            return false;
        };
        let is_tuple = self.is_tuple(apparent);
        let parts = if self.is_boolean(keys) {
            std::slice::from_ref(&keys)
        } else {
            self.parts(keys)
        };
        parts.iter().any(|&key| {
            if let Some(name) = self.property_name_of_type(key)
                && (self.property_of_type(&members, name).is_some()
                    || is_tuple && self.is_numeric_name(name))
            {
                return false;
            }
            let plain = self.constraint_for_operator(key);
            if self.is_nullish(key)
                || !self.every_type(plain, |c, t| {
                    c.is_string_like(t) || c.is_number_like(t) || c.is_symbol_like(t)
                })
            {
                return false;
            }
            // `getApplicableIndexInfo`, or else the signature for strings, which stands in for what has none.
            let mut applicable = members.shape().index.iter().filter(|info| {
                info.key != TypeId::STRING && self.is_key_for_index_signature(key, info.key)
            });
            match (applicable.next(), applicable.next()) {
                (Some(only), None) => only.key != TypeId::NUMBER,
                (Some(_), Some(_)) => true,
                (None, _) => members
                    .shape()
                    .index
                    .iter()
                    .any(|info| info.key == TypeId::STRING),
            }
        })
    }
}
