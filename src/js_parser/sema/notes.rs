//! What the parser says of a node that `bun_ast` has no place for.
//!
//! A [`Loc`] in the tree is where the node is. When the parser runs for the type checker and has something to say of a node, it makes
//! an entry for the node in [`Notes::nodes`] and puts the index of the entry where the location was, with bit 30 set
//! ([`Loc::is_index`]). The entry has the location. So what is said of a node is found from the node, by one index, and nothing is
//! looked up by where something is written.
//!
//! - A note is made on the `Loc` that ends up in the tree: a field of a node that exists, or a local that is stored in one as it is.
//! - A new node is born without an entry: `P::new_expr`, `P::s` and `P::b` are often given the location of another node, and take
//!   where that is ([`P::real_loc`]).
//! - The parser reads the location of a node through [`P::real_loc`].
//! - What an attempt at parsing noted is taken back with the attempt ([`P::rewind_type_syntax`]). So an attempt makes no first note
//!   on a `Loc` that outlives it.
//!
//! An ordinary build makes no entry and never sees such a `Loc`.

use super::{Mark, TypeSyntax};
use crate::p::P;
use crate::parser::{SkipTypeParameterResult, TypeParameterFlag};
use bun_ast::ts_syntax as ts;
use bun_ast::{Expr, Loc};

const NO_NOTE: u32 = u32::MAX;

/// A node that something is said of.
#[derive(Copy, Clone)]
pub(crate) struct NodeSyntax {
    /// Where the node is.
    pub(crate) loc: Loc,
    /// `node.Pos()`. `EMPTY` if it is not said.
    pub(crate) full_start: Loc,
    /// `node.End()`. `EMPTY` if it is not said.
    pub(crate) end: Loc,
    /// The last note that was made of it.
    last_note: u32,
}

#[derive(Copy, Clone)]
pub(crate) struct Note {
    pub(crate) what: Mark,
    /// A position, or the index of what was kept: see [`Mark`].
    pub(crate) payload: u32,
    /// The entry it is a note of.
    owner: u32,
    /// The note that was made of that entry before this one.
    previous: u32,
}

/// How much had been noted when a speculative parse began.
#[derive(Copy, Clone, Default)]
pub(crate) struct Checkpoint {
    nodes: u32,
    notes: u32,
    ranges: u32,
    after_skipped: u32,
    stray_decorators: u32,
    unclosed_literals: u32,
}

/// The notes of one file.
#[derive(Default)]
pub(crate) struct Notes {
    pub(crate) nodes: Vec<NodeSyntax>,
    pub(crate) notes: Vec<Note>,
    /// `Span`s and `IdList`s that are the payload of a note: where they start, and how long they are.
    pub(crate) ranges: Vec<[u32; 2]>,
}

thread_local! {
    /// The notes of the last file, empty: they have about the room the next needs.
    static ROOM: core::cell::Cell<Notes> = Default::default();
}

impl Notes {
    /// None, with the room the last file of this thread left.
    pub(crate) fn with_room() -> Notes {
        ROOM.take()
    }

    /// They have served.
    pub(crate) fn leave_room(mut self) {
        self.nodes.clear();
        self.notes.clear();
        self.ranges.clear();
        ROOM.set(self);
    }

    /// Where the node whose `loc` is `loc` is.
    #[inline]
    pub(crate) fn real_loc(&self, loc: Loc) -> Loc {
        if loc.is_index() {
            self.nodes[loc.index()].loc
        } else {
            loc
        }
    }

    /// The entry of the node whose `loc` is `loc`.
    #[inline]
    pub(crate) fn node(&self, loc: Loc) -> Option<&NodeSyntax> {
        if loc.is_index() {
            Some(&self.nodes[loc.index()])
        } else {
            None
        }
    }

    /// Whether anything but its range is noted of the node whose `loc` is `loc`.
    #[inline]
    pub(crate) fn has_notes(&self, loc: Loc) -> bool {
        self.node(loc).is_some_and(|node| node.last_note != NO_NOTE)
    }

