//! Detects, while parsing, names that may be declared twice in one scope.
//!
//! oxc reports a redeclaration (`let a; let a;`) as an error. Finding one requires building the file's scopes, which
//! isn't worth the cost because almost no file has one. So the parser tracks just enough to say "this file has none":
//! for each name, the innermost open scope that declares it and the kind of declaration. The result is
//! [`rare::MAY_REDECLARE`]. It errs toward "maybe", since it doesn't know about strict mode or about scripts vs.
//! modules. The linter works out the rest.

use super::Parser;
use bun_sema::atom::{Atom, KNOWN_TEXTS, known};
use bun_sema::hir::*;

/// oxc's `SymbolFlags`, as far as its `..Excludes` constants distinguish them.
mod flag {
    /// `var`, a parameter, the `e` of `catch (e)`
    pub(super) const VAR: u16 = 1 << 0;
    /// `let`, `const`, `using`, a name in a `catch` pattern
    pub(super) const LEXICAL: u16 = 1 << 1;
    pub(super) const CLASS: u16 = 1 << 2;
    pub(super) const FUNCTION: u16 = 1 << 3;
    pub(super) const IMPORT: u16 = 1 << 4;
    pub(super) const ALIAS: u16 = 1 << 5;
    pub(super) const INTERFACE: u16 = 1 << 6;
    pub(super) const ENUM: u16 = 1 << 7;
    pub(super) const CONST_ENUM: u16 = 1 << 8;
    pub(super) const ENUM_MEMBER: u16 = 1 << 9;
    pub(super) const TYPE_PARAMETER: u16 = 1 << 10;
    /// Every namespace is treated as one that has values.
    pub(super) const NAMESPACE: u16 = 1 << 11;
    /// In JavaScript, a function declared by a block inside the scope. Outside strict mode it's a `var` of the
    /// enclosing function.
    pub(super) const FUNCTION_IN_BLOCK: u16 = 1 << 12;

    pub(super) const VALUE: u16 = VAR
        | LEXICAL
        | CLASS
        | FUNCTION
        | ENUM
        | CONST_ENUM
        | ENUM_MEMBER
        | NAMESPACE
        | FUNCTION_IN_BLOCK;
    pub(super) const TYPE: u16 =
        CLASS | INTERFACE | ENUM | CONST_ENUM | ENUM_MEMBER | TYPE_PARAMETER | ALIAS;
}

/// The kind of a declaration.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Declares {
    Var,
    /// Also the `e` of `catch (e)`. Two parameters with the same name are covered by
    /// `File::may_bind_a_parameter_twice`.
    Parameter,
    Lexical,
    Function,
    Class,
    Import,
    Alias,
    Interface,
    TypeParameter,
    Enum,
    ConstEnum,
    EnumMember,
    Namespace,
}

/// Indexed by `Declares`: a declaration's flag, then the flags it can't share a scope with in TypeScript, where oxc
/// follows tsc, and in JavaScript, where oxc has extra checks that depend on where the declarations are.
const RULES: [(u16, u16, u16); 13] = {
    use flag::*;
    [
        (VAR, VALUE & !(VAR | FUNCTION), VALUE & !VAR | IMPORT),
        (VAR, 0, 0),
        (LEXICAL, VALUE, VALUE | IMPORT),
        (
            FUNCTION,
            VALUE & !(FUNCTION | NAMESPACE | CLASS),
            VALUE | IMPORT,
        ),
        (
            CLASS,
            (VALUE | TYPE) & !(NAMESPACE | FUNCTION | INTERFACE),
            VALUE | IMPORT,
        ),
        (IMPORT, IMPORT, VALUE | IMPORT),
        (ALIAS, TYPE, TYPE),
        (INTERFACE, TYPE & !(INTERFACE | CLASS), TYPE),
        (TYPE_PARAMETER, TYPE & !TYPE_PARAMETER, TYPE),
        (ENUM, (VALUE | TYPE) & !(ENUM | NAMESPACE), VALUE | TYPE),
        (CONST_ENUM, (VALUE | TYPE) & !CONST_ENUM, VALUE | TYPE),
        (ENUM_MEMBER, ENUM_MEMBER, ENUM_MEMBER),
        (
            NAMESPACE,
            VALUE & !(FUNCTION | CLASS | ENUM | NAMESPACE),
            VALUE,
        ),
    ]
};

