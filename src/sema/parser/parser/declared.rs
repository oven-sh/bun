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

    pub(super) const VALUE: u16 =
        VAR | LEXICAL | CLASS | FUNCTION | ENUM | CONST_ENUM | ENUM_MEMBER | NAMESPACE;
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

/// What is known about a name.
#[derive(Copy, Clone, Default)]
struct Entry {
    /// The id of a scope that declares it. No scope has the id 0.
    scope: u32,
    /// The index of that scope in `Declared::open` while it is open.
    depth: u32,
    /// As what: bits of `flag`.
    flags: u16,
}

/// Where a scope found the lists of [`Declared`] when it was opened.
#[derive(Copy, Clone)]
pub(crate) struct Outer {
    replaced: u32,
    hoisted: u32,
    holds_vars: u32,
}

/// [`Outer`] for a speculative parse.
#[derive(Copy, Clone)]
pub(crate) struct Mark {
    open: u32,
    outer: Outer,
}

#[derive(Default)]
pub(crate) struct Declared {
    /// Off for every parser but oxc's, and once the answer is "maybe".
    is_on: bool,
    is_javascript: bool,
    /// By the low bits of the number of a name. Two names that share a place count as one, which can only turn a "no" into a
    /// "maybe". It is never cleared: an entry of another file has the id of a scope that is not open.
    table: Vec<Entry>,
    mask: u32,
    /// The ids of the open scopes, the outermost first.
    open: Vec<u32>,
    /// The id that was given out last. None is given out twice, from file to file.
    last: u32,
    /// The innermost open scope.
    now: u32,
    /// The innermost open scope that a `var` declares in: a function, a static block, a namespace, the file.
    holds_vars: u32,
    /// The entries of open scopes that a scope in them has replaced, with their places in `table`.
    replaced: Vec<(u32, Entry)>,
    /// What the open blocks of `holds_vars` have declared with `var`: the place in `table`, and the flag. oxc notes such a name
    /// in every scope up to the function. In sloppy JavaScript a function in a block is such a name too.
    hoisted: Vec<(u32, u16)>,
    /// The parameters of the function whose block comes next.
    pub(crate) parameters: (Span<TypeParamId>, Span<ParamId>),
}

impl Declared {
    pub(crate) fn begin(&mut self, text_len: usize, is_on: bool, is_javascript: bool) {
        (self.is_on, self.is_javascript) = (is_on, is_javascript);
        if !is_on {
            return;
        }
        // A file that has its own atoms numbers them from 0. Beyond a million names some share a place.
        let places = (KNOWN_TEXTS.len() + text_len / 4)
            .next_power_of_two()
            .min(1 << 20);
        if self.table.len() < places {
            self.table.resize(places, Entry::default());
        }
        self.mask = places as u32 - 1;
        if self.last > u32::MAX / 2 {
            self.table.fill(Entry::default());
            self.last = 0;
        }
        self.open.clear();
        self.replaced.clear();
        self.hoisted.clear();
        self.parameters = Default::default();
        self.last += 1;
        (self.now, self.holds_vars) = (self.last, self.last);
        self.open.push(self.last);
    }

    #[inline(always)]
    fn is_open(&self, entry: Entry) -> bool {
        self.open.get(entry.depth as usize) == Some(&entry.scope)
    }

    /// Returns whether the name may be declared already by what the declaration can't stand beside.
    #[inline(always)]
    fn declare(&mut self, name: Atom, kind: Declares) -> bool {
        let (flags, in_typescript, in_javascript) = RULES[kind as usize];
        let excludes = match self.is_javascript {
            true => in_javascript,
            false => in_typescript,
        };
        let place = name.0 & self.mask;
        let is_hoisted = self.now != self.holds_vars
            && (kind == Declares::Var || kind == Declares::Function && self.is_javascript);
        let Some(&old) = self.table.get(place as usize) else {
            return false;
        };
        if is_hoisted || self.is_open(old) {
            return self.declare_beside(place, old, (flags, excludes), is_hoisted);
        }
        self.put(place, flags);
        false
    }

