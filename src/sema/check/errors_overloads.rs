//! Overloads and what implements them: 2389 2390 2391 2392 2393 2394 2387 2388 2516.
//!
//! Follows `checkFunctionOrConstructorSymbolWorker` of TypeScript 7.0.2's checker.go. That goes through the declarations of a symbol
//! and asks whether one ends where the next starts. Here the declarations are taken from each list of statements and of members,
//! and one ends where another starts if that is the next in the list and the parser skipped no token in between.

use super::errors::Diagnostic;
use super::*;
use crate::bind::Decl;
use smallvec::SmallVec;

/// `NodeIsPresent(node.Body())`: a body written where none belongs is not kept, but it counts.
fn has_body(func: &Func) -> bool {
    !matches!(func.body, FnBody::None) || func.flags.contains(Flags::BODY_DROPPED)
}

/// `node.Body() != nil`: a block whose `{` is missing is a body node, though not a present one.
fn has_body_node(func: &Func) -> bool {
    has_body(func) || func.flags.contains(Flags::MISSING_BODY)
}

/// Where a constructor starts. An error about one goes to the first of its modifiers (`GetErrorRangeForNode`); `member.pos` is
/// the keyword. Only the modifiers it is known to have are looked for, each once.
fn start_of_constructor(text: &[u8], member: &Member) -> u32 {
    const MODIFIERS: &[(&[u8], Flags)] = &[
        (b"public", Flags::PUBLIC),
        (b"private", Flags::PRIVATE),
        (b"protected", Flags::PROTECTED),
        (b"abstract", Flags::ABSTRACT),
        (b"override", Flags::OVERRIDE),
        (b"readonly", Flags::READONLY),
        (b"declare", Flags::AMBIENT),
        (b"async", Flags::ASYNC),
        (b"accessor", Flags::ACCESSOR),
    ];
    let mut start = member.pos as usize;
    if start > text.len() {
        return member.pos;
    }
    let mut left = member.flags;
    loop {
        let before = text[..start].trim_ascii_end();
        match MODIFIERS
            .iter()
            .find(|m| left.contains(m.1) && before.ends_with(m.0))
        {
            Some(m) => {
                left.remove(m.1);
                start = before.len() - m.0.len();
            }
            None => return start as u32,
        }
    }
}

/// Whether the parser skipped a token right before the declaration whose name is at `name`. `previous`: the name of the declaration
/// before it in the list. Then `previous.End() != node.Pos()`, though the two are neighbours in the tree.
fn follows_skipped_token(hir: &hir::File, previous: u32, name: u32) -> bool {
    let after = hir.after_skipped.partition_point(|&start| start <= name);
    let Some(&start) = after
        .checked_sub(1)
        .and_then(|last| hir.after_skipped.get(last))
    else {
        return false;
    };
    // Only modifiers and keywords stand between the first token of a declaration and its name. A token skipped inside the previous
    // declaration is followed by whatever closes the list it was skipped in.
    start > previous
        && hir
            .text
            .get(start as usize..name as usize)
            .is_some_and(|head| !head.iter().any(|&b| matches!(b, b'}' | b')' | b']' | b';')))
}

/// The way `checkFunctionOrConstructorSymbolWorker` goes through the declarations of one function, method or constructor.
/// `group`: where each is in the list it is written in. `of`: whether the one there is ambient, and whether it has a body.
/// `starts_at_previous_end`: whether the one there starts where the one before it in the list ends.
/// `report` (`reportImplementationExpectedError`) is called for each that the next does not follow at once.
/// Gives the last that is not ambient.
fn walk_declarations(
    group: &[usize],
    of: impl Fn(usize) -> (bool, bool),
    starts_at_previous_end: impl Fn(usize) -> bool,
    mut report: impl FnMut(usize),
) -> Option<usize> {
    let (mut previous, mut last_non_ambient): (Option<usize>, Option<usize>) = (None, None);
    let mut has_implementation = false;
    for &i in group {
        let (is_ambient, is_implementation) = of(i);
        // Ambient declarations may stand apart, and to mix them with others is an error of its own.
        if is_ambient {
            previous = None;
        }
        // So is a second body.
        if !(is_implementation && has_implementation)
            && let Some(p) = previous
            && (p + 1 != i || !starts_at_previous_end(i))
        {
            report(p);
        }
        has_implementation |= is_implementation;
        previous = Some(i);
        if !is_ambient {
            last_non_ambient = Some(i);
        }
    }
    last_non_ambient
}