/// What's known about a name. The upper half is the id of a scope that declares it, the next 16 bits are that scope's
/// depth, and the low 16 bits are the `flag` bits of its declarations there. No scope has the id 0.
type Entry = u64;

#[inline(always)]
fn scope_of(entry: Entry) -> u32 {
    (entry >> 32) as u32
}

#[inline(always)]
fn depth_of(entry: Entry) -> usize {
    usize::from((entry >> 16) as u16)
}

#[inline(always)]
fn stamp_of(scope: u32, depth: usize) -> Entry {
    Entry::from(scope) << 32 | (depth as Entry) << 16
}

/// The number of scope depths that are tracked. In a deeper scope the answer is "maybe".
const DEPTHS: usize = 256;

/// Set on the slot index of a `Declared::log` entry to mark a name that's hoisted to the function. The entry's other
/// field is the name's flags.
const HOISTED: u32 = 1 << 31;

/// An open scope. Levels are indexed by depth.
#[derive(Copy, Clone, Default)]
struct Level {
    /// 0 if no scope is open at this depth.
    id: u32,
    /// The length of `Declared::log` when the scope was opened.
    log: u32,
    /// `Declared::var_scope` outside this scope.
    outer_var_scope: u32,
}

/// The state when a speculative parse began.
#[derive(Copy, Clone)]
pub(crate) struct Mark {
    stamp: Entry,
    log: u32,
    var_scope: u32,
    unopened: u32,
}

#[derive(Default)]
pub(crate) struct Declared {
    /// False unless `Dialect::oxc_names` is set, and false again once the answer is "maybe".
    is_on: bool,
    is_javascript: bool,
    /// How many of the innermost scopes have no level yet. Most blocks don't declare anything, so a block only gets a
    /// level at its first declaration. While `is_on` is false, every scope is counted here.
    unopened: u32,
    mask: u32,
    /// An entry with no flags for the innermost scope that has a level.
    stamp: Entry,
    /// The innermost open scope that `var` declarations belong to: a function, a static block, a namespace or the file.
    var_scope: u32,
    /// The last id handed out. Ids are never reused, not even across files.
    last: u32,
    /// Indexed by the low bits of a name's atom number. Two names that share a slot are treated as one, which can only
    /// turn a "no" into a "maybe". It isn't cleared between files, because an entry from another file has the id of a
    /// scope that isn't open.
    table: Vec<Entry>,
    levels: Vec<Level>,
    /// Work to do when a scope closes. An open scope's entry that an inner scope replaced is stored with its slot in
    /// `table`, and gets restored. A name that a block declared with `var` ([`HOISTED`]) gets declared in the enclosing
    /// scope, because oxc records it in every scope up to the function. In JavaScript, a function in a block is hoisted
    /// the same way.
    log: Vec<(u32, Entry)>,
    /// Scratch space for `close_level_with_log`.
    carried: Vec<(u32, u16)>,
    /// The parameters of the function whose block comes next.
    parameters: (Span<TypeParamId>, Span<ParamId>),
}

impl Declared {
    /// `has_table` is true if `note_odd_exports` will be called.
    pub(crate) fn begin(
        &mut self,
        text_len: usize,
        is_on: bool,
        has_table: bool,
        is_javascript: bool,
    ) {
        (self.is_on, self.is_javascript, self.unopened) = (is_on, is_javascript, 0);
        if !is_on && !has_table {
            return;
        }
        // A file with its own atoms numbers them from 0. Beyond a million names, some share a slot.
        let table_len = (KNOWN_TEXTS.len() + text_len / 4)
            .next_power_of_two()
            .min(1 << 20);
        if self.table.len() < table_len {
            self.table.resize(table_len, 0);
        }
        self.mask = table_len as u32 - 1;
        if self.last > u32::MAX / 2 {
            self.table.fill(0);
            self.last = 0;
        }
        // The previous file closed all its scopes, unless the parser gave up on it.
        if self.levels.len() != DEPTHS || depth_of(self.stamp) != 0 {
            self.levels.clear();
            self.levels.resize(DEPTHS, Level::default());
        }
        self.last += 1;
        self.var_scope = self.last;
        self.stamp = stamp_of(self.last, 0);
        if let Some(level) = self.levels.first_mut() {
            level.id = self.last;
        }
        self.log.clear();
        self.parameters = Default::default();
    }