    #[inline(always)]
    fn put(&mut self, place: u32, flags: u16) {
        if let Some(entry) = self.table.get_mut(place as usize) {
            *entry = Entry {
                scope: self.now,
                depth: self.open.len() as u32 - 1,
                flags,
            };
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
            self.hoisted.push((place, flags));
        }
        if !self.is_open(old) {
            self.put(place, flags);
            return false;
        }
        if old.scope == self.now {
            self.put(place, old.flags | flags);
            return old.flags & excludes != 0;
        }
        self.replaced.push((place, old));
        self.put(place, flags);
        // oxc asks each scope up to the function, and stops at the first that has the name.
        is_hoisted && old.scope >= self.holds_vars && old.flags & excludes != 0
    }

    #[inline(always)]
    fn open_scope(&mut self, holds_vars: bool) -> Outer {
        let outer = Outer {
            replaced: self.replaced.len() as u32,
            hoisted: self.hoisted.len() as u32,
            holds_vars: self.holds_vars,
        };
        if self.is_on {
            self.last += 1;
            self.now = self.last;
            self.open.push(self.last);
            if holds_vars {
                self.holds_vars = self.last;
            }
        }
        outer
    }

    #[inline(always)]
    fn close_scope(&mut self, outer: Outer) {
        if !self.is_on {
            return;
        }
        if self.replaced.len() + self.hoisted.len() != (outer.replaced + outer.hoisted) as usize {
            return self.close_scope_with_lists(outer);
        }
        self.leave(outer);
    }

    #[inline(always)]
    fn leave(&mut self, outer: Outer) {
        self.open.pop();
        self.now = self.open.last().copied().unwrap_or_default();
        self.holds_vars = outer.holds_vars;
    }

    fn give_back(&mut self, from: u32) {
        while self.replaced.len() > from as usize
            && let Some((place, entry)) = self.replaced.pop()
        {
            if let Some(slot) = self.table.get_mut(place as usize) {
                *slot = entry;
            }
        }
    }

    #[inline(never)]
    fn close_scope_with_lists(&mut self, outer: Outer) {
        let held_vars = self.holds_vars == self.now;
        self.give_back(outer.replaced);
        self.leave(outer);
        // What a block has hoisted is now declared by the scope around it.
        for index in outer.hoisted as usize..self.hoisted.len() {
            let (place, flags) = self.hoisted[index];
            let Some(&old) = self.table.get(place as usize).filter(|_| !held_vars) else {
                break;
            };
            match self.is_open(old) {
                true if old.scope == self.now => self.put(place, old.flags | flags),
                true => {
                    self.replaced.push((place, old));
                    self.put(place, flags);
                }
                false => self.put(place, flags),
            }
        }
        if held_vars || self.now == self.holds_vars {
            self.hoisted.truncate(outer.hoisted as usize);
        }
    }

    pub(crate) fn mark(&self) -> Mark {
        Mark {
            open: self.open.len() as u32,
            outer: Outer {
                replaced: self.replaced.len() as u32,
                hoisted: self.hoisted.len() as u32,
                holds_vars: self.holds_vars,
            },
        }
    }

    pub(crate) fn rollback(&mut self, to: Mark) {
        if !self.is_on {
            return;
        }
        self.give_back(to.outer.replaced);
        self.hoisted.truncate(to.outer.hoisted as usize);
        self.open.truncate(to.open as usize);
        self.now = self.open.last().copied().unwrap_or_default();
        self.holds_vars = to.outer.holds_vars;
    }

    /// Whether the file itself declares `name`. Only at the end of the file.
    fn is_declared_at_top(&self, name: Atom) -> bool {
        let entry = self.table.get((name.0 & self.mask) as usize);
        entry.is_some_and(|it| Some(&it.scope) == self.open.first())
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
        if self.declared.is_on && self.declared.declare(name, kind) {
            self.may_redeclare();
        }
    }

