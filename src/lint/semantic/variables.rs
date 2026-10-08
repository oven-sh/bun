//! What each scope declares: ESLint's `scope.variables`.
//!
//! The declarations are read off the lists of the HIR. What is derived here is which scope of
//! [`ScopeTree`] each is in, and which of them declare one variable.

use super::scopes::{self, Block, NONE, ScopeTree};
use super::{DeclarationKind, ScopeKind};
use crate::ast::File;
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{ClassOwner, Decl, FnOwner, Parent, PatParent};
use bun_sema::hir::{self, FnKind, NameKind, PatKind, StmtKind, VarKind};

/// ESLint's `variable.isValueVariable`.
pub(crate) const VALUE: u8 = 1 << 0;
/// ESLint's `variable.isTypeVariable`.
pub(crate) const TYPE: u8 = 1 << 1;

#[derive(Copy, Clone, Debug)]
pub(crate) struct Variable {
    pub(crate) name: Atom,
    /// The index of the name in `NameTable::slots`.
    pub(crate) slot: u32,
    pub(crate) scope: u32,
    /// `ScopeData::body_start` of its scope.
    pub(crate) body_start: u32,
    /// Where the name of its first declaration is. 0 for the implicit `arguments`.
    pub(crate) first_pos: u32,
    /// Its first declaration.
    first: Decl,
    /// How many declarations it has. None: it is the implicit `arguments`.
    pub(crate) count: u32,
    /// If it has several, where they start in `Variables::declarations`.
    start: u32,
    pub(crate) flags: u8,
    /// A bit for each `DeclarationKind` that one of its declarations has.
    pub(crate) kinds: u16,
}

pub(crate) struct Variables {
    /// Sorted by scope, then by position, but for the `arguments` of a function, which is first.
    pub(crate) list: Vec<Variable>,
    /// For each scope, where its variables start in `list`. One more than there are scopes.
    starts: Vec<u32>,
    /// Where the name of each declaration is, and the index in `list` of what it declares. Sorted.
    declared_at: Vec<(u32, u32)>,
    /// For each pattern that is a name, the index in `list` of what it declares.
    of_pat: Vec<u32>,
    names: NameTable,
    /// The indices in `list` name by name. Those of one name are sorted, and so by scope.
    by_name: Vec<u32>,
    /// The declarations of the variables that have several, in the order they are written.
    declarations: Vec<Decl>,
}

struct Entry {
    scope: u32,
    name: Atom,
    pos: u32,
    decl: Decl,
    flags: u8,
    kinds: u16,
}

/// The bit of `Variable::kinds` for a declaration. `is_catch_parameter`: of a `Decl::Var`.
pub(crate) fn kind_bit(decl: Decl, is_catch_parameter: bool) -> u16 {
    let kind = match decl {
        Decl::Var(_) if is_catch_parameter => DeclarationKind::CatchClause,
        Decl::Var(_) => DeclarationKind::Variable,
        Decl::Param(_) => DeclarationKind::Parameter,
        Decl::Fn(_) => DeclarationKind::FunctionName,
        Decl::Class(_) => DeclarationKind::ClassName,
        Decl::Interface(_) | Decl::Alias(_) | Decl::TypeParam(_) => DeclarationKind::Type,
        Decl::Enum(_) => DeclarationKind::TsEnumName,
        Decl::EnumMember(_) => DeclarationKind::TsEnumMember,
        Decl::Module(_) => DeclarationKind::TsModuleName,
        Decl::ImportDefault(_)
        | Decl::ImportNamespace(_)
        | Decl::ImportSpec(_)
        | Decl::ImportEquals(_) => DeclarationKind::ImportBinding,
        _ => return 0,
    };
    1 << kind as u16
}

#[derive(Copy, Clone)]
struct NameSlot {
    /// `NONE`: the slot is free.
    name: Atom,
    /// While the variables are made: the last one of that name. Then: how many of them are in
    /// `by_name` so far.
    last: u32,
    /// How many variables have the name.
    count: u32,
    /// Where they start in `by_name`.
    start: u32,
}

/// The names of the variables of a file: a hash table with open addressing, at most half full.
struct NameTable {
    /// A power of two of them.
    slots: Vec<NameSlot>,
}

