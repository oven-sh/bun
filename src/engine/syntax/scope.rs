//! Finds the binding of each name while the parser goes along.
//!
//! References and declarations are kept on stacks, and the entries for one name are chained from the innermost
//! outwards. What a scope does with a name adds up in one reference, which the scope that declares the name takes
//! when it closes. The others become captures when the function ends, and wait for a scope around it.

use crate::ast::{
    Ast, Binding, BindingFlags, BindingKind, FunctionId, List, Scope, ScopeFlags, ScopeId,
    ScopeKind,
};
use crate::cache::{Captured, Found, Outline, Summary, Traits};
use crate::names::Name;
use crate::options::{FunctionFlags, FunctionKind};

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq, Default)]
    struct Access: u8 {
        const WRITTEN = 1 << 0;
        const REWRITTEN = 1 << 1;
        /// A scope has taken the reference.
        const RESOLVED = 1 << 2;
    }
}

/// An index plus one, or zero.
type Link = u32;

#[derive(Clone, Copy)]
struct Reference {
    name: Name,
    access: Access,
    first: u32,
    /// An assignment that is read twice counts once.
    written_at: u32,
    /// The most loops that an assignment is in, or `u16::MAX` if that is too many.
    loop_depth: u16,
    outer: Link,
}

impl Reference {
    #[inline(always)]
    fn add(&mut self, other: &Reference) {
        if other.access.contains(Access::WRITTEN) {
            if self.access.contains(Access::WRITTEN) && self.written_at != other.written_at {
                self.access |= Access::REWRITTEN;
            }
            self.written_at = other.written_at;
        }
        self.access |= other.access;
        self.first = self.first.min(other.first);
        self.loop_depth = self.loop_depth.max(other.loop_depth);
    }

    #[inline(always)]
    fn apply_to(&self, binding: &mut Binding, frame: &Frame) {
        binding.flags |= BindingFlags::USED;
        if self.access.contains(Access::WRITTEN) {
            binding.flags |= BindingFlags::WRITTEN;
            if self.access.contains(Access::REWRITTEN)
                || u32::from(self.loop_depth) > frame.loop_depth.min(u32::from(u16::MAX) - 1)
            {
                binding.flags |= BindingFlags::REWRITTEN;
            }
        }
        if self.first < binding.initialized_from || binding.initialized_until != u32::MAX {
            binding.flags |= BindingFlags::USED_EARLY;
        }
    }
}

/// What a closure, `eval` or the body of `with` refers to.
#[derive(Clone, Copy)]
struct Capture {
    /// None once a scope has taken it.
    name: Option<Name>,
    is_written: bool,
    outer: Link,
}

fn note_captured(binding: &mut Binding, is_written: bool) {
    binding.flags |= BindingFlags::USED | BindingFlags::CAPTURED;
    if is_written {
        binding.flags |= BindingFlags::WRITTEN | BindingFlags::REWRITTEN;
    }
}

#[derive(Clone, Copy)]
struct Declaration {
    binding: Binding,
    /// Of a variable, where the last `var` for it is. Of a lexical binding, the link to the innermost of its name that
    /// is in the way of a `var`.
    detail: u32,
    outer: Link,
}

#[derive(Clone, Copy, Default)]
struct Heads {
    reference: Link,
    capture: Link,
    lexical: Link,
    variable: Link,
}

#[derive(Clone, Copy, Default)]
struct RareHeads {
    label: Link,
    candidate: Link,
}

struct Label {
    name: Name,
    is_loop: bool,
    outer: Link,
}

/// A function in a block that may get a variable too.
#[derive(Clone, Copy)]
struct Candidate {
    /// None where no tree is built.
    function: Option<FunctionId>,
    name: Name,
    /// How many scopes are open where it is declared. Zero if a binding of a block around is in the way.
    depth: u32,
    outer: Link,
}

#[derive(Clone, Copy)]
struct Frame {
    kind: ScopeKind,
    flags: ScopeFlags,
    /// Of a scope of kind `Function`, unless it is the top level of `eval` code.
    function: Option<FunctionKind>,
    is_catch_block: bool,
    start: u32,
    loop_depth: u32,
    references: u32,
    captures: u32,
    lexicals: u32,
    variables: u32,
    functions: u32,
    candidates: u32,
    closures: u32,
    suspensions: u32,
    saved: u64,
    /// The index of the frame that `var` declares in.
    variable_frame: u32,
    outer_floors: Floors,
    outer_inheritance: u32,
}

/// From which index on a new entry joins an earlier one for the same name.
#[derive(Clone, Copy, Default)]
struct Floors {
    references: u32,
    captures: u32,
}

/// What a parse does with the outline.
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Recall {
    #[default]
    Nothing,
    /// Adds the code at hand.
    Records,
    /// Skips what it has, and takes its word for what that captures.
    Replays,
}

/// What to go back to when a guess about the syntax was wrong.
#[derive(Clone, Copy)]
pub(crate) struct Mark {
    frames: u32,
    references: u32,
    captures: u32,
    floors: Floors,
    inheritance: u32,
    outline: u32,
    loop_depth: u32,
    closures: u32,
    suspensions: u32,
    saved: u64,
    /// Of the innermost scope, and of the one that `var` declares in.
    flags: [ScopeFlags; 2],
}

