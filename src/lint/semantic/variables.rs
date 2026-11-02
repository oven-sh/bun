//! Each scope's variables: ESLint's `scope.variables`.
//!
//! The declarations come straight from the HIR's lists. This module works out which [`ScopeTree`] scope each one
//! belongs to, and which declarations share one variable.

use super::scopes::{self, Block, NONE, ScopeTree};
use super::{DeclarationKind, ScopeKind};
use crate::ast::File;
use crate::tokens::skip_trivia;
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{ClassOwner, Decl, FnOwner, Parent, PatParent};
use bun_sema::hir::{self, FnKind, NameKind, PatKind, StmtKind, VarKind};
use rustc_hash::FxHashMap;

/// ESLint's `variable.isValueVariable`.
pub(crate) const VALUE: u8 = 1 << 0;
/// ESLint's `variable.isTypeVariable`.
pub(crate) const TYPE: u8 = 1 << 1;

#[derive(Copy, Clone, Debug)]
pub(crate) struct Variable {
    pub(crate) name: Atom,
    /// The name's index in `NameTable::slots`.
    pub(crate) slot: u32,
    pub(crate) scope: u32,
    /// Its scope's `ScopeData::body_start`.
    pub(crate) body_start: u32,
    /// The position of the name in its first declaration. 0 for the implicit `arguments`.
    pub(crate) first_pos: u32,
    /// Its first declaration.
    first: Decl,
    /// Number of declarations. 0 means it's the implicit `arguments`.
    pub(crate) count: u32,
    /// With more than one declaration, where they start in `Variables::declarations`.
    start: u32,
    pub(crate) flags: u8,
    /// One bit per `DeclarationKind` among its declarations.
    pub(crate) kinds: u16,
}

pub(crate) struct Variables {
    /// Sorted by scope, then by position, except that a function's `arguments` comes first.
    pub(crate) list: Vec<Variable>,
    /// For each scope, where its variables start in `list`. Has one more entry than there are scopes.
    starts: Vec<u32>,
    /// For each declaration that isn't a pattern: its name's position and the `list` index of the variable it declares.
    /// Sorted.
    declared_at: Vec<(u32, u32)>,
    /// For each pattern that's a name, the `list` index of the variable it declares.
    pat_variables: Vec<u32>,
    names: NameTable,
    /// `list` indices grouped by name. Within a name they're sorted, and therefore ordered by scope.
    by_name: Vec<u32>,
    /// The declarations of variables that have more than one, in source order.
    declarations: Vec<Decl>,
    /// The `list` indices of variables with more than one declaration.
    pub(crate) several: Vec<u32>,
    /// True if some block declares a variable that belongs to the enclosing function: a `var`, or a function that's
    /// hoisted out of its block (`hoisted_function_scope`).
    pub(crate) has_hoisted_block_declarations: bool,
    pub(crate) deep_patterns: DeepPatterns,
}

struct Entry {
    scope: u32,
    name: Atom,
    pos: u32,
    decl: Decl,
    /// The owner of the outermost pattern around the name: the `VarDeclId` for a `Decl::Var`, the `ParamId` for a
    /// `Decl::Param`. `NONE` for the name of a `this` parameter.
    owner: u32,
    flags: u8,
    kinds: u16,
}

/// Returns a declaration's bit in `Variable::kinds`. `is_catch_parameter` only applies to a `Decl::Var`.
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
    /// `NONE` if the slot is free.
    name: Atom,
    /// While the variables are built: the last one with this name. Afterwards: how many of them are in `by_name` so
    /// far.
    last: u32,
    /// Number of variables with this name.
    count: u32,
    /// Where they start in `by_name`.
    start: u32,
}

/// The names of a file's variables.
struct NameTable {
    slots: Vec<NameSlot>,
    /// If true, a name's atom number is its slot index, and the last slot, which stays free, covers all higher numbers.
    /// That works because a file that's linted on its own numbers its names from 0. Otherwise it's an open-addressing
    /// hash table, at most half full, with a power-of-two number of slots.
    is_indexed_by_atom: bool,
}

impl NameTable {
    /// `highest` is the highest atom number that will be stored.
    fn with_capacity_for(names: usize, highest: u32) -> NameTable {
        let free = NameSlot {
            name: Atom::NONE,
            last: NONE,
            count: 0,
            start: NONE,
        };
        let is_indexed_by_atom = (highest as usize) < 8 * names + 1024;
        NameTable {
            slots: match is_indexed_by_atom {
                true => vec![free; highest as usize + 2],
                false => vec![free; (names * 2 + 2).next_power_of_two()],
            },
            is_indexed_by_atom,
        }
    }