impl NameTable {
    fn with_room_for(names: usize) -> NameTable {
        let free = NameSlot {
            name: Atom::NONE,
            last: NONE,
            count: 0,
            start: NONE,
        };
        NameTable {
            slots: vec![free; (names * 2 + 2).next_power_of_two()],
        }
    }

    /// The index of the slot of `name`, or of the free slot where it belongs.
    #[inline]
    fn place(&self, name: Atom) -> usize {
        let mask = self.slots.len() - 1;
        // Atoms are numbered sequentially: Fibonacci hashing spreads them.
        let mut at = (u64::from(name.0).wrapping_mul(0x9E37_79B9_7F4A_7C15) >> 32) as usize & mask;
        while self.slots[at].name != name && self.slots[at].name.is_some() {
            at = (at + 1) & mask;
        }
        at
    }
}

/// The declaration or the parameter that the pattern `pat` is part of.
pub(crate) fn root_of_pattern(file: &File, mut pat: hir::PatId) -> PatParent {
    loop {
        match file.bound.pat_parent.get(pat.idx()) {
            Some(&(PatParent::Prop(outer, _) | PatParent::Elem(outer, _))) if outer != pat => {
                pat = outer
            }
            Some(&root) => return root,
            None => return PatParent::None,
        }
    }
}

/// Whether `d` is the `e` of `catch (e)`.
pub(crate) fn is_catch_parameter(file: &File, d: hir::VarDeclId) -> bool {
    let statement = file
        .bound
        .var_stmt
        .get(d.idx())
        .and_then(|it| file.hir.stmts.get(it.idx()));
    matches!(statement.map(|it| it.kind), Some(StmtKind::Try { .. }))
}

/// The name of a declaration that declares a variable, and where it is written.
pub(crate) fn name_of_declaration(file: &File, decl: Decl) -> Option<(Atom, u32)> {
    let hir = &file.hir;
    let (name, pos) = match decl {
        Decl::Var(p) | Decl::Param(p) => match hir.pats.get(p.idx())? {
            hir::Pat {
                kind: PatKind::Ident(name),
                pos,
                ..
            } => (*name, *pos),
            _ => return None,
        },
        Decl::Fn(f) => {
            let f = hir.fns.get(f.idx())?;
            match f.kind {
                FnKind::Decl | FnKind::Expr => (f.name, f.name_pos),
                _ => return None,
            }
        }
        Decl::Class(c) => hir.classes.get(c.idx()).map(|it| (it.name, it.name_pos))?,
        Decl::Interface(i) => hir
            .interfaces
            .get(i.idx())
            .map(|it| (it.name, it.name_pos))?,
        Decl::Alias(a) => hir.aliases.get(a.idx()).map(|it| (it.name, it.name_pos))?,
        Decl::Enum(e) => hir.enums.get(e.idx()).map(|it| (it.name, it.name_pos))?,
        Decl::EnumMember(m) => {
            let m = hir.enum_members.get(m.idx())?;
            match m.name_kind {
                NameKind::StringLiteral if m.name.is_some() => return Some((m.name, m.pos)),
                NameKind::Identifier => (m.name, m.pos),
                _ => return None,
            }
        }
        Decl::Module(m) => {
            let m = hir.modules.get(m.idx())?;
            match m.name {
                // `namespace A.B { }` declares nothing that a name can refer to.
                hir::ModuleName::Ident(name)
                    if !scopes::is_after_dot(file, m) && scopes::after_dot(file, m).is_none() =>
                {
                    (name, m.name_pos)
                }
                _ => return None,
            }
        }
        Decl::TypeParam(p) => hir.type_params.get(p.idx()).map(|it| (it.name, it.pos))?,
        Decl::ImportDefault(i) => hir
            .imports
            .get(i.idx())
            .map(|it| (it.default, it.default_pos))?,
        Decl::ImportNamespace(i) => hir
            .imports
            .get(i.idx())
            .map(|it| (it.namespace, it.namespace_pos))?,
        Decl::ImportSpec(s) => hir.import_specs.get(s.idx()).map(|it| (it.local, it.pos))?,
        Decl::ImportEquals(i) => hir
            .import_equals
            .get(i.idx())
            .map(|it| (it.name, it.name_pos))?,
        _ => return None,
    };
    (name.is_some() && name != known::empty).then_some((name, pos))
}