/// See [`Scopes::begin_tentative`].
#[derive(Clone, Copy)]
pub(crate) struct Tentative {
    outer_floors: Floors,
    references: u32,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum PrivateDeclaration {
    Valid,
    Duplicate,
    /// One accessor of a pair is static and the other is not.
    StaticMismatch,
}

/// What is known of a function once it has been parsed.
#[derive(Clone, Copy)]
pub(crate) struct Closed {
    pub(crate) scope: Option<ScopeId>,
    pub(crate) contains_eval: bool,
    pub(crate) has_closures: bool,
    /// An arrow function or a direct `eval` inside needs the home object.
    pub(crate) captures_home: bool,
}

#[derive(Default)]
pub(crate) struct Scopes {
    frames: Vec<Frame>,
    heads: Vec<Heads>,
    rare_heads: Vec<RareHeads>,
    references: Vec<Reference>,
    captures: Vec<Capture>,
    lexicals: Vec<Declaration>,
    variables: Vec<Declaration>,
    functions: Vec<FunctionId>,
    candidates: Vec<Candidate>,
    labels: Vec<Label>,
    floors: Floors,
    /// The most captures that a function inside the innermost one has left behind.
    inheritance: u32,
    loop_depth: u32,
    /// How many have been seen.
    closures: u32,
    /// The same, but for those of the functions that have ended.
    suspensions: u32,
    /// How many bindings the suspensions of the innermost function would save.
    saved: u64,
    capture_everything: bool,
    pub(crate) outline: Outline,
    pub(crate) recall: Recall,
}

impl Scopes {
    pub(crate) fn reset(&mut self, capture_everything: bool) {
        self.drop_references(0);
        self.drop_captures(0);
        self.drop_lexicals(0);
        self.drop_variables(0);
        self.drop_labels(0);
        self.drop_candidates(0);
        self.frames.clear();
        self.functions.clear();
        self.heads(Name::IMPORT_META);
        self.floors = Floors::default();
        self.inheritance = 0;
        self.recall = Recall::Nothing;
        self.loop_depth = 0;
        self.suspensions = 0;
        self.saved = 0;
        self.capture_everything = capture_everything;
    }

    #[inline(always)]
    fn heads(&mut self, name: Name) -> &mut Heads {
        if name.index() < self.heads.len() {
            &mut self.heads[name.index()]
        } else {
            self.grown_heads(name)
        }
    }

    #[cold]
    #[inline(never)]
    fn grown_heads(&mut self, name: Name) -> &mut Heads {
        self.heads.resize(name.index() * 2 + 64, Heads::default());
        &mut self.heads[name.index()]
    }

    fn rare_heads(&mut self, name: Name) -> &mut RareHeads {
        if name.index() >= self.rare_heads.len() {
            (self.rare_heads).resize(name.index() * 2 + 64, RareHeads::default());
        }
        &mut self.rare_heads[name.index()]
    }

    #[inline(always)]
    fn frame(&self) -> &Frame {
        &self.frames[self.frames.len() - 1]
    }

    #[inline(always)]
    fn frame_mut(&mut self) -> &mut Frame {
        let last = self.frames.len() - 1;
        &mut self.frames[last]
    }

    #[inline]
    pub(crate) fn kind(&self) -> ScopeKind {
        self.frame().kind
    }

    /// How many scopes are open.
    pub(crate) fn depth(&self) -> usize {
        self.frames.len()
    }

    /// Whether the innermost scope is the one that `var` declares in.
    #[inline]
    pub(crate) fn is_at_top_level(&self) -> bool {
        self.frame().variable_frame as usize == self.frames.len() - 1
    }

    #[inline(always)]
    fn push_frame(&mut self, kind: ScopeKind, function: Option<FunctionKind>, start: u32) {
        let variable_frame = match kind {
            ScopeKind::Script
            | ScopeKind::Module
            | ScopeKind::Function
            | ScopeKind::FunctionBody => self.frames.len() as u32,
            _ => self.frame().variable_frame,
        };
        let (references, captures) = (self.references.len() as u32, self.captures.len() as u32);
        self.frames.push(Frame {
            kind,
            flags: ScopeFlags::empty(),
            function,
            is_catch_block: false,
            start,
            loop_depth: self.loop_depth,
            references,
            captures,
            lexicals: self.lexicals.len() as u32,
            variables: self.variables.len() as u32,
            functions: self.functions.len() as u32,
            candidates: self.candidates.len() as u32,
            closures: self.closures,
            suspensions: self.suspensions,
            saved: self.saved,
            variable_frame,
            outer_floors: self.floors,
            outer_inheritance: self.inheritance,
        });
        self.floors = Floors {
            references,
            captures,
        };
    }

    #[inline(always)]
    pub(crate) fn push(&mut self, kind: ScopeKind, start: u32) {
        self.push_frame(kind, None, start);
    }

    #[inline(always)]
    pub(crate) fn push_function(&mut self, kind: FunctionKind, start: u32) {
        self.push_frame(ScopeKind::Function, Some(kind), start);
        self.inheritance = 0;
        // Each function has its own budget, so that it is read the same on its own as in its outer one.
        self.saved = 0;
    }

    /// The block after `catch (..)`, which may not declare the parameters again.
    pub(crate) fn push_catch_block(&mut self, start: u32) {
        self.push(ScopeKind::Block, start);
        self.frame_mut().is_catch_block = true;
    }

    #[inline(always)]
    pub(crate) fn enter_loop(&mut self) {
        self.loop_depth += 1;
    }

    #[inline(always)]
    pub(crate) fn leave_loop(&mut self) {
        self.loop_depth -= 1;
    }

    // References

    /// `join` adds it to an earlier one.
    #[inline(always)]
    fn refer(&mut self, mut reference: Reference, join: impl Fn(&mut Reference, &Reference)) {
        let (floor, next) = (self.floors.references, self.references.len() as u32 + 1);
        let heads = self.heads(reference.name);
        reference.outer = heads.reference;
        if reference.outer > floor {
            let index = reference.outer as usize - 1;
            join(&mut self.references[index], &reference);
        } else {
            heads.reference = next;
            self.references.push(reference);
        }
    }

    #[inline(always)]
    pub(crate) fn read(&mut self, name: Name, position: u32) {
        let reference = Reference {
            name,
            access: Access::empty(),
            first: position,
            written_at: 0,
            loop_depth: 0,
            outer: 0,
        };
        self.refer(reference, |earlier, reference| {
            earlier.first = earlier.first.min(reference.first);
        });
    }

    #[inline]
    pub(crate) fn write(&mut self, name: Name, position: u32) {
        let reference = Reference {
            name,
            access: Access::WRITTEN,
            first: position,
            written_at: position,
            loop_depth: self.loop_depth.try_into().unwrap_or(u16::MAX),
            outer: 0,
        };
        self.refer(reference, Reference::add);
    }

