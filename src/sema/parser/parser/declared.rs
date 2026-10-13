//! Spots, while a file is parsed, a name that may be declared twice in one scope.
//!
//! oxc reports a redeclaration (`let a; let a;`) as an error. Finding one takes the scopes of the file, which costs far more
//! than the answer is worth: nearly no file has one. So the parser keeps just enough to say "this file has none": for each
//! name, the innermost open scope that declares it, and as what. [`rare::MAY_REDECLARE`] is the answer. It errs towards
//! "maybe": it knows nothing of strict mode or of scripts and modules. The linter works out the rest.

use super::Parser;
use bun_sema::atom::{Atom, KNOWN_TEXTS, known};
use bun_sema::hir::*;

/// oxc's `SymbolFlags`, as far as its `..Excludes` tell them apart.
mod flag {
    /// `var`, a parameter, the `e` of `catch (e)`
    pub(super) const VAR: u16 = 1 << 0;
    /// `let`, `const`, `using`, a name in the pattern of a `catch`
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
    /// Every namespace counts as one that has values.
    pub(super) const NAMESPACE: u16 = 1 << 11;
    /// In JavaScript, a function that a block in the scope declares. Outside strict code it is a `var` of the function around.
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

/// What a declaration declares its name as.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Declares {
    Var,
    /// Also the `e` of `catch (e)`. Two parameters with one name are `File::may_bind_a_parameter_twice`.
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

/// The flag of a declaration, and the flags that it can't share a scope with: in TypeScript, where oxc follows tsc, and in
/// JavaScript, where it has further checks that depend on where the declarations are.
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

/// What is known about a name: the id of a scope that declares it in the upper half, the depth of that scope in the next 16
/// bits, and as what it is declared there in the low 16, which are bits of `flag`. No scope has the id 0.
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

/// How deep scopes are told apart. In a scope that is deeper the answer is "maybe".
const DEPTHS: usize = 256;

/// In `Declared::log`, with the place: the name goes up to the function. What is beside it are its flags.
const HOISTED: u32 = 1 << 31;

/// A scope that is open, by its depth.
#[derive(Copy, Clone, Default)]
struct Level {
    /// 0: none is open at this depth.
    id: u32,
    /// How long `Declared::log` was when it was opened.
    log: u32,
    /// `Declared::holds_vars` around it.
    holds_vars: u32,
}

/// Where a speculative parse began.
#[derive(Copy, Clone)]
pub(crate) struct Mark {
    stamp: Entry,
    log: u32,
    holds_vars: u32,
    unopened: u32,
}

#[derive(Default)]
pub(crate) struct Declared {
    /// Off unless `Dialect::oxc_names`, and once the answer is "maybe".
    is_on: bool,
    is_javascript: bool,
    /// How many of the innermost scopes have no level yet. Most blocks declare nothing, so a block gets its level with its first
    /// declaration. While it is off every scope is counted here.
    unopened: u32,
    mask: u32,
    /// An entry without flags for the innermost scope that has a level.
    stamp: Entry,
    /// The innermost open scope that a `var` declares in: a function, a static block, a namespace, the file.
    holds_vars: u32,
    /// The id that was given out last. None is given out twice, from file to file.
    last: u32,
    /// By the low bits of the number of a name. Two names that share a place count as one, which can only turn a "no" into a
    /// "maybe". It is never cleared: an entry of another file has the id of a scope that is not open.
    table: Vec<Entry>,
    levels: Vec<Level>,
    /// What is to be done when a scope closes. An entry of an open scope that a scope in it has replaced, with its place in
    /// `table`, is put back. A name that a block has declared with `var` ([`HOISTED`]) is declared in the scope around: oxc notes
    /// it in every scope up to the function. In JavaScript a function in a block is such a name too.
    log: Vec<(u32, Entry)>,
    /// For `close_level_with_log`.
    carried: Vec<(u32, u16)>,
    /// The parameters of the function whose block comes next.
    parameters: (Span<TypeParamId>, Span<ParamId>),
}

impl Declared {
    /// `has_table`: `note_odd_exports` will be called.
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
        // A file that has its own atoms numbers them from 0. Beyond a million names some share a place.
        let places = (KNOWN_TEXTS.len() + text_len / 4)
            .next_power_of_two()
            .min(1 << 20);
        if self.table.len() < places {
            self.table.resize(places, 0);
        }
        self.mask = places as u32 - 1;
        if self.last > u32::MAX / 2 {
            self.table.fill(0);
            self.last = 0;
        }
        // The last file has closed its scopes, unless it was given up.
        if self.levels.len() != DEPTHS || depth_of(self.stamp) != 0 {
            self.levels.clear();
            self.levels.resize(DEPTHS, Level::default());
        }
        self.last += 1;
        self.holds_vars = self.last;
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