    #[inline(always)]
    fn is_open(&self, entry: Entry) -> bool {
        (self.levels.get(depth_of(entry))).is_some_and(|it| it.id == scope_of(entry))
    }

    #[inline(always)]
    fn rule(&self, kind: Declares) -> (u16, u16) {
        let (flags, in_typescript, in_javascript) = RULES[kind as usize];
        match self.is_javascript {
            true => (flags, in_javascript),
            false => (flags, in_typescript),
        }
    }

    /// Returns true if the name may already have a declaration that conflicts with this one.
    #[inline(always)]
    fn declare(&mut self, name: Atom, kind: Declares) -> bool {
        if self.unopened != 0 && !self.open_levels() {
            return true;
        }
        let (flags, excludes) = self.rule(kind);
        let table_index = name.0 & self.mask;
        let is_hoisted = (kind == Declares::Var
            || kind == Declares::Function && self.is_javascript)
            && scope_of(self.stamp) != self.var_scope;
        let Some(entry) = self.table.get_mut(table_index as usize) else {
            return false;
        };
        let old = *entry;
        let is_open = (self.levels.get(depth_of(old))).is_some_and(|it| it.id == scope_of(old));
        if is_hoisted || is_open {
            return self.declare_existing_or_hoisted(
                table_index,
                old,
                (flags, excludes),
                is_hoisted,
            );
        }
        *entry = self.stamp | Entry::from(flags);
        false
    }

    #[inline(always)]
    fn put(&mut self, table_index: u32, flags: u16) {
        if let Some(entry) = self.table.get_mut(table_index as usize) {
            *entry = self.stamp | Entry::from(flags);
        }
    }

    /// [`Declared::declare`] for a name that an open scope already declares, or that's hoisted to the function.
    #[inline(never)]
    fn declare_existing_or_hoisted(
        &mut self,
        table_index: u32,
        old: Entry,
        (flags, excludes): (u16, u16),
        is_hoisted: bool,
    ) -> bool {
        if is_hoisted {
            let above = match flags {
                flag::FUNCTION => flag::FUNCTION_IN_BLOCK,
                _ => flags,
            };
            self.log.push((table_index | HOISTED, Entry::from(above)));
        }
        if !self.is_open(old) {
            self.put(table_index, flags);
            return false;
        }
        let clashes = old as u16 & excludes != 0;
        if scope_of(old) == scope_of(self.stamp) {
            self.put(table_index, old as u16 | flags);
            return clashes;
        }
        self.log.push((table_index, old));
        self.put(table_index, flags);
        // oxc checks each scope up to the function and stops at the first one that has the name.
        is_hoisted && scope_of(old) >= self.var_scope && clashes
    }

    /// Returns false if the scope is too deep.
    #[inline(always)]
    fn open_level(&mut self, is_var_scope: bool) -> bool {
        let depth = depth_of(self.stamp) + 1;
        let Some(level) = self.levels.get_mut(depth) else {
            return false;
        };
        self.last += 1;
        *level = Level {
            id: self.last,
            log: self.log.len() as u32,
            outer_var_scope: self.var_scope,
        };
        self.stamp = stamp_of(self.last, depth);
        if is_var_scope {
            self.var_scope = self.last;
        }
        true
    }

    /// Gives a level to each scope that doesn't have one yet. They're all blocks.
    #[inline(never)]
    fn open_levels(&mut self) -> bool {
        while self.unopened != 0 {
            if !self.open_level(false) {
                return false;
            }
            self.unopened -= 1;
        }
        true
    }

    /// Closes the innermost scope, which has a level.
    #[inline(never)]
    fn close_level(&mut self) {
        let depth = depth_of(self.stamp);
        let Some(&level) = self.levels.get(depth).filter(|_| self.is_on) else {
            return;
        };
        if self.log.len() != level.log as usize {
            return self.close_level_with_log(depth, level);
        }
        self.leave(depth, level);
    }