    /// For the target of a loop that enumerates.
    pub(crate) fn rewrite(&mut self, name: Name, position: u32) {
        self.enter_loop();
        self.write(name, position);
        self.leave_loop();
    }

    #[inline(always)]
    pub(crate) fn capture(&mut self, name: Name, is_written: bool) {
        let (floor, next) = (self.floors.captures, self.captures.len() as u32 + 1);
        let heads = self.heads(name);
        let outer = heads.capture;
        if outer > floor {
            self.captures[outer as usize - 1].is_written |= is_written;
        } else {
            heads.capture = next;
            self.captures.push(Capture {
                name: Some(name),
                is_written,
                outer,
            });
        }
    }

    pub(crate) fn note_direct_eval(&mut self, is_strict: bool) {
        self.note_contains_eval();
        if !is_strict {
            let variable_frame = self.frame().variable_frame as usize;
            self.frames[variable_frame].flags |= ScopeFlags::EXTENSIBLE;
        }
        self.capture_context();
    }

    /// What code that is evaluated here later on may ask for without a declaration.
    pub(crate) fn capture_context(&mut self) {
        self.capture(Name::THIS_VALUE, true);
        for name in [
            Name::NEW_TARGET,
            Name::HOME,
            Name::ACTIVE_FUNCTION,
            Name::FIELD_INITIALIZER,
            Name::ARGUMENTS,
        ] {
            self.capture(name, false);
        }
    }

    fn note_contains_eval(&mut self) {
        self.frame_mut().flags |= ScopeFlags::CONTAINS_EVAL;
    }

    /// For an inner function that is not parsed again.
    #[inline]
    pub(crate) fn note_closure(&mut self, contains_eval: bool) {
        self.closures = self.closures.wrapping_add(1);
        if contains_eval {
            self.note_contains_eval();
        }
    }

    pub(crate) fn note_suspension(&mut self) {
        self.suspensions += 1;
    }

    #[inline(always)]
    pub(crate) fn closure_count(&self) -> u32 {
        self.closures
    }

    /// Whether a closure has been seen in the innermost scope.
    pub(crate) fn has_closures(&self) -> bool {
        self.contains_eval() || self.closures != self.frame().closures
    }

    pub(crate) fn contains_eval(&self) -> bool {
        self.frame().flags.contains(ScopeFlags::CONTAINS_EVAL)
    }

    /// What no scope has taken.
    pub(crate) fn free_names(&self) -> impl Iterator<Item = Name> {
        let references =
            (self.references.iter()).filter(|it| !it.access.contains(Access::RESOLVED));
        (references.map(|it| it.name)).chain(self.captures.iter().filter_map(|it| it.name))
    }

    /// Keeps what follows apart, so that all trace of it can be dropped.
    #[inline(always)]
    pub(crate) fn begin_tentative(&mut self) -> Tentative {
        let floors = Floors {
            references: self.references.len() as u32,
            captures: self.captures.len() as u32,
        };
        Tentative {
            outer_floors: core::mem::replace(&mut self.floors, floors),
            references: floors.references,
        }
    }

    #[inline(always)]
    pub(crate) fn commit_tentative(&mut self, tentative: Tentative) {
        self.floors = tentative.outer_floors;
    }

    /// The code has turned out to run many times.
    pub(crate) fn commit_tentative_as_repeated(&mut self, tentative: Tentative) {
        self.floors = tentative.outer_floors;
        for reference in &mut self.references[tentative.references as usize..] {
            if reference.access.contains(Access::WRITTEN) {
                reference.access |= Access::REWRITTEN;
            }
        }
    }

    fn drop_references(&mut self, start: u32) {
        for reference in self.references[start as usize..].iter().rev() {
            if !reference.access.contains(Access::RESOLVED) {
                self.heads[reference.name.index()].reference = reference.outer;
            }
        }
        self.references.truncate(start as usize);
    }

    fn drop_captures(&mut self, start: u32) {
        for capture in self.captures[start as usize..].iter().rev() {
            if let Some(name) = capture.name {
                self.heads[name.index()].capture = capture.outer;
            }
        }
        self.captures.truncate(start as usize);
    }

    /// Those from `start` on that no scope has taken.
    #[inline(always)]
    fn capture_references(&mut self, start: u32) {
        for index in start as usize..self.references.len() {
            let reference = self.references[index];
            if reference.access.contains(Access::RESOLVED) {
                continue;
            }
            if reference.outer <= start {
                self.heads[reference.name.index()].reference = reference.outer;
            }
            self.capture(reference.name, reference.access.contains(Access::WRITTEN));
        }
        self.references.truncate(start as usize);
    }

    /// Leaves one for each name of those from `start` on, or none if there is one above the floor.
    #[inline(never)]
    fn merge_captures(&mut self, start: u32) {
        /// Many that only pass through are not gone over at each level.
        const FEW: u32 = 64;
        let count = self.captures.len() as u32 - start;
        if count > FEW && count / 2 < self.inheritance {
            return;
        }
        let mut kept = start as usize;
        for index in start as usize..self.captures.len() {
            let capture = self.captures[index];
            let Some(name) = capture.name else {
                continue;
            };
            let head = &mut self.heads[name.index()].capture;
            if capture.outer <= start {
                *head = capture.outer;
            }
            if *head > self.floors.captures {
                self.captures[*head as usize - 1].is_written |= capture.is_written;
            } else {
                self.captures[kept] = capture;
                kept += 1;
                *head = kept as Link;
            }
        }
        self.captures.truncate(kept);
    }

    #[inline(always)]
    pub(crate) fn mark(&self) -> Mark {
        let frame = self.frame();
        Mark {
            closures: self.closures,
            suspensions: self.suspensions,
            saved: self.saved,
            flags: [
                frame.flags,
                self.frames[frame.variable_frame as usize].flags,
            ],
            frames: self.frames.len() as u32,
            references: self.references.len() as u32,
            captures: self.captures.len() as u32,
            floors: self.floors,
            inheritance: self.inheritance,
            outline: self.outline.len(),
            loop_depth: self.loop_depth,
        }
    }

