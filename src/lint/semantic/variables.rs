//! What each scope declares: ESLint's `scope.variables`.
//!
//! The symbols and their declarations are the binder's. What is derived here is which scope of
//! [`ScopeTree`] each is declared in, and which symbols ESLint takes for one variable.

use super::ScopeKind;
use super::scopes::{self, Block, NONE, ScopeTree};
use crate::ast::File;
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{ClassOwner, Decl, Parent, PatParent, SymFlags, SymbolId};
use bun_sema::hir::{self, FnKind, NameKind, PatKind, StmtKind, VarKind};

/// ESLint's `variable.isValueVariable`.
pub(crate) const VALUE: u8 = 1 << 0;
/// ESLint's `variable.isTypeVariable`.
pub(crate) const TYPE: u8 = 1 << 1;

#[derive(Copy, Clone, Debug)]
pub(crate) struct Variable {
    /// What identifies it. The binder's symbol, or a number past those: see `Variables::of_symbol`.
    pub(crate) symbol: SymbolId,
    /// The binder's symbol. `NONE` for the implicit `arguments`.
    pub(crate) binder: SymbolId,
    /// The flags of the binder's symbol.
    pub(crate) binder_flags: SymFlags,
    pub(crate) name: Atom,
    pub(crate) scope: u32,
    /// Where the name of its first declaration is. 0 for the implicit `arguments`.
    pub(crate) first_pos: u32,
    /// Its first declaration.
    first: Decl,
    /// How many declarations it has. None: it is the implicit `arguments`.
    count: u32,
    /// If it has several, where they start in `Variables::declarations`.
    start: u32,
    pub(crate) flags: u8,
}

/// Where a variable can be referred to.
#[derive(Copy, Clone)]
pub(crate) struct Extent {
    /// From the scopes with these numbers.
    pub(crate) first_scope: u32,
    pub(crate) last_scope: u32,
    /// `ScopeData::body_start` of its scope.
    pub(crate) body_start: u32,
}

impl Extent {
    /// Whether what the binder resolves to the variable, from the scope `from` at `pos`, is what
    /// ESLint resolves to it: it is declared around the reference, and not in the body of a
    /// function whose parameters refer to it.
    #[inline]
    pub(crate) fn has(&self, from: u32, pos: u32) -> bool {
        self.first_scope <= from && from <= self.last_scope && pos >= self.body_start
    }
}

pub(crate) struct Variables {
    /// Sorted by scope, then by position, but for the `arguments` of a function, which is first.
    pub(crate) list: Vec<Variable>,
    /// For each of `list`.
    pub(crate) extents: Vec<Extent>,
    /// For each scope, where its variables start in `list`. One more than there are scopes.
    starts: Vec<u32>,
    /// For each `Variable::symbol`, the index in `list`. First the symbols of the binder, of which
    /// those that are one variable have the same index. Then the implicit `arguments`, one number
    /// for each function and one for the file. Then `further`.
    of_symbol: Vec<u32>,
    pub(crate) symbol_count: usize,
    /// The binder has one symbol for declarations that TypeScript merges across scopes: the type
    /// parameters of the declarations of an interface, what the bodies of a namespace export. ESLint
    /// has a variable in each scope. How many variables there are after the first of such a symbol.
    further: usize,
    names: NameTable,
    /// The indices in `list` name by name. Those of one name are sorted, and so by scope.
    by_name: Vec<u32>,
    /// The declarations of the variables that have several, in the order they are written.
    declarations: Vec<Decl>,
    /// The names that the binder may resolve to something else than ESLint. Sorted.
    pub(crate) hazards: Vec<Atom>,
}

struct Entry {
    scope: u32,
    name: Atom,
    pos: u32,
    symbol: SymbolId,
    binder_flags: SymFlags,
    decl: Decl,
    flags: u8,
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
            Some(&(PatParent::Prop(outer, _) | PatParent::Elem(outer, _))) if outer != pat => pat = outer,
            Some(&root) => return root,
            None => return PatParent::None,
        }
    }
}

/// Whether `d` is the `e` of `catch (e)`.
pub(crate) fn is_catch_parameter(file: &File, d: hir::VarDeclId) -> bool {
    let statement = file.bound.var_stmt.get(d.idx()).and_then(|it| file.hir.stmts.get(it.idx()));
    matches!(statement.map(|it| it.kind), Some(StmtKind::Try { .. }))
}