    /// The same for the names that `pat` binds.
    #[inline(always)]
    pub(crate) fn declare_pattern(&mut self, pat: PatId, kind: Declares) {
        if !self.declared.is_on {
            return;
        }
        match self.f.pats.get(pat.idx()).map(|it| it.kind) {
            Some(PatKind::Ident(name)) => self.declare(name, kind),
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
                }) => self.declare(name, kind),
                _ => {}
            }
        }
    }

    /// A block, the head and body of a `for`, the cases of a `switch`, a `catch` clause, the members of an enum.
    #[inline(always)]
    pub(crate) fn open_scope(&mut self) -> Outer {
        self.declared.open_scope(false)
    }

    /// The body of a namespace.
    #[inline(always)]
    pub(crate) fn open_scope_for_vars(&mut self) -> Outer {
        self.declared.open_scope(true)
    }

    /// The block of a function or a static block. A function without one has nothing that its parameters could clash with.
    #[inline(always)]
    pub(crate) fn open_function(&mut self) -> Outer {
        let outer = self.declared.open_scope(true);
        let (type_parameters, parameters) = std::mem::take(&mut self.declared.parameters);
        if self.declared.is_on {
            for index in type_parameters.range() {
                if let Some(name) = self.f.type_params.get(index).map(|it| it.name) {
                    self.declare(name, Declares::TypeParameter);
                }
            }
            for index in parameters.range() {
                if let Some(pat) = self.f.params.get(index).map(|it| it.pat) {
                    self.declare_pattern(pat, Declares::Parameter);
                }
            }
        }
        outer
    }

    #[inline(always)]
    pub(crate) fn close_scope(&mut self, outer: Outer) {
        self.declared.close_scope(outer);
    }

    /// At the end of a JavaScript file: `rare::ODD_EXPORT`.
    pub(crate) fn note_odd_exports(&mut self) {
        if !self.options.dialect.oxc || !self.options.is_javascript || !self.f.has_module_syntax {
            return;
        }
        // Nothing is known once the answer about redeclarations is "maybe".
        if !self.declared.is_on {
            self.f.rare_syntax |= rare::ODD_EXPORT;
            return;
        }
        let (f, declared) = (&self.f, &mut self.declared);
        let is_undeclared = f.exports.iter().any(|it| {
            let items = f.export_specs.get(it.items.range()).unwrap_or_default();
            !it.has_module_specifier
                && !items.iter().all(|it| declared.is_declared_at_top(it.local))
        });
        // The exported names are declared in a scope of their own, which finds the one that is there twice.
        declared.open_scope(false);
        let mut export =
            |name: Atom| name.is_some() && declared.declare(name, Declares::EnumMember);
        let name_or_default = |flags: Flags, name: Atom| match flags.contains(Flags::DEFAULT) {
            true => known::default,
            false => name,
        };
        let is_twice = f.ids(f.body).any(|id| match f[id].kind {
            StmtKind::ExportDefault(_) => export(known::default),
            StmtKind::ExportStar { alias, .. } => export(alias),
            StmtKind::ExportNamed(it) => {
                let items = f.export_specs.get(f[it].items.range()).unwrap_or_default();
                items.iter().any(|it| export(it.exported))
            }
            StmtKind::Fn(it) if f[it].flags.contains(Flags::EXPORT) => {
                export(name_or_default(f[it].flags, f[it].name))
            }
            StmtKind::Class(it) if f[it].flags.contains(Flags::EXPORT) => {
                export(name_or_default(f[it].flags, f[it].name))
            }
            StmtKind::Var(list) => {
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
        if is_undeclared || is_twice {
            self.f.rare_syntax |= rare::ODD_EXPORT;
        }
    }
}