    /// The notes of the node whose `loc` is `loc`, the last one first.
    #[inline]
    pub(crate) fn of(&self, loc: Loc) -> NotesOf<'_> {
        NotesOf {
            notes: &self.notes,
            next: self.node(loc).map_or(NO_NOTE, |node| node.last_note),
        }
    }

    /// What is noted as `what` of the node whose `loc` is `loc`.
    #[inline]
    pub(crate) fn get(&self, loc: Loc, what: Mark) -> Option<u32> {
        self.of(loc)
            .find(|note| note.what == what)
            .map(|note| note.payload)
    }

    #[inline]
    pub(crate) fn range(&self, payload: u32) -> [u32; 2] {
        self.ranges[payload as usize]
    }

    /// The entry of the node whose `loc` is `at`. Makes it, and puts its index in `at`, if there is none.
    fn entry(&mut self, at: &mut Loc) -> usize {
        if !at.is_index() {
            self.nodes.push(NodeSyntax {
                loc: *at,
                full_start: Loc::EMPTY,
                end: Loc::EMPTY,
                last_note: NO_NOTE,
            });
            *at = Loc::from_index(self.nodes.len() - 1);
        }
        at.index()
    }

    /// Takes back the note that was made last, if it says `what`.
    fn take_back(&mut self, what: Mark) -> bool {
        match self.notes.last() {
            Some(&note) if note.what == what => {
                self.nodes[note.owner as usize].last_note = note.previous;
                self.notes.pop();
                true
            }
            _ => false,
        }
    }

    pub(super) fn add(&mut self, at: &mut Loc, what: Mark, payload: u32) {
        let owner = self.entry(at);
        let previous =
            core::mem::replace(&mut self.nodes[owner].last_note, self.notes.len() as u32);
        self.notes.push(Note {
            what,
            payload,
            owner: owner as u32,
            previous,
        });
    }
}

pub(crate) struct NotesOf<'n> {
    notes: &'n [Note],
    next: u32,
}