    /// What has gone into the outline.
    pub(crate) fn forget_since(&mut self, mark: Mark) {
        self.outline.truncate(mark.outline);
    }

    pub(crate) fn rewind(&mut self, mark: Mark) {
        if let Some(&frame) = self.frames.get(mark.frames as usize) {
            self.drop_lexicals(frame.lexicals);
            self.drop_variables(frame.variables);
            self.functions.truncate(frame.functions as usize);
            self.drop_candidates(frame.candidates);
            self.frames.truncate(mark.frames as usize);
        }
        self.drop_references(mark.references);
        self.drop_captures(mark.captures);
        self.forget_since(mark);
        self.floors = mark.floors;
        self.inheritance = mark.inheritance;
        self.loop_depth = mark.loop_depth;
        self.closures = mark.closures;
        self.suspensions = mark.suspensions;
        self.saved = mark.saved;
        let variable_frame = self.frame().variable_frame as usize;
        [self.frame_mut().flags, self.frames[variable_frame].flags] = mark.flags;
    }

    // Declarations

    fn declaration(name: Name, kind: BindingKind, detail: u32, outer: Link) -> Declaration {
        Declaration {
            binding: Binding {
                name,
                kind,
                flags: BindingFlags::empty(),
                initialized_from: 0,
                initialized_until: u32::MAX,
            },
            detail,
            outer,
        }
    }

    #[inline(always)]
    fn add_lexical(&mut self, name: Name, kind: BindingKind) -> &mut Binding {
        let next = self.lexicals.len() as Link + 1;
        let outer = core::mem::replace(&mut self.heads(name).lexical, next);
        let obstacle = match outer {
            _ if self.kind() != ScopeKind::SimpleCatch => next,
            0 => 0,
            _ => self.lexicals[outer as usize - 1].detail,
        };
        (self.lexicals).push(Self::declaration(name, kind, obstacle, outer));
        &mut self.lexicals[next as usize - 1].binding
    }

    #[inline(always)]
    fn add_variable(&mut self, name: Name, kind: BindingKind, position: u32) -> &mut Binding {
        let next = self.variables.len() as Link + 1;
        let outer = core::mem::replace(&mut self.heads(name).variable, next);
        self.variables
            .push(Self::declaration(name, kind, position, outer));
        &mut self.variables[next as usize - 1].binding
    }

    /// In the innermost scope.
    #[inline(always)]
    fn own_lexical(&mut self, name: Name) -> Option<&mut Binding> {
        let link = self.heads(name).lexical;
        (link > self.frame().lexicals).then(|| &mut self.lexicals[link as usize - 1].binding)
    }

    /// In the scope that `var` declares in.
    #[inline(always)]
    fn own_variable(&mut self, name: Name) -> Option<&mut Declaration> {
        let link = self.heads(name).variable;
        let start = self.frames[self.frame().variable_frame as usize].variables;
        (link > start).then(|| &mut self.variables[link as usize - 1])
    }

    fn is_parameter(&mut self, name: Name) -> bool {
        let mut frame = self.frame().variable_frame as usize;
        if self.frames[frame].kind == ScopeKind::FunctionBody {
            frame -= 1;
        }
        let mut link = self.heads(name).variable;
        while link > self.frames[frame].variables {
            let declaration = &self.variables[link as usize - 1];
            if declaration.binding.kind == BindingKind::Parameter {
                return true;
            }
            link = declaration.outer;
        }
        false
    }

    fn declare_in_variable_scope(&mut self, name: Name, position: u32) -> &mut Binding {
        if self.own_variable(name).is_none() {
            return self.add_variable(name, BindingKind::Var, position);
        }
        let link = self.heads[name.index()].variable;
        let declaration = &mut self.variables[link as usize - 1];
        declaration.detail = position;
        if declaration.binding.kind == BindingKind::Callee {
            declaration.binding.kind = BindingKind::Var;
        }
        &mut declaration.binding
    }

    /// False if a lexical binding is in the way.
    pub(crate) fn declare_variable(&mut self, name: Name, position: u32) -> bool {
        let floor = self.frames[self.frame().variable_frame as usize].lexicals;
        let link = self.heads(name).lexical;
        if link > floor && self.lexicals[link as usize - 1].detail > floor {
            return false;
        }
        self.declare_in_variable_scope(name, position);
        true
    }

    /// Whether a lexical declaration here clashes with a `var` or with a parameter of the function or of `catch`.
    fn clashes_with_outer_declaration(&mut self, name: Name) -> bool {
        let frame = *self.frame();
        if frame.is_catch_block {
            let mut link = self.heads(name).lexical;
            if link > frame.lexicals {
                link = self.lexicals[link as usize - 1].outer;
            }
            if link > self.frames[self.frames.len() - 2].lexicals {
                return true;
            }
        }
        if self.is_at_top_level() {
            return self.is_parameter(name)
                || self
                    .own_variable(name)
                    .is_some_and(|variable| variable.binding.kind == BindingKind::Var);
        }
        self.own_variable(name)
            .is_some_and(|variable| variable.detail >= frame.start)
    }

    /// False if the name is taken. It counts as not initialized until [`Scopes::initialize_lexicals`].
    pub(crate) fn declare_lexical(&mut self, name: Name, kind: BindingKind) -> bool {
        if self.clashes_with_outer_declaration(name) || self.own_lexical(name).is_some() {
            return false;
        }
        self.add_lexical(name, kind).initialized_from = u32::MAX;
        match kind {
            BindingKind::Using => self.frame_mut().flags |= ScopeFlags::HAS_USING,
            BindingKind::AwaitUsing => {
                self.frame_mut().flags |= ScopeFlags::HAS_USING | ScopeFlags::HAS_AWAIT_USING;
            }
            _ => {}
        }
        true
    }