/// The name of a declaration that declares a variable, and where it is written.
pub(crate) fn name_of_declaration(file: &File, decl: Decl) -> Option<(Atom, u32)> {
    let hir = &file.hir;
    let (name, pos) = match decl {
        Decl::Var(p) | Decl::Require(p) | Decl::Param(p) => match hir.pats.get(p.idx())? {
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
        Decl::Interface(i) => hir.interfaces.get(i.idx()).map(|it| (it.name, it.name_pos))?,
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
        Decl::ImportDefault(i) => hir.imports.get(i.idx()).map(|it| (it.default, it.default_pos))?,
        Decl::ImportNamespace(i) => hir.imports.get(i.idx()).map(|it| (it.namespace, it.namespace_pos))?,
        Decl::ImportSpec(s) => hir.import_specs.get(s.idx()).map(|it| (it.local, it.pos))?,
        Decl::ImportEquals(i) => hir.import_equals.get(i.idx()).map(|it| (it.name, it.name_pos))?,
        _ => return None,
    };
    (name.is_some() && name != known::empty).then_some((name, pos))
}

/// Every declaration of a variable, and the position and the index of each, sorted.
#[inline(never)]
fn entries_in_order(file: &File) -> (Vec<Entry>, Vec<u64>) {
    let mut declared: Vec<(SymbolId, SymFlags, Decl)> = Vec::new();
    file.binding.declarations_in_scopes(&mut declared);
    let mut entries: Vec<Entry> = Vec::with_capacity(declared.len());
    // The position and the index of each entry.
    let mut in_order: Vec<u64> = Vec::with_capacity(declared.len());
    for &(symbol, binder_flags, decl) in &declared {
        if let Some((name, pos)) = name_of_declaration(file, decl)
            && !(file.has_synthetic_nodes() && file.is_in_jsdoc(pos))
        {
            in_order.push(u64::from(pos) << 32 | entries.len() as u64);
            entries.push(Entry {
                scope: NONE,
                name,
                pos,
                symbol,
                binder_flags,
                decl,
                flags: 0,
            });
        }
    }
    // The binder declares nearly in source order.
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
    hazards: &mut Vec<Atom>,
) -> Vec<u32> {
    let (hir, bound) = (&file.hir, &file.bound);
    let is_javascript = scopes::is_javascript_mode(file);
    let has_block_scopes = !is_javascript || file.language().ecma_version >= 2015;
    let mut entry_starts = vec![0u32; tree.scopes.len() + 1];
    let mut cursor = tree.cursor();
    for &key in in_order {
        let it = &mut entries[key as u32 as usize];
        let (here, name) = (cursor.seek(it.pos), it.name);
        (it.scope, it.flags) = match it.decl {
            Decl::Var(p) | Decl::Require(p) => {
                let PatParent::Var(d) = root_of_pattern(file, p) else {
                    continue;
                };
                let is_hoisted = hir.var_decls.get(d.idx()).is_some_and(|it| it.kind == VarKind::Var)
                    && !is_catch_parameter(file, d);
                let scope = match is_hoisted {
                    true => tree.scopes[here as usize].variable_scope,
                    false => here,
                };
                // The binder declares it in the function.
                if matches!(it.decl, Decl::Require(_)) && tree.scopes[scope as usize].variable_scope != scope {
                    hazards.push(name);
                }
                (scope, VALUE)
            }
            Decl::Param(p) => match root_of_pattern(file, p) {
                PatParent::Param(param) => {
                    let scope = bound.param_fn.get(param.idx()).and_then(|f| tree.of_fn.get(f.idx()));
                    (scope.copied().unwrap_or(NONE), VALUE)
                }
                // The binder does not visit the name of a `this` parameter.
                _ if name == known::this => (here, VALUE),
                _ => continue,
            },
            Decl::Fn(f) => {
                let is_in_block = || {
                    matches!(bound.fns.get(f.idx()).map(|it| it.owner), Some(bun_sema::bind::FnOwner::Stmt(s))
                        if matches!(bound.stmt_parent.get(s.idx()), Some(Parent::Stmt(_))))
                };
                if !has_block_scopes && is_in_block() {
                    hazards.push(name);
                }
                (here, VALUE)
            }
            Decl::Class(c) => match bound.class_owner.get(c.idx()) {
                Some(ClassOwner::Expr(_)) => (tree.of_class.get(c.idx()).copied().unwrap_or(NONE), VALUE | TYPE),
                _ => (here, VALUE | TYPE),
            },
            Decl::ImportDefault(_) | Decl::ImportNamespace(_) | Decl::ImportSpec(_) => (here, VALUE | TYPE),
            _ if is_javascript => continue,
            Decl::Interface(_) | Decl::Alias(_) => (here, TYPE),
            Decl::TypeParam(_) => (scope_of_type_parameter(file, tree, here, it.pos), TYPE),
            Decl::Module(_) => {
                // To the binder, a namespace without values is not a value.
                if !it.binder_flags.intersects(SymFlags::VALUE) {
                    hazards.push(name);
                }
                (here, VALUE | TYPE)
            }
            _ => (here, VALUE | TYPE),
        };
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
    /// The symbols of the binder that are part of a variable with another symbol, with its index.
    parts: Vec<(SymbolId, u32)>,
}

impl Made {
    /// Adds a declaration. All those of a scope are added in a row, in source order. `count`: 0 for
    /// the implicit `arguments`, which comes first.
    #[inline]
    fn declare(&mut self, it: &Entry, count: u32) {
        let at = self.names.place(it.name);
        let slot = &mut self.names.slots[at];
        // What the scope has declared under the name is the last variable of that name.
        if let Some(variable) = self.list.get_mut(slot.last as usize)
            && variable.scope == it.scope
        {
            if variable.count == 0 {
                // ESLint has the `arguments` of a function first, declared or not.
                (variable.symbol, variable.binder_flags, variable.flags) = (it.symbol, it.binder_flags, 0);
                (variable.first_pos, variable.first) = (it.pos, it.decl);
            }
            if it.symbol != variable.symbol {
                self.parts.push((it.symbol.max(variable.symbol), slot.last));
                if it.symbol < variable.symbol {
                    (variable.symbol, variable.binder_flags) = (it.symbol, it.binder_flags);
                }
            }
            if variable.count > 0 {
                // What is exported can be listed for both of its symbols.
                if variable.start == it.pos {
                    return;
                }
                self.later.push((slot.last, it.decl));
            }
            variable.count += 1;
            variable.flags |= it.flags;
            // Until all are added: where the last declaration is.
            variable.start = it.pos;
            return;
        }
        slot.name = it.name;
        slot.last = self.list.len() as u32;
        slot.count += 1;
        self.list.push(Variable {
            symbol: it.symbol,
            binder: SymbolId::NONE,
            binder_flags: it.binder_flags,
            name: it.name,
            scope: it.scope,
            first_pos: it.pos,
            first: it.decl,
            count,
            start: it.pos,
            flags: it.flags,
        });
    }
}

impl Variables {
    pub(crate) fn new<'a>(file: &'a File<'a>, tree: &ScopeTree) -> Variables {
        let hir = &file.hir;
        let symbol_count = file.binding.symbol_count();
        let mut hazards: Vec<Atom> = Vec::new();

        let (mut entries, in_order) = entries_in_order(file);
        let scope_count = tree.scopes.len();
        let mut entry_starts = assign_scopes(file, tree, &mut entries, &in_order, &mut hazards);

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
            parts: Vec::new(),
        };
        for (scope, data) in tree.scopes.iter().enumerate() {
            starts.push(made.list.len() as u32);
            // "NOTE Arrow functions never have an arguments objects."
            let arguments = match (data.kind, data.block) {
                (ScopeKind::Function, Block::File) => Some(symbol_count + hir.fns.len()),
                (ScopeKind::Function, Block::Fn(f)) => {
                    let has_its_own = hir.fns.get(f.idx()).is_some_and(|it| it.kind != FnKind::Arrow);
                    has_its_own.then_some(symbol_count + f.idx())
                }
                _ => None,
            };
            if let Some(symbol) = arguments {
                let implicit = Entry {
                    scope: scope as u32,
                    name: known::arguments,
                    pos: 0,
                    symbol: SymbolId(symbol as u32),
                    binder_flags: SymFlags::FUNCTION_SCOPED_VARIABLE,
                    decl: Decl::File,
                    flags: VALUE | TYPE,
                };
                made.declare(&implicit, 0);
            }
            for &i in &by_scope[entry_starts[scope] as usize..entry_starts[scope + 1] as usize] {
                made.declare(&entries[i as usize], 1);
            }
        }
        let Made {
            mut list,
            mut names,
            mut later,
            parts,
        } = made;
        starts.push(list.len() as u32);
        if scopes::has_top_level_function(file) {
            hazards.push(known::arguments);
        }

        // What identifies each, and the variables name by name.
        let first_further = symbol_count + hir.fns.len() + 1;
        let mut of_symbol = vec![NONE; first_further];
        let mut by_name = vec![0u32; list.len()];
        let mut filled = 0;
        for (index, variable) in list.iter_mut().enumerate() {
            if variable.count > 0 {
                variable.binder = variable.symbol;
            }
            match of_symbol.get_mut(variable.symbol.idx()) {
                Some(slot) if *slot == NONE => *slot = index as u32,
                _ => {
                    variable.symbol = SymbolId(of_symbol.len() as u32);
                    of_symbol.push(index as u32);
                }
            }
            let at = names.place(variable.name);
            let slot = &mut names.slots[at];
            if slot.start == NONE {
                (slot.start, slot.last) = (filled, 0);
                filled += slot.count;
            }
            by_name[(slot.start + slot.last) as usize] = index as u32;
            slot.last += 1;
        }
        for &(symbol, index) in &parts {
            if let Some(slot) = of_symbol.get_mut(symbol.idx())
                && *slot == NONE
            {
                *slot = index;
            }
        }
        let mut declarations: Vec<Decl> = Vec::new();
        later.sort_by_key(|it| it.0);
        for of_one in later.chunk_by(|a, b| a.0 == b.0) {
            let variable = &mut list[of_one[0].0 as usize];
            variable.start = declarations.len() as u32;
            declarations.push(variable.first);
            declarations.extend(of_one.iter().map(|it| it.1));
            // `Referencer.visitFunction` defines the parameters before the type parameters.
            if tree.scopes[variable.scope as usize].kind == ScopeKind::Function && variable.flags == VALUE | TYPE {
                declarations[variable.start as usize..].sort_by_key(|it| !matches!(it, Decl::Param(_)));
            }
        }

        let mut refused: Vec<Decl> = Vec::new();
        file.binding.refused_declarations(&mut refused);
        hazards.extend(refused.iter().filter_map(|&it| Some(name_of_declaration(file, it)?.0)));
        hazards.sort_unstable_by_key(|it| it.0);
        hazards.dedup();

        let extent = |it: &Variable| {
            let scope = &tree.scopes[it.scope as usize];
            Extent {
                first_scope: it.scope,
                // `WithScope#__close` leaves every reference to the scope around it.
                last_scope: if scope.kind == ScopeKind::With { 0 } else { scope.last },
                body_start: scope.body_start,
            }
        };
        Variables {
            extents: list.iter().map(extent).collect(),
            list,
            starts,
            further: of_symbol.len() - first_further,
            of_symbol,
            symbol_count,
            names,
            by_name,
            declarations,
            hazards,
        }
    }

    /// The index in `list` of the variable that `symbol` identifies.
    #[inline]
    pub(crate) fn of_symbol(&self, symbol: SymbolId) -> Option<u32> {
        self.of_symbol.get(symbol.idx()).copied().filter(|it| *it != NONE)
    }

    /// The same, or `NONE`.
    #[inline(always)]
    pub(crate) fn index_of_symbol(&self, symbol: SymbolId) -> u32 {
        self.of_symbol.get(symbol.idx()).copied().unwrap_or(NONE)
    }

    /// More than what identifies any variable.
    #[inline]
    pub(crate) fn key_limit(&self) -> usize {
        self.of_symbol.len()
    }

    /// The variable that the declaration of the binder's `symbol` whose name is at `pos` declares.
    pub(crate) fn of_declaration(&self, file: &File, symbol: SymbolId, pos: u32) -> Option<u32> {
        let first = self.of_symbol(symbol)?;
        if self.further == 0 {
            return Some(first);
        }
        let binder = self.list[first as usize].binder;
        let is_declared_by = |index: &u32| {
            let it = &self.list[*index as usize];
            let mut declarations = self.declarations_of(it).iter();
            it.binder == binder && declarations.any(|&decl| name_of_declaration(file, decl).is_some_and(|it| it.1 == pos))
        };
        let mut named = self.named(self.list[first as usize].name).iter().copied();
        Some(named.find(is_declared_by).unwrap_or(first))
    }

    #[inline]
    pub(crate) fn range_of_scope(&self, scope: u32) -> std::ops::Range<usize> {
        match (self.starts.get(scope as usize), self.starts.get(scope as usize + 1)) {
            (Some(&start), Some(&end)) => start as usize..end as usize,
            _ => 0..0,
        }
    }

    #[inline]
    pub(crate) fn declarations_of<'t>(&'t self, variable: &'t Variable) -> &'t [Decl] {
        match variable.count {
            0 => &[],
            1 => std::slice::from_ref(&variable.first),
            count => self.declarations.get(variable.start as usize..(variable.start + count) as usize).unwrap_or_default(),
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
            true => self.by_name.get(slot.start as usize..(slot.start + slot.count) as usize).unwrap_or_default(),
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
    pub(crate) fn resolve(&self, tree: &ScopeTree, from: u32, name: Atom, pos: u32, wants: u8) -> Option<u32> {
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
    if !file.text().get(..before).is_some_and(|it| it.ends_with(b"infer")) {
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
