//! Types as they are written, and what looking one type up in another comes to:
//! 1257 1265 1266 2574 (tuple types), 2799 2800 (tuples too large), 2590 (unions too large), 2589 (instantiation depth),
//! 1338 2838 (`infer`), 1354 (`readonly`), 2795 (`intrinsic`), 2526 (`this`), 1021 1268 1337 (index signatures),
//! 7061 (mapped types), 2804 18016 (private names), 1176 (interfaces), 1099 1009 (lists of type arguments, `import()`),
//! 2848 2635 (instantiation expressions), 2536 4105 2542 2862 2514 (`T[K]`, `a[k]`), 2456 4109 4110 (what comes back to itself).
//!
//! Follows `checkTupleType`, `TupleNormalizer.normalize`, `checkCrossProductUnion`, `removeSubtypes`, `instantiateTypeWithAlias`,
//! `checkInferType`, `getThisType`, `checkTypeAliasDeclaration`, `checkObjectTypeForDuplicateDeclarations`,
//! `checkPropertySignature`, `checkMethodDeclaration`, `checkIndexedAccessIndexType`, `getPropertyTypeForIndexType`,
//! `checkExpressionWithTypeArguments`, `getInstantiationExpressionType`, `pushTypeResolution`, `getBaseTypes`,
//! `getDeclaredTypeOfTypeAlias` and `getTypeArguments` of TypeScript 7.0.2's checker.go, and
//! `checkGrammarIndexSignatureParameters`, `checkGrammarTypeArguments`, `checkGrammarImportCallExpression`,
//! `checkGrammarInterfaceDeclaration`, `checkGrammarProperty` and `checkGrammarTypeOperatorNode` of its grammarchecks.go.
//!
//! What the summary of a file does not keep (parentheses around types, where a list of type arguments is) is read off the text.

use super::errors::Diagnostic;
use super::*;
use crate::bind::{Decl, FnOwner, MemberOwner, Parent, PatParent, ScopeKind};
use crate::resolve::ModuleKind;
use crate::util::FxHashSet;

/// `hasParseDiagnostics`: the parser or the scanner objected to something in the file, and `grammarErrorOnNode` and its like say nothing.
/// Of type syntax that was given up on it is not known whether they did. `parse_for_sema` sets the flag by the origin of each error,
/// so a code the parser shares with `grammarErrorOnNode` (1005 ..) does not count. Declaration files have no flag: there the codes tell.
fn has_parse_diagnostics(hir: &hir::File) -> bool {
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

/// `SkipTrivia`: where the first token at or after `pos` starts.
fn skip_trivia(text: &[u8], mut pos: usize) -> usize {
    loop {
        match text.get(pos) {
            Some(c) if c.is_ascii_whitespace() => pos += 1,
            Some(b'/') if text.get(pos + 1) == Some(&b'/') => {
                pos += text[pos..]
                    .iter()
                    .position(|&c| c == b'\n')
                    .unwrap_or(text.len() - pos);
            }
            Some(b'/') if text.get(pos + 1) == Some(&b'*') => {
                pos = text[pos + 2..]
                    .windows(2)
                    .position(|w| w == b"*/")
                    .map_or(text.len(), |end| pos + end + 4);
            }
            _ => return pos,
        }
    }
}

/// Where a `//` comment starts in `line`, if it ends in one.
fn line_comment_start(line: &[u8]) -> Option<usize> {
    let mut quote = 0u8;
    let mut i = 0;
    while i < line.len() {
        let c = line[i];
        if quote != 0 {
            if c == b'\\' {
                i += 1;
            } else if c == quote {
                quote = 0;
            }
        } else if matches!(c, b'"' | b'\'' | b'`') {
            quote = c;
        } else if c == b'/' && line.get(i + 1) == Some(&b'/') {
            return Some(i);
        } else if c == b'/' && line.get(i + 1) == Some(&b'*') {
            i += line[i + 2..].windows(2).position(|w| w == b"*/")? + 3;
        }
        i += 1;
    }
    None
}

/// Where the token before `pos` ends: `pos`, less the blanks and the comments before it.
fn end_of_previous_token(text: &[u8], pos: usize) -> usize {
    let mut pos = pos.min(text.len());
    loop {
        while pos > 0 && text[pos - 1].is_ascii_whitespace() {
            pos -= 1;
            if text[pos] == b'\n' {
                let line = text[..pos]
                    .iter()
                    .rposition(|&c| c == b'\n')
                    .map_or(0, |i| i + 1);
                if let Some(comment) = line_comment_start(&text[line..pos]) {
                    pos = line + comment;
                }
            }
        }
        match text[..pos]
            .strip_suffix(b"*/")
            .and_then(|before| before.windows(2).rposition(|w| w == b"/*"))
        {
            Some(open) => pos = open,
            None => return pos,
        }
    }
}

fn is_identifier_part(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_' || c == b'$' || c >= 0x80
}

/// Past the string or the template that starts at `pos`.
fn end_of_string(text: &[u8], pos: usize) -> Option<usize> {
    let quote = text[pos];
    let mut at = pos + 1;
    loop {
        match *text.get(at)? {
            b'\\' => at += 2,
            c if c == quote => return Some(at + 1),
            b'$' if quote == b'`' && text.get(at + 1) == Some(&b'{') => {
                at = closing_bracket(text, at + 1)? + 1
            }
            _ => at += 1,
        }
    }
}

/// Where the bracket that is opened at `open` is closed.
fn closing_bracket(text: &[u8], open: usize) -> Option<usize> {
    let mut depth = 0usize;
    let mut at = open;
    loop {
        at = skip_trivia(text, at);
        match *text.get(at)? {
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(at);
                }
            }
            b'"' | b'\'' | b'`' => {
                at = end_of_string(text, at)?;
                continue;
            }
            _ => {}
        }
        at += 1;
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
    let end = end_of_previous_token(
        &hir.text,
        end_of_type_arguments(&hir.text, hir[last].pos as usize)?,
    );
    hir.text[..end].ends_with(b",").then(|| end as u32 - 1)
}

/// Where the type `node`, which is all of an element or an argument, starts as it is written: parentheses around a type are not
/// kept, nor is the `new` of a constructor type.
fn start_of_type(hir: &hir::File, node: TypeNodeId) -> u32 {
    let text: &[u8] = &hir.text;
    let mut at = hir[node].pos as usize;
    if let TypeNodeKind::Fn(f) = hir[node].kind
        && hir[f].kind == FnKind::ConstructorType
    {
        let words: [&[u8]; 2] = [b"new", b"abstract"];
        for word in words {
            let end = end_of_previous_token(text, at);
            if text[..end].ends_with(word) {
                at = end - word.len();
            }
        }
    }
    // `(T)`, `| T`: a bar before the whole of a type leads it.
    loop {
        let end = end_of_previous_token(text, at);
        if !matches!(text[..end].last(), Some(b'(' | b'|' | b'&')) {
            return at as u32;
        }
        at = end - 1;
    }
}

/// Where the member whose name is at `pos` starts, modifiers included.
fn start_of_modifiers(text: &[u8], pos: u32) -> u32 {
    let mut at = pos as usize;
    loop {
        let end = end_of_previous_token(text, at);
        let mut start = end;
        while start > 0 && is_identifier_part(text[start - 1]) {
            start -= 1;
        }
        if !matches!(
            &text[start..end],
            b"public"
                | b"private"
                | b"protected"
                | b"static"
                | b"declare"
                | b"abstract"
                | b"override"
                | b"readonly"
                | b"accessor"
                | b"async"
        ) {
            return at as u32;
        }
        at = start;
    }
}

/// Where an element of a tuple type starts: at its `...`, at its name, or at its type.
fn start_of_tuple_element(hir: &hir::File, elem: &TupleElem) -> u32 {
    let text: &[u8] = &hir.text;
    let before_dots = |at: usize| {
        let end = end_of_previous_token(text, at);
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
        let mut end = end_of_previous_token(text, at);
        if !text[..end].ends_with(b":") {
            return at as u32;
        }
        end = end_of_previous_token(text, end - 1);
        if text[..end].ends_with(b"?") {
            end = end_of_previous_token(text, end - 1);
        }
        at = end;
        while at > 0 && is_identifier_part(text[at - 1]) {
            at -= 1;
        }
        if elem.rest {
            at = before_dots(at);
        }
    }
    at as u32
}