    /// False if the name is taken.
    pub(crate) fn declare_function(&mut self, name: Name, is_plain: bool, is_strict: bool) -> bool {
        if self.is_at_top_level() && self.kind() != ScopeKind::Module {
            self.declare_in_variable_scope(name, 0).flags |= BindingFlags::FUNCTION;
            return self.own_lexical(name).is_none();
        }
        if self.clashes_with_outer_declaration(name) {
            return false;
        }
        if let Some(earlier) = self.own_lexical(name) {
            return !is_strict && is_plain && earlier.flags.contains(BindingFlags::PLAIN_FUNCTION);
        }
        self.add_lexical(name, BindingKind::LexicalFunction)
            .flags
            .set(BindingFlags::PLAIN_FUNCTION, is_plain);
        true
    }

    /// What [`Scopes::declare_function`] has just declared may get a variable too (ECMA-262 B.3.2.1).
    pub(crate) fn note_hoistable(&mut self, name: Name) {
        if !self.is_at_top_level() {
            let next = self.candidates.len() as Link + 1;
            let outer = core::mem::replace(&mut self.rare_heads(name).candidate, next);
            self.candidates.push(Candidate {
                function: None,
                name,
                depth: self.frames.len() as u32,
                outer,
            });
        }
    }

    /// The node of what [`Scopes::declare_function`] has just declared.
    pub(crate) fn add_function(&mut self, function: FunctionId) {
        self.functions.push(function);
        let first = self.frame().candidates as usize;
        if let Some(candidate) = self.candidates[first..].last_mut() {
            candidate.function.get_or_insert(function);
        }
    }

    /// False if there is one of that name already.
    pub(crate) fn declare_parameter(&mut self, name: Name) -> bool {
        let is_new = self.own_variable(name).is_none();
        if is_new {
            self.add_variable(name, BindingKind::Parameter, 0);
        }
        is_new
    }

    /// After the parameters, which hide it, as the `arguments` object does.
    pub(crate) fn declare_callee(&mut self, name: Name) {
        if name != Name::ARGUMENTS && self.own_variable(name).is_none() {
            self.add_variable(name, BindingKind::Callee, 0);
        }
    }

    /// A name of the engine in the scope of a class.
    pub(crate) fn declare_class_internal(&mut self, name: Name) {
        self.add_lexical(name, BindingKind::Internal).flags =
            BindingFlags::USED | BindingFlags::CAPTURED;
    }

    /// `accessor` is `HAS_GETTER` or `HAS_SETTER` for a `PrivateAccessor`.
    pub(crate) fn declare_private(
        &mut self,
        name: Name,
        kind: BindingKind,
        is_static: bool,
        accessor: BindingFlags,
    ) -> PrivateDeclaration {
        let Some(earlier) = self.own_lexical(name) else {
            let binding = self.add_lexical(name, kind);
            binding.flags = BindingFlags::USED | BindingFlags::CAPTURED | accessor;
            binding.flags.set(BindingFlags::STATIC, is_static);
            return PrivateDeclaration::Valid;
        };
        if kind != BindingKind::PrivateAccessor
            || earlier.kind != kind
            || earlier.flags.contains(accessor)
        {
            PrivateDeclaration::Duplicate
        } else if earlier.flags.contains(BindingFlags::STATIC) != is_static {
            PrivateDeclaration::StaticMismatch
        } else {
            earlier.flags |= accessor;
            PrivateDeclaration::Valid
        }
    }

    #[inline(always)]
    pub(crate) fn lexical_count(&self) -> u32 {
        self.lexicals.len() as u32
    }

    #[inline(always)]
    pub(crate) fn variable_count(&self) -> u32 {
        self.variables.len() as u32
    }

    /// Those declared since there were `count` are initialized from `position` on.
    #[inline]
    pub(crate) fn initialize_lexicals(&mut self, count: u32, position: u32) {
        for declaration in &mut self.lexicals[count as usize..] {
            declaration.binding.initialized_from = position;
        }
    }

    pub(crate) fn initialize_parameters(&mut self, count: u32, position: u32) {
        for declaration in &mut self.variables[count as usize..] {
            declaration.binding.initialized_from = position;
        }
    }

    /// The last lexical declaration has no initializer.
    pub(crate) fn note_starts_undefined(&mut self) {
        if let Some(declaration) = self.lexicals.last_mut() {
            declaration.binding.flags |= BindingFlags::STARTS_UNDEFINED;
        }
    }

    /// A jump to a later clause of the `switch` passes by what has been declared since there were `count`.
    pub(crate) fn end_clause(&mut self, count: u32, position: u32) {
        for declaration in &mut self.lexicals[count as usize..] {
            if declaration.binding.kind != BindingKind::LexicalFunction {
                declaration.binding.initialized_until = position;
            }
        }
    }

    /// For `eval` code that has turned out to be strict.
    pub(crate) fn keep_variables_in_root(&mut self) {
        self.frame_mut().kind = ScopeKind::Function;
    }

    /// False if the top level of the module declares no such thing.
    pub(crate) fn export_binding(&mut self, name: Name) -> bool {
        let binding = match self.own_variable(name) {
            Some(variable) => &mut variable.binding,
            None => match self.own_lexical(name) {
                Some(lexical) => lexical,
                None => return false,
            },
        };
        binding.flags |= BindingFlags::EXPORTED | BindingFlags::USED | BindingFlags::CAPTURED;
        true
    }

    // Labels

    #[inline(always)]
    pub(crate) fn label_count(&self) -> u32 {
        self.labels.len() as u32
    }

    pub(crate) fn add_label(&mut self, name: Name) {
        let next = self.labels.len() as Link + 1;
        let outer = core::mem::replace(&mut self.rare_heads(name).label, next);
        self.labels.push(Label {
            name,
            is_loop: false,
            outer,
        });
    }

    /// Those added since there were `count` are labels of a loop.
    pub(crate) fn label_loop(&mut self, count: u32) {
        for label in &mut self.labels[count as usize..] {
            label.is_loop = true;
        }
    }