impl Iterator for NotesOf<'_> {
    type Item = Note;

    #[inline]
    fn next(&mut self) -> Option<Note> {
        let note = *self.notes.get(self.next as usize)?;
        self.next = note.previous;
        Some(note)
    }
}

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    /// Where the node whose `loc` is `loc` is.
    #[inline]
    pub(crate) fn real_loc(&self, loc: Loc) -> Loc {
        if TYPESCRIPT && loc.is_index() {
            self.loc_of_entry(loc)
        } else {
            loc
        }
    }

    #[cold]
    #[inline(never)]
    fn loc_of_entry(&self, loc: Loc) -> Loc {
        match &self.type_syntax {
            Some(syntax) => syntax.notes.real_loc(loc),
            None => loc,
        }
    }

    /// Says `what` of the node whose `loc` is `at`.
    #[inline]
    pub(crate) fn note(&mut self, at: &mut Loc, what: Mark, payload: u32) {
        if TYPESCRIPT && let Some(syntax) = &mut self.type_syntax {
            syntax.notes.add(at, what, payload);
        }
    }

    /// A note that says all there is to say by being there.
    #[inline]
    pub(crate) fn note_flag(&mut self, at: &mut Loc, what: Mark) {
        self.note(at, what, 0);
    }

    /// A note of a place in the source.
    #[inline]
    pub(crate) fn note_loc(&mut self, at: &mut Loc, what: Mark, place: Loc) {
        debug_assert!(!place.is_index());
        self.note(at, what, place.start.max(0) as u32);
    }

    /// A note of the type that `parse_and_keep_type` parsed last.
    #[inline]
    pub(crate) fn note_type(&mut self, at: &mut Loc, what: Mark) {
        if TYPESCRIPT && let Some(syntax) = &mut self.type_syntax {
            let ty = syntax.last_type_or_error();
            syntax.notes.add(at, what, ty.index() as u32);
        }
    }

    /// The type that `parse_and_keep_type` parsed last, for `note_kept_type`. `NONE` outside of type checking.
    #[inline]
    pub(crate) fn kept_type_or_error(&mut self) -> ts::TypeId {
        match &mut self.type_syntax {
            Some(syntax) if TYPESCRIPT => syntax.last_type_or_error(),
            _ => ts::TypeId::NONE,
        }
    }

    /// The same. `NONE` also if the type is unusable.
    #[inline]
    pub(crate) fn kept_type(&self) -> ts::TypeId {
        match &self.type_syntax {
            Some(syntax) if TYPESCRIPT => syntax.last_type,
            _ => ts::TypeId::NONE,
        }
    }

    /// A note of a type that was parsed before the node was.
    #[inline]
    pub(crate) fn note_kept_type(&mut self, at: &mut Loc, what: Mark, ty: ts::TypeId) {
        self.note(at, what, ty.index() as u32);
    }

    /// The type arguments that were parsed last, as the payload of a note. `None` if they are unusable.
    #[inline]
    pub(crate) fn kept_type_arguments(&mut self) -> Option<u32> {
        if TYPESCRIPT
            && let Some(syntax) = &mut self.type_syntax
            && let Some(arguments) = syntax.last_type_args.take()
        {
            syntax.notes.ranges.push(arguments.parts());
            return Some(syntax.notes.ranges.len() as u32 - 1);
        }
        None
    }

    /// The type arguments that were parsed last. Empty if they are unusable.
    #[inline]
    pub(crate) fn take_kept_type_argument_list(&mut self) -> ts::IdList<ts::Type> {
        match &mut self.type_syntax {
            Some(syntax) if TYPESCRIPT => syntax.last_type_args.take().unwrap_or_default(),
            _ => ts::IdList::EMPTY,
        }
    }

    /// `async<T>(..)` was read as the head of an arrow function and turned out to be a call, whose `)` is at `close_paren`.
    #[cold]
    pub(crate) fn note_type_arguments_read_as_parameters(
        &mut self,
        close_paren: &mut Loc,
        parameters: Option<ts::Span<ts::TypeParam>>,
    ) {
        if let Some(syntax) = &mut self.type_syntax
            && let Some(parameters) = parameters
        {
            syntax.notes.ranges.push(parameters.parts());
            let payload = syntax.notes.ranges.len() as u32 - 1;
            syntax
                .notes
                .add(close_paren, Mark::TypeArgumentsReadAsParameters, payload);
        }
    }

    /// A note of the type arguments that were parsed last. None if they are unusable.
    #[inline]
    pub(crate) fn note_type_arguments_of(&mut self, at: &mut Loc, what: Mark) {
        if let Some(arguments) = self.kept_type_arguments() {
            self.note(at, what, arguments);
        }
    }

    /// The type parameters that `skip_type_script_type_parameters` just parsed, for `note_type_parameters`. `None` if there are none
    /// or they are unusable.
    #[inline]
    pub(crate) fn kept_type_parameters(
        &mut self,
        skipped: SkipTypeParameterResult,
    ) -> Option<ts::Span<ts::TypeParam>> {
        match &mut self.type_syntax {
            Some(syntax)
                if TYPESCRIPT && skipped != SkipTypeParameterResult::DidNotSkipAnything =>
            {
                syntax.last_type_params.take()
            }
            _ => None,
        }
    }

    /// `parseTypeParameters`, of a declaration that `bun_ast` has a node for.
    #[inline]
    pub(crate) fn parse_type_parameters(
        &mut self,
        flags: TypeParameterFlag,
    ) -> Result<Option<ts::Span<ts::TypeParam>>, crate::Error> {
        let skipped = self.skip_type_script_type_parameters(flags)?;
        Ok(self.kept_type_parameters(skipped))
    }

    /// A note of `parameters`, which are those of the node.
    #[inline]
    pub(crate) fn note_type_parameters(
        &mut self,
        at: &mut Loc,
        parameters: Option<ts::Span<ts::TypeParam>>,
    ) {
        if TYPESCRIPT
            && let Some(syntax) = &mut self.type_syntax
            && let Some(parameters) = parameters
        {
            syntax.notes.ranges.push(parameters.parts());
            let payload = syntax.notes.ranges.len() as u32 - 1;
            syntax.notes.add(at, Mark::TypeParameters, payload);
        }
    }

    /// `<T>(operand)` was read as the type parameters of an arrow function and turned out to be a cast. `less_than` is where the `<` is.
    #[cold]
    pub(crate) fn note_cast_to_type_parameter(
        &mut self,
        operand: &mut Expr,
        parameters: Option<ts::Span<ts::TypeParam>>,
        less_than: Loc,
    ) {
        self.note_token_full_start(&mut operand.loc, Mark::End);
        self.note_loc(&mut operand.loc, Mark::LessThan, less_than);
        if let Some(syntax) = &mut self.type_syntax {
            syntax
                .notes
                .ranges
                .push(parameters.unwrap_or_default().parts());
            let payload = syntax.notes.ranges.len() as u32 - 1;
            syntax
                .notes
                .add(&mut operand.loc, Mark::AsTypeParameter, payload);
        }
    }

    /// A note of `modifiers`, which are those of the node. None if there are none.
    pub(crate) fn note_modifiers(&mut self, at: &mut Loc, modifiers: ts::Span<ts::Modifier>) {
        if TYPESCRIPT
            && let Some(syntax) = &mut self.type_syntax
            && !modifiers.is_empty()
        {
            syntax.notes.ranges.push(modifiers.parts());
            let payload = syntax.notes.ranges.len() as u32 - 1;
            syntax.notes.add(at, Mark::Modifiers, payload);
        }
    }

    /// A note of an expression that `bun_ast` has no place for.
    #[inline]
    pub(crate) fn note_expr(&mut self, at: &mut Loc, what: Mark, expression: Expr) {
        if TYPESCRIPT && let Some(syntax) = &mut self.type_syntax {
            let kept = syntax.ast.add_expression(expression);
            syntax.notes.add(at, what, kept.index() as u32);
        }
    }

    /// `finishNode`: a note of where the token before the current one ends.
    #[inline]
    pub(crate) fn note_token_full_start(&mut self, at: &mut Loc, what: Mark) {
        if self.keeps_type_syntax() {
            let place = self.lexer.full_start();
            self.note_loc(at, what, place);
        }
    }

    /// `operand<T>` was parsed, whose `<` is at `less_than`, and the lexer is at what follows. An instantiation expression, unless the
    /// type arguments are taken. Type arguments that are unusable are as good as none.
    #[inline]
    pub(crate) fn note_type_arguments(&mut self, operand: &mut Expr, less_than: Loc) {
        let (next, end) = (self.lexer.loc(), self.lexer.full_start());
        if TYPESCRIPT && let Some(syntax) = &mut self.type_syntax {
            syntax.pending_type_arguments = None;
            if let Some(arguments) = syntax.last_type_args.take() {
                syntax.notes.ranges.push(arguments.parts());
                let payload = syntax.notes.ranges.len() as u32 - 1;
                syntax.pending_type_arguments = Some((payload, next));
                let less_than = less_than.start.max(0) as u32;
                syntax
                    .notes
                    .add(&mut operand.loc, Mark::End, end.start.max(0) as u32);
                syntax
                    .notes
                    .add(&mut operand.loc, Mark::InstantiationStart, less_than);
                syntax
                    .notes
                    .add(&mut operand.loc, Mark::Instantiation, payload);
            }
        }
    }

    /// The type arguments that end right before the current token, for the call, `new` or tagged template that has them: the payload
    /// of its note.
    #[inline]
    pub(crate) fn take_type_arguments(&mut self) -> Option<u32> {
        let here = self.lexer.loc();
        if TYPESCRIPT
            && let Some(syntax) = &mut self.type_syntax
            && let Some((payload, next)) = syntax.pending_type_arguments
            && next == here
        {
            syntax.pending_type_arguments = None;
            // Nothing was parsed since they were noted.
            if syntax.notes.take_back(Mark::Instantiation) {
                syntax.notes.take_back(Mark::InstantiationStart);
                syntax.notes.take_back(Mark::End);
            }
            return Some(payload);
        }
        None
    }

    /// Of the tagged template `template`: where its `` ` `` is, the type arguments of its tag (`take_type_arguments`), and whether its
    /// last piece of text is missing or unterminated.
    #[inline]
    pub(crate) fn note_tagged_template(
        &mut self,
        template: &mut Expr,
        backtick: Loc,
        type_arguments: Option<u32>,
        is_incomplete: bool,
    ) {
        if !self.keeps_type_syntax() {
            return;
        }
        self.note_loc(&mut template.loc, Mark::Backtick, backtick);
        if let Some(type_arguments) = type_arguments {
            self.note(&mut template.loc, Mark::TagTypeArguments, type_arguments);
        }
        if is_incomplete {
            self.note_flag(&mut template.loc, Mark::IncompleteTemplate);
        }
    }

    /// What was made last of `expr`, which is only `expr` in the tree: `(x)`, `x as T`, `x!`, `x<T>`.
    #[cold]
    pub(crate) fn last_cast(&self, expr: &Expr) -> Option<Mark> {
        let notes = &self.type_syntax.as_ref()?.notes;
        notes
            .of(expr.loc)
            .map(|note| note.what)
            .find(|what| what.is_cast())
    }

    /// `(inside)`, whose `(` is at `open` and whose `)` has been taken. `full_start`: `TokenFullStart` of the `(`, or nothing.
    #[inline]
    pub(crate) fn mark_paren(&mut self, inside: &mut Expr, open: Loc, full_start: Loc) {
        if self.has_comments_before(open, full_start) {
            self.note_loc(&mut inside.loc, Mark::ParenFullStart, full_start);
        }
        self.note_token_full_start(&mut inside.loc, Mark::End);
        self.note_loc(&mut inside.loc, Mark::Paren, open);
    }

    /// `withJSDoc`, of a node of which `node.Pos()` is asked for nothing else: it is only said if comments stand before `token`, its
    /// first token, which fully starts at `full_start`.
    #[inline]
    pub(crate) fn mark_comments_before(&mut self, at: &mut Loc, token: Loc, full_start: Loc) {
        if self.has_comments_before(token, full_start) {
            self.note_full_start(at, full_start);
        }
    }

    /// `decorator` decorates nothing (`note_stray_decorators`). `end`: where what comes after the decorators starts.
    #[cold]
    pub(crate) fn note_stray_decorator(&mut self, decorator: &Expr, end: Loc) {
        let at = self.real_loc(decorator.loc);
        if let Some(syntax) = &mut self.type_syntax {
            syntax.stray_decorators.push((at, end));
        }
    }

    /// `Expr::join_with_comma`. A new node is born without an entry.
    pub(crate) fn join_with_comma(&self, a: Expr, b: Expr) -> Expr {
        let is_new = !a.is_missing() && !b.is_missing();
        let mut joined = a.join_with_comma(b);
        if is_new {
            joined.loc = self.real_loc(joined.loc);
        }
        joined
    }

    /// `Expr::assign`. A new node is born without an entry.
    #[inline]
    pub(crate) fn assign(&self, a: Expr, b: Expr) -> Expr {
        let mut assignment = Expr::assign(a, b);
        assignment.loc = self.real_loc(assignment.loc);
        assignment
    }

    /// `P::finish_expr`. Inlined into `new_expr`, which knows the kind: one arm is left of the `match`.
    #[inline(always)]
    pub(crate) fn note_expr_end(&mut self, expr: &mut Expr, end: Loc) {
        use bun_ast::ExprData as E;
        // Most expressions end with their last part, with a word of a known length or with a token whose place the tree has. The
        // lowering works that out (`Lower::expr_without_casts`), and they need no entry.
        let follows = match expr.data {
            E::EBinary(_) | E::EIf(_) | E::ESpread(_) | E::EAwait(_) => true,
            E::ESuper(_) | E::ENull(_) | E::EBoolean(_) => true,
            // Tokens may have been skipped where the operand is missed.
            E::EUnary(unary) => {
                !matches!(
                    unary.op,
                    bun_ast::OpCode::UnPostDec | bun_ast::OpCode::UnPostInc
                ) && !matches!(unary.value.data, E::EMissing(_))
            }
            E::EDot(dot) => self.real_loc(dot.name_loc).start + dot.name.len() as i32 == end.start,
            E::ECall(call) => self.real_loc(call.close_paren_loc).start + 1 == end.start,
            E::EArray(array) => self.real_loc(array.close_bracket_loc).start + 1 == end.start,
            E::EObject(object) => self.real_loc(object.close_brace_loc).start + 1 == end.start,
            // It is made before its token is taken.
            E::EString(string) => {
                end_of_quoted(self.source.contents(), string.data.slice()) == Some(self.lexer.end)
                    && self.lexer.start as i32 == expr.loc.start
            }
            _ => false,
        };
        if !follows {
            self.note_expr_end_as_given(expr, end);
        }
    }

    #[inline(never)]
    fn note_expr_end_as_given(&mut self, expr: &mut Expr, end: Loc) {
        let start = self.real_loc(expr.loc).start;
        match expr.data {
            // `createMissingNode`: it takes no room, where the token before it ends. One that is made late does not know where.
            bun_ast::ExprData::EMissing(_) if end.start > start => {}
            // `parse_jsx_element` returns before the last ">" is taken, and text is no trivia: `hir::Jsx::end`.
            bun_ast::ExprData::EJsxElement(_) => {}
            bun_ast::ExprData::EMissing(_) => self.note_end(&mut expr.loc, end),
            _ if end.start > start => self.note_end(&mut expr.loc, end),
            // A literal is made before its token is taken.
            _ if self.lexer.start as i32 == start => {
                let end = bun_ast::usize2loc(self.lexer.end);
                self.note_end(&mut expr.loc, end)
            }
            _ => {}
        }
    }

    /// `node.End()` of the array or object literal `literal`, which may not have been noted (`note_expr_end`).
    pub(crate) fn end_of_literal(&self, literal: &Expr) -> Option<Loc> {
        let close = match literal.data {
            bun_ast::ExprData::EArray(array) => array.close_bracket_loc,
            bun_ast::ExprData::EObject(object) => object.close_brace_loc,
            _ => return self.noted_end(literal.loc),
        };
        let after = Loc {
            start: self.real_loc(close).start + 1,
        };
        Some(self.noted_end(literal.loc).unwrap_or(after))
    }

    /// `new_expr`, of an expression that is put together when tokens after it have been taken. It ends at `end`.
    #[cold]
    #[inline(never)]
    pub(crate) fn new_expr_ending_at<T>(&mut self, t: T, loc: Loc, end: Loc) -> Expr
    where
        T: bun_ast::expr::IntoExprData,
    {
        let mut expr = Expr::init(t, self.real_loc(loc));
        self.note_expr_end(&mut expr, end);
        expr
    }

    /// What was noted as `what` of the node whose `loc` is `at`.
    #[cold]
    pub(crate) fn noted(&self, at: Loc, what: Mark) -> Option<u32> {
        self.type_syntax.as_ref()?.notes.get(at, what)
    }

    /// `node.End()` of the node whose `loc` is `at`, if it was noted.
    #[inline]
    pub(crate) fn noted_end(&self, at: Loc) -> Option<Loc> {
        let end = self.type_syntax.as_ref()?.notes.node(at)?.end;
        (!end.is_empty()).then_some(end)
    }

    /// `node.Pos()` of the node whose `loc` is `at`.
    #[inline]
    pub(crate) fn note_full_start(&mut self, at: &mut Loc, full_start: Loc) {
        if TYPESCRIPT && let Some(syntax) = &mut self.type_syntax {
            let entry = syntax.notes.entry(at);
            syntax.notes.nodes[entry].full_start = full_start;
        }
    }

    /// `node.Loc` of the node whose `loc` is `at`.
    #[inline]
    pub(crate) fn note_range(&mut self, at: &mut Loc, full_start: Loc, end: Loc) {
        if TYPESCRIPT && let Some(syntax) = &mut self.type_syntax {
            let entry = syntax.notes.entry(at);
            let node = &mut syntax.notes.nodes[entry];
            (node.full_start, node.end) = (full_start, end);
        }
    }

    /// `node.End()` of the node whose `loc` is `at`.
    #[inline]
    pub(crate) fn note_end(&mut self, at: &mut Loc, end: Loc) {
        if TYPESCRIPT && let Some(syntax) = &mut self.type_syntax {
            let entry = syntax.notes.entry(at);
            syntax.notes.nodes[entry].end = end;
        }
    }

    /// `finishNode(node, pos)`: the node whose `loc` is `at` fully starts at `full_start`, and ends where the token before the current
    /// one does.
    #[inline]
    pub(crate) fn finish_node(&mut self, at: &mut Loc, full_start: Loc) {
        let end = self.lexer.full_start();
        if TYPESCRIPT && let Some(syntax) = &mut self.type_syntax {
            let entry = syntax.notes.entry(at);
            let node = &mut syntax.notes.nodes[entry];
            (node.full_start, node.end) = (full_start, end);
        }
    }

    /// The same of the member of a class or of an object literal that is named at `named_at`. The name is an expression, which has an
    /// end of its own.
    #[inline]
    pub(crate) fn finish_member(&mut self, named_at: &mut Loc, full_start: Loc) {
        self.note_loc(named_at, Mark::MemberFullStart, full_start);
        self.note_token_full_start(named_at, Mark::MemberEnd);
    }

    /// `mark`: pass the result to `rewind_type_syntax` if what is parsed from here on is abandoned.
    #[inline]
    pub(crate) fn type_syntax_checkpoint(&self) -> Checkpoint {
        match &self.type_syntax {
            Some(syntax) if TYPESCRIPT => Checkpoint {
                nodes: syntax.notes.nodes.len() as u32,
                notes: syntax.notes.notes.len() as u32,
                ranges: syntax.notes.ranges.len() as u32,
                after_skipped: syntax.after_skipped.len() as u32,
                stray_decorators: syntax.stray_decorators.len() as u32,
                unclosed_literals: syntax.unclosed_literals.len() as u32,
            },
            _ => Checkpoint::default(),
        }
    }

    /// `rewind`: an attempt that is abandoned leaves nothing behind, also of nodes that were there before it.
    #[inline]
    pub(crate) fn rewind_type_syntax(&mut self, to: Checkpoint) {
        if TYPESCRIPT && let Some(syntax) = &mut self.type_syntax {
            syntax.rewind(to);
        }
    }
}