    #[inline(always)]
    fn leave(&mut self, depth: usize, level: Level) {
        if let Some(level) = self.levels.get_mut(depth) {
            level.id = 0;
        }
        let outer_depth = depth.saturating_sub(1);
        self.stamp = stamp_of(
            self.levels.get(outer_depth).map_or(0, |it| it.id),
            outer_depth,
        );
        self.var_scope = level.outer_var_scope;
    }

    /// Restores the entries replaced since the log had length `from`. Hoisted names are left in `carried`.
    fn unwind(&mut self, from: u32) {
        self.carried.clear();
        while self.log.len() > from as usize
            && let Some((table_index, entry)) = self.log.pop()
        {
            if table_index & HOISTED != 0 {
                self.carried.push((table_index & !HOISTED, entry as u16));
            } else if let Some(slot) = self.table.get_mut(table_index as usize) {
                *slot = entry;
            }
        }
    }

    #[inline(never)]
    fn close_level_with_log(&mut self, depth: usize, level: Level) {
        let was_var_scope = self.var_scope == scope_of(self.stamp);
        self.unwind(level.log);
        self.leave(depth, level);
        if was_var_scope {
            return;
        }
        let keeps_hoisting = scope_of(self.stamp) != self.var_scope;
        for index in 0..self.carried.len() {
            let Some(&(table_index, flags)) = self.carried.get(index) else {
                break;
            };
            let Some(&old) = self.table.get(table_index as usize) else {
                continue;
            };
            match self.is_open(old) {
                true if scope_of(old) == scope_of(self.stamp) => {
                    self.put(table_index, old as u16 | flags)
                }
                true => {
                    self.log.push((table_index, old));
                    self.put(table_index, flags);
                }
                false => self.put(table_index, flags),
            }
            if keeps_hoisting {
                self.log.push((table_index | HOISTED, Entry::from(flags)));
            }
        }
    }

    #[inline(always)]
    pub(crate) fn mark(&self) -> Mark {
        Mark {
            stamp: self.stamp,
            log: self.log.len() as u32,
            var_scope: self.var_scope,
            unopened: self.unopened,
        }
    }

    pub(crate) fn rollback(&mut self, to: Mark) {
        self.unopened = to.unopened;
        if !self.is_on {
            return;
        }
        self.unwind(to.log);
        let (target_depth, open) = (depth_of(to.stamp), depth_of(self.stamp));
        for level in self
            .levels
            .get_mut(target_depth + 1..=open)
            .unwrap_or_default()
        {
            level.id = 0;
        }
        self.stamp = to.stamp;
        self.var_scope = to.var_scope;
    }

    /// Adds `name` to the set `names`, which is identified by an id that no scope has. Only valid at the end of the
    /// file. A name that would share its slot with another is skipped.
    fn add_to(&mut self, names: u32, name: Atom) {
        if name.0 <= self.mask
            && let Some(entry) = self.table.get_mut(name.0 as usize)
        {
            *entry = stamp_of(names, 0);
        }
    }

    /// True if `add_to` added `name` to the set `names`.
    fn is_in(&self, names: u32, name: Atom) -> bool {
        name.0 <= self.mask && self.table.get(name.0 as usize) == Some(&stamp_of(names, 0))
    }

    /// True if this was already called for `name`, or for a name that shares its slot. Only valid at the end of the
    /// file. `names` is an id that no scope has.
    fn exports_twice(&mut self, name: Atom, names: u32) -> bool {
        let Some(entry) = self.table.get_mut((name.0 & self.mask) as usize) else {
            return true;
        };
        std::mem::replace(entry, stamp_of(names, 0)) == stamp_of(names, 0)
    }