/// Every declaration of a variable, and the position and the index of each, sorted.
#[inline(never)]
fn entries_in_order(file: &File) -> (Vec<Entry>, Vec<u64>) {
    let (hir, bound) = (&file.hir, &file.bound);
    let room = hir.pats.len()
        + hir.fns.len() / 4
        + hir.type_params.len()
        + hir.import_specs.len()
        + hir.classes.len();
    let mut entries: Vec<Entry> = Vec::with_capacity(room);
    // The position and the index of each entry.
    let mut in_order: Vec<u64> = Vec::with_capacity(room);
    let mut add = |decl: Decl| {
        if let Some((name, pos)) = name_of_declaration(file, decl)
            && !(file.has_synthetic_nodes() && file.is_in_jsdoc(pos))
        {
            in_order.push(u64::from(pos) << 32 | entries.len() as u64);
            entries.push(Entry {
                scope: NONE,
                name,
                pos,
                decl,
                flags: 0,
                kinds: 0,
            });
        }
    };
    // What the parser has left behind where it backtracked is part of nothing.
    let is_in_tree =
        |s: hir::StmtId| !matches!(bound.stmt_parent.get(s.idx()), None | Some(Parent::None));
    for (i, pat) in hir.pats.iter().enumerate() {
        let PatKind::Ident(name) = pat.kind else {
            continue;
        };
        let id = hir::PatId(i as u32);
        match root_of_pattern(file, id) {
            PatParent::Var(_) => add(Decl::Var(id)),
            PatParent::Param(_) => add(Decl::Param(id)),
            // The name of a `this` parameter is part of nothing.
            PatParent::None if name == known::this => add(Decl::Param(id)),
            _ => {}
        }
    }
    for (i, func) in hir.fns.iter().enumerate() {
        if matches!(func.kind, FnKind::Decl | FnKind::Expr)
            && func.name.is_some()
            && bound.fns.get(i).is_some_and(|it| it.owner != FnOwner::None)
        {
            add(Decl::Fn(hir::FnId(i as u32)));
        }
    }
    for (i, class) in hir.classes.iter().enumerate() {
        if class.name.is_some() && bound.class_scope.get(i).is_some_and(|it| it.is_some()) {
            add(Decl::Class(hir::ClassId(i as u32)));
        }
    }
    for (i, import) in hir.imports.iter().enumerate() {
        if is_in_tree(import.stmt) {
            add(Decl::ImportDefault(hir::ImportId(i as u32)));
            add(Decl::ImportNamespace(hir::ImportId(i as u32)));
            import
                .named
                .iter()
                .for_each(|spec| add(Decl::ImportSpec(spec)));
        }
    }
    if !scopes::is_javascript_mode(file) {
        for (i, _) in hir.type_params.iter().enumerate() {
            if bound.type_param_scope.get(i).is_some_and(|it| it.is_some()) {
                add(Decl::TypeParam(hir::TypeParamId(i as u32)));
            }
        }
        for (i, it) in hir.interfaces.iter().enumerate() {
            if is_in_tree(it.stmt) {
                add(Decl::Interface(hir::InterfaceId(i as u32)));
            }
        }
        for (i, it) in hir.aliases.iter().enumerate() {
            if is_in_tree(it.stmt) {
                add(Decl::Alias(hir::AliasId(i as u32)));
            }
        }
        for (i, it) in hir.enums.iter().enumerate() {
            if is_in_tree(it.stmt) {
                add(Decl::Enum(hir::EnumId(i as u32)));
                it.members
                    .iter()
                    .for_each(|member| add(Decl::EnumMember(member)));
            }
        }
        for (i, it) in hir.modules.iter().enumerate() {
            if is_in_tree(it.stmt) {
                add(Decl::Module(hir::ModuleId(i as u32)));
            }
        }
        for (i, it) in hir.import_equals.iter().enumerate() {
            if is_in_tree(it.stmt) {
                add(Decl::ImportEquals(hir::ImportEqualsId(i as u32)));
            }
        }
    }
    // Each list is nearly in source order.
    in_order.sort();
    (entries, in_order)
}