impl TypeSyntax {
    /// The type that `parse_and_keep_type` parsed last. If it is unusable, an error type where it starts.
    pub(super) fn last_type_or_error(&mut self) -> ts::TypeId {
        if self.last_type.is_none() {
            let start = Loc {
                start: self.last_type_start,
            };
            let error = ts::TypeData::Error {
                is_syntax_error: true,
            };
            self.last_type = self.ast.add_type(error, start);
        }
        self.last_type
    }

    #[cold]
    #[inline(never)]
    fn rewind(&mut self, snapshot: Checkpoint) {
        let Notes {
            nodes,
            notes,
            ranges,
        } = &mut self.notes;
        while notes.len() > snapshot.notes as usize {
            let Some(note) = notes.pop() else { break };
            nodes[note.owner as usize].last_note = note.previous;
        }
        nodes.truncate(snapshot.nodes as usize);
        ranges.truncate(snapshot.ranges as usize);
        self.pending_type_arguments = None;
        self.after_skipped.truncate(snapshot.after_skipped as usize);
        self.stray_decorators
            .truncate(snapshot.stray_decorators as usize);
        self.unclosed_literals
            .truncate(snapshot.unclosed_literals as usize);
    }
}

/// Where the string literal ends whose characters are `inside`, if they are a piece of `source`: after the quote that follows them.
#[inline]
pub(crate) fn end_of_quoted(source: &[u8], inside: &[u8]) -> Option<usize> {
    let offset = (inside.as_ptr() as usize).checked_sub(source.as_ptr() as usize)?;
    (offset + inside.len() < source.len()).then_some(offset + inside.len() + 1)
}