    /// True if a fully parsed JavaScript module may export a name twice, or export a name it doesn't declare.
    #[inline(never)]
    fn has_odd_exports(&mut self, f: &FileBuilder) -> bool {
        let kind_of = |id: StmtId| f.stmts.get(id.idx()).map(|it| it.kind);
        let is_local = |it: &&Export| !it.has_module_specifier && !it.items.is_empty();
        let mut is_undeclared = false;
        if f.exports.iter().any(|it| is_local(&it)) {
            // Collect the names that top-level statements plainly declare. Any other name counts as possibly
            // undeclared, such as one bound in a pattern or a `var` in a block.
            self.last += 1;
            let top_level_names = self.last;
            for id in f.ids(f.body) {
                match kind_of(id) {
                    Some(StmtKind::Fn(it)) => {
                        if let Some(it) = f.fns.get(it.idx()) {
                            self.add_to(top_level_names, it.name);
                        }
                    }
                    Some(StmtKind::Class(it)) => {
                        if let Some(it) = f.classes.get(it.idx()) {
                            self.add_to(top_level_names, it.name);
                        }
                    }
                    Some(StmtKind::Var(list)) => {
                        for it in f.var_decls.get(list.range()).unwrap_or_default() {
                            if let Some(PatKind::Ident(name)) =
                                f.pats.get(it.pat.idx()).map(|it| it.kind)
                            {
                                self.add_to(top_level_names, name);
                            }
                        }
                    }
                    _ => {}
                }
            }
            for it in f.imports.iter() {
                self.add_to(top_level_names, it.default);
                self.add_to(top_level_names, it.namespace);
                for it in f.import_specs.get(it.named.range()).unwrap_or_default() {
                    self.add_to(top_level_names, it.local);
                }
            }
            is_undeclared = f.exports.iter().filter(is_local).any(|it| {
                let items = f.export_specs.get(it.items.range()).unwrap_or_default();
                !items.iter().all(|it| self.is_in(top_level_names, it.local))
            });
        }
        self.last += 1;
        let names = self.last;
        let mut export = |name: Atom| name.is_some() && self.exports_twice(name, names);
        let name_or_default = |flags: Flags, name: Atom| match flags.contains(Flags::DEFAULT) {
            true => known::default,
            false => name,
        };
        let is_twice = f.ids(f.body).any(|id| match kind_of(id) {
            Some(StmtKind::ExportDefault(_)) => export(known::default),
            Some(StmtKind::ExportStar { alias, .. }) => export(alias),
            Some(StmtKind::ExportNamed(it)) => {
                let items = f.exports.get(it.idx()).map(|it| it.items.range());
                let items = items.and_then(|it| f.export_specs.get(it));
                items
                    .unwrap_or_default()
                    .iter()
                    .any(|it| export(it.exported))
            }
            Some(StmtKind::Fn(it)) => f.fns.get(it.idx()).is_some_and(|it| {
                it.flags.contains(Flags::EXPORT) && export(name_or_default(it.flags, it.name))
            }),
            Some(StmtKind::Class(it)) => f.classes.get(it.idx()).is_some_and(|it| {
                it.flags.contains(Flags::EXPORT) && export(name_or_default(it.flags, it.name))
            }),
            Some(StmtKind::Var(list)) => {
                let list = f.var_decls.get(list.range()).unwrap_or_default();
                let exported = list.iter().filter(|it| it.flags.contains(Flags::EXPORT));
                exported
                    .into_iter()
                    .any(|it| match f.pats.get(it.pat.idx()).map(|it| it.kind) {
                        Some(PatKind::Ident(name)) => export(name),
                        // Names bound by a pattern aren't checked here.
                        _ => true,
                    })
            }
            _ => false,
        });
        is_undeclared || is_twice
    }
}