    /// Returns whether the name may be declared already by what the declaration can't stand beside.
    #[inline(always)]
    fn declare(&mut self, name: Atom, kind: Declares) -> bool {
        if self.unopened != 0 && !self.open_levels() {
            return true;
        }
        let (flags, excludes) = self.rule(kind);
        let place = name.0 & self.mask;
        let is_hoisted = (kind == Declares::Var
            || kind == Declares::Function && self.is_javascript)
            && scope_of(self.stamp) != self.holds_vars;
        let Some(entry) = self.table.get_mut(place as usize) else {
            return false;
        };
        let old = *entry;
        let is_open = (self.levels.get(depth_of(old))).is_some_and(|it| it.id == scope_of(old));
        if is_hoisted || is_open {
            return self.declare_beside(place, old, (flags, excludes), is_hoisted);
        }
        *entry = self.stamp | Entry::from(flags);
        false
    }

    #[inline(always)]
    fn put(&mut self, place: u32, flags: u16) {
        if let Some(entry) = self.table.get_mut(place as usize) {
            *entry = self.stamp | Entry::from(flags);
        }
    }

    /// [`Declared::declare`] of a name that an open scope declares, or that goes up to the function.
    #[inline(never)]
    fn declare_beside(
        &mut self,
        place: u32,
        old: Entry,
        (flags, excludes): (u16, u16),
        is_hoisted: bool,
    ) -> bool {
        if is_hoisted {
            let above = match flags {
                flag::FUNCTION => flag::FUNCTION_IN_BLOCK,
                _ => flags,
            };
            self.log.push((place | HOISTED, Entry::from(above)));
        }
        if !self.is_open(old) {
            self.put(place, flags);
            return false;
        }
        let clashes = old as u16 & excludes != 0;
        if scope_of(old) == scope_of(self.stamp) {
            self.put(place, old as u16 | flags);
            return clashes;
        }
        self.log.push((place, old));
        self.put(place, flags);
        // oxc asks each scope up to the function, and stops at the first that has the name.
        is_hoisted && scope_of(old) >= self.holds_vars && clashes
    }

    /// Returns `false` where it is too deep.
    #[inline(always)]
    fn open_level(&mut self, holds_vars: bool) -> bool {
        let depth = depth_of(self.stamp) + 1;
        let Some(level) = self.levels.get_mut(depth) else {
            return false;
        };
        self.last += 1;
        *level = Level {
            id: self.last,
            log: self.log.len() as u32,
            holds_vars: self.holds_vars,
        };
        self.stamp = stamp_of(self.last, depth);
        if holds_vars {
            self.holds_vars = self.last;
        }
        true
    }

    /// Gives the scopes that have none a level. They are blocks.
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
        let around = depth.saturating_sub(1);
        self.stamp = stamp_of(self.levels.get(around).map_or(0, |it| it.id), around);
        self.holds_vars = level.holds_vars;
    }

    /// Puts back what was replaced since the log was `from` long. What goes up to the function is left in `carried`.
    fn unwind(&mut self, from: u32) {
        self.carried.clear();
        while self.log.len() > from as usize
            && let Some((place, entry)) = self.log.pop()
        {
            if place & HOISTED != 0 {
                self.carried.push((place & !HOISTED, entry as u16));
            } else if let Some(slot) = self.table.get_mut(place as usize) {
                *slot = entry;
            }
        }
    }

    #[inline(never)]
    fn close_level_with_log(&mut self, depth: usize, level: Level) {
        let held_vars = self.holds_vars == scope_of(self.stamp);
        self.unwind(level.log);
        self.leave(depth, level);
        if held_vars {
            return;
        }
        let goes_on = scope_of(self.stamp) != self.holds_vars;
        for index in 0..self.carried.len() {
            let Some(&(place, flags)) = self.carried.get(index) else {
                break;
            };
            let Some(&old) = self.table.get(place as usize) else {
                continue;
            };
            match self.is_open(old) {
                true if scope_of(old) == scope_of(self.stamp) => {
                    self.put(place, old as u16 | flags)
                }
                true => {
                    self.log.push((place, old));
                    self.put(place, flags);
                }
                false => self.put(place, flags),
            }
            if goes_on {
                self.log.push((place | HOISTED, Entry::from(flags)));
            }
        }
    }

    #[inline(always)]
    pub(crate) fn mark(&self) -> Mark {
        Mark {
            stamp: self.stamp,
            log: self.log.len() as u32,
            holds_vars: self.holds_vars,
            unopened: self.unopened,
        }
    }

    pub(crate) fn rollback(&mut self, to: Mark) {
        self.unopened = to.unopened;
        if !self.is_on {
            return;
        }
        self.unwind(to.log);
        let (kept, open) = (depth_of(to.stamp), depth_of(self.stamp));
        for level in self.levels.get_mut(kept + 1..=open).unwrap_or_default() {
            level.id = 0;
        }
        self.stamp = to.stamp;
        self.holds_vars = to.holds_vars;
    }

    /// Puts `name` in the set `names`, which is an id that no scope has. Only at the end of the file. A name that would share
    /// its place with another is left out.
    fn add_to(&mut self, names: u32, name: Atom) {
        if name.0 <= self.mask
            && let Some(entry) = self.table.get_mut(name.0 as usize)
        {
            *entry = stamp_of(names, 0);
        }
    }