/// Finds the scope that each is declared in, from the scope that its name is written in. Those
/// that declare no variable are left without. Returns how many are declared in each scope, at the
/// index after that of the scope.
#[inline(never)]
fn assign_scopes(
    file: &File,
    tree: &ScopeTree,
    entries: &mut [Entry],
    in_order: &[u64],
) -> Vec<u32> {
    let (hir, bound) = (&file.hir, &file.bound);
    let mut entry_starts = vec![0u32; tree.scopes.len() + 1];
    let mut cursor = tree.cursor();
    for &key in in_order {
        let it = &mut entries[key as u32 as usize];
        let (here, name) = (cursor.seek(it.pos), it.name);
        let mut is_catch = false;
        (it.scope, it.flags) = match it.decl {
            Decl::Var(p) => {
                let PatParent::Var(d) = root_of_pattern(file, p) else {
                    continue;
                };
                is_catch = is_catch_parameter(file, d);
                let is_hoisted = hir
                    .var_decls
                    .get(d.idx())
                    .is_some_and(|it| it.kind == VarKind::Var)
                    && !is_catch;
                let scope = match is_hoisted {
                    true => tree.scopes[here as usize].variable_scope,
                    false => here,
                };
                (scope, VALUE)
            }
            Decl::Param(p) => match root_of_pattern(file, p) {
                PatParent::Param(param) => {
                    let scope = bound
                        .param_fn
                        .get(param.idx())
                        .and_then(|f| tree.of_fn.get(f.idx()));
                    (scope.copied().unwrap_or(NONE), VALUE)
                }
                _ if name == known::this => (here, VALUE),
                _ => continue,
            },
            Decl::Fn(_) => (here, VALUE),
            Decl::Class(c) => match bound.class_owner.get(c.idx()) {
                Some(ClassOwner::Expr(_)) => (
                    tree.of_class.get(c.idx()).copied().unwrap_or(NONE),
                    VALUE | TYPE,
                ),
                _ => (here, VALUE | TYPE),
            },
            Decl::Interface(_) | Decl::Alias(_) => (here, TYPE),
            Decl::TypeParam(_) => (scope_of_type_parameter(file, tree, here, it.pos), TYPE),
            _ => (here, VALUE | TYPE),
        };
        it.kinds = kind_bit(it.decl, is_catch);
        if let Some(count) = entry_starts.get_mut(it.scope as usize + 1) {
            *count += 1;
        }
    }
    entry_starts
}

/// The variables while they are made.
struct Made {
    list: Vec<Variable>,
    names: NameTable,
    /// The declarations after the first of a variable, with its index.
    later: Vec<(u32, Decl)>,
}

impl Made {
    /// Adds a declaration, and returns the index of what it declares. All those of a scope are added in
    /// a row, in source order. `count`: 0 for the implicit `arguments`, which comes first.
    #[inline]
    fn declare(&mut self, it: &Entry, count: u32, body_start: u32) -> u32 {
        let at = self.names.place(it.name);
        let slot = &mut self.names.slots[at];
        // What the scope has declared under the name is the last variable of that name.
        if let Some(variable) = self.list.get_mut(slot.last as usize)
            && variable.scope == it.scope
        {
            match variable.count {
                // ESLint has the `arguments` of a function first, declared or not.
                0 => (variable.flags, variable.first_pos, variable.first) = (0, it.pos, it.decl),
                _ => self.later.push((slot.last, it.decl)),
            }
            variable.count += 1;
            variable.flags |= it.flags;
            variable.kinds |= it.kinds;
            return slot.last;
        }
        slot.name = it.name;
        slot.last = self.list.len() as u32;
        slot.count += 1;
        self.list.push(Variable {
            name: it.name,
            slot: at as u32,
            scope: it.scope,
            body_start,
            first_pos: it.pos,
            first: it.decl,
            count,
            start: 0,
            flags: it.flags,
            kinds: it.kinds,
        });
        slot.last
    }
}

impl Variables {
    pub(crate) fn new<'a>(file: &'a File<'a>, tree: &ScopeTree) -> Variables {
        let hir = &file.hir;
        let (mut entries, in_order) = entries_in_order(file);
        let scope_count = tree.scopes.len();
        let mut entry_starts = assign_scopes(file, tree, &mut entries, &in_order);

        // The entries scope by scope, and in each in source order, as indices.
        for i in 0..scope_count {
            entry_starts[i + 1] += entry_starts[i];
        }
        let mut next = entry_starts.clone();
        let mut by_scope = vec![0u32; entry_starts[scope_count] as usize];
        for &key in &in_order {
            if let Some(slot) = next.get_mut(entries[key as u32 as usize].scope as usize) {
                by_scope[*slot as usize] = key as u32;
                *slot += 1;
            }
        }