/// Where `implements` is written in the head of the interface whose name is at `name_pos`. `None` if it is not, or a second
/// `extends` comes first: `checkGrammarInterfaceDeclaration` stops at whichever it meets first.
fn implements_in_interface_head(text: &[u8], name_pos: usize) -> Option<usize> {
    let mut at = name_pos;
    while text.get(at).is_some_and(|&c| is_identifier_part(c)) {
        at += 1;
    }
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
            _ if is_identifier_part(c) => {
                let start = at;
                while text.get(at).is_some_and(|&c| is_identifier_part(c)) {
                    at += 1;
                }
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

/// Whether the element starts with `...`. `name: ...T` does not, whatever else is wrong with it.
fn is_rest_element(hir: &hir::File, elem: &TupleElem) -> bool {
    // Of a declaration file the text is not kept.
    elem.rest
        && (elem.name.is_none()
            || hir.text.is_empty()
            || hir.text[start_of_tuple_element(hir, elem) as usize..].starts_with(b"..."))
}

/// `getArrayElementTypeNode`: `X` for `X[]`, `[...X[]]`, `[...[...X[]]]`.
fn array_element_type_node(hir: &hir::File, node: TypeNodeId) -> Option<TypeNodeId> {
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

/// The member that is written around `pos`: the last one that starts before it.
fn member_around(hir: &hir::File, members: Span<MemberId>, pos: u32) -> Option<MemberId> {
    members.iter().take_while(|&m| hir[m].pos <= pos).last()
}

/// `getThisType`: whether the `this` type written at `node` is in a member of a class or an interface that is not static, with
/// nothing in between that has a `this` of its own (`GetThisContainer`).
fn is_this_type_available(
    hir: &hir::File,
    bound: &Bound,
    node: TypeNodeId,
    parents: &[TypeNodeId],
) -> bool {
    // The members of a type literal are as far as it gets.
    let mut at = node;
    while parents[at.idx()].is_some() {
        at = parents[at.idx()];
        if matches!(hir[at].kind, TypeNodeKind::Object(_)) {
            return false;
        }
    }
    let pos = hir[node].pos;
    let mut scope = bound.type_scope[node.idx()];
    while scope.is_some() {
        let s = &bound.scopes[scope.idx()];
        match s.kind {
            ScopeKind::Fn(f) => match hir[f].kind {
                FnKind::Arrow | FnKind::FunctionType | FnKind::ConstructorType => {}
                FnKind::Decl | FnKind::Expr | FnKind::StaticBlock => return false,
                kind => {
                    let FnOwner::Member(m) = bound.fns[f.idx()].owner else {
                        return false;
                    };
                    if !matches!(
                        bound.member_owner[m.idx()],
                        MemberOwner::Class(_) | MemberOwner::Interface(_)
                    ) || hir[m].flags.contains(Flags::STATIC)
                    {
                        return false;
                    }
                    // Of a constructor only the body will do.
                    return kind != FnKind::Constructor
                        || matches!(hir[f].body, FnBody::Block(body) if hir.ids(body).next().is_some_and(|first| hir[first].pos <= pos));
                }
            },
            // Not in a method: in a field, or else in the head of the class, which is outside.
            ScopeKind::Class(c) => {
                if let Some(m) = member_around(hir, hir[c].members, pos)
                    && hir[m].kind == MemberKind::Property
                {
                    return !hir[m].flags.contains(Flags::STATIC);
                }
            }
            ScopeKind::Interface(i) => {
                if member_around(hir, hir[i].members, pos).is_some() {
                    return true;
                }
            }
            ScopeKind::Module(_) | ScopeKind::Enum(_) | ScopeKind::File => return false,
            // Those after the first two only say which part of something a name is written in: what they lie in is come to next.
            ScopeKind::Block
            | ScopeKind::TypeParams
            | ScopeKind::TypeParamList(_)
            | ScopeKind::Param(_)
            | ScopeKind::ReturnType(_)
            | ScopeKind::Extends
            | ScopeKind::InferConstraint => {}
        }
        scope = s.parent;
    }
    false
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

/// What has to be found out before something else can be: the entries of TypeScript's stack of type resolutions.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum Needs {
    /// What a type alias stands for: `TypeSystemPropertyNameDeclaredType`.
    Alias(Sym),
    /// What a variable is declared as: `TypeSystemPropertyNameType`.
    Variable(FileId, VarDeclId),
    /// The type arguments of a reference, an array type or a tuple type that puts them off:
    /// `TypeSystemPropertyNameResolvedTypeArguments`.
    Arguments(FileId, TypeNodeId),
    /// The base types of an interface: `TypeSystemPropertyNameResolvedBaseTypes`.
    Bases(Sym),
}

/// A type, and what counts of where it is written.
#[derive(Copy, Clone)]
struct Written {
    file: FileId,
    node: TypeNodeId,
    /// `getAliasSymbolForTypeNode`: it is what a type alias is declared as.
    is_aliased: bool,
    /// `isResolvedByTypeAlias`: it is worked out as part of working out what a type alias stands for.
    by_alias: bool,
}

/// The type at `node`. `is_declared` says which types of the file are what a type alias is declared as.
fn written_at(
    hir: &hir::File,
    file: FileId,
    node: TypeNodeId,
    parents: &[TypeNodeId],
    is_declared: &[bool],
) -> Written {
    let mut top = node;
    while parents[top.idx()].is_some()
        && matches!(hir[parents[top.idx()]].kind, TypeNodeKind::Readonly(_))
    {
        top = parents[top.idx()];
    }
    let mut at = node;
    let by_alias = loop {
        let parent = parents[at.idx()];
        if parent.is_none() {
            break is_declared[at.idx()];
        }
        let goes_on = match hir[parent].kind {
            TypeNodeKind::Ref { .. }
            | TypeNodeKind::Union(_)
            | TypeNodeKind::Intersection(_)
            | TypeNodeKind::IndexedAccess { .. }
            | TypeNodeKind::Cond { .. }
            | TypeNodeKind::Keyof(_)
            | TypeNodeKind::Readonly(_)
            | TypeNodeKind::Array(_) => true,
            // Through `name: T`, and neither through `T?` nor through `...T`.
            TypeNodeKind::Tuple(elems) => elems.iter().any(|e| {
                hir[e].ty == at && (hir[e].name.is_some() || !(hir[e].rest || hir[e].optional))
            }),
            _ => false,
        };
        if !goes_on {
            break false;
        }
        at = parent;
    };
    Written {
        file,
        node,
        is_aliased: is_declared[top.idx()],
        by_alias,
    }
}

/// TypeScript's stack of type resolutions, and what came of those that are over.
#[derive(Default)]
struct Circles {
    /// What has been found out and is not asked again, and whether it is in a circle or needs something that is.
    done: FxHashMap<Needs, bool>,
    path: Vec<Needs>,
    circular: FxHashSet<Needs>,
}

impl Checker<'_> {
    pub(super) fn check_x_typenodes(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // The text of the default library is not kept.
        if hir.text.is_empty() {
            return;
        }
        // Of a declaration file only `checkGrammarIndexSignature` is gone into.
        if hir.kind == FileKind::Declaration {
            self.check_keys_of_index_signatures(file, out);
            return;
        }
        self.check_private_names_of_both_kinds(file, out);
        self.check_private_names_in_signatures(file, out);
        self.check_members_next_to_a_mapping(file, out);
        self.check_type_argument_lists_of_calls(file, out);
        self.check_commas_of_import_calls(file, out);
        self.check_instantiation_expressions(file, out);
        self.check_instantiations_after_instanceof(file, out);
        self.check_clauses_of_interfaces(file, out);
        self.check_keys_of_element_accesses(file, out);
        self.check_size_of_array_literals(file, out);
        self.check_subtype_reduction_of_array_literals(file, out);
        self.check_contextual_property_cross_products(file, out);
        self.check_excessive_depth(file, out);
        if hir.types.is_empty() {
            return;
        }
        let parents = Self::type_node_parents(hir, bound);
        self.check_tuple_type_nodes(file, &parents, out);
        self.check_instantiated_tuple_sizes(file, out);
        self.check_size_of_cross_products(file, out);
        self.check_infer_type_nodes(file, &parents, out);
        self.check_type_operator_nodes(file, out);
        self.check_type_argument_lists_of_types(file, out);
        self.check_this_type_nodes(file, &parents, out);
        self.check_intrinsic_aliases(file, out);
        self.check_keys_of_index_signatures(file, out);
        self.check_indexed_access_type_nodes(file, &parents, out);
        self.check_instantiated_type_queries(file, out);
        self.check_circular_aliases_and_arguments(file, &parents, out);
    }

    /// What `ask` answers. `None`: a comparison was cut short or time ran out on the way, and the answer is not to be told anybody.
    fn answer_if_sure(&mut self, ask: impl FnOnce(&mut Self) -> bool) -> Option<bool> {
        let gave_up_before = std::mem::replace(&mut self.relation_gave_up, false);
        let answer = ask(self);
        let is_sure = !self.relation_gave_up && !self.timed_out();
        self.relation_gave_up |= gave_up_before;
        is_sure.then_some(answer)
    }

    // ───────────────────────────── tuple types ─────────────────────────────

    /// `checkTupleType`: 2574, 1265 1266 1257. And 2799, which `TupleNormalizer.normalize` says when the type is made.
    fn check_tuple_type_nodes(
        &mut self,
        file: FileId,
        parents: &[TypeNodeId],
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let is_silent = has_parse_diagnostics(hir);
        for t in 0..hir.types.len() {
            let TypeNodeKind::Tuple(elems) = hir.types[t].kind else {
                continue;
            };
            if bound.type_scope[t].is_none() {
                continue;
            }
            let (mut seen_optional, mut seen_rest) = (false, false);
            for e in elems.iter() {
                let elem = &hir[e];
                let start = || start_of_tuple_element(hir, elem);
                let mut flags = tuple_element_flags(hir, elem);
                if flags.contains(ElemFlags::VARIADIC) {
                    let ty = self.type_from_node(file, elem.ty);
                    let mut ty = self.force(ty);
                    // `...T?`: `T?` is `T` or null.
                    if elem.optional && self.p.files.options.strict_null_checks {
                        ty = self.union(&[ty, TypeId::NULL]);
                    }
                    // What a type parameter can be spread as goes by what it extends.
                    let apparent = self.apparent_type(ty);
                    if !self.is_known(ty) || !self.is_known(apparent) {
                        break;
                    }
                    let fits = self.answer_if_sure(|c| {
                        c.can_be_spread_in_a_tuple(ty) || {
                            let narrowed = c.conditional_flow_type(file, ty, elem.ty, parents);
                            narrowed != ty && c.can_be_spread_in_a_tuple(narrowed)
                        }
                    });
                    if fits != Some(true) {
                        if fits == Some(false) {
                            out.push(Diagnostic {
                                start: start(),
                                code: 2574,
                            });
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
                if !is_silent {
                    out.push(Diagnostic {
                        start: start(),
                        code,
                    });
                }
                break;
            }
            self.check_size_of_tuple_type(file, TypeNodeId(t as u32), elems, out);
        }
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
        out: &mut Vec<Diagnostic>,
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
                let ty = self.force(ty);
                if !self.is_known(ty) {
                    return;
                }
                // One that is too large itself was refused where it was made, and is `any` from then on: one rest element.
                if let TypeData::Tuple { elems, .. } = self.data(ty)
                    && elems.len() < 10_000
                {
                    spread = elems.len();
                    if spread + count >= 10_000 {
                        out.push(Diagnostic {
                            start: hir[node].pos,
                            code: 2799,
                        });
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
            if bound.type_scope[t].is_none()
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
            if self.p.too_large_tuples.get(&(file, node)).is_some() {
                out.push(Diagnostic {
                    start: hir.types[t].pos,
                    code: 2799,
                });
            }
        }
    }

    /// The same of an array literal that comes to a tuple: 2800.
    fn check_size_of_array_literals(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for i in 0..hir.exprs.len() {
            let ExprKind::Array(items) = hir.exprs[i].kind else {
                continue;
            };
            if matches!(bound.expr_parent[i], Parent::None)
                || !hir
                    .ids(items)
                    .any(|x| matches!(hir[x].kind, ExprKind::Spread(_)))
            {
                continue;
            }
            // What is refused is `any`.
            let whole = self.type_of_expr(file, ExprId(i as u32));
            if !self.is_tuple(whole) && whole != TypeId::ANY {
                continue;
            }
            let mut count = 0;
            for item in hir.ids(items) {
                let mut spread = 1;
                if let ExprKind::Spread(inner) = hir[item].kind {
                    let ty = self.type_of_expr(file, inner);
                    if let TypeData::Tuple { elems, .. } = self.data(ty)
                        && elems.len() < 10_000
                    {
                        spread = elems.len();
                        if spread + count >= 10_000 {
                            out.push(Diagnostic {
                                start: hir.exprs[i].pos,
                                code: 2800,
                            });
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
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for i in 0..hir.exprs.len() {
            if !matches!(hir.exprs[i].kind, ExprKind::Array(_))
                || matches!(bound.expr_parent[i], Parent::None)
            {
                continue;
            }
            let e = ExprId(i as u32);
            // `getUnionTypeWorker` returns the error type for a union that `removeSubtypes` refuses, so the literal is `any[]`.
            // This call also caches the types of the elements.
            let ty = self.type_of_expr(file, e);
            if self.array_element(ty) != Some(TypeId::ANY) {
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
            }
        }
    }

    /// `checkCrossProductUnion`, of a template literal type, a tuple type or an intersection type as it is written: 2590.
    fn check_size_of_cross_products(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for t in 0..hir.types.len() {
            if bound.type_scope[t].is_none() {
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
            let ty = self.force(ty);
            if !self.is_known(ty) || ty == TypeId::NEVER {
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
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // (start of the object literal, contextual intersection, property name, start of the error)
        let mut refused: Vec<(u32, TypeId, Atom, u32)> = Vec::new();
        for i in 0..hir.exprs.len() {
            let ExprKind::Object(props) = hir.exprs[i].kind else {
                continue;
            };
            if props.is_empty() || matches!(bound.expr_parent[i], Parent::None) {
                continue;
            }
            let Some(context) = self.contextual_type_for_object_literal(file, ExprId(i as u32))
            else {
                continue;
            };
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
                    let start = match hir[prop.value].kind {
                        // These ask for their contextual type while `checkExpression` has them as the current node.
                        ExprKind::Fn(_) | ExprKind::Object(_) | ExprKind::Array(_)
                            if prop.kind == PropKind::Init =>
                        {
                            self.error_start_inside_parentheses(file, prop.value)
                        }
                        // `checkExpressionForMutableLocation` and `checkObjectLiteralMethod` ask while the object literal is the
                        // current node.
                        _ => hir.exprs[i].pos,
                    };
                    refused.push((hir.exprs[i].pos, part, name, start));
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
            bound.type_scope[t].is_some()
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
            if !matches!(bound.expr_parent[e], Parent::None) {
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
                self.type_of_expr(file, ExprId(u32::MAX - rank));
            }
        }
        self.reports_depth = false;
        // A limit reported at a node of another file is dropped.
        for (reported_in, start) in std::mem::take(&mut self.excessive_at) {
            if reported_in == file {
                out.push(Diagnostic { start, code: 2589 });
            }
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
            if bound.type_scope[t].is_none() {
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
            // `areTypeParametersIdentical`: what the parameter extends is what the first that says so says.
            let mut wanted = None;
            let mut identical = true;
            for decl in decls {
                let Decl::TypeParam(p) = *decl else { continue };
                if hir[p].constraint.is_none() {
                    continue;
                }
                let own = self.type_from_node(file, hir[p].constraint);
                let says_any = matches!(
                    hir[hir[p].constraint].kind,
                    TypeNodeKind::Keyword(Keyword::Any)
                );
                if !self.is_known(own) || self.is_any(own) && !says_any {
                    identical = true;
                    break;
                }
                // `getConstraintFromTypeParameter`: to extend `any` is to extend `unknown`.
                let wanted = *wanted.get_or_insert(if says_any { TypeId::UNKNOWN } else { own });
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
            if bound.type_scope[t].is_none() {
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
            } else if !is_in_variable_statement {
                out.push(Diagnostic {
                    start: hir[decl.ty].pos,
                    code: 1334,
                });
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
                start: member.pos,
                code,
            });
        }
        for (t, node) in hir.types.iter().enumerate() {
            if matches!(node.kind, TypeNodeKind::UniqueSymbol)
                && bound.type_scope[t].is_some()
                && !annotations.contains(&node.pos)
            {
                out.push(Diagnostic {
                    start: node.pos,
                    code: 1335,
                });
            }
        }
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
                && bound.type_scope[t].is_some()
                && !is_this_type_available(hir, bound, TypeNodeId(t as u32), parents)
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
            if !hir.text[..end_of_previous_token(&hir.text, start as usize)].ends_with(b"=") {
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
                .any(|&(start, _)| (member.pos..func.pos).contains(&start))
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
            let keys = self.force(keys);
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
                || keys == TypeId::NEVER
            {
                out.push(Diagnostic {
                    start: name,
                    code: 1268,
                });
            } else if member.ty.is_none() {
                out.push(Diagnostic {
                    start: member.pos,
                    code: 1021,
                });
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
            let modifiers = start_of_modifiers(&hir.text, member.pos)..member.pos;
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
                MemberKind::Constructor | MemberKind::StaticBlock => {
                    start_of_modifiers(&hir.text, first.pos)
                }
                MemberKind::Method if !is_in_class => start_of_modifiers(&hir.text, first.pos),
                _ => first.pos,
            };
            out.push(Diagnostic { start, code: 7061 });
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
                                start: hir[o].pos,
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
                PropKey::None => hir.text.get(member.pos as usize) == Some(&b'#'),
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
                    start: member.pos,
                    code: 18016,
                }),
                // `GetErrorRangeForNode` has no case for a method signature: the error starts at the first modifier.
                MemberKind::Method
                    if !self.is_signature_inside_a_class(file, MemberId(m as u32)) =>
                {
                    out.push(Diagnostic {
                        start: start_of_modifiers(&hir.text, member.pos),
                        code: 18016,
                    });
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
            let statement = hir
                .stmts
                .iter()
                .find(|s| matches!(s.kind, StmtKind::Interface(x) if x.idx() == i))
                .map_or(interface.name_pos, |s| s.pos);
            if !hir
                .early_errors
                .iter()
                .any(|&(start, _)| (statement..interface.name_pos).contains(&start))
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
    fn check_type_argument_lists_of_calls(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if has_parse_diagnostics(hir) {
            return;
        }
        let text: &[u8] = &hir.text;
        for i in 0..hir.exprs.len() {
            let (ExprKind::Call(c) | ExprKind::New(c)) = hir.exprs[i].kind else {
                continue;
            };
            let call = &hir[c];
            if call.close_pos == u32::MAX || matches!(bound.expr_parent[i], Parent::None) {
                continue;
            }
            // Back from the arguments: `(`, and before that the `>` of the list, if there is one.
            let inside = match hir.ids(call.args).next() {
                Some(first) => self.start_of(file, first),
                None => call.close_pos,
            };
            let open = end_of_previous_token(text, inside as usize);
            if !text[..open].ends_with(b"(") {
                continue;
            }
            let close = end_of_previous_token(text, open - 1);
            if !text[..close].ends_with(b">") {
                continue;
            }
            let last = end_of_previous_token(text, close - 1);
            match text[..last].last() {
                Some(b',') => out.push(Diagnostic {
                    start: last as u32 - 1,
                    code: 1009,
                }),
                Some(b'<') => out.push(Diagnostic {
                    start: last as u32 - 1,
                    code: 1099,
                }),
                _ => {}
            }
        }
        let is_empty_list_at = |open: usize| {
            text.get(open) == Some(&b'<') && text.get(skip_trivia(text, open + 1)) == Some(&b'>')
        };
        // `checkGrammarExpressionWithTypeArguments`: `f<>` that is not called. An empty list is not kept, so it is read after the name.
        for (i, e) in hir.exprs.iter().enumerate() {
            let (name, name_pos) = match e.kind {
                ExprKind::Ident(name) => (name, e.pos as usize),
                ExprKind::Dot { name, name_pos, .. } => (name, name_pos as usize),
                _ => continue,
            };
            let name = self.files().atoms.bytes(name);
            if matches!(bound.expr_parent[i], Parent::None)
                || !text
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
            }
        }
        // `checkGrammarJsxElement`: the list after the name of an opening tag.
        for (i, e) in hir.exprs.iter().enumerate() {
            let ExprKind::Jsx(j) = e.kind else { continue };
            if hir[j].tag.is_none() || matches!(bound.expr_parent[i], Parent::None) {
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
            let mut at = skip_trivia(text, e.pos as usize + 1);
            while text
                .get(at)
                .is_some_and(|&c| is_identifier_part(c) || matches!(c, b'.' | b'-' | b':'))
            {
                at += 1;
            }
            let open = skip_trivia(text, at);
            if is_empty_list_at(open) {
                out.push(Diagnostic {
                    start: open as u32,
                    code: 1099,
                });
            }
        }
    }

    /// The same of references to types and of type queries: 1009 for `A<T,>`, 1099 for `A.B<>`.
    fn check_type_argument_lists_of_types(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if has_parse_diagnostics(hir) {
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
            if bound.type_scope[t].is_none() {
                continue;
            }
            if !args.is_empty() {
                if let Some(comma) = trailing_comma_of_type_arguments(hir, args) {
                    out.push(Diagnostic {
                        start: comma,
                        code: 1009,
                    });
                }
                continue;
            }
            // Past the name. The list is on the same line, or it is not a list.
            for i in 0..names {
                at = skip_trivia(text, at);
                if i > 0 && text.get(at) == Some(&b'.') {
                    at = skip_trivia(text, at + 1);
                }
                while text
                    .get(at)
                    .is_some_and(|&c| is_identifier_part(c) || c == b'#')
                {
                    at += 1;
                }
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
            }
        }
    }

    /// `checkGrammarImportCallExpression`, as far as `import(a,)` goes: 1009.
    fn check_commas_of_import_calls(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
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
        for (i, e) in hir.exprs.iter().enumerate() {
            if !matches!(e.kind, ExprKind::ImportCall(_))
                || matches!(bound.expr_parent[i], Parent::None)
            {
                continue;
            }
            let open = skip_trivia(text, e.pos as usize + b"import".len());
            if text.get(open) != Some(&b'(') {
                continue;
            }
            let Some(close) = closing_bracket(text, open) else {
                continue;
            };
            let last = end_of_previous_token(text, close);
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
    fn check_instantiation_expressions(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let is_silent = has_parse_diagnostics(hir);
        for i in 0..hir.exprs.len() {
            let ExprKind::Instantiation { expr, type_args } = hir.exprs[i].kind else {
                continue;
            };
            if matches!(bound.expr_parent[i], Parent::None) {
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
            }
            let ty = self.type_of_expr(file, expr);
            if !self.is_uncertain(file, expr) {
                self.check_type_arguments_apply(file, ty, type_args, out);
            }
        }
    }

    /// The same where the type arguments were not kept, being none or given up on: 2848. They are looked for after the name.
    fn check_instantiations_after_instanceof(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let text: &[u8] = &hir.text;
        for i in 0..hir.exprs.len() {
            let ExprKind::Binary {
                op: BinOp::Instanceof,
                right,
                ..
            } = hir.exprs[i].kind
            else {
                continue;
            };
            if matches!(bound.expr_parent[i], Parent::None) {
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
            let is_in_parentheses = hir.parens.binary_search_by_key(&right.0, |p| p.0.0).is_ok();
            let is_compared = matches!(bound.expr_parent[i], Parent::Expr(p) if matches!(hir[p].kind, ExprKind::Binary { op: BinOp::Lt, left, .. } if left.idx() == i));
            if is_in_parentheses || !is_compared {
                out.push(Diagnostic {
                    start: self.start_inside_parentheses(file, right),
                    code: 2848,
                });
            }
        }
    }

    /// `getInstantiationExpressionType`, of `typeof f<T>`: 2635.
    fn check_instantiated_type_queries(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for t in 0..hir.types.len() {
            let TypeNodeKind::Typeof { name, args, expr } = hir.types[t].kind else {
                continue;
            };
            let scope = bound.type_scope[t];
            if args.is_empty() || scope.is_none() {
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
        // What is in error is `any` too, and nothing more is said of that.
        if args.is_empty() || !self.is_known(ty) || self.is_any(ty) {
            return;
        }
        let hir = self.hir(file);
        // Whether any part takes the list, and whether any that has signatures does not.
        let mut found = (false, false);
        let mut applicable = Vec::new();
        self.note_whether_type_arguments_apply(ty, args.len(), &mut found, &mut applicable, 0);
        if !found.0 || found.1 {
            out.push(Diagnostic {
                start: start_of_type(hir, hir.id_at(args, 0)),
                code: 2635,
            });
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
                self.report_not_assignable(
                    argument,
                    constraint,
                    start_of_type(hir, hir.id_at(args, index)),
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
        found: &mut (bool, bool),
        applicable: &mut Vec<SigId>,
        depth: u32,
    ) {
        // Whether it has signatures, and whether any of them takes the list.
        let mut own = (false, false);
        self.note_signatures_that_take(ty, given, &mut own, found, applicable, depth);
        found.0 |= own.1;
        found.1 |= own.0 && !own.1;
    }

    /// Its `getInstantiatedTypePart`.
    fn note_signatures_that_take(
        &mut self,
        ty: TypeId,
        given: usize,
        own: &mut (bool, bool),
        found: &mut (bool, bool),
        applicable: &mut Vec<SigId>,
        depth: u32,
    ) {
        if depth > 16 {
            return;
        }
        let ty = self.force(ty);
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
            | TypeData::Cond { .. } => {
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
    fn check_indexed_access_type_nodes(
        &mut self,
        file: FileId,
        parents: &[TypeNodeId],
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for t in 0..hir.types.len() {
            let TypeNodeKind::IndexedAccess { obj, index } = hir.types[t].kind else {
                continue;
            };
            if bound.type_scope[t].is_none() {
                continue;
            }
            let (object, keys) = (
                self.type_from_node(file, obj),
                self.type_from_node(file, index),
            );
            // `shouldDeferIndexedAccessType`: written as a type, what waits for its type parameters is not looked into.
            if !self.is_generic_object_type(object)
                && self.is_negative_index_of_a_tuple(object, keys)
            {
                out.push(Diagnostic {
                    start: start_of_type(hir, index),
                    code: 2514,
                });
            }
            let whole = self.type_from_node(file, TypeNodeId(t as u32));
            let TypeData::IndexedAccess {
                obj: waiting,
                index: key,
                ..
            } = *self.data(whole)
            else {
                continue;
            };
            let Some(code) = self.why_not_a_key_of(waiting, key) else {
                continue;
            };
            // What the conditional types around have found out may be what makes it one.
            let narrowed = (
                self.conditional_flow_type(file, object, obj, parents),
                self.conditional_flow_type(file, keys, index, parents),
            );
            if narrowed != (object, keys) && self.why_not_a_key_of(narrowed.0, narrowed.1).is_none()
            {
                continue;
            }
            // `getTypeFromTypeNode` applies `getConditionalFlowTypeOfType` to every type node, so a type parameter that the object
            // type or the index type only mentions is narrowed as well.
            if let Some(flow) = self.conditional_flow_mapper(file, TypeNodeId(t as u32), parents) {
                let mentioned = (self.instantiate(object, flow), self.instantiate(keys, flow));
                if mentioned != (object, keys)
                    && self.why_not_a_key_of(mentioned.0, mentioned.1).is_none()
                {
                    continue;
                }
            }
            out.push(Diagnostic {
                start: hir.types[t].pos,
                code,
            });
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
    fn check_keys_of_element_accesses(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for i in 0..hir.exprs.len() {
            let ExprKind::Index { obj, index, chain } = hir.exprs[i].kind else {
                continue;
            };
            let e = ExprId(i as u32);
            if matches!(bound.expr_parent[i], Parent::None)
                || matches!(hir[index].kind, ExprKind::Missing)
            {
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
            let object = self.receiver_that_is_there(object);
            if !self.is_known(object)
                || self.is_any(object)
                || object == TypeId::NEVER
                || object == TypeId::UNKNOWN
            {
                continue;
            }
            if self.is_negative_index_of_a_tuple(object, keys) {
                out.push(Diagnostic {
                    start: self.start_of(file, index),
                    code: 2514,
                });
                continue;
            }
            // `getAssignmentTargetKind(node) != AssignmentKindNone`
            let is_written = self.is_assignment_target(file, e)
                || matches!(bound.expr_parent[i], Parent::Expr(p) if match hir[p].kind {
                    ExprKind::Assign { op: Some(_), target, .. } => target == e,
                    ExprKind::Unary { op, .. } => matches!(op, UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec),
                    _ => false,
                });
            if !self.has_type_variables(object) && !self.has_type_variables(keys)
                || !self.is_in_generic_context(file, e)
            {
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
                continue;
            }
            let checked = self.type_of_expr(file, e);
            if self.is_uncertain(file, e) {
                continue;
            }
            // `checkIndexedAccessIndexType` is given the flow type of every element access, generic key or not, before the optional
            // chain adds `undefined`. It returns the error type for an index it refuses, so `checked` is `any` then.
            let whole = if chain == Chain::No && checked != TypeId::ANY {
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
                Some(code) => out.push(Diagnostic { start: at, code }),
                None if is_written && self.is_known(waiting) && self.is_known(key) => {
                    if let Some((of, node, _)) = self.mapped_origin(waiting)
                        && self.mapped_decl(of, node).readonly == MappedModifier::Add
                    {
                        out.push(Diagnostic {
                            start: at,
                            code: 2542,
                        });
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
        if !self.is_known(apparent) || self.is_any(apparent) || apparent == TypeId::NEVER {
            return false;
        }
        let Some(members) = self.members(apparent) else {
            return false;
        };
        let is_tuple = self.is_tuple(apparent);
        let parts = if keys == TypeId::BOOLEAN {
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

    // ───────────────────────────── what comes back to itself ─────────────────────────────

    /// 2456 4109 4110. In `getDeclaredTypeOfTypeAlias` and `getTypeArguments` these fall out of `pushTypeResolution` finding what is
    /// asked for already under way. Here the circles are looked for in what is written, following what `getTypeFromTypeNode` works
    /// out there and then and leaving what it puts off.
    fn check_circular_aliases_and_arguments(
        &mut self,
        file: FileId,
        parents: &[TypeNodeId],
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if hir.aliases.is_empty() {
            return;
        }
        // Whether anything comes back to itself at all, whoever asks.
        let mut circles = Circles::default();
        let mut put_off = Vec::new();
        for (a, alias) in hir.aliases.iter().enumerate() {
            if bound.alias_symbol[a].is_none() || alias.ty.is_none() {
                continue;
            }
            self.find_circles(
                Needs::Alias(self.files().sym(file, bound.alias_symbol[a])),
                &mut circles,
            );
            self.collect_types_that_put_off(
                Written {
                    file,
                    node: alias.ty,
                    is_aliased: true,
                    by_alias: true,
                },
                &mut put_off,
            );
        }
        for node in put_off {
            self.find_circles(Needs::Arguments(file, node), &mut circles);
        }
        // Which of it is told so, and whether it is ever asked, is a matter of who asks first.
        if !circles.circular.is_empty() {
            circles = Circles::default();
            self.find_circles_in_order(file, parents, &mut circles);
        }
        for need in &circles.circular {
            if let Needs::Arguments(of, node) = *need
                && of == file
            {
                // A tuple type has no name to go by. `[...X[]]` is an array.
                let is_tuple = matches!(hir[node].kind, TypeNodeKind::Tuple(_))
                    && array_element_type_node(hir, node).is_none();
                out.push(Diagnostic {
                    start: hir[node].pos,
                    code: if is_tuple { 4110 } else { 4109 },
                });
            }
        }
        // What is known to depend on itself and is declared as an alias, no more and no less, does so by way of the alias.
        let mut through: Vec<Sym> = Vec::new();
        for i in 0..hir.pats.len() {
            let ty = match bound.pat_parent[i] {
                PatParent::Var(d) => hir[d].ty,
                PatParent::Param(p) => hir[p].ty,
                _ => continue,
            };
            if matches!(hir.pats[i].kind, PatKind::Ident(_))
                && ty.is_some()
                && self.plain_alias_written(file, ty).is_some()
            {
                self.type_of_pat(file, PatId(i as u32));
                if self.p.circular_pats.get(&(file, PatId(i as u32))).is_some() {
                    self.note_aliases_gone_through(file, ty, &mut through);
                }
            }
        }
        for i in 0..hir.members.len() {
            let member = &hir.members[i];
            if member.kind == MemberKind::Property
                && member.ty.is_some()
                && !matches!(bound.member_owner[i], MemberOwner::None)
                && self.plain_alias_written(file, member.ty).is_some()
            {
                self.type_of_member_declaration(file, MemberId(i as u32));
                if self
                    .p
                    .circular_members
                    .get(&(file, MemberId(i as u32)))
                    .is_some()
                {
                    self.note_aliases_gone_through(file, member.ty, &mut through);
                }
            }
        }
        for i in 0..hir.fns.len() {
            let ret = hir.fns[i].ret;
            if ret.is_some()
                && !matches!(bound.fns[i].owner, FnOwner::None)
                && self.plain_alias_written(file, ret).is_some()
            {
                self.return_type_of_fn(file, FnId(i as u32));
                if self
                    .p
                    .circular_returns
                    .get(&(file, FnId(i as u32)))
                    .is_some()
                {
                    self.note_aliases_gone_through(file, ret, &mut through);
                }
            }
        }
        for (a, alias) in hir.aliases.iter().enumerate() {
            if bound.alias_symbol[a].is_none() || alias.ty.is_none() {
                continue;
            }
            let sym = self.files().sym(file, bound.alias_symbol[a]);
            // Said of the declaration the alias goes by: the first.
            if self
                .declaration_of_alias(sym)
                .is_none_or(|first| (first.file, first.node) != (file, alias.ty))
            {
                continue;
            }
            // One that only leads to a circle as it is written is in error without being told so, whatever else is known of it.
            let leads_to_a_circle = self.find_circles(Needs::Alias(sym), &mut circles);
            if circles.circular.contains(&Needs::Alias(sym))
                || !leads_to_a_circle
                    && (through.contains(&sym)
                        || self.is_declared_as_itself(sym)
                        || self.is_circular_through_type_query(file, sym, alias.ty, parents))
            {
                out.push(Diagnostic {
                    start: alias.name_pos,
                    code: 2456,
                });
            }
        }
    }

    /// `getDeclaredTypeOfTypeAlias`: whether resolving the alias `sym`, declared as the type node `body` of `file`, came back to `sym`
    /// through a value: control flow analysis, an initializer, an inferred return type. `collect_needs` follows type syntax only, and
    /// `typeof` is where a type depends on a value.
    fn is_circular_through_type_query(
        &mut self,
        file: FileId,
        sym: Sym,
        body: TypeNodeId,
        parents: &[TypeNodeId],
    ) -> bool {
        self.declared_type(sym);
        if self.p.circular_aliases.get(&sym).is_none() {
            return false;
        }
        let hir = self.hir(file);
        (0..hir.types.len()).any(|t| {
            if !matches!(hir.types[t].kind, TypeNodeKind::Typeof { .. }) {
                return false;
            }
            let mut outermost = TypeNodeId(t as u32);
            while parents[outermost.idx()].is_some() {
                outermost = parents[outermost.idx()];
            }
            outermost == body
        })
    }

    /// `pushTypeResolution` .. `popTypeResolution`: what is under way from `at` on when `at` is asked for again is in a circle, and
    /// what is over is not gone into again. Says whether `at` is in a circle or needs something that is.
    fn find_circles(&self, at: Needs, circles: &mut Circles) -> bool {
        if let Some(&leads_to_a_circle) = circles.done.get(&at) {
            return leads_to_a_circle;
        }
        if let Some(start) = circles.path.iter().rposition(|&n| n == at) {
            circles
                .circular
                .extend(circles.path[start..].iter().copied());
            return true;
        }
        // Not so deep that the stack gives out: what is left alone then is taken to end well.
        if self.is_stack_low() {
            return false;
        }
        circles.path.push(at);
        let mut needs = Vec::new();
        self.collect_needs(at, &mut needs);
        let mut leads_to_a_circle = false;
        for next in needs {
            leads_to_a_circle |= self.find_circles(next, circles);
        }
        circles.path.pop();
        circles.done.insert(at, leads_to_a_circle);
        leads_to_a_circle
    }

    /// What checking the types of `file` asks for, in the order they are written: `checkSourceElement` of each, which comes after that
    /// of what it is made of.
    fn find_circles_in_order(&self, file: FileId, parents: &[TypeNodeId], circles: &mut Circles) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut is_declared = vec![false; hir.types.len()];
        for alias in &hir.aliases {
            if alias.ty.is_some() {
                is_declared[alias.ty.idx()] = true;
            }
        }
        // `checkTypeAliasDeclaration` does not ask what the alias stands for, nor `checkSignatureDeclaration` what a function type or a
        // call or construct signature returns.
        let mut nobody_asks = is_declared.clone();
        for func in &hir.fns {
            if func.ret.is_some()
                && matches!(
                    func.kind,
                    FnKind::FunctionType
                        | FnKind::ConstructorType
                        | FnKind::CallSignature
                        | FnKind::ConstructSignature
                )
            {
                nobody_asks[func.ret.idx()] = true;
            }
        }
        let mut needs = Vec::new();
        for t in 0..hir.types.len() {
            if bound.type_scope[t].is_none() {
                continue;
            }
            let at = written_at(hir, file, TypeNodeId(t as u32), parents, &is_declared);
            let kind = hir.types[t].kind;
            // `checkArrayType`, `checkTypeOperator`, `checkConditionalType` look at what the type is made of and no further. What it comes
            // to is asked by what it is the type of, or else by the type it is part of.
            if matches!(
                kind,
                TypeNodeKind::Array(_)
                    | TypeNodeKind::Keyof(_)
                    | TypeNodeKind::Readonly(_)
                    | TypeNodeKind::Cond { .. }
            ) {
                let parent = parents[t];
                let is_the_type_of_something = parent.is_none()
                    || matches!(
                        hir[parent].kind,
                        TypeNodeKind::Object(_)
                            | TypeNodeKind::Fn(_)
                            | TypeNodeKind::Infer(_)
                            | TypeNodeKind::Predicate { .. }
                    );
                if nobody_asks[t] || !is_the_type_of_something {
                    continue;
                }
            }
            self.collect_needs_of_type(at, &mut needs);
            // `checkMappedType` asks what the keys are renamed to.
            if let TypeNodeKind::Mapped(m) = kind
                && hir[m].name_ty.is_some()
            {
                self.collect_needs_of_type(
                    Written {
                        node: hir[m].name_ty,
                        is_aliased: false,
                        by_alias: false,
                        ..at
                    },
                    &mut needs,
                );
            }
            if self.puts_off_its_type_arguments(at) {
                match kind {
                    // `checkTypeArgumentConstraints`: with something to hold them against, the type arguments are asked for after all.
                    TypeNodeKind::Ref { args, .. }
                        if self
                            .type_symbol_written(file, at.node)
                            .is_some_and(|sym| self.has_constrained_type_parameter(sym)) =>
                    {
                        for arg in hir.ids(args) {
                            self.collect_needs_of_type(
                                Written {
                                    node: arg,
                                    is_aliased: false,
                                    ..at
                                },
                                &mut needs,
                            );
                        }
                    }
                    // `checkNamedTupleMember`
                    TypeNodeKind::Tuple(elems) => {
                        for e in elems.iter().filter(|&e| hir[e].name.is_some()) {
                            self.collect_needs_of_element(at, &hir[e], &mut needs);
                        }
                    }
                    _ => {}
                }
            }
            for need in needs.drain(..) {
                self.find_circles(need, circles);
            }
        }
    }

    /// Whether a type parameter of the class or the interface `sym` is declared to extend something.
    fn has_constrained_type_parameter(&self, sym: Sym) -> bool {
        self.files().decls(sym).into_iter().any(|(file, decl)| {
            let hir = self.hir(file);
            let params = match decl {
                Decl::Class(c) => hir[c].type_params,
                Decl::Interface(i) => hir[i].type_params,
                _ => return false,
            };
            params.iter().any(|p| hir[p].constraint.is_some())
        })
    }

    fn collect_needs(&self, of: Needs, out: &mut Vec<Needs>) {
        match of {
            Needs::Alias(sym) => {
                if let Some(at) = self.declaration_of_alias(sym) {
                    self.collect_needs_of_type(at, out);
                }
            }
            Needs::Variable(file, d) => {
                self.collect_needs_of_type(
                    Written {
                        file,
                        node: self.hir(file)[d].ty,
                        is_aliased: false,
                        by_alias: false,
                    },
                    out,
                );
            }
            // `getTypeArguments`
            Needs::Arguments(file, node) => {
                let hir = self.hir(file);
                let at = Written {
                    file,
                    node,
                    is_aliased: false,
                    by_alias: true,
                };
                match hir[node].kind {
                    TypeNodeKind::Ref { args, .. } => {
                        for arg in hir.ids(args) {
                            self.collect_needs_of_type(Written { node: arg, ..at }, out);
                        }
                    }
                    TypeNodeKind::Array(element) => self.collect_needs_of_type(
                        Written {
                            node: element,
                            ..at
                        },
                        out,
                    ),
                    TypeNodeKind::Tuple(elems) => self.collect_needs_of_elements(at, elems, out),
                    _ => {}
                }
            }
            // `resolveBaseTypesOfInterface` resolves every `extends` type at once: a heritage clause defers no type arguments.
            // `hasBaseType` then asks for the base types of each base, and `resolveObjectTypeMembers` for its members.
            Needs::Bases(sym) => {
                for (file, decl) in self.files().decls(sym) {
                    if let Decl::Interface(i) = decl {
                        let hir = self.hir(file);
                        for node in hir.ids(hir[i].extends) {
                            let at = Written {
                                file,
                                node,
                                is_aliased: false,
                                by_alias: false,
                            };
                            self.collect_needs_of_type(at, out);
                            self.collect_needs_of_members(at, out, 0);
                        }
                    }
                }
            }
        }
    }

    /// What the type alias `sym` is declared as.
    fn declaration_of_alias(&self, sym: Sym) -> Option<Written> {
        self.files()
            .decls(sym)
            .into_iter()
            .find_map(|(file, decl)| match decl {
                Decl::Alias(a) if self.hir(file)[a].ty.is_some() => Some(Written {
                    file,
                    node: self.hir(file)[a].ty,
                    is_aliased: true,
                    by_alias: true,
                }),
                _ => None,
            })
    }

    /// What the reference to a type at `node` names.
    fn type_symbol_written(&self, file: FileId, node: TypeNodeId) -> Option<Sym> {
        let hir = self.hir(file);
        let TypeNodeKind::Ref { name, .. } = hir[node].kind else {
            return None;
        };
        let scope = self.bound(file).type_scope[node.idx()];
        let mut names = [Atom::NONE; 8];
        if scope.is_none() || name.len() > names.len() {
            return None;
        }
        for (slot, part) in names.iter_mut().zip(hir.ids(name)) {
            *slot = part;
        }
        let sym = self
            .files()
            .resolve_entity(file, scope, &names[..name.len()], SymFlags::TYPE)?;
        // `resolveEntityName`: a symbol that is a type itself is not resolved further.
        self.files().resolve_alias_as(sym, SymFlags::TYPE)
    }

    /// The type alias `node` names, if that is all it does and the alias takes no type arguments; and what it is declared as.
    fn plain_alias_written(&self, file: FileId, node: TypeNodeId) -> Option<(Sym, Written)> {
        let TypeNodeKind::Ref { args, .. } = self.hir(file)[node].kind else {
            return None;
        };
        let sym = self.type_symbol_written(file, node)?;
        let flags = self.files().flags(sym);
        if !args.is_empty()
            || !flags.contains(SymFlags::TYPE_ALIAS)
            || flags.intersects(SymFlags::CLASS | SymFlags::INTERFACE)
            || self.type_argument_arity(sym).1 != 0
        {
            return None;
        }
        Some((sym, self.declaration_of_alias(sym)?))
    }

    /// The aliases from `node` on, each of which is declared as the next.
    fn note_aliases_gone_through(
        &self,
        mut file: FileId,
        mut node: TypeNodeId,
        through: &mut Vec<Sym>,
    ) {
        while let Some((sym, declared)) = self.plain_alias_written(file, node) {
            if through.contains(&sym) {
                break;
            }
            through.push(sym);
            (file, node) = (declared.file, declared.node);
        }
    }

    /// Whether working out what `sym` stands for came back to `sym` and left it at that: on its own, or as a member of a union or an
    /// intersection, there is nothing to put the question off.
    fn is_declared_as_itself(&mut self, sym: Sym) -> bool {
        let mut todo = vec![self.declared_type(sym)];
        while let Some(ty) = todo.pop() {
            match self.data(ty) {
                TypeData::LazyAlias { sym: named, .. } if *named == sym => return true,
                TypeData::Union(parts) | TypeData::Intersection(parts) => {
                    todo.extend_from_slice(parts)
                }
                _ => {}
            }
        }
        false
    }

    /// `mayResolveTypeAlias`
    fn may_lead_to_a_type_alias(&self, file: FileId, node: TypeNodeId) -> bool {
        let hir = self.hir(file);
        match hir[node].kind {
            TypeNodeKind::Ref { .. } => self
                .type_symbol_written(file, node)
                .is_some_and(|sym| self.files().flags(sym).contains(SymFlags::TYPE_ALIAS)),
            TypeNodeKind::Typeof { .. } => true,
            TypeNodeKind::Keyof(inner) | TypeNodeKind::Readonly(inner) => {
                self.may_lead_to_a_type_alias(file, inner)
            }
            TypeNodeKind::Union(members) | TypeNodeKind::Intersection(members) => hir
                .ids(members)
                .any(|m| self.may_lead_to_a_type_alias(file, m)),
            TypeNodeKind::IndexedAccess { obj, index } => {
                self.may_lead_to_a_type_alias(file, obj)
                    || self.may_lead_to_a_type_alias(file, index)
            }
            TypeNodeKind::Cond {
                check,
                extends,
                yes,
                no,
            } => [check, extends, yes, no]
                .into_iter()
                .any(|x| self.may_lead_to_a_type_alias(file, x)),
            _ => false,
        }
    }

    /// The same of an element of a tuple type.
    fn element_may_lead_to_a_type_alias(&self, file: FileId, elem: &TupleElem) -> bool {
        match self.hir(file)[elem.ty].kind {
            TypeNodeKind::Array(element) if elem.rest && elem.name.is_none() => {
                self.may_lead_to_a_type_alias(file, element)
            }
            _ => elem.rest && elem.name.is_none() || self.may_lead_to_a_type_alias(file, elem.ty),
        }
    }

    /// `isDeferredTypeReferenceNode`, and what `getTypeFromClassOrInterfaceReference` and `getTypeFromArrayOrTupleTypeNode` ask before
    /// they ask that: whether the reference to a class or an interface, the array type or the tuple type leaves its type arguments
    /// for when somebody wants them.
    fn puts_off_its_type_arguments(&self, at: Written) -> bool {
        let hir = self.hir(at.file);
        match hir[at.node].kind {
            TypeNodeKind::Array(element) => {
                at.is_aliased || at.by_alias && self.may_lead_to_a_type_alias(at.file, element)
            }
            TypeNodeKind::Tuple(elems) => {
                !elems.iter().any(|e| is_variadic_element(hir, &hir[e]))
                    && (at.is_aliased
                        || at.by_alias
                            && elems
                                .iter()
                                .any(|e| self.element_may_lead_to_a_type_alias(at.file, &hir[e])))
            }
            TypeNodeKind::Ref { args, .. } => {
                let Some(sym) = self.type_symbol_written(at.file, at.node) else {
                    return false;
                };
                let (least, most) = self.type_argument_arity(sym);
                self.files()
                    .flags(sym)
                    .intersects(SymFlags::CLASS | SymFlags::INTERFACE)
                    && most != 0
                    && (least..=most).contains(&args.len())
                    && (at.is_aliased
                        || at.by_alias
                            && (args.len() != most
                                || hir
                                    .ids(args)
                                    .any(|a| self.may_lead_to_a_type_alias(at.file, a))))
            }
            _ => false,
        }
    }

    /// The types in what a type alias is declared as that put off their type arguments.
    fn collect_types_that_put_off(&self, at: Written, out: &mut Vec<TypeNodeId>) {
        let hir = self.hir(at.file);
        if self.puts_off_its_type_arguments(at) {
            out.push(at.node);
        }
        let inner = |node: TypeNodeId| Written {
            node,
            is_aliased: false,
            ..at
        };
        // Only through what `isResolvedByTypeAlias` goes through.
        match hir[at.node].kind {
            TypeNodeKind::Ref { args: list, .. }
            | TypeNodeKind::Union(list)
            | TypeNodeKind::Intersection(list) => {
                for x in hir.ids(list) {
                    self.collect_types_that_put_off(inner(x), out);
                }
            }
            TypeNodeKind::Readonly(x) => {
                self.collect_types_that_put_off(Written { node: x, ..at }, out)
            }
            TypeNodeKind::Array(x) | TypeNodeKind::Keyof(x) => {
                self.collect_types_that_put_off(inner(x), out)
            }
            TypeNodeKind::Tuple(elems) => {
                for e in elems.iter() {
                    if hir[e].name.is_some() || !(hir[e].rest || hir[e].optional) {
                        self.collect_types_that_put_off(inner(hir[e].ty), out);
                    }
                }
            }
            TypeNodeKind::IndexedAccess { obj, index } => {
                self.collect_types_that_put_off(inner(obj), out);
                self.collect_types_that_put_off(inner(index), out);
            }
            TypeNodeKind::Cond {
                check,
                extends,
                yes,
                no,
            } => {
                for x in [check, extends, yes, no] {
                    self.collect_types_that_put_off(inner(x), out);
                }
            }
            _ => {}
        }
    }

    /// What `getTypeFromTypeNode` of the type at `at` asks for there and then.
    fn collect_needs_of_type(&self, at: Written, out: &mut Vec<Needs>) {
        let hir = self.hir(at.file);
        let inner = |node: TypeNodeId| Written {
            node,
            is_aliased: false,
            ..at
        };
        let outside = |node: TypeNodeId| Written {
            node,
            is_aliased: false,
            by_alias: false,
            ..at
        };
        match hir[at.node].kind {
            TypeNodeKind::Ref { args, .. } => {
                let Some(sym) = self.type_symbol_written(at.file, at.node) else {
                    return;
                };
                let flags = self.files().flags(sym);
                if flags.intersects(SymFlags::CLASS | SymFlags::INTERFACE) {
                    if self.puts_off_its_type_arguments(at) {
                        return;
                    }
                } else if flags.contains(SymFlags::TYPE_ALIAS) {
                    out.push(Needs::Alias(sym));
                } else {
                    return;
                }
                // The wrong number of type arguments is an error, and they are not looked at.
                let (least, most) = self.type_argument_arity(sym);
                if (least..=most).contains(&args.len()) {
                    for arg in hir.ids(args) {
                        self.collect_needs_of_type(inner(arg), out);
                    }
                }
            }
            TypeNodeKind::Array(element) => {
                if !self.puts_off_its_type_arguments(at) {
                    self.collect_needs_of_type(inner(element), out);
                }
            }
            TypeNodeKind::Tuple(elems) => {
                if !self.puts_off_its_type_arguments(at) {
                    self.collect_needs_of_elements(at, elems, out);
                }
            }
            TypeNodeKind::Union(members) | TypeNodeKind::Intersection(members) => {
                for m in hir.ids(members) {
                    self.collect_needs_of_type(inner(m), out);
                }
            }
            TypeNodeKind::Readonly(x) => self.collect_needs_of_type(Written { node: x, ..at }, out),
            // `getIndexType` of a type that is not generic lists its properties (`getLiteralTypeFromProperties`).
            TypeNodeKind::Keyof(x) => {
                self.collect_needs_of_type(inner(x), out);
                self.collect_needs_of_members(inner(x), out, 0);
            }
            TypeNodeKind::IndexedAccess { obj, index } => {
                self.collect_needs_of_type(inner(obj), out);
                self.collect_needs_of_type(inner(index), out);
                // Looking something up takes knowing what is there.
                if is_plain_key(hir, index) {
                    self.collect_needs_of_members(inner(obj), out, 0);
                }
            }
            // Which branch is taken, if any, is not a matter of how it is written.
            TypeNodeKind::Cond { check, extends, .. } => {
                self.collect_needs_of_type(inner(check), out);
                self.collect_needs_of_type(inner(extends), out);
                // `getConditionalType`: what does not wait for type parameters is compared there and then, and to compare something
                // with an object type takes knowing what is in it.
                if self.is_written_as_an_object_type(at.file, extends) {
                    self.collect_needs_of_members(inner(check), out, 0);
                }
            }
            TypeNodeKind::Template { types, .. } => {
                for x in hir.ids(types) {
                    self.collect_needs_of_type(outside(x), out);
                }
            }
            // `getTypeFromMappedTypeNode` asks what is mapped over at once, for the sake of this very error.
            TypeNodeKind::Mapped(m) => {
                let over = hir[hir[m].param].constraint;
                if over.is_some() {
                    self.collect_needs_of_type(outside(over), out);
                }
            }
            TypeNodeKind::Typeof { expr, .. } => {
                let ExprKind::Ident(name) = hir[expr].kind else {
                    return;
                };
                let Some(sym) = self
                    .symbol_of_identifier(at.file, expr, name)
                    .and_then(|sym| self.files().resolve_alias_if_needed(sym))
                else {
                    return;
                };
                for (file, decl) in self.files().decls(sym) {
                    if let Decl::Var(pat) = decl
                        && let PatParent::Var(d) = self.bound(file).pat_parent[pat.idx()]
                        && self.hir(file)[d].ty.is_some()
                    {
                        out.push(Needs::Variable(file, d));
                        break;
                    }
                }
            }
            _ => {}
        }
    }

    /// Whether the type at `node` is an object type whatever the names in it mean, and one that does not wait for type parameters:
    /// a type literal, a function type, an array type, a tuple type nothing is spread into, a class or an interface.
    fn is_written_as_an_object_type(&self, file: FileId, node: TypeNodeId) -> bool {
        let hir = self.hir(file);
        match hir[node].kind {
            TypeNodeKind::Object(_) | TypeNodeKind::Fn(_) | TypeNodeKind::Array(_) => true,
            TypeNodeKind::Tuple(elems) => !elems.iter().any(|e| is_variadic_element(hir, &hir[e])),
            TypeNodeKind::Ref { .. } => self.type_symbol_written(file, node).is_some_and(|sym| {
                self.files()
                    .flags(sym)
                    .intersects(SymFlags::CLASS | SymFlags::INTERFACE)
            }),
            _ => false,
        }
    }

    /// What `getTypeFromTypeNode` of each element of the tuple type at `at` asks for there and then.
    fn collect_needs_of_elements(
        &self,
        at: Written,
        elems: Span<TupleElemId>,
        out: &mut Vec<Needs>,
    ) {
        for e in elems.iter() {
            self.collect_needs_of_element(at, &self.hir(at.file)[e], out);
        }
    }

    fn collect_needs_of_element(&self, at: Written, elem: &TupleElem, out: &mut Vec<Needs>) {
        // `getTypeFromRestTypeNode`: of `...X[]` it is `X` that is asked for.
        let node = if elem.rest {
            rest_element_type_node(self.hir(at.file), elem).unwrap_or(elem.ty)
        } else {
            elem.ty
        };
        // `isResolvedByTypeAlias` goes through `name: T`, and neither through `T?` nor through `...T`.
        let by_alias = at.by_alias && (elem.name.is_some() || !(elem.rest || elem.optional));
        self.collect_needs_of_type(
            Written {
                node,
                is_aliased: false,
                by_alias,
                ..at
            },
            out,
        );
    }

    /// What has to be found out to know the members of the type at `at`, once it is known what type it is: the type arguments that
    /// were put off (`resolveTypeReferenceMembers`) and the base types of an interface (`resolveObjectTypeMembers`).
    fn collect_needs_of_members(&self, at: Written, out: &mut Vec<Needs>, depth: u32) {
        if depth > 32 {
            return;
        }
        let hir = self.hir(at.file);
        let inner = |node: TypeNodeId| Written {
            node,
            is_aliased: false,
            ..at
        };
        match hir[at.node].kind {
            TypeNodeKind::Ref { .. } => match self.plain_alias_written(at.file, at.node) {
                Some((_, declared)) => self.collect_needs_of_members(declared, out, depth + 1),
                None => {
                    if self.puts_off_its_type_arguments(at) {
                        out.push(Needs::Arguments(at.file, at.node));
                    }
                    // `resolveObjectTypeMembers` calls `getBaseTypes`.
                    if let Some(sym) = self.type_symbol_written(at.file, at.node)
                        && self.files().flags(sym).contains(SymFlags::INTERFACE)
                    {
                        out.push(Needs::Bases(sym));
                    }
                }
            },
            TypeNodeKind::Array(_) | TypeNodeKind::Tuple(_) => {
                if self.puts_off_its_type_arguments(at) {
                    out.push(Needs::Arguments(at.file, at.node));
                }
            }
            TypeNodeKind::Readonly(x) => {
                self.collect_needs_of_members(Written { node: x, ..at }, out, depth + 1)
            }
            TypeNodeKind::Union(members) | TypeNodeKind::Intersection(members) => {
                for m in hir.ids(members) {
                    self.collect_needs_of_members(inner(m), out, depth + 1);
                }
            }
            TypeNodeKind::IndexedAccess { .. } => {
                if let Some(found) = self.type_written_for(at, depth + 1) {
                    self.collect_needs_of_members(found, out, depth + 1);
                }
            }
            _ => {}
        }
    }

    /// The reference, the array type or the tuple type that the type at `at` comes to, where following names and looking up
    /// elements is all it takes to tell.
    fn type_written_for(&self, at: Written, depth: u32) -> Option<Written> {
        if depth > 32 {
            return None;
        }
        let hir = self.hir(at.file);
        match hir[at.node].kind {
            TypeNodeKind::Ref { .. } => match self.plain_alias_written(at.file, at.node) {
                Some((_, declared)) => self.type_written_for(declared, depth + 1),
                None => Some(at),
            },
            TypeNodeKind::Array(_) | TypeNodeKind::Tuple(_) => Some(at),
            TypeNodeKind::Readonly(x) => {
                self.type_written_for(Written { node: x, ..at }, depth + 1)
            }
            TypeNodeKind::IndexedAccess { obj, index } => {
                let object = self.type_written_for(
                    Written {
                        node: obj,
                        is_aliased: false,
                        ..at
                    },
                    depth + 1,
                )?;
                let of = self.hir(object.file);
                let element = match (of[object.node].kind, hir[index].kind) {
                    (
                        TypeNodeKind::Array(element),
                        TypeNodeKind::Keyword(Keyword::Number) | TypeNodeKind::NumberLit(_),
                    ) => element,
                    (TypeNodeKind::Tuple(elems), TypeNodeKind::NumberLit(n)) => {
                        let n = hir.numbers[n as usize];
                        if n < 0.0
                            || n.fract() != 0.0
                            || n >= elems.len() as f64
                            || elems.iter().take(n as usize + 1).any(|e| of[e].rest)
                            || of[elems.at(n as usize)].optional
                        {
                            return None;
                        }
                        of[elems.at(n as usize)].ty
                    }
                    _ => return None,
                };
                self.type_written_for(
                    Written {
                        node: element,
                        is_aliased: false,
                        ..object
                    },
                    depth + 1,
                )
            }
            _ => None,
        }
    }
}