impl<const GENERAL: bool, const COMMENTS: bool> Parser<'_, GENERAL, COMMENTS> {
    #[cold]
    #[inline(never)]
    pub(crate) fn may_redeclare(&mut self) {
        self.f.rare_syntax |= rare::MAY_REDECLARE;
        self.declared.is_on = false;
    }

    /// Declares `name` in the current scope.
    #[inline(always)]
    pub(crate) fn declare(&mut self, name: Atom, kind: Declares) {
        if self.declared.is_on {
            self.declare_name(name, kind);
        }
    }

    #[inline(never)]
    fn declare_name(&mut self, name: Atom, kind: Declares) {
        if self.declared.is_on && self.declared.declare(name, kind) {
            self.may_redeclare();
        }
    }

    /// The same for the names that `pat` binds.
    #[inline(always)]
    pub(crate) fn declare_pattern(&mut self, pat: PatId, kind: Declares) {
        if self.declared.is_on {
            self.declare_pattern_names(pat, kind);
        }
    }

    #[inline(never)]
    fn declare_pattern_names(&mut self, pat: PatId, kind: Declares) {
        match self.f.pats.get(pat.idx()).map(|it| it.kind) {
            Some(PatKind::Ident(name)) => {
                if self.declared.declare(name, kind) {
                    self.may_redeclare();
                }
            }
            _ => self.declare_nested_pattern_names(pat, kind),
        }
    }

    /// A pattern's parts are right before it in the list. So are the parameters of a function inside one of its default
    /// values, which can only turn a "no" into a "maybe".
    #[inline(never)]
    fn declare_nested_pattern_names(&mut self, pat: PatId, kind: Declares) {
        let Some(start) = self.f.pats.get(pat.idx()).map(|it| it.pos) else {
            return;
        };
        for index in (0..pat.idx()).rev() {
            match self.f.pats.get(index) {
                Some(part) if part.pos < start => break,
                Some(&Pat {
                    kind: PatKind::Ident(name),
                    ..
                }) => self.declare_name(name, kind),
                _ => {}
            }
        }
    }

    /// Opens the scope of a block, a `for` (head and body), a `switch`'s cases, a `catch` clause or an enum's members.
    #[inline(always)]
    pub(crate) fn open_scope(&mut self) {
        self.declared.unopened += 1;
    }

    /// Opens the scope of a namespace body.
    #[inline(always)]
    pub(crate) fn open_scope_for_vars(&mut self) {
        match self.declared.is_on {
            true => self.open_level_for_vars(),
            false => self.declared.unopened += 1,
        }
    }

    #[inline(never)]
    fn open_level_for_vars(&mut self) {
        if !(self.declared.open_levels() && self.declared.open_level(true)) {
            // The scope will be closed like any other scope without a level.
            self.declared.unopened += 1;
            self.may_redeclare();
        }
    }

    /// Records the parameters of the function whose block comes next.
    #[inline(always)]
    pub(crate) fn note_parameters(&mut self, types: Span<TypeParamId>, values: Span<ParamId>) {
        if self.declared.is_on {
            self.declared.parameters = (types, values);
        }
    }

    /// Opens the scope of a function's block or a static block. In a function without a block, there's nothing its
    /// parameters could clash with.
    #[inline(always)]
    pub(crate) fn open_function(&mut self) {
        match self.declared.is_on {
            true => self.open_level_of_function(),
            false => self.declared.unopened += 1,
        }
    }

    #[inline(never)]
    fn open_level_of_function(&mut self) {
        self.open_level_for_vars();
        let (type_parameters, parameters) = std::mem::take(&mut self.declared.parameters);
        for index in type_parameters.range() {
            if let Some(name) = self.f.type_params.get(index).map(|it| it.name) {
                self.declare_name(name, Declares::TypeParameter);
            }
        }
        for index in parameters.range() {
            if let Some(pat) = self.f.params.get(index).map(|it| it.pat)
                && self.declared.is_on
            {
                self.declare_pattern_names(pat, Declares::Parameter);
            }
        }
    }

    #[inline(always)]
    pub(crate) fn close_scope(&mut self) {
        match self.declared.unopened {
            0 => self.declared.close_level(),
            _ => self.declared.unopened -= 1,
        }
    }

    /// Call at the end of a JavaScript file. Sets `rare::ODD_EXPORT`.
    pub(crate) fn note_odd_exports(&mut self) {
        if !self.options.dialect.oxc || !self.options.is_javascript || !self.f.has_module_syntax {
            return;
        }
        // For a file that doesn't parse, oxlint only prints the parser's errors, and the tree has holes.
        if self.has_failed() || self.f.has_parse_diagnostics {
            return;
        }
        if self.declared.has_odd_exports(&self.f) {
            self.f.rare_syntax |= rare::ODD_EXPORT;
        }
    }
}
