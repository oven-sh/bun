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
    pub(crate) name: Atom,
    pub(crate) scope: u32,
    /// Where the name of its first declaration is. 0 for the implicit `arguments`.
    pub(crate) first_pos: u32,
    /// Its range of `Variables::declarations`.
    declarations: (u32, u32),
    pub(crate) flags: u8,
}

pub(crate) struct Variables {
    /// Sorted by scope, then by position.
    pub(crate) list: Vec<Variable>,
    /// For each scope, where its variables start in `list`. One more than there are scopes.
    starts: Vec<u32>,
    /// For each symbol of the binder, its index in `list`. Symbols that are one variable have the
    /// same.
    of_symbol: Vec<u32>,
    /// The binder has one symbol for declarations that TypeScript merges across scopes: the type
    /// parameters of the declarations of an interface, what the bodies of a namespace export. ESLint
    /// has a variable in each scope. The variables after the first of such a symbol, as indices
    /// into `list`.
    further: Vec<u32>,
    function_count: usize,
    /// The name and the index in `list` of each variable, sorted. So those of one name are sorted
    /// by scope.
    by_name: Vec<(u32, u32)>,
    /// A Bloom filter with one hash function over the names in `by_name`: most names that are
    /// looked up are globals. Its length is a power of two.
    names: Vec<u64>,
    /// In the order they are written, variable by variable.
    declarations: Vec<Decl>,
    /// The names that the binder may resolve to something else than ESLint. Sorted.
    pub(crate) hazards: Vec<Atom>,
}

struct Entry {
    scope: u32,
    name: Atom,
    pos: u32,
    symbol: SymbolId,
    decl: Decl,
    flags: u8,
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

impl Variables {
    pub(crate) fn new<'a>(file: &'a File<'a>, tree: &ScopeTree) -> Variables {
        let (hir, bound) = (&file.hir, &file.bound);
        let is_javascript = scopes::is_javascript_mode(file);
        let has_block_scopes = !is_javascript || file.language().ecma_version >= 2015;
        let symbol_count = file.binding.symbol_count();
        let mut hazards: Vec<Atom> = Vec::new();