    /// Whether `add_to` has put `name` in the set `names`.
    fn is_in(&self, names: u32, name: Atom) -> bool {
        name.0 <= self.mask && self.table.get(name.0 as usize) == Some(&stamp_of(names, 0))
    }

    /// Whether it was asked about `name` before, or about one that shares its place. Only at the end of the file: `names` is an
    /// id that no scope has.
    fn exports_twice(&mut self, name: Atom, names: u32) -> bool {
        let Some(entry) = self.table.get_mut((name.0 & self.mask) as usize) else {
            return true;
        };
        std::mem::replace(entry, stamp_of(names, 0)) == stamp_of(names, 0)
    }

    /// Whether a JavaScript module, which has been parsed, may export a name twice or one that it doesn't declare.
    #[inline(never)]
    fn has_odd_exports(&mut self, f: &FileBuilder) -> bool {
        let kind_of = |id: StmtId| f.stmts.get(id.idx()).map(|it| it.kind);
        let is_local = |it: &&Export| !it.has_module_specifier && !it.items.is_empty();
        let mut is_undeclared = false;
        if f.exports.iter().any(|it| is_local(&it)) {
            // The names that a statement of the file declares in plain sight. Any other may be undeclared: one in a pattern, a
            // `var` in a block.
            self.last += 1;
            let at_top = self.last;
            for id in f.ids(f.body) {
                match kind_of(id) {
                    Some(StmtKind::Fn(it)) => {
                        if let Some(it) = f.fns.get(it.idx()) {
                            self.add_to(at_top, it.name);
                        }
                    }
                    Some(StmtKind::Class(it)) => {
                        if let Some(it) = f.classes.get(it.idx()) {
                            self.add_to(at_top, it.name);
                        }
                    }
                    Some(StmtKind::Var(list)) => {
                        for it in f.var_decls.get(list.range()).unwrap_or_default() {
                            if let Some(PatKind::Ident(name)) =
                                f.pats.get(it.pat.idx()).map(|it| it.kind)
                            {
                                self.add_to(at_top, name);
                            }
                        }
                    }
                    _ => {}
                }
            }
            for it in f.imports.iter() {
                self.add_to(at_top, it.default);
                self.add_to(at_top, it.namespace);
                for it in f.import_specs.get(it.named.range()).unwrap_or_default() {
                    self.add_to(at_top, it.local);
                }
            }
            is_undeclared = f.exports.iter().filter(is_local).any(|it| {
                let items = f.export_specs.get(it.items.range()).unwrap_or_default();
                !items.iter().all(|it| self.is_in(at_top, it.local))
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
                        // What a pattern binds is not looked at here.
                        _ => true,
                    })
            }
            _ => false,
        });
        is_undeclared || is_twice
    }
}

impl<const GENERAL: bool> Parser<'_, GENERAL> {
    #[cold]
    #[inline(never)]
    pub(crate) fn may_redeclare(&mut self) {
        self.f.rare_syntax |= rare::MAY_REDECLARE;
        self.declared.is_on = false;
    }

    /// The scope that is open declares `name`.
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
            self.declare_names_of(pat, kind);
        }
    }

    #[inline(never)]
    fn declare_names_of(&mut self, pat: PatId, kind: Declares) {
        match self.f.pats.get(pat.idx()).map(|it| it.kind) {
            Some(PatKind::Ident(name)) => {
                if self.declared.declare(name, kind) {
                    self.may_redeclare();
                }
            }
            _ => self.declare_names_in(pat, kind),
        }
    }

    /// The parts of a pattern are right before it in the list. So are the parameters of a function in one of its defaults,
    /// which can only turn a "no" into a "maybe".
    #[inline(never)]
    fn declare_names_in(&mut self, pat: PatId, kind: Declares) {
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

    /// A block, the head and body of a `for`, the cases of a `switch`, a `catch` clause, the members of an enum.
    #[inline(always)]
    pub(crate) fn open_scope(&mut self) {
        self.declared.unopened += 1;
    }

    /// The body of a namespace.
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
            // The scope is closed like the others that have no level.
            self.declared.unopened += 1;
            self.may_redeclare();
        }
    }

    /// The function whose block comes next has these.
    #[inline(always)]
    pub(crate) fn note_parameters(&mut self, types: Span<TypeParamId>, values: Span<ParamId>) {
        if self.declared.is_on {
            self.declared.parameters = (types, values);
        }
    }

    /// The block of a function or a static block. A function without one has nothing that its parameters could clash with.
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
                self.declare_names_of(pat, Declares::Parameter);
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

    /// At the end of a JavaScript file: `rare::ODD_EXPORT`.
    pub(crate) fn note_odd_exports(&mut self) {
        if !self.options.dialect.oxc || !self.options.is_javascript || !self.f.has_module_syntax {
            return;
        }
        // oxlint prints nothing but the parser's errors about a file that doesn't parse, and the tree has holes then.
        if self.has_failed() || self.f.has_parse_diagnostics {
            return;
        }
        if self.declared.has_odd_exports(&self.f) {
            self.f.rare_syntax |= rare::ODD_EXPORT;
        }
    }
}