impl Checker<'_> {
    pub(super) fn check_overloads(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        if hir.kind == FileKind::Declaration || hir.has_errors {
            return;
        }
        self.check_function_overloads_in(file, hir.body, out);
        for s in &hir.stmts {
            if let StmtKind::Block(list) = s.kind {
                self.check_function_overloads_in(file, list, out);
            }
        }
        for f in &hir.fns {
            if let FnBody::Block(list) = f.body {
                self.check_function_overloads_in(file, list, out);
            }
        }
        for m in &hir.modules {
            if !m.flags.contains(Flags::AMBIENT) {
                self.check_function_overloads_in(file, m.body, out);
            }
        }
        for case in &hir.cases {
            self.check_function_overloads_in(file, case.body, out);
        }
        for c in 0..hir.classes.len() {
            if !hir.classes[c].flags.contains(Flags::AMBIENT) {
                self.check_member_overloads(file, ClassId(c as u32), out);
            }
        }
    }

    fn check_function_overloads_in(
        &mut self,
        file: FileId,
        list: IdList<StmtId>,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        if !hir
            .ids(list)
            .any(|s| matches!(hir[s].kind, StmtKind::Fn(_)))
        {
            return;
        }
        // The function each statement declares, and where an error about it goes: to its name, or to where the statement starts.
        let functions: Vec<Option<(FnId, u32)>> = hir
            .ids(list)
            .map(|s| match hir[s].kind {
                StmtKind::Fn(f) => Some((
                    f,
                    if hir[f].name.is_some() {
                        hir[f].name_pos
                    } else {
                        hir[s].pos
                    },
                )),
                _ => None,
            })
            .collect();
        // All that go by one name, together.
        let mut named: Vec<(Atom, usize)> = Vec::new();
        for (i, function) in functions.iter().enumerate() {
            if let Some((f, _)) = *function
                && hir[f].name.is_some()
            {
                named.push((hir[f].name, i));
            }
        }
        named.sort_unstable();
        let mut group: Vec<usize> = Vec::new();
        for same in named.chunk_by(|a, b| a.0 == b.0) {
            group.clear();
            group.extend(same.iter().map(|n| n.1));
            self.check_function_symbol(file, &functions, &group, out);
        }
        // Every `export default function` declares the export `default` as well, whatever it is called.
        group.clear();
        group.extend(
            (0..functions.len()).filter(|&i| {
                functions[i].is_some_and(|(f, _)| hir[f].flags.contains(Flags::DEFAULT))
            }),
        );
        if !group.is_empty() {
            self.check_function_symbol(file, &functions, &group, out);
        }
    }

    /// `checkFunctionOrConstructorSymbolWorker`, of the function whose declarations are at `group` in `functions`, a list of statements.
    fn check_function_symbol(
        &mut self,
        file: FileId,
        functions: &[Option<(FnId, u32)>],
        group: &[usize],
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        if hir.is_js
            && !group.iter().any(|&i| {
                functions[i].is_some_and(|(f, _)| self.is_js_function_symbol_checked(file, f))
            })
        {
            return;
        }
        let starts_at_previous_end = |i: usize| match (functions[i - 1], functions[i]) {
            (Some((_, previous)), Some((_, start))) => !follows_skipped_token(hir, previous, start),
            _ => true,
        };
        // `reportImplementationExpectedError`
        let mut report = |i: usize| {
            let Some((f, start)) = functions[i] else {
                return;
            };
            // `NodeIsMissing(name)`
            if hir[f].name == known::empty {
                return;
            }
            // `subsequentNode.Pos() == node.End()`
            match functions
                .get(i + 1)
                .copied()
                .flatten()
                .filter(|_| starts_at_previous_end(i + 1))
            {
                Some((next, _)) if hir[f].name.is_some() && hir[next].name == hir[f].name => {}
                Some((next, at)) if has_body(&hir[next]) => {
                    out.push(Diagnostic {
                        start: at,
                        code: 2389,
                    });
                    // `DeclarationNameToString`
                    let name = if hir[f].name.is_some() {
                        let name_end = self.end_of_name_at(file, hir[f].name_pos);
                        self.source_text(file, hir[f].name_pos, name_end)
                    } else {
                        "(Missing)".to_owned()
                    };
                    self.note(at, 0, 2389, vec![name]);
                }
                _ => out.push(Diagnostic { start, code: 2391 }),
            }
        };
        let of = |i: usize| {
            functions[i].map_or((false, false), |(f, _)| {
                (hir[f].flags.contains(Flags::AMBIENT), has_body(&hir[f]))
            })
        };
        if let Some(last) = walk_declarations(group, of, &starts_at_previous_end, &mut report)
            && let Some((f, _)) = functions[last]
            && !has_body_node(&hir[f])
            && self.is_last_declaration_of_function(file, f)
        {
            report(last);
        }
        let declarations: SmallVec<[(FnId, u32, u32); 4]> = group
            .iter()
            .filter_map(|&i| functions[i])
            .map(|(f, start)| (f, start, 0))
            .collect();
        // A body in another block of the namespace, or in another file, is a body of the function as well.
        if declarations.iter().filter(|d| has_body(&hir[d.0])).count() < 2
            && let Some(all) =
                self.all_declarations_of_function(file, declarations[0].0, declarations.len())
            && all
                .iter()
                .filter(|&&(of, decl)| matches!(decl, Decl::Fn(f) if has_body(&self.hir(of)[f])))
                .count()
                > 1
        {
            out.extend(declarations.iter().map(|d| Diagnostic {
                start: d.1,
                code: 2393,
            }));
        }
        self.check_overload_group(file, &declarations, 2393, out);
    }

    /// `checkFunctionOrMethodDeclaration`: the function `f` of a JavaScript file is looked at as an export (`symbol.Parent != nil`),
    /// or from a declaration of it in a file that is not JavaScript.
    fn is_js_function_symbol_checked(&self, file: FileId, f: FnId) -> bool {
        self.hir(file)[f].flags.contains(Flags::EXPORT)
            || self
                .all_declarations_of_function(file, f, 0)
                .is_some_and(|all| {
                    all.iter()
                        .any(|&(of, decl)| matches!(decl, Decl::Fn(_)) && !self.hir(of).is_js)
                })
    }

    /// Every declaration of the symbol of the function `f`, if it has more than the `here` that are written next to `f`: in other
    /// blocks of a namespace, in other files.
    fn all_declarations_of_function(
        &self,
        file: FileId,
        f: FnId,
        here: usize,
    ) -> Option<Vec<(FileId, Decl)>> {
        let symbol = self.bound(file).fn_symbol[f.idx()];
        if symbol.is_none() {
            return None;
        }
        let sym = self.files().sym(file, symbol);
        let whole = self.files().symbol(sym);
        // `mergeSymbol` keeps apart what cannot be one symbol with a function.
        let excluded = SymFlags::VALUE
            .difference(SymFlags::FUNCTION | SymFlags::VALUE_MODULE | SymFlags::CLASS);
        if whole.flags.intersects(excluded)
            || !whole.flags.contains(SymFlags::MERGED) && whole.decls.len() <= here
        {
            return None;
        }
        Some(self.files().decls(sym))
    }

    /// Whether `f` is `lastSeenNonAmbientDeclaration`. What is exported is looked at block by block (`LocalSymbol`). What is not, at the
    /// top of a script, is one function with what other scripts declare by the name.
    fn is_last_declaration_of_function(&self, file: FileId, f: FnId) -> bool {
        self.hir(file)[f].flags.contains(Flags::EXPORT)
            || self.all_declarations_of_function(file, f, usize::MAX).is_none_or(|all| {
                let last = all.iter().rev().find(|&&(of, decl)| matches!(decl, Decl::Fn(g) if !self.hir(of)[g].flags.contains(Flags::AMBIENT)));
                last == Some(&(file, Decl::Fn(f)))
            })
    }

    /// `group`: the declarations of one function, method or constructor, and where an error about each starts and ends. An end of 0:
    /// with the token it starts at.
    fn check_overload_group(
        &mut self,
        file: FileId,
        group: &[(FnId, u32, u32)],
        duplicate: u32,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        let mut bodies = group.iter().filter(|g| has_body(&hir[g.0]));
        let Some(&(implementation, _, _)) = bodies.next() else {
            return;
        };
        if bodies.next().is_some() {
            out.extend(group.iter().map(|g| Diagnostic {
                start: g.1,
                code: duplicate,
            }));
            for g in group {
                self.note(g.1, g.2, duplicate, Vec::new());
            }
        }
        if group.len() < 2 {
            return;
        }
        let body = self.sig_of_fn(file, implementation);
        for &(f, start, end) in group {
            if has_body(&hir[f]) {
                continue;
            }
            let overload = self.sig_of_fn(file, f);
            match self.is_implementation_compatible_with_overload(body, overload) {
                Some(true) => {}
                Some(false) => {
                    out.push(Diagnostic { start, code: 2394 });
                    self.note(start, end, 2394, Vec::new());
                    break;
                }
                None => break,
            }
        }
    }

    fn check_member_overloads(&mut self, file: FileId, c: ClassId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        let members = hir[c].members;
        if !members
            .iter()
            .any(|m| matches!(hir[m].kind, MemberKind::Method | MemberKind::Constructor))
        {
            return;
        }
        // What each method is called, if that can be told (`hasBindableName`).
        let mut names: Vec<Option<Atom>> = Vec::with_capacity(members.len());
        for m in members.iter() {
            names.push(if hir[m].kind == MemberKind::Method {
                self.member_name(file, hir[m].key)
            } else {
                None
            });
        }
        let is_static = |i: usize| hir[members.at(i)].flags.contains(Flags::STATIC);
        let mut group: Vec<usize> = (0..members.len())
            .filter(|&i| hir[members.at(i)].kind == MemberKind::Constructor)
            .collect();
        if !group.is_empty() {
            self.check_member_symbol(file, c, &names, &group, out);
        }
        let mut methods: Vec<(Atom, bool, usize)> = (0..members.len())
            .filter_map(|i| names[i].map(|name| (name, is_static(i), i)))
            .collect();
        methods.sort_unstable();
        for i in 0..members.len() {
            let Some(name) = names[i] else { continue };
            let key = (name, is_static(i));
            let first = methods.partition_point(|m| (m.0, m.1) < key);
            if methods[first].2 != i {
                continue;
            }
            group.clear();
            group.extend(
                methods[first..]
                    .iter()
                    .take_while(|m| (m.0, m.1) == key)
                    .map(|m| m.2),
            );
            self.check_member_symbol(file, c, &names, &group, out);
        }
    }

    /// `checkFunctionOrConstructorSymbolWorker`, of the constructor or the method whose declarations are at `group` among the members
    /// of `c`. `names`: what each method among these is called, if that can be told.
    fn check_member_symbol(
        &mut self,
        file: FileId,
        c: ClassId,
        names: &[Option<Atom>],
        group: &[usize],
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        let members = hir[c].members;
        // Declared once, with a body: nothing can be wrong.
        if let [only] = group
            && has_body(&hir[hir[members.at(*only)].func])
        {
            return;
        }
        let start_of = |member: &Member| {
            if member.kind == MemberKind::Constructor {
                start_of_constructor(&hir.text, member)
            } else {
                member.pos
            }
        };
        // `GetErrorRangeForNode`: up to the end of the name, or of the keyword of a constructor.
        let end_of = |i: usize| {
            let m = members.at(i);
            if hir[m].kind == MemberKind::Constructor {
                self.end_of_token_at(file, hir[m].pos)
            } else {
                self.end_of_member_name(file, m)
            }
        };
        let starts_at_previous_end = |i: usize| {
            !follows_skipped_token(hir, hir[members.at(i - 1)].pos, hir[members.at(i)].pos)
        };
        // `reportImplementationExpectedError`
        let mut report = |i: usize| {
            let member = &hir[members.at(i)];
            // `NodeIsMissing(name)`: nothing is written where the name would be, not even `""` or `[""]`.
            if matches!(member.key, PropKey::Name(known::empty))
                && !matches!(hir.text.get(member.pos as usize), Some(b'"' | b'\'' | b'['))
            {
                return;
            }
            // `subsequentNode.Pos() == node.End()`
            if i + 1 < members.len() && starts_at_previous_end(i + 1) {
                let next = &hir[members.at(i + 1)];
                if next.kind == member.kind {
                    if names[i].is_some() && names[i + 1] == names[i] {
                        let is_static = member.flags.contains(Flags::STATIC);
                        if next.flags.contains(Flags::STATIC) != is_static {
                            let code = if is_static { 2387 } else { 2388 };
                            out.push(Diagnostic {
                                start: next.pos,
                                code,
                            });
                            self.note(next.pos, end_of(i + 1), code, Vec::new());
                        }
                        return;
                    }
                    if has_body(&hir[next.func]) {
                        out.push(Diagnostic {
                            start: start_of(next),
                            code: 2389,
                        });
                        // `DeclarationNameToString`
                        let name = if member.kind == MemberKind::Constructor {
                            "(Missing)".to_owned()
                        } else {
                            self.source_text(file, member.pos, end_of(i))
                        };
                        self.note(start_of(next), end_of(i + 1), 2389, vec![name]);
                        return;
                    }
                }
            }
            let code = match member.kind {
                MemberKind::Constructor => 2390,
                _ if member.flags.contains(Flags::ABSTRACT) => 2516,
                _ => 2391,
            };
            out.push(Diagnostic {
                start: start_of(member),
                code,
            });
            self.note(start_of(member), end_of(i), code, Vec::new());
        };
        let of = |i: usize| {
            let member = &hir[members.at(i)];
            // `parseClassElement`: its own `declare` makes a method ambient. Not so a constructor.
            (
                member.kind == MemberKind::Method && member.flags.contains(Flags::AMBIENT),
                has_body(&hir[member.func]),
            )
        };
        // What is abstract or may be left out needs nothing to implement it.
        if let Some(last) = walk_declarations(group, of, &starts_at_previous_end, &mut report)
            && !has_body_node(&hir[hir[members.at(last)].func])
            && !hir[members.at(last)]
                .flags
                .intersects(Flags::ABSTRACT | Flags::OPTIONAL)
        {
            report(last);
        }
        let declarations: Vec<(FnId, u32, u32)> = group
            .iter()
            .map(|&i| {
                let member = &hir[members.at(i)];
                (member.func, start_of(member), end_of(i))
            })
            .collect();
        let duplicate = if hir[members.at(group[0])].kind == MemberKind::Constructor {
            2392
        } else {
            2393
        };
        self.check_overload_group(file, &declarations, duplicate, out);
    }
}