    pub(crate) fn label_at(&self, index: u32) -> Name {
        self.labels[index as usize].name
    }

    /// Among those added since there were `count`: whether it is that of a loop.
    pub(crate) fn find_label(&mut self, name: Name, count: u32) -> Option<bool> {
        let link = self.rare_heads(name).label;
        (link > count).then(|| self.labels[link as usize - 1].is_loop)
    }

    #[inline(always)]
    pub(crate) fn drop_labels(&mut self, count: u32) {
        while self.labels.len() > count as usize
            && let Some(label) = self.labels.pop()
        {
            self.rare_heads[label.name.index()].label = label.outer;
        }
    }

    // Closing scopes

    #[inline(always)]
    fn drop_lexicals(&mut self, start: u32) {
        for declaration in self.lexicals[start as usize..].iter().rev() {
            self.heads[declaration.binding.name.index()].lexical = declaration.outer;
        }
        self.lexicals.truncate(start as usize);
    }

    #[inline(always)]
    fn drop_variables(&mut self, start: u32) {
        for declaration in self.variables[start as usize..].iter().rev() {
            self.heads[declaration.binding.name.index()].variable = declaration.outer;
        }
        self.variables.truncate(start as usize);
    }

    #[inline(always)]
    fn drop_candidates(&mut self, start: u32) {
        for candidate in self.candidates.drain(start as usize..).rev() {
            if candidate.depth != 0 {
                self.rare_heads[candidate.name.index()].candidate = candidate.outer;
            }
        }
    }

    /// Closes the innermost scope, which `var` does not declare in. Without a tree there is no node for it; with
    /// one there is none if it declares nothing.
    #[inline(always)]
    pub(crate) fn pop<const BUILD: bool>(&mut self, ast: &mut Ast) -> Option<ScopeId> {
        let mut scope = None;
        if self.lexicals.len() > self.frame().lexicals as usize {
            scope = self.resolve_block::<BUILD>(ast);
        }
        self.pop_frame();
        scope
    }

    #[inline(always)]
    fn pop_frame(&mut self) -> Option<Frame> {
        let frame = self.frames.pop()?;
        self.floors = frame.outer_floors;
        self.frame_mut().flags |= frame.flags & ScopeFlags::CONTAINS_EVAL;
        Some(frame)
    }

    pub(crate) fn pop_with(&mut self) {
        if let Some(frame) = self.pop_frame() {
            self.capture_references(frame.references);
        }
    }

    pub(crate) fn pop_function_body<const BUILD: bool>(
        &mut self,
        ast: &mut Ast,
    ) -> Option<ScopeId> {
        let scope = self.close_function::<BUILD>(ast).scope;
        self.pop_frame();
        scope
    }

    #[inline(never)]
    fn resolve_block<const BUILD: bool>(&mut self, ast: &mut Ast) -> Option<ScopeId> {
        let frame = *self.frame();
        self.bind::<BUILD>(&frame, false);
        if self.recall == Recall::Records {
            self.remember_scope(&frame, Traits::empty());
        } else if BUILD {
            self.replay_scope(&frame, Traits::SCOPE);
        }
        if self.candidates.len() > frame.candidates as usize {
            self.obstruct_candidates(&frame);
        }
        let mut scope = None;
        if BUILD {
            scope = Some(self.record(&frame, false, ast));
            self.functions.truncate(frame.functions as usize);
        }
        self.drop_lexicals(frame.lexicals);
        scope
    }

    /// Takes what the innermost scope, which `var` declares in, binds from the references.
    #[inline(never)]
    pub(crate) fn close_function<const BUILD: bool>(&mut self, ast: &mut Ast) -> Closed {
        let mut frame = *self.frame();
        self.hoist_candidates(&frame, ast);
        self.bind::<BUILD>(&frame, true);
        if frame.kind == ScopeKind::FunctionBody {
            self.relate_body_to_parameters::<BUILD>(&mut frame);
        } else if BUILD {
            self.replay_scope(&frame, Traits::empty());
        }
        let captures_home = self.bind_implicitly::<BUILD>(&frame);
        let scope = BUILD.then(|| self.record(&frame, true, ast));
        self.drop_lexicals(frame.lexicals);
        self.drop_variables(frame.variables);
        self.functions.truncate(frame.functions as usize);
        self.drop_candidates(frame.candidates);
        Closed {
            scope,
            contains_eval: frame.flags.contains(ScopeFlags::CONTAINS_EVAL),
            has_closures: self.closures != frame.closures,
            captures_home,
        }
    }

    /// After [`Scopes::close_function`].
    #[inline(always)]
    pub(crate) fn leave_function(&mut self) {
        let Some(frame) = self.pop_frame() else {
            return;
        };
        self.closures = self.closures.wrapping_add(1);
        self.suspensions = frame.suspensions;
        self.saved = frame.saved;
        if self.captures.len() > frame.captures as usize {
            self.merge_captures(frame.captures);
        }
        self.capture_references(frame.references);
        let left_behind = self.captures.len() as u32 - frame.captures;
        self.inheritance = frame.outer_inheritance.max(left_behind);
    }

    /// The sum of those that have been made in the scope, from `link` outwards.
    #[inline(always)]
    fn take_references(
        link: &mut Link,
        references: &mut [Reference],
        frame: &Frame,
    ) -> Option<Reference> {
        let mut sum: Option<Reference> = None;
        while *link > frame.references {
            let reference = &mut references[*link as usize - 1];
            match &mut sum {
                Some(sum) => sum.add(reference),
                None => sum = Some(*reference),
            }
            reference.access |= Access::RESOLVED;
            *link = reference.outer;
        }
        sum
    }

    /// The same. Returns whether any writes.
    #[inline(always)]
    fn take_captures(link: &mut Link, captures: &mut [Capture], frame: &Frame) -> Option<bool> {
        let mut is_written = None;
        while *link > frame.captures {
            let capture = &mut captures[*link as usize - 1];
            *is_written.get_or_insert(false) |= capture.is_written;
            capture.name = None;
            *link = capture.outer;
        }
        is_written
    }