    /// Returns the index of `name`'s slot, or of the free slot where it would go.
    #[inline(always)]
    fn slot_index(&self, name: Atom) -> usize {
        match self.is_indexed_by_atom {
            true => (name.0 as usize).min(self.slots.len() - 1),
            false => self.slot_index_by_hash(name),
        }
    }

    #[inline(never)]
    fn slot_index_by_hash(&self, name: Atom) -> usize {
        let mask = self.slots.len() - 1;
        // Atoms are numbered sequentially, so Fibonacci hashing spreads them out.
        let mut at = (u64::from(name.0).wrapping_mul(0x9E37_79B9_7F4A_7C15) >> 32) as usize & mask;
        while self.slots[at].name != name && self.slots[at].name.is_some() {
            at = (at + 1) & mask;
        }
        at
    }
}

/// The ancestors recorded for a pattern that's far above a name.
#[derive(Copy, Clone)]
pub(crate) struct PatternAncestors {
    /// The outermost enclosing pattern, or the pattern itself.
    pub(crate) top: hir::PatId,
    /// The nearest enclosing pattern, or the pattern itself, that's a property or element with a default value. `NONE`
    /// if there isn't one.
    pub(crate) with_default: hir::PatId,
}

/// Patterns that are far above a name, as in `let [a, [b, [c, ..`, where walking up from every name would be quadratic.
/// Empty in a file without such patterns.
#[derive(Default)]
pub(crate) struct DeepPatterns {
    above: FxHashMap<u32, PatternAncestors>,
}

/// Returns the pattern that `pat` is a property or element of, and `pat`'s default value there.
fn outer_pattern(file: &File, pat: hir::PatId) -> Option<(hir::PatId, hir::ExprId)> {
    let hir = &file.hir;
    let (outer, default) = match *file.bound.pat_parent.get(pat.idx())? {
        PatParent::Prop(outer, p) => (outer, hir.pat_props.get(p.idx()).map(|it| it.default)),
        PatParent::Elem(outer, e) => (outer, hir.pat_elems.get(e.idx()).map(|it| it.default)),
        _ => return None,
    };
    (outer != pat).then_some((outer, default.unwrap_or(hir::ExprId::NONE)))
}

impl DeepPatterns {
    /// The first this many steps up from a pattern are neither cached nor looked up.
    pub(crate) const PLAIN_STEPS: u32 = 8;

    #[inline]
    pub(crate) fn get(&self, pat: hir::PatId) -> Option<PatternAncestors> {
        self.above.get(&pat.0).copied()
    }

    /// Returns the outermost pattern around the name `pat`, and caches the patterns far above it. `visited` is scratch
    /// space for the patterns visited on the way up.
    fn add(&mut self, file: &File, pat: hir::PatId, visited: &mut Vec<hir::PatId>) -> hir::PatId {
        let (mut at, mut steps) = (pat, 0);
        let mut above = loop {
            if steps >= Self::PLAIN_STEPS {
                if let Some(known) = self.get(at) {
                    break known;
                }
                visited.push(at);
            }
            match outer_pattern(file, at) {
                Some((outer, _)) => (at, steps) = (outer, steps + 1),
                None => {
                    break PatternAncestors {
                        top: at,
                        with_default: hir::PatId::NONE,
                    };
                }
            }
        };
        // Pop from the outermost pattern inward.
        while let Some(it) = visited.pop() {
            if outer_pattern(file, it).is_some_and(|(_, default)| default.is_some()) {
                above.with_default = it;
            }
            self.above.insert(it.0, above);
        }
        above.top
    }

    /// Returns the outermost pattern around `pat`.
    fn top_of(known: Option<&DeepPatterns>, file: &File, pat: hir::PatId) -> hir::PatId {
        let (mut at, mut steps) = (pat, 0);
        loop {
            if steps >= Self::PLAIN_STEPS
                && let Some(above) = known.and_then(|it| it.get(at))
            {
                return above.top;
            }
            match outer_pattern(file, at) {
                Some((outer, _)) => (at, steps) = (outer, steps + 1),
                None => return at,
            }
        }
    }
}

/// Returns what the outermost pattern `top` belongs to.
fn owner_of_pattern(file: &File, top: hir::PatId) -> PatParent {
    (file.bound.pat_parent.get(top.idx())).map_or(PatParent::None, |&it| it)
}

