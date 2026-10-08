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
    /// Indices into `list`, sorted by name, then by scope.
    by_name: Vec<u32>,
    /// In the order they are written, variable by variable.
    declarations: Vec<Decl>,
    /// The names that the binder may resolve differently from ESLint. Sorted.
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
            let Some((name, pos)) = name_of_declaration(file, decl) else {
                continue;
            };
            if file.has_synthetic_nodes() && file.is_in_jsdoc(pos) {
                continue;
            }
            let here = || tree.region_at(pos).from;
            let (scope, flags) = match decl {
                Decl::Var(p) | Decl::Require(p) => {
                    let PatParent::Var(d) = root_of_pattern(file, p) else {
                        continue;
                    };
                    let is_hoisted = hir.var_decls.get(d.idx()).is_some_and(|it| it.kind == VarKind::Var)
                        && !is_catch_parameter(file, d);
                    let scope = match is_hoisted {
                        true => tree.scopes[here() as usize].variable_scope,
                        false => here(),
                    };
                    // The binder declares it in the function.
                    if matches!(decl, Decl::Require(_)) && tree.scopes[scope as usize].variable_scope != scope {
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
                    _ if name == known::this => (here(), VALUE),
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
                    (here(), VALUE)
                }
                Decl::Class(c) => match bound.class_owner.get(c.idx()) {
                    Some(ClassOwner::Expr(_)) => (tree.of_class.get(c.idx()).copied().unwrap_or(NONE), VALUE | TYPE),
                    _ => (here(), VALUE | TYPE),
                },
                Decl::ImportDefault(_) | Decl::ImportNamespace(_) | Decl::ImportSpec(_) => (here(), VALUE | TYPE),
                _ if is_javascript => continue,
                Decl::Interface(_) | Decl::Alias(_) => (here(), TYPE),
                Decl::TypeParam(_) => (scope_of_type_parameter(file, tree, pos), TYPE),
                Decl::Module(_) => {
                    // To the binder, a namespace without values is not a value.
                    if !file.binding.symbol(symbol).is_some_and(|it| it.flags.intersects(SymFlags::VALUE)) {
                        hazards.push(name);
                    }
                    (here(), VALUE | TYPE)
                }
                _ => (here(), VALUE | TYPE),
            };
            if scope != NONE {
                entries.push(Entry {
                    scope,
                    name,
                    pos,
                    symbol,
                    decl,
                    flags,
                });
            }
        }
        entries.sort_unstable_by_key(|it| (it.scope, it.name.0, it.pos, it.symbol.0));

        let mut list: Vec<Variable> = Vec::with_capacity(entries.len() + hir.fns.len());
        let mut of_symbol = vec![NONE; symbol_count];
        let mut declarations: Vec<Decl> = Vec::with_capacity(entries.len());
        let mut declares_arguments: Vec<u32> = Vec::new();
        let mut further: Vec<u32> = Vec::new();
        let first_further = symbol_count + hir.fns.len() + 1;
        let mut rest = &entries[..];
        while let Some(first) = rest.first() {
            let len = rest.partition_point(|it| (it.scope, it.name) == (first.scope, first.name));
            let (group, after) = rest.split_at(len.max(1));
            rest = after;
            let index = list.len() as u32;
            let binder = group.iter().map(|it| it.symbol).min().unwrap_or(first.symbol);
            let mut symbol = binder;
            let start = declarations.len() as u32;
            let mut flags = 0;
            for it in group {
                if declarations.get(start as usize..).is_none_or(|them| them.last() != Some(&it.decl)) {
                    declarations.push(it.decl);
                }
                flags |= it.flags;
            }
            if of_symbol.get(binder.idx()).is_some_and(|it| *it != NONE) {
                symbol = SymbolId((first_further + further.len()) as u32);
                further.push(index);
            }
            for it in group {
                if let Some(slot) = of_symbol.get_mut(it.symbol.idx())
                    && *slot == NONE
                {
                    *slot = index;
                }
            }
            if first.name == known::arguments {
                declares_arguments.push(first.scope);
            }
            list.push(Variable {
                symbol,
                binder,
                name: first.name,
                scope: first.scope,
                first_pos: first.pos,
                declarations: (start, declarations.len() as u32 - start),
                flags,
            });
        }

        // "NOTE Arrow functions never have an arguments objects."
        for (scope, data) in tree.scopes.iter().enumerate() {
            let symbol = match (data.kind, data.block) {
                (ScopeKind::Function, Block::File) => symbol_count + hir.fns.len(),
                (ScopeKind::Function, Block::Fn(f))
                    if hir.fns.get(f.idx()).is_some_and(|it| it.kind != FnKind::Arrow) =>
                {
                    symbol_count + f.idx()
                }
                _ => continue,
            };
            if declares_arguments.binary_search(&(scope as u32)).is_err() {
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
        }
        if scopes::has_top_level_function(file) {
            hazards.push(known::arguments);
        }

        let mut order: Vec<u32> = (0..list.len() as u32).collect();
        order.sort_unstable_by_key(|&i| (list[i as usize].scope, list[i as usize].first_pos));
        let mut moved_to = vec![0u32; list.len()];
        for (to, &from) in order.iter().enumerate() {
            moved_to[from as usize] = to as u32;
        }
        let list: Vec<Variable> = order.iter().map(|&i| list[i as usize]).collect();
        for slot in of_symbol.iter_mut().filter(|it| **it != NONE).chain(&mut further) {
            *slot = moved_to[*slot as usize];
        }
        let mut starts = vec![0u32; tree.scopes.len() + 1];
        for it in &list {
            starts[it.scope as usize + 1] += 1;
        }
        for i in 0..tree.scopes.len() {
            starts[i + 1] += starts[i];
        }
        let mut by_name = order;
        by_name.iter_mut().enumerate().for_each(|(i, slot)| *slot = i as u32);
        by_name.sort_unstable_by_key(|&i| (list[i as usize].name.0, list[i as usize].scope));

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
        let named = self.named(self.list[first as usize].name).iter();
        Some(named.copied().find(|it| is_declared_by(it)).unwrap_or(first))
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
    fn named(&self, name: Atom) -> &[u32] {
        let start = self.by_name.partition_point(|&i| self.list[i as usize].name.0 < name.0);
        let len = self.by_name[start..].partition_point(|&i| self.list[i as usize].name == name);
        &self.by_name[start..start + len]
    }

    /// ESLint's `scope.set.get(name)`.
    pub(crate) fn get(&self, scope: u32, name: Atom) -> Option<u32> {
        let named = self.named(name);
        let at = named.binary_search_by_key(&scope, |&i| self.list[i as usize].scope).ok()?;
        Some(named[at])
    }

    /// What a reference to `name` that is written at `pos`, in the scope `from`, resolves to:
    /// ESLint's `Scope#__resolve`, scope by scope. `wants`: `VALUE`, `TYPE` or both.
    pub(crate) fn resolve(&self, tree: &ScopeTree, from: u32, name: Atom, pos: u32, wants: u8) -> Option<u32> {
        let named = self.named(name);
        let is_valid = |index: u32| {
            let it = &self.list[index as usize];
            // ESLint's `FunctionScope#isValidResolution`: "References in default parameters isn't
            // resolved to variables which are in their function body."
            let body_start = tree.scopes[it.scope as usize].body_start;
            (it.flags & wants != 0) && !(pos < body_start && (it.first_pos >= body_start || Self::is_implicit(it)))
        };
        // The innermost scope has the highest number.
        let before = named.partition_point(|&i| self.list[i as usize].scope <= from);
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
            if let Ok(at) = named.binary_search_by_key(&scope, |&i| self.list[i as usize].scope)
                && is_valid(named[at])
            {
                return Some(named[at]);
            }
            scope = data.parent;
        }
        None
    }
}

/// The scope that the type parameter at `pos` is declared in.
fn scope_of_type_parameter(file: &File, tree: &ScopeTree, pos: u32) -> u32 {
    let here = tree.region_at(pos).from;
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