        let mut starts: Vec<u32> = Vec::with_capacity(scope_count + 1);
        let mut made = Made {
            list: Vec::with_capacity(by_scope.len() + hir.fns.len()),
            names: NameTable::with_room_for(by_scope.len() + 1),
            later: Vec::new(),
        };
        for (scope, data) in tree.scopes.iter().enumerate() {
            starts.push(made.list.len() as u32);
            // "NOTE Arrow functions never have an arguments objects."
            let has_arguments = match (data.kind, data.block) {
                (ScopeKind::Function, Block::File) => true,
                (ScopeKind::Function, Block::Fn(f)) => hir
                    .fns
                    .get(f.idx())
                    .is_some_and(|it| it.kind != FnKind::Arrow),
                _ => false,
            };
            if has_arguments {
                let implicit = Entry {
                    scope: scope as u32,
                    name: known::arguments,
                    pos: 0,
                    decl: Decl::File,
                    flags: VALUE | TYPE,
                    kinds: 0,
                };
                made.declare(&implicit, 0, data.body_start);
            }
            for &i in &by_scope[entry_starts[scope] as usize..entry_starts[scope + 1] as usize] {
                // From here on: what it declares.
                entries[i as usize].scope = made.declare(&entries[i as usize], 1, data.body_start);
            }
        }
        let Made {
            mut list,
            mut names,
            mut later,
        } = made;
        starts.push(list.len() as u32);
        let declared = in_order
            .iter()
            .map(|&key| &entries[key as u32 as usize])
            .filter(|it| it.scope != NONE);
        let mut of_pat = vec![NONE; hir.pats.len()];
        let note = |it: &Entry| {
            if let Decl::Var(pat) | Decl::Param(pat) = it.decl
                && let Some(slot) = of_pat.get_mut(pat.idx())
            {
                *slot = it.scope;
            }
            (it.pos, it.scope)
        };
        let declared_at = declared.map(note).collect();