/// Returns the declaration or parameter that the pattern `pat` is part of.
pub(crate) fn root_of_pattern(file: &File, pat: hir::PatId) -> PatParent {
    let known = file.semantic().variables.get().map(|it| &it.deep_patterns);
    owner_of_pattern(file, DeepPatterns::top_of(known, file, pat))
}

/// True if `d` is the `e` in `catch (e)`.
pub(crate) fn is_catch_parameter(file: &File, d: hir::VarDeclId) -> bool {
    let statement = file
        .bound
        .var_stmt
        .get(d.idx())
        .and_then(|it| file.hir.stmts.get(it.idx()));
    matches!(statement.map(|it| it.kind), Some(StmtKind::Try { .. }))
}

/// Returns the name of a declaration that declares a variable, and the name's position.
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
                // `["a"]`, which typescript-estree rejects. The name is the string. Only oxc accepts a template as a
                // name.
                NameKind::ComputedString if m.name.is_some() => {
                    let pos = skip_trivia(file.text(), m.pos + 1);
                    let is_string = matches!(file.text().get(pos as usize), Some(b'"' | b'\''));
                    return (is_string || file.has_oxc_scopes()).then_some((m.name, pos));
                }
                NameKind::Identifier => (m.name, m.pos),
                _ => return None,
            }
        }
        Decl::Module(m) => {
            let m = hir.modules.get(m.idx())?;
            match m.name {
                // `namespace A.B { }` doesn't declare anything a name can refer to.
                hir::ModuleName::Ident(name)
                    if file.has_oxc_scopes()
                        || !scopes::is_after_dot(file, m)
                            && scopes::after_dot(file, m).is_none() =>
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

/// Returns every variable declaration, plus a sorted list of each one's position and index.
#[inline(never)]
fn entries_in_order(
    file: &File,
    unvisited: &[(u32, u32)],
    deep_patterns: &mut DeepPatterns,
) -> (Vec<Entry>, Vec<u64>) {
    let (hir, bound) = (&file.hir, &file.bound);
    let room = hir.pats.len()
        + hir.fns.len() / 4
        + hir.type_params.len()
        + hir.import_specs.len()
        + hir.classes.len();
    let mut entries: Vec<Entry> = Vec::with_capacity(room);
    // Each entry's position (high half) and index (low half).
    let mut in_order: Vec<u64> = Vec::with_capacity(room);
    let mut add_named = |decl: Decl, owner: u32, name: Atom, pos: u32| {
        if !(file.has_synthetic_nodes() && file.is_in_jsdoc(pos))
            && !unvisited.iter().any(|it| (it.0..it.1).contains(&pos))
        {
            in_order.push(u64::from(pos) << 32 | entries.len() as u64);
            entries.push(Entry {
                scope: NONE,
                name,
                pos,
                decl,
                owner,
                flags: 0,
                kinds: 0,
            });
        }
    };
    // Nodes the parser left behind when it backtracked have no parent.
    let is_in_tree = |s: hir::StmtId| !matches!(bound.parent_of_stmt(s), Parent::None);
    let mut visited = Vec::new();
    for (i, pat) in hir.pats.iter().enumerate() {
        let PatKind::Ident(name) = pat.kind else {
            continue;
        };
        let id = hir::PatId(i as u32);
        let owner = owner_of_pattern(file, deep_patterns.add(file, id, &mut visited));
        // The same check as in `name_of_declaration`.
        if name.is_none() || name == known::empty {
            continue;
        }
        match owner {
            PatParent::Var(d) => add_named(Decl::Var(id), d.0, name, pat.pos),
            PatParent::Param(p) => add_named(Decl::Param(id), p.0, name, pat.pos),
            // A `this` parameter's name has no parent.
            PatParent::None if name == known::this => {
                add_named(Decl::Param(id), NONE, name, pat.pos)
            }
            _ => {}
        }
    }
    let mut add = |decl: Decl| {
        if let Some((name, pos)) = name_of_declaration(file, decl) {
            add_named(decl, NONE, name, pos);
        }
    };
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

/// Returns the scope oxc puts function `f` in, if it isn't `here`, the scope it's declared in. `f` is `entries[index]`.
/// Outside strict code, a plain function in a block is a variable of the enclosing function, unless that function
/// already declared the name earlier. An earlier function from the same block that was hoisted there doesn't count,
/// because the two are one variable.
fn hoisted_function_scope<'a>(
    file: &'a File<'a>,
    tree: &ScopeTree,
    entries: &[Entry],
    index: usize,
    f: hir::FnId,
    here: u32,
) -> Option<u32> {
    let enclosing_scope = tree.scopes.get(here as usize)?.variable_scope;
    let (raw, it) = (file.hir.fns.get(f.idx())?, entries.get(index)?);
    let not_plain = hir::Flags::ASYNC.union(hir::Flags::GENERATOR);
    let is_moved = enclosing_scope != here
        && raw.kind == FnKind::Decl
        && !raw.flags.intersects(not_plain)
        && !scopes::is_strict_for_oxc(file, tree, here)
        && (entries.iter())
            .filter(|other| {
                other.name == it.name && other.scope == enclosing_scope && other.pos < it.pos
            })
            .all(|other| matches!(other.decl, Decl::Fn(_)) && tree.scope_at(other.pos) == here);
    is_moved.then_some(enclosing_scope)
}

/// Finds the scope each entry is declared in, starting from the scope its name is written in. Entries that don't
/// declare a variable keep `NONE`. Returns the number of entries per scope, stored at the scope's index plus 1, and
/// `Variables::has_hoisted_block_declarations`.
#[inline(never)]
fn assign_scopes<'a>(
    file: &'a File<'a>,
    tree: &ScopeTree,
    entries: &mut [Entry],
    in_order: &[u64],
) -> (Vec<u32>, bool) {
    let (hir, bound) = (&file.hir, &file.bound);
    let mut entry_starts = vec![0u32; tree.scopes.len() + 1];
    let mut hoists_names = false;
    let mut cursor = tree.cursor();
    let moves_functions = file.has_oxc_scopes()
        && file.is_javascript()
        && crate::utils::oxlint::source_type(file) != crate::language::SourceType::Module;
    for &key in in_order {
        let here = cursor.seek(entries[key as u32 as usize].pos);
        let moved_to = match entries[key as u32 as usize].decl {
            Decl::Fn(f) if moves_functions => {
                let index = key as u32 as usize;
                let to = hoisted_function_scope(file, tree, entries, index, f, here);
                hoists_names |= to.is_some();
                to
            }
            _ => None,
        };
        let it = &mut entries[key as u32 as usize];
        let mut is_catch = false;
        (it.scope, it.flags) = match it.decl {
            Decl::Var(_) => {
                let d = hir::VarDeclId(it.owner);
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
                hoists_names |= scope != here;
                (scope, VALUE)
            }
            Decl::Param(_) => match it.owner {
                NONE => (here, VALUE),
                param => {
                    let scope = bound
                        .param_fn
                        .get(param as usize)
                        .and_then(|f| tree.scope_of_fn.get(f.idx()));
                    (scope.copied().unwrap_or(NONE), VALUE)
                }
            },
            Decl::Fn(_) => (moved_to.unwrap_or(here), VALUE),
            Decl::Class(c) => match bound.class_owner.get(c.idx()) {
                Some(ClassOwner::Expr(_)) => (
                    tree.scope_of_class.get(c.idx()).copied().unwrap_or(NONE),
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
    (entry_starts, hoists_names)
}

/// The variables while they're being built.
struct Builder {
    list: Vec<Variable>,
    names: NameTable,
    /// Each variable's declarations after the first, with the variable's index.
    later: Vec<(u32, Decl)>,
}

impl Builder {
    /// Adds a declaration and returns the index of the variable it declares. A scope's declarations are all added
    /// consecutively, in source order. `count` is 0 for the implicit `arguments`, which comes first.
    #[inline]
    fn declare(&mut self, it: &Entry, count: u32, body_start: u32) -> u32 {
        let at = self.names.slot_index(it.name);
        let slot = &mut self.names.slots[at];
        // If the scope already declared the name, that's the last variable with that name.
        if let Some(variable) = self.list.get_mut(slot.last as usize)
            && variable.scope == it.scope
        {
            match variable.count {
                // ESLint lists a function's `arguments` first, whether or not the code declares it.
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
        let mut deep_patterns = DeepPatterns::default();
        let (mut entries, in_order) = entries_in_order(file, &tree.unvisited, &mut deep_patterns);
        let scope_count = tree.scopes.len();
        let (mut entry_starts, has_hoisted_block_declarations) =
            assign_scopes(file, tree, &mut entries, &in_order);

        // Entry indices grouped by scope, in source order within each scope.
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
        let mut builder = Builder {
            list: Vec::with_capacity(by_scope.len() + hir.fns.len()),
            names: NameTable::with_capacity_for(
                by_scope.len() + 1,
                (entries.iter()).fold(known::arguments.0, |highest, it| highest.max(it.name.0)),
            ),
            later: Vec::new(),
        };
        let mut pat_variables = vec![NONE; hir.pats.len()];
        // For each non-pattern declaration: the name's position, the entry's index and the variable it declares.
        let mut others: Vec<(u32, u32, u32)> = Vec::new();
        for (scope, data) in tree.scopes.iter().enumerate() {
            starts.push(builder.list.len() as u32);
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
                    owner: NONE,
                    flags: VALUE | TYPE,
                    kinds: 0,
                };
                builder.declare(&implicit, 0, data.body_start);
            }
            for &i in &by_scope[entry_starts[scope] as usize..entry_starts[scope + 1] as usize] {
                let it = &entries[i as usize];
                let declared = builder.declare(it, 1, data.body_start);
                match it.decl {
                    Decl::Var(pat) | Decl::Param(pat) => {
                        if let Some(slot) = pat_variables.get_mut(pat.idx()) {
                            *slot = declared;
                        }
                    }
                    _ => others.push((it.pos, i, declared)),
                }
            }
        }
        let Builder {
            mut list,
            mut names,
            mut later,
        } = builder;
        starts.push(list.len() as u32);
        others.sort_unstable();
        let declared_at = others.iter().map(|it| (it.0, it.2)).collect();

        // Group the variables by name.
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
        let mut several: Vec<u32> = Vec::new();
        crate::utils::sort::sort_by_key(&mut later, |it| it.0);
        for group in later.chunk_by(|a, b| a.0 == b.0) {
            several.push(group[0].0);
            let variable = &mut list[group[0].0 as usize];
            variable.start = declarations.len() as u32;
            declarations.push(variable.first);
            declarations.extend(group.iter().map(|it| it.1));
            // `Referencer.visitFunction` defines the parameters before the type parameters.
            if tree.scopes[variable.scope as usize].kind == ScopeKind::Function
                && variable.flags == VALUE | TYPE
            {
                crate::utils::sort::sort_by_key(
                    &mut declarations[variable.start as usize..],
                    |it| !matches!(it, Decl::Param(_)),
                );
            }
        }
        Variables {
            list,
            starts,
            declared_at,
            pat_variables,
            names,
            by_name,
            declarations,
            several,
            has_hoisted_block_declarations,
            deep_patterns,
        }
    }

    /// Returns the `list` index of the variable declared by the non-pattern declaration whose name is at `pos`.
    pub(crate) fn declared_at(&self, pos: u32) -> Option<u32> {
        let found = self
            .declared_at
            .get(self.declared_at.partition_point(|it| it.0 < pos))?;
        (found.0 == pos).then_some(found.1)
    }

    /// Returns the `list` index of the variable that the name `pat` declares.
    #[inline]
    pub(crate) fn variable_of_pat(&self, pat: hir::PatId) -> Option<u32> {
        self.pat_variables
            .get(pat.idx())
            .copied()
            .filter(|it| *it != NONE)
    }

    /// The number of distinct values `slot_of` can return.
    #[inline]
    pub(crate) fn slot_count(&self) -> usize {
        self.names.slots.len()
    }

    /// Returns the `Variable::slot` of the variables named `name`. If there are none, no variable has the returned
    /// slot.
    #[inline]
    pub(crate) fn slot_of(&self, name: Atom) -> usize {
        self.names.slot_index(name)
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

    /// True if another variable has the same name as `variable`.
    #[inline]
    pub(crate) fn shares_name(&self, variable: &Variable) -> bool {
        (self.names.slots.get(variable.slot as usize)).is_some_and(|it| it.count > 1)
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

    /// Returns the variables named `name`, ordered by scope.
    #[inline]
    pub(crate) fn named(&self, name: Atom) -> &[u32] {
        let slot = &self.names.slots[self.names.slot_index(name)];
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

    /// Returns what a reference to `name` at `pos`, in scope `from`, resolves to: ESLint's `Scope#__resolve`, scope by
    /// scope. `wanted_flags` is `VALUE`, `TYPE` or both.
    pub(crate) fn resolve(
        &self,
        tree: &ScopeTree,
        from: u32,
        name: Atom,
        pos: u32,
        wanted_flags: u8,
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
            (it.flags & wanted_flags != 0)
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

/// Returns the scope that the type parameter at `pos`, written in scope `here`, is declared in.
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