    #[inline(always)]
    fn bind<const BUILD: bool>(&mut self, frame: &Frame, declares_variables: bool) {
        let variables = if declares_variables {
            frame.variables as usize
        } else {
            self.variables.len()
        };
        let lexicals = &mut self.lexicals[frame.lexicals as usize..];
        let declarations = lexicals.iter_mut().chain(&mut self.variables[variables..]);
        for (index, Declaration { binding, .. }) in (0..).zip(declarations) {
            let heads = &mut self.heads[binding.name.index()];
            let reference =
                Self::take_references(&mut heads.reference, &mut self.references, frame);
            if BUILD && let Some(reference) = reference {
                reference.apply_to(binding, frame);
            }
            if let Some(is_written) =
                Self::take_captures(&mut heads.capture, &mut self.captures, frame)
            {
                if self.recall == Recall::Records && !binding.kind.is_private() {
                    self.outline.note(Captured::declared(index, is_written));
                }
                note_captured(binding, is_written);
            }
        }
    }

    /// What ends at this scope though nothing declares it. Returns whether the home object does.
    #[inline(always)]
    fn bind_implicitly<const BUILD: bool>(&mut self, frame: &Frame) -> bool {
        let names: &[Name] = match (frame.function, frame.kind) {
            (Some(FunctionKind::Arrow), _) | (_, ScopeKind::FunctionBody) => &[],
            (Some(_), _) if self.captures.len() == frame.captures as usize => &[Name::ARGUMENTS],
            (Some(_), _) => &[
                Name::ARGUMENTS,
                Name::THIS_VALUE,
                Name::NEW_TARGET,
                Name::HOME,
                Name::ACTIVE_FUNCTION,
                Name::FIELD_INITIALIZER,
            ],
            (None, ScopeKind::Module) => &[Name::IMPORT_META],
            (None, _) => &[Name::THIS_VALUE],
        };
        let mut captures_home = false;
        for &name in names {
            let heads = &mut self.heads[name.index()];
            let reference =
                Self::take_references(&mut heads.reference, &mut self.references, frame);
            let capture = Self::take_captures(&mut heads.capture, &mut self.captures, frame);
            if let Some(is_written) = capture {
                captures_home |= name == Name::HOME;
                if self.recall == Recall::Records {
                    self.outline.note(Captured::implicit(name, is_written));
                }
            }
            if BUILD
                && (reference.is_some() || capture.is_some())
                && let Some(kind) = Self::implicit_binding(frame.function, name)
            {
                let binding = self.add_variable(name, kind, 0);
                if let Some(reference) = reference {
                    reference.apply_to(binding, frame);
                }
                if let Some(is_written) = capture {
                    note_captured(binding, is_written);
                }
            }
        }
        captures_home
    }

    /// If there is anything to it.
    fn remember_scope(&mut self, frame: &Frame, traits: Traits) {
        if self.outline.has_notes() || !traits.is_empty() {
            let summary = Summary {
                traits: traits | Traits::SCOPE,
                ..Summary::default()
            };
            self.outline.add(frame.start, summary);
        }
    }

    /// Does to the bindings of the innermost scope what the functions would have that were skipped.
    #[inline]
    fn replay_scope(&mut self, frame: &Frame, part: Traits) -> Traits {
        if self.recall != Recall::Replays || self.closures == frame.closures {
            return Traits::empty();
        }
        let Some(found) = self.outline.find(frame.start, part) else {
            return Traits::empty();
        };
        self.replay(found);
        self.outline.summary(found).traits
    }

    pub(crate) fn replay(&mut self, found: Found) {
        let frame = *self.frame();
        for index in 0..self.outline.captured(found).len() {
            let captured = self.outline.captured(found)[index];
            let index = match captured.binding() {
                Ok(index) => index,
                Err(name) => {
                    self.capture(name, captured.is_written());
                    continue;
                }
            };
            let lexicals = &mut self.lexicals[frame.lexicals as usize..];
            let variables = &mut self.variables[frame.variables as usize..];
            let declaration = match index.checked_sub(lexicals.len()) {
                Some(index) => variables.get_mut(index),
                None => lexicals.get_mut(index),
            };
            if let Some(declaration) = declaration {
                note_captured(&mut declaration.binding, captured.is_written());
            }
        }
    }

    fn implicit_binding(function: Option<FunctionKind>, name: Name) -> Option<BindingKind> {
        let exists = match name {
            Name::ARGUMENTS => {
                let has_arguments = function != Some(FunctionKind::FieldInitializer);
                return has_arguments.then_some(BindingKind::Arguments);
            }
            Name::HOME => function.is_some_and(FunctionKind::has_home_object),
            Name::ACTIVE_FUNCTION | Name::FIELD_INITIALIZER => {
                function == Some(FunctionKind::DerivedConstructor)
            }
            _ => true,
        };
        exists.then_some(BindingKind::Internal)
    }

    /// Rules out those of the blocks inside that have the name of a binding of the innermost scope.
    #[cold]
    fn obstruct_candidates(&mut self, frame: &Frame) {
        if frame.kind == ScopeKind::SimpleCatch {
            return;
        }
        for index in frame.lexicals as usize..self.lexicals.len() {
            let name = self.lexicals[index].binding.name;
            let (mut link, mut last_kept) = (self.rare_heads(name).candidate, 0);
            while link > frame.candidates {
                let candidate = &mut self.candidates[link as usize - 1];
                let outer = candidate.outer;
                if candidate.depth as usize == self.frames.len() {
                    last_kept = link;
                } else {
                    candidate.depth = 0;
                    match last_kept {
                        0 => self.rare_heads(name).candidate = outer,
                        _ => self.candidates[last_kept as usize - 1].outer = outer,
                    }
                }
                link = outer;
            }
        }
    }