        // The variables name by name.
        let mut by_name = vec![0u32; list.len()];
        let mut filled = 0;
        for (index, variable) in list.iter().enumerate() {
            let slot = &mut names.slots[variable.slot as usize];
            if slot.start == NONE {
                (slot.start, slot.last) = (filled, 0);
                filled += slot.count;
            }
            by_name[(slot.start + slot.last) as usize] = index as u32;
            slot.last += 1;
        }
        let mut declarations: Vec<Decl> = Vec::new();
        later.sort_by_key(|it| it.0);
        for of_one in later.chunk_by(|a, b| a.0 == b.0) {
            let variable = &mut list[of_one[0].0 as usize];
            variable.start = declarations.len() as u32;
            declarations.push(variable.first);
            declarations.extend(of_one.iter().map(|it| it.1));
            // `Referencer.visitFunction` defines the parameters before the type parameters.
            if tree.scopes[variable.scope as usize].kind == ScopeKind::Function
                && variable.flags == VALUE | TYPE
            {
                declarations[variable.start as usize..]
                    .sort_by_key(|it| !matches!(it, Decl::Param(_)));
            }
        }
        Variables {
            list,
            starts,
            declared_at,
            of_pat,
            names,
            by_name,
            declarations,
        }
    }

    /// The index in `list` of what the declaration whose name is at `pos` declares.
    pub(crate) fn declared_at(&self, pos: u32) -> Option<u32> {
        let found = self
            .declared_at
            .get(self.declared_at.partition_point(|it| it.0 < pos))?;
        (found.0 == pos).then_some(found.1)
    }

    /// The index in `list` of what the name `pat` declares.
    #[inline]
    pub(crate) fn of_pat(&self, pat: hir::PatId) -> Option<u32> {
        self.of_pat.get(pat.idx()).copied().filter(|it| *it != NONE)
    }

    /// How many slots `slot_of` tells apart.
    #[inline]
    pub(crate) fn slot_count(&self) -> usize {
        self.names.slots.len()
    }

    /// `Variable::slot` of the variables named `name`. If there are none it is that of no variable.
    #[inline]
    pub(crate) fn slot_of(&self, name: Atom) -> usize {
        self.names.place(name)
    }

    #[inline]
    pub(crate) fn range_of_scope(&self, scope: u32) -> std::ops::Range<usize> {
        match (
            self.starts.get(scope as usize),
            self.starts.get(scope as usize + 1),
        ) {
            (Some(&start), Some(&end)) => start as usize..end as usize,
            _ => 0..0,
        }
    }

    #[inline]
    pub(crate) fn declarations_of<'t>(&'t self, variable: &'t Variable) -> &'t [Decl] {
        match variable.count {
            0 => &[],
            1 => std::slice::from_ref(&variable.first),
            count => self
                .declarations
                .get(variable.start as usize..(variable.start + count) as usize)
                .unwrap_or_default(),
        }
    }

    #[inline]
    pub(crate) fn is_implicit(variable: &Variable) -> bool {
        variable.count == 0
    }

    /// The variables named `name`, by scope.
    #[inline]
    fn named(&self, name: Atom) -> &[u32] {
        let slot = &self.names.slots[self.names.place(name)];
        match slot.name.is_some() {
            true => self
                .by_name
                .get(slot.start as usize..(slot.start + slot.count) as usize)
                .unwrap_or_default(),
            false => &[],
        }
    }

    /// ESLint's `scope.set.get(name)`.
    pub(crate) fn get(&self, scope: u32, name: Atom) -> Option<u32> {
        let range = self.range_of_scope(scope);
        let named = self.named(name);
        let found = *named.get(named.partition_point(|&it| (it as usize) < range.start))?;
        range.contains(&(found as usize)).then_some(found)
    }

    /// What a reference to `name` that is written at `pos`, in the scope `from`, resolves to:
    /// ESLint's `Scope#__resolve`, scope by scope. `wants`: `VALUE`, `TYPE` or both.
    pub(crate) fn resolve(
        &self,
        tree: &ScopeTree,
        from: u32,
        name: Atom,
        pos: u32,
        wants: u8,
    ) -> Option<u32> {
        let named = self.named(name);
        if named.is_empty() {
            return None;
        }
        let is_valid = |index: u32| {
            let it = &self.list[index as usize];
            // ESLint's `FunctionScope#isValidResolution`: "References in default parameters isn't
            // resolved to variables which are in their function body."
            let scope = &tree.scopes[it.scope as usize];
            let body_start = scope.body_start;
            (it.flags & wants != 0)
                && !(pos < body_start && (it.first_pos >= body_start || Self::is_implicit(it)))
                && scope.kind != ScopeKind::With
        };
        // The innermost scope has the highest number.
        let end = self.range_of_scope(from).end;
        let before = named.partition_point(|&it| (it as usize) < end);
        const SCANNED: usize = 8;
        for &index in named[..before].iter().rev().take(SCANNED) {
            if tree.contains(self.list[index as usize].scope, from) && is_valid(index) {
                return Some(index);
            }
        }
        if before <= SCANNED {
            return None;
        }
        let mut scope = from;
        while let Some(data) = tree.scopes.get(scope as usize) {
            if let Some(index) = self.get(scope, name)
                && is_valid(index)
            {
                return Some(index);
            }
            scope = data.parent;
        }
        None
    }
}

/// The scope that the type parameter at `pos`, in the scope `here`, is declared in.
fn scope_of_type_parameter(file: &File, tree: &ScopeTree, here: u32, pos: u32) -> u32 {
    let is_nested = |scope: u32| {
        matches!(
            tree.scopes.get(scope as usize).map(|it| it.kind),
            Some(ScopeKind::FunctionType | ScopeKind::MappedType)
        )
    };
    if !is_nested(here) {
        return here;
    }
    let before = crate::tokens::skip_trivia_back(file.text(), pos) as usize;
    if !file
        .text()
        .get(..before)
        .is_some_and(|it| it.ends_with(b"infer"))
    {
        return here;
    }
    // `TypeVisitor.TSInferType`: "In cases where there is a sub-type scope created within a
    // conditional type, then the generic should be defined in the conditional type's scope".
    let mut scope = tree.scopes[here as usize].parent;
    while is_nested(scope) {
        scope = tree.scopes[scope as usize].parent;
    }
    match tree.scopes.get(scope as usize).map(|it| it.kind) {
        Some(ScopeKind::ConditionalType) => scope,
        _ => here,
    }
}