        let mut declared: Vec<(SymbolId, Decl)> = Vec::new();
        file.binding.declarations_in_scopes(&mut declared);
        let mut entries: Vec<Entry> = Vec::with_capacity(declared.len());
        for &(symbol, decl) in &declared {
            if let Some((name, pos)) = name_of_declaration(file, decl)
                && !(file.has_synthetic_nodes() && file.is_in_jsdoc(pos))
            {
                entries.push(Entry {
                    scope: NONE,
                    name,
                    pos,
                    symbol,
                    decl,
                    flags: 0,
                });
            }
        }
        // The scope that each name is written in. The binder declares nearly in source order.
        let mut in_order: Vec<u64> =
            (entries.iter().enumerate()).map(|(i, it)| u64::from(it.pos) << 32 | i as u64).collect();
        in_order.sort_unstable();
        let mut cursor = tree.cursor();
        for key in in_order {
            entries[key as u32 as usize].scope = cursor.seek((key >> 32) as u32).from;
        }
        // The scope that each is declared in.
        entries.retain_mut(|it| {
            let (here, name) = (it.scope, it.name);
            (it.scope, it.flags) = match it.decl {
                Decl::Var(p) | Decl::Require(p) => {
                    let PatParent::Var(d) = root_of_pattern(file, p) else {
                        return false;
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
                    _ => return false,
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
                _ if is_javascript => return false,
                Decl::Interface(_) | Decl::Alias(_) => (here, TYPE),
                Decl::TypeParam(_) => (scope_of_type_parameter(file, tree, here, it.pos), TYPE),
                Decl::Module(_) => {
                    // To the binder, a namespace without values is not a value.
                    if !file.binding.symbol(it.symbol).is_some_and(|it| it.flags.intersects(SymFlags::VALUE)) {
                        hazards.push(name);
                    }
                    (here, VALUE | TYPE)
                }
                _ => (here, VALUE | TYPE),
            };
            it.scope != NONE
        });

        // The entries scope by scope, as indices.
        let scope_count = tree.scopes.len();
        let mut entry_starts = vec![0u32; scope_count + 1];
        for it in &entries {
            entry_starts[it.scope as usize + 1] += 1;
        }
        for i in 0..scope_count {
            entry_starts[i + 1] += entry_starts[i];
        }
        let mut next = entry_starts.clone();
        let mut by_scope = vec![0u32; entries.len()];
        for (i, it) in entries.iter().enumerate() {
            let slot = &mut next[it.scope as usize];
            by_scope[*slot as usize] = i as u32;
            *slot += 1;
        }

        let mut list: Vec<Variable> = Vec::with_capacity(entries.len() + hir.fns.len());
        let mut starts: Vec<u32> = Vec::with_capacity(scope_count + 1);
        let mut of_symbol = vec![NONE; symbol_count];
        let mut declarations: Vec<Decl> = Vec::with_capacity(entries.len());
        let mut further: Vec<u32> = Vec::new();
        let first_further = symbol_count + hir.fns.len() + 1;
        // The position of the first declaration of each name in the scope, and its range of `here`.
        let mut groups: Vec<(u32, u32, u32)> = Vec::new();
        for (scope, data) in tree.scopes.iter().enumerate() {
            starts.push(list.len() as u32);
            let here = &mut by_scope[entry_starts[scope] as usize..entry_starts[scope + 1] as usize];
            let entry = |i: u32| &entries[i as usize];
            // "NOTE Arrow functions never have an arguments objects."
            let arguments = match (data.kind, data.block) {
                (ScopeKind::Function, Block::File) => Some(symbol_count + hir.fns.len()),
                (ScopeKind::Function, Block::Fn(f)) => {
                    let has_its_own = hir.fns.get(f.idx()).is_some_and(|it| it.kind != FnKind::Arrow);
                    has_its_own.then_some(symbol_count + f.idx())
                }
                _ => None,
            };
            if let Some(symbol) = arguments
                && !here.iter().any(|&i| entry(i).name == known::arguments)
            {
                list.push(Variable {
                    symbol: SymbolId(symbol as u32),
                    binder: SymbolId::NONE,
                    name: known::arguments,
                    scope: scope as u32,
                    first_pos: 0,
                    declarations: (0, 0),
                    flags: VALUE | TYPE,
                });
            }
            if here.len() > 1 {
                here.sort_unstable_by_key(|&i| (entry(i).name.0, entry(i).pos, entry(i).symbol.0));
            }
            groups.clear();
            let mut at = 0;
            while let Some(&first) = here.get(at) {
                let len = here[at..].iter().take_while(|&&i| entry(i).name == entry(first).name).count();
                groups.push((entry(first).pos, at as u32, len as u32));
                at += len;
            }
            if groups.len() > 1 {
                groups.sort_unstable();
            }
            for &(first_pos, at, len) in &groups {
                let group = &here[at as usize..(at + len) as usize];
                let index = list.len() as u32;
                let binder = group.iter().map(|&i| entry(i).symbol).min().unwrap_or(SymbolId::NONE);
                let (start, mut flags) = (declarations.len(), 0);
                for &i in group {
                    // What is exported is listed for both of its symbols.
                    if declarations.get(start..).is_none_or(|them| them.last() != Some(&entry(i).decl)) {
                        declarations.push(entry(i).decl);
                    }
                    flags |= entry(i).flags;
                }
                let mut symbol = binder;
                if of_symbol.get(binder.idx()).is_some_and(|it| *it != NONE) {
                    symbol = SymbolId((first_further + further.len()) as u32);
                    further.push(index);
                }
                for &i in group {
                    if let Some(slot) = of_symbol.get_mut(entry(i).symbol.idx())
                        && *slot == NONE
                    {
                        *slot = index;
                    }
                }
                list.push(Variable {
                    symbol,
                    binder,
                    name: entry(group[0]).name,
                    scope: scope as u32,
                    first_pos,
                    declarations: (start as u32, (declarations.len() - start) as u32),
                    flags,
                });
            }
        }
        starts.push(list.len() as u32);
        if scopes::has_top_level_function(file) {
            hazards.push(known::arguments);
        }
        let mut by_name: Vec<(u32, u32)> = (list.iter().enumerate()).map(|(i, it)| (it.name.0, i as u32)).collect();
        by_name.sort_unstable();
        let mut names = vec![0u64; (list.len() / 8 + 1).next_power_of_two()];
        for it in &list {
            let (word, bit) = place_in_filter(names.len(), it.name);
            names[word] |= bit;
        }

        let mut refused: Vec<Decl> = Vec::new();
        file.binding.refused_declarations(&mut refused);
        hazards.extend(refused.iter().filter_map(|&it| Some(name_of_declaration(file, it)?.0)));
        hazards.sort_unstable_by_key(|it| it.0);
        hazards.dedup();

        Variables {
            list,
            starts,
            of_symbol,
            further,
            function_count: hir.fns.len(),
            by_name,
            names,
            declarations,
            hazards,
        }
    }

    /// The index in `list` of the variable that `symbol` identifies. After the symbols of the
    /// binder come the implicit `arguments`, one number for each function and one for the file,
    /// and then `further`.
    pub(crate) fn of_symbol(&self, tree: &ScopeTree, symbol: SymbolId) -> Option<u32> {
        if let Some(&index) = self.of_symbol.get(symbol.idx()) {
            return (index != NONE).then_some(index);
        }
        let function = symbol.idx() - self.of_symbol.len();
        if function > self.function_count {
            return self.further.get(function - self.function_count - 1).copied();
        }
        let scope = tree.of_fn.get(function).copied().unwrap_or(1);
        let index = *self.starts.get(scope as usize)?;
        (self.list.get(index as usize)?.symbol == symbol).then_some(index)
    }

    /// The variable that the declaration of the binder's `symbol` whose name is at `pos` declares.
    pub(crate) fn of_declaration(&self, file: &File, tree: &ScopeTree, symbol: SymbolId, pos: u32) -> Option<u32> {
        let first = self.of_symbol(tree, symbol)?;
        if self.further.is_empty() {
            return Some(first);
        }
        let binder = self.list[first as usize].binder;
        let is_declared_by = |index: &u32| {
            let it = &self.list[*index as usize];
            let mut declarations = self.declarations_of(it).iter();
            it.binder == binder && declarations.any(|&decl| name_of_declaration(file, decl).is_some_and(|it| it.1 == pos))
        };
        let named = self.named(self.list[first as usize].name).iter().map(|it| it.1);
        Some({ named }.find(is_declared_by).unwrap_or(first))
    }

    #[inline]
    pub(crate) fn range_of_scope(&self, scope: u32) -> std::ops::Range<usize> {
        match (self.starts.get(scope as usize), self.starts.get(scope as usize + 1)) {
            (Some(&start), Some(&end)) => start as usize..end as usize,
            _ => 0..0,
        }
    }

    #[inline]
    pub(crate) fn declarations_of(&self, variable: &Variable) -> &[Decl] {
        let (start, len) = variable.declarations;
        self.declarations.get(start as usize..(start + len) as usize).unwrap_or_default()
    }

    #[inline]
    pub(crate) fn is_implicit(variable: &Variable) -> bool {
        variable.declarations.1 == 0
    }

    /// The variables named `name`, by scope.
    fn named(&self, name: Atom) -> &[(u32, u32)] {
        let (word, bit) = place_in_filter(self.names.len(), name);
        if self.names[word] & bit == 0 {
            return &[];
        }
        let start = self.by_name.partition_point(|it| it.0 < name.0);
        let len = self.by_name[start..].partition_point(|it| it.0 == name.0);
        &self.by_name[start..start + len]
    }

    /// ESLint's `scope.set.get(name)`.
    pub(crate) fn get(&self, scope: u32, name: Atom) -> Option<u32> {
        let range = self.range_of_scope(scope);
        let named = self.named(name);
        let found = named.get(named.partition_point(|it| (it.1 as usize) < range.start))?.1;
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
            let body_start = tree.scopes[it.scope as usize].body_start;
            (it.flags & wants != 0) && !(pos < body_start && (it.first_pos >= body_start || Self::is_implicit(it)))
        };
        // The innermost scope has the highest number.
        let end = self.range_of_scope(from).end;
        let before = named.partition_point(|it| (it.1 as usize) < end);
        const SCANNED: usize = 8;
        for &(_, index) in named[..before].iter().rev().take(SCANNED) {
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

/// The word and the bit for `name` in a filter of `words` words.
#[inline]
fn place_in_filter(words: usize, name: Atom) -> (usize, u64) {
    // Atoms are numbered sequentially: Fibonacci hashing spreads them.
    let hash = u64::from(name.0).wrapping_mul(0x9E37_79B9_7F4A_7C15) >> 32;
    ((hash >> 6) as usize & (words - 1), 1 << (hash & 63))
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