    /// ECMA-262 B.3.2.1 to B.3.2.3.
    fn hoist_candidates(&mut self, frame: &Frame, ast: &mut Ast) {
        for index in frame.candidates as usize..self.candidates.len() {
            let Candidate {
                function,
                name,
                depth,
                ..
            } = self.candidates[index];
            if depth == 0 || self.own_lexical(name).is_some() || self.is_parameter(name) {
                continue;
            }
            if let Some(function) = function {
                ast[function].flags |= FunctionFlags::HOISTED_AS_VARIABLE;
            }
            let is_new = self
                .own_variable(name)
                .is_none_or(|variable| variable.binding.kind == BindingKind::Callee);
            if is_new && name == Name::ARGUMENTS && self.has_own_arguments() {
                self.rewrite(name, u32::MAX - 1);
                continue;
            }
            let binding = self.declare_in_variable_scope(name, 0);
            binding.flags |= BindingFlags::USED | BindingFlags::WRITTEN | BindingFlags::REWRITTEN;
            if is_new {
                binding.flags |= BindingFlags::HOISTED;
            }
        }
    }

    fn has_own_arguments(&self) -> bool {
        let is_body = self.kind() == ScopeKind::FunctionBody;
        self.frames[self.frames.len() - 1 - usize::from(is_body)]
            .function
            .is_some_and(|function| function != FunctionKind::Arrow)
    }

    fn record(&mut self, frame: &Frame, declares_variables: bool, ast: &mut Ast) -> ScopeId {
        /// Each suspension of a function saves the bindings of its scopes that are not captured.
        const MOST_SAVED: u64 = 1 << 20;
        let variables = if declares_variables {
            frame.variables as usize
        } else {
            self.variables.len()
        };
        let mut flags = frame.flags;
        let is_open = self.capture_everything || flags.contains(ScopeFlags::CONTAINS_EVAL);
        let declarations = || {
            (self.variables[variables..].iter()).chain(&self.lexicals[frame.lexicals as usize..])
        };
        let suspensions = self.suspensions - frame.suspensions;
        let mut is_too_much_to_save = false;
        if suspensions != 0 && !is_open {
            let kept = declarations().filter(|it| {
                let flags = it.binding.flags;
                flags.contains(BindingFlags::USED) && !flags.contains(BindingFlags::CAPTURED)
            });
            // What is captured instead is saved once, so a scope over the limit adds nothing.
            let saved = kept.count() as u64 * u64::from(suspensions);
            is_too_much_to_save = self.saved.saturating_add(saved) > MOST_SAVED;
            if !is_too_much_to_save {
                self.saved += saved;
            }
        }
        let first_binding = ast.bindings.len() as u32;
        for declaration in declarations() {
            let mut binding = declaration.binding;
            if is_open {
                binding.flags |= BindingFlags::USED
                    | BindingFlags::CAPTURED
                    | BindingFlags::WRITTEN
                    | BindingFlags::REWRITTEN;
            }
            if is_too_much_to_save && binding.flags.contains(BindingFlags::USED) {
                binding.flags |= BindingFlags::CAPTURED;
            }
            if binding.flags.contains(BindingFlags::CAPTURED) {
                flags |= ScopeFlags::HAS_CAPTURED;
            }
            ast.bindings.push(binding);
        }
        let functions = if self.functions.len() > frame.functions as usize {
            let open = ast.open_list();
            for &function in &self.functions[frame.functions as usize..] {
                ast.push_to_list(function);
            }
            ast.close_list(open)
        } else {
            List::EMPTY
        };
        ast.push_scope(Scope {
            kind: frame.kind,
            flags,
            first_binding,
            binding_count: ast.bindings.len() as u32 - first_binding,
            functions,
            start: frame.start,
        })
    }

    /// A variable starts with the value of the parameter, or of the `arguments`, that it is named after.
    #[inline(never)]
    fn relate_body_to_parameters<const BUILD: bool>(&mut self, frame: &mut Frame) {
        let parameters = self.frames[self.frames.len() - 2];
        let lexicals = &self.lexicals[frame.lexicals as usize..];
        let mut is_hidden = parameters.flags.contains(ScopeFlags::CONTAINS_EVAL)
            || (lexicals
                .iter()
                .chain(&self.variables[frame.variables as usize..]))
            .any(|it| self.heads[it.binding.name.index()].capture > parameters.captures);
        if self.recall == Recall::Records {
            let mut traits = Traits::empty();
            traits.set(Traits::HIDDEN_FROM_PARAMETERS, is_hidden);
            self.remember_scope(frame, traits);
        }
        if !BUILD {
            return;
        }
        let with_parameters = Frame {
            closures: parameters.closures,
            ..*frame
        };
        is_hidden |= (self.replay_scope(&with_parameters, Traits::SCOPE))
            .contains(Traits::HIDDEN_FROM_PARAMETERS);
        (frame.flags).set(ScopeFlags::HIDDEN_FROM_PARAMETERS, is_hidden);
        for index in frame.variables as usize..self.variables.len() {
            let Binding { name, flags, .. } = self.variables[index].binding;
            let hides_parameter = self.is_parameter(name);
            (self.variables[index].binding.flags)
                .set(BindingFlags::HIDES_PARAMETER, hides_parameter);
            if !flags.contains(BindingFlags::FUNCTION)
                && (hides_parameter || (name == Name::ARGUMENTS && self.has_own_arguments()))
            {
                self.read(name, u32::MAX - 1);
            }
        }
    }

    /// A scope for the methods of an object literal, which code between them does not see.
    pub(crate) fn record_home_scope(start: u32, ast: &mut Ast) -> ScopeId {
        ast.bindings.push(Binding {
            name: Name::CLASS_HOME,
            kind: BindingKind::Internal,
            flags: BindingFlags::USED | BindingFlags::CAPTURED,
            initialized_from: 0,
            initialized_until: u32::MAX,
        });
        ast.push_scope(Scope {
            kind: ScopeKind::Class,
            flags: ScopeFlags::HAS_CAPTURED,
            first_binding: ast.bindings.len() as u32 - 1,
            binding_count: 1,
            functions: List::EMPTY,
            start,
        })
    }
}
