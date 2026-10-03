//! Side table for information the parser records about a node that `bun_ast` has no field for.
//!
//! A [`Loc`] in the AST is the position of the node. When the parser runs for the type checker and
//! has information to record about a node, it creates an entry for the node in [`Notes::nodes`] and
//! replaces the location with the index of the entry, with bit 30 set ([`Loc::is_index`]). The
//! entry stores the location. So the notes of a node are reached from the node by one index, and
//! nothing is looked up by source position.
//!
//! - A note is attached to the `Loc` that ends up in the AST: a field of an existing node, or a
//!   local that is stored in one unchanged.
//! - A new node starts without an entry: `P::new_expr`, `P::s` and `P::b` are often passed the
//!   location of another node, and take its position ([`P::real_loc`]).
//! - The parser reads the location of a node through [`P::real_loc`].
//! - Notes recorded during a speculative parse are rolled back with it ([`P::rewind_type_syntax`]).
//!   So a speculative parse never attaches the first note to a `Loc` that outlives it.
//!
//! An ordinary build creates no entry and never sees such a `Loc`.

use super::{Mark, TypeSyntax};
use crate::p::P;
use crate::parser::{SkipTypeParameterResult, TypeParameterFlag};
use crate::sema::ts_syntax as ts;
use bun_ast::{Expr, Loc};

const NO_NOTE: u32 = u32::MAX;

/// The entry of a node the parser recorded something about.
#[derive(Copy, Clone)]
pub(crate) struct NodeSyntax {
    /// Position of the node.
    pub(crate) loc: Loc,
    /// `node.Pos()`. `EMPTY` if it is not recorded.
    pub(crate) full_start: Loc,
    /// `node.End()`. `EMPTY` if it is not recorded.
    pub(crate) end: Loc,
    /// Its most recent note.
    last_note: u32,
}

#[derive(Copy, Clone)]
pub(crate) struct Note {
    pub(crate) what: Mark,
    /// A position, or the index of the saved syntax: see [`Mark`].
    pub(crate) payload: u32,
    /// The entry it belongs to.
    owner: u32,
    /// The previous note of that entry.
    previous: u32,
}

/// Checkpoint: how much had been recorded when a speculative parse began.
#[derive(Copy, Clone, Default)]
pub(crate) struct Checkpoint {
    nodes: u32,
    notes: u32,
    ranges: u32,
    after_skipped: u32,
    stray_decorators: u32,
    unclosed_literals: u32,
    type_stack: u32,
    name_stack: u32,
    rows: Rows,
}

macro_rules! rows {
    ($($list:ident),*) => {
        /// Counts of the HIR nodes of the kinds the parser builds, and of whatever else it adds to
        /// the HIR.
        #[derive(Copy, Clone, Default)]
        pub(crate) struct Rows {
            $(pub(crate) $list: u32,)*
            pub(crate) pending: u32,
            pub(crate) syntax_errors: u32,
            error_pos: u32,
        }

        impl Rows {
            /// Appends to `to` the nodes of `from` between these counts and `end`. Returns the
            /// offset applied to the ids of each vector, and the number of syntax errors among the
            /// nodes.
            pub(crate) fn copy(
                &self,
                end: &Rows,
                from: &bun_sema::hir::File,
                to: &mut bun_sema::hir::File,
            ) -> Rows {
                Rows {
                    $($list: {
                        let moved = (to.$list.len() as u32).wrapping_sub(self.$list);
                        if end.$list > self.$list {
                            let rows = &from.$list[self.$list as usize..end.$list as usize];
                            to.$list.extend_from_slice(rows);
                        }
                        moved
                    },)*
                    pending: 0,
                    syntax_errors: end.syntax_errors - self.syntax_errors,
                    error_pos: 0,
                }
            }
        }

        impl TypeSyntax<'_> {
            pub(crate) fn rows(&self) -> Rows {
                let file = &self.b.file;
                Rows {
                    $($list: file.$list.len() as u32,)*
                    pending: self.b.pending.len() as u32,
                    syntax_errors: file.syntax_errors,
                    error_pos: file.error_pos,
                }
            }

            /// Rolls back the nodes built since `to` was taken.
            pub(crate) fn rewind_rows(&mut self, to: Rows) {
                let file = &mut self.b.file;
                $(if file.$list.len() > to.$list as usize {
                    file.$list.truncate(to.$list as usize);
                })*
                file.modifiers_of_params.truncate(to.params as usize);
                (file.syntax_errors, file.error_pos) = (to.syntax_errors, to.error_pos);
                self.b.pending.truncate(to.pending as usize);
            }
        }
    };
}
rows!(
    ids,
    numbers,
    exprs,
    types,
    pats,
    pat_props,
    pat_elems,
    fns,
    params,
    type_params,
    members,
    tuple_elems,
    mapped,
    modifiers,
    names,
    diagnostics,
    specifier_uses
);

/// The notes of one file.
#[derive(Default)]
pub(crate) struct Notes {
    pub(crate) nodes: Vec<NodeSyntax>,
    pub(crate) notes: Vec<Note>,
    /// `Span`s and `IdList`s that are note payloads: start and length.
    pub(crate) ranges: Vec<[u32; 2]>,
}

thread_local! {
    /// The emptied notes of the previous file, reused for their capacity.
    static RECYCLED: core::cell::Cell<Notes> = Default::default();
}

/// Swaps this thread's recycled buffers.
pub(crate) fn replace_recycled(room: Notes) -> Notes {
    RECYCLED.replace(room)
}

impl Notes {
    /// Empty notes with the capacity recycled from this thread's previous file.
    pub(crate) fn take_recycled() -> Notes {
        RECYCLED.take()
    }

    /// Called when the notes are no longer needed.
    pub(crate) fn recycle(mut self) {
        self.nodes.clear();
        self.notes.clear();
        self.ranges.clear();
        RECYCLED.set(self);
    }

    /// Position of the node whose `loc` is `loc`.
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

    /// Whether the node whose `loc` is `loc` has any note besides its range.
    #[inline]
    pub(crate) fn has_notes(&self, loc: Loc) -> bool {
        self.node(loc).is_some_and(|node| node.last_note != NO_NOTE)
    }

    /// The notes of the node whose `loc` is `loc`, most recent first.
    #[inline]
    pub(crate) fn of(&self, loc: Loc) -> NotesOf<'_> {
        NotesOf {
            notes: &self.notes,
            next: self.node(loc).map_or(NO_NOTE, |node| node.last_note),
        }
    }

    /// The note of kind `what` on the node whose `loc` is `loc`.
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

    /// The entry of the node whose `loc` is `at`. Creates it and stores its index in `at` if it
    /// does not exist.
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

    /// Removes the most recent note if its kind is `what`.
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
    /// Position of the node whose `loc` is `loc`.
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

    /// Adds a note of kind `what` to the node whose `loc` is `at`.
    #[inline]
    pub(crate) fn note(&mut self, at: &mut Loc, what: Mark, payload: u32) {
        if TYPESCRIPT && let Some(syntax) = &mut self.type_syntax {
            syntax.notes.add(at, what, payload);
        }
    }

    /// A note without a payload: its presence is the information.
    #[inline]
    pub(crate) fn note_flag(&mut self, at: &mut Loc, what: Mark) {
        self.note(at, what, 0);
    }

    /// A note whose payload is a source position.
    #[inline]
    pub(crate) fn note_loc(&mut self, at: &mut Loc, what: Mark, place: Loc) {
        debug_assert!(!place.is_index());
        self.note(at, what, place.start.max(0) as u32);
    }

    /// A note whose payload is the type that `parse_and_keep_type` parsed last.
    #[inline]
    pub(crate) fn note_type(&mut self, at: &mut Loc, what: Mark) {
        if TYPESCRIPT && let Some(syntax) = &mut self.type_syntax {
            let ty = syntax.last_type_or_error();
            syntax.notes.add(at, what, ty.0);
        }
    }

    /// The type that `parse_and_keep_type` parsed last, for `note_saved_type`. `NONE` outside of type checking.
    #[inline]
    pub(crate) fn saved_type_or_error(&mut self) -> ts::TypeId {
        match &mut self.type_syntax {
            Some(syntax) if TYPESCRIPT => syntax.last_type_or_error(),
            _ => ts::TypeId::NONE,
        }
    }

    /// The same. `NONE` also if the type is unusable.
    #[inline]
    pub(crate) fn saved_type(&self) -> ts::TypeId {
        match &self.type_syntax {
            Some(syntax) if TYPESCRIPT => syntax.last_type,
            _ => ts::TypeId::NONE,
        }
    }

    /// A note whose payload is a type that was parsed before the node.
    #[inline]
    pub(crate) fn note_saved_type(&mut self, at: &mut Loc, what: Mark, ty: ts::TypeId) {
        self.note(at, what, ty.0);
    }

    /// The type arguments that were parsed last, as the payload of a note. `None` if they are unusable.
    #[inline]
    pub(crate) fn saved_type_arguments(&mut self) -> Option<u32> {
        if TYPESCRIPT
            && let Some(syntax) = &mut self.type_syntax
            && let Some(arguments) = syntax.last_type_args.take()
        {
            syntax.notes.ranges.push([arguments.start, arguments.len]);
            return Some(syntax.notes.ranges.len() as u32 - 1);
        }
        None
    }

    /// The type arguments that were parsed last. Empty if they are unusable.
    #[inline]
    pub(crate) fn take_saved_type_argument_list(&mut self) -> ts::Types {
        match &mut self.type_syntax {
            Some(syntax) if TYPESCRIPT => syntax.last_type_args.take().unwrap_or_default(),
            _ => ts::Types::EMPTY,
        }
    }

    /// `async<T>(..)` was parsed as the head of an arrow function and turned out to be a call,
    /// whose `)` is at `close_paren`.
    #[cold]
    pub(crate) fn note_type_arguments_read_as_parameters(
        &mut self,
        close_paren: &mut Loc,
        parameters: Option<ts::TypeParams>,
    ) {
        if let Some(syntax) = &mut self.type_syntax
            && let Some(parameters) = parameters
        {
            syntax.notes.ranges.push([parameters.start, parameters.len]);
            let payload = syntax.notes.ranges.len() as u32 - 1;
            syntax
                .notes
                .add(close_paren, Mark::TypeArgumentsReadAsParameters, payload);
        }
    }

    /// A note whose payload is the type arguments that were parsed last. No note if they are
    /// unusable.
    #[inline]
    pub(crate) fn note_type_arguments_of(&mut self, at: &mut Loc, what: Mark) {
        if let Some(arguments) = self.saved_type_arguments() {
            self.note(at, what, arguments);
        }
    }

    /// The type parameters that `skip_type_script_type_parameters` just parsed, for `note_type_parameters`. `None` if there are none
    /// or they are unusable.
    #[inline]
    pub(crate) fn saved_type_parameters(
        &mut self,
        skipped: SkipTypeParameterResult,
    ) -> Option<ts::TypeParams> {
        match &mut self.type_syntax {
            Some(syntax)
                if TYPESCRIPT && skipped != SkipTypeParameterResult::DidNotSkipAnything =>
            {
                syntax.last_type_params.take()
            }
            _ => None,
        }
    }

    /// `parseTypeParameters` for a declaration that `bun_ast` has a node for.
    #[inline]
    pub(crate) fn parse_type_parameters(
        &mut self,
        flags: TypeParameterFlag,
    ) -> Result<Option<ts::TypeParams>, crate::Error> {
        let skipped = self.skip_type_script_type_parameters(flags)?;
        Ok(self.saved_type_parameters(skipped))
    }

    /// A note whose payload is `parameters`, the type parameters of the node.
    #[inline]
    pub(crate) fn note_type_parameters(
        &mut self,
        at: &mut Loc,
        parameters: Option<ts::TypeParams>,
    ) {
        if TYPESCRIPT
            && let Some(syntax) = &mut self.type_syntax
            && let Some(parameters) = parameters
        {
            syntax.notes.ranges.push([parameters.start, parameters.len]);
            let payload = syntax.notes.ranges.len() as u32 - 1;
            syntax.notes.add(at, Mark::TypeParameters, payload);
        }
    }

    /// `<T>(operand)` was parsed as the type parameters of an arrow function and turned out to be a
    /// cast. `less_than` is the position of the `<`.
    #[cold]
    pub(crate) fn note_cast_to_type_parameter(
        &mut self,
        operand: &mut Expr,
        parameters: Option<ts::TypeParams>,
        less_than: Loc,
    ) {
        self.note_token_full_start(&mut operand.loc, Mark::End);
        self.note_loc(&mut operand.loc, Mark::LessThan, less_than);
        if let Some(syntax) = &mut self.type_syntax {
            let parameters = parameters.unwrap_or_default();
            syntax.notes.ranges.push([parameters.start, parameters.len]);
            let payload = syntax.notes.ranges.len() as u32 - 1;
            syntax
                .notes
                .add(&mut operand.loc, Mark::AsTypeParameter, payload);
        }
    }

    /// A note whose payload is `modifiers`, the modifiers of the node. No note if the list is
    /// empty.
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

    /// A note whose payload is an expression that `bun_ast` has no field for.
    #[inline]
    pub(crate) fn note_expr(&mut self, at: &mut Loc, what: Mark, expression: Expr) {
        if TYPESCRIPT && let Some(syntax) = &mut self.type_syntax {
            let kept = syntax.b.ts.add_expression(expression);
            syntax.notes.add(at, what, kept.index() as u32);
        }
    }

    /// `finishNode`: a note whose payload is the end of the previous token.
    #[inline]
    pub(crate) fn note_token_full_start(&mut self, at: &mut Loc, what: Mark) {
        if self.preserves_type_syntax() {
            let place = self.lexer.full_start();
            self.note_loc(at, what, place);
        }
    }

    /// `operand<T>` was parsed, whose `<` is at `less_than`, and the lexer is at the next token. It
    /// is an instantiation expression unless the type arguments are consumed. Unusable type
    /// arguments are treated as absent.
    #[inline]
    pub(crate) fn note_type_arguments(&mut self, operand: &mut Expr, less_than: Loc) {
        let (next, end) = (self.lexer.loc(), self.lexer.full_start());
        if TYPESCRIPT && let Some(syntax) = &mut self.type_syntax {
            syntax.pending_type_arguments = None;
            if let Some(arguments) = syntax.last_type_args.take() {
                syntax.notes.ranges.push([arguments.start, arguments.len]);
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

    /// The type arguments that end directly before the current token, for the call, `new` or tagged
    /// template that owns them: the payload of its note.
    #[inline]
    pub(crate) fn take_type_arguments(&mut self) -> Option<u32> {
        let here = self.lexer.loc();
        if TYPESCRIPT
            && let Some(syntax) = &mut self.type_syntax
            && let Some((payload, next)) = syntax.pending_type_arguments
            && next == here
        {
            syntax.pending_type_arguments = None;
            // Nothing was parsed since they were recorded.
            if syntax.notes.take_back(Mark::Instantiation) {
                syntax.notes.take_back(Mark::InstantiationStart);
                syntax.notes.take_back(Mark::End);
            }
            return Some(payload);
        }
        None
    }

    /// Records for the tagged template `template`: the position of its `` ` ``, the type arguments
    /// of its tag (`take_type_arguments`), and whether its last piece of text is missing or
    /// unterminated.
    #[inline]
    pub(crate) fn note_tagged_template(
        &mut self,
        template: &mut Expr,
        backtick: Loc,
        type_arguments: Option<u32>,
        is_incomplete: bool,
    ) {
        if !self.preserves_type_syntax() {
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

    /// The kind of the outermost cast of `expr`. A cast is syntax that the AST represents as `expr`
    /// alone: `(x)`, `x as T`, `x!`, `x<T>`.
    #[cold]
    pub(crate) fn last_cast(&self, expr: &Expr) -> Option<Mark> {
        let notes = &self.type_syntax.as_ref()?.notes;
        notes
            .of(expr.loc)
            .map(|note| note.what)
            .find(|what| what.is_cast())
    }

    /// `(inside)`, whose `(` is at `open` and whose `)` has been consumed. `full_start`:
    /// `TokenFullStart` of the `(`, or none.
    #[inline]
    pub(crate) fn mark_paren(&mut self, inside: &mut Expr, open: Loc, full_start: Loc) {
        if self.has_comments_before(open, full_start) {
            self.note_loc(&mut inside.loc, Mark::ParenFullStart, full_start);
        }
        self.note_token_full_start(&mut inside.loc, Mark::End);
        self.note_loc(&mut inside.loc, Mark::Paren, open);
    }

    /// `withJSDoc` for a node whose `node.Pos()` has no other use: it is only recorded if comments
    /// precede `token`, its first token, whose full start is `full_start`.
    #[inline]
    pub(crate) fn mark_comments_before(&mut self, at: &mut Loc, token: Loc, full_start: Loc) {
        if self.has_comments_before(token, full_start) {
            self.note_full_start(at, full_start);
        }
    }

    /// `decorator` decorates nothing (`note_stray_decorators`). `end`: the start of the syntax
    /// after the decorators.
    #[cold]
    pub(crate) fn note_stray_decorator(&mut self, decorator: &Expr, end: Loc) {
        let at = self.real_loc(decorator.loc);
        if let Some(syntax) = &mut self.type_syntax {
            syntax.stray_decorators.push((at, end));
        }
    }

    /// `Expr::join_with_comma`. A new node starts without an entry.
    pub(crate) fn join_with_comma(&self, a: Expr, b: Expr) -> Expr {
        let is_new = !a.is_missing() && !b.is_missing();
        let mut joined = a.join_with_comma(b);
        if is_new {
            joined.loc = self.real_loc(joined.loc);
        }
        joined
    }

    /// `Expr::assign`. A new node starts without an entry.
    #[inline]
    pub(crate) fn assign(&self, a: Expr, b: Expr) -> Expr {
        let mut assignment = Expr::assign(a, b);
        assignment.loc = self.real_loc(assignment.loc);
        assignment
    }

    /// `P::finish_expr`. Inlined into `new_expr`, which knows the kind, so a single arm of the
    /// `match` remains.
    #[inline(always)]
    pub(crate) fn note_expr_end(&mut self, expr: &mut Expr, end: Loc) {
        use bun_ast::ExprData as E;
        // Most expressions end with their last child, with a word of known length or with a token
        // whose position is in the AST. The lowering pass computes that end
        // (`Lower::expr_without_casts`), so they need no entry.
        let follows = match expr.data {
            E::EBinary(_) | E::EIf(_) | E::ESpread(_) | E::EAwait(_) => true,
            E::ESuper(_) | E::ENull(_) | E::EBoolean(_) => true,
            // Tokens may have been skipped where the operand is missing.
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
            // It is created before its token is consumed.
            E::EString(string) => {
                end_of_quoted(self.source.contents(), string.data.slice()) == Some(self.lexer.end)
                    && self.lexer.start as i32 == expr.loc.start
            }
            _ => false,
        };
        if !follows {
            self.note_expr_end_as_passed(expr, end);
        }
    }

    #[inline(never)]
    fn note_expr_end_as_passed(&mut self, expr: &mut Expr, end: Loc) {
        let start = self.real_loc(expr.loc).start;
        match expr.data {
            // `createMissingNode`: zero-width, at the end of the previous token. A node created
            // late does not have that position.
            bun_ast::ExprData::EMissing(_) if end.start > start => {}
            // `parse_jsx_element` returns before the last ">" is consumed, and text is not trivia:
            // `hir::Jsx::end`.
            bun_ast::ExprData::EJsxElement(_) => {}
            bun_ast::ExprData::EMissing(_) => self.note_end(&mut expr.loc, end),
            _ if end.start > start => self.note_end(&mut expr.loc, end),
            // A literal is created before its token is consumed.
            _ if self.lexer.start as i32 == start => {
                let end = bun_ast::usize2loc(self.lexer.end);
                self.note_end(&mut expr.loc, end)
            }
            _ => {}
        }
    }

    /// `node.End()` of the array or object literal `literal`, which may not have been recorded
    /// (`note_expr_end`).
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

    /// `new_expr` for an expression that is created after tokens that follow it have been consumed.
    /// It ends at `end`.
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

    /// The note of kind `what` on the node whose `loc` is `at`.
    #[cold]
    pub(crate) fn noted(&self, at: Loc, what: Mark) -> Option<u32> {
        self.type_syntax.as_ref()?.notes.get(at, what)
    }

    /// `node.End()` of the node whose `loc` is `at`, if it was recorded.
    #[inline]
    pub(crate) fn noted_end(&self, at: Loc) -> Option<Loc> {
        let end = self.type_syntax.as_ref()?.notes.node(at)?.end;
        (!end.is_empty()).then_some(end)
    }

    /// Records `node.Pos()` of the node whose `loc` is `at`.
    #[inline]
    pub(crate) fn note_full_start(&mut self, at: &mut Loc, full_start: Loc) {
        if TYPESCRIPT && let Some(syntax) = &mut self.type_syntax {
            let entry = syntax.notes.entry(at);
            syntax.notes.nodes[entry].full_start = full_start;
        }
    }

    /// Records `node.Loc` of the node whose `loc` is `at`.
    #[inline]
    pub(crate) fn note_range(&mut self, at: &mut Loc, full_start: Loc, end: Loc) {
        if TYPESCRIPT && let Some(syntax) = &mut self.type_syntax {
            let entry = syntax.notes.entry(at);
            let node = &mut syntax.notes.nodes[entry];
            (node.full_start, node.end) = (full_start, end);
        }
    }

    /// Records `node.End()` of the node whose `loc` is `at`.
    #[inline]
    pub(crate) fn note_end(&mut self, at: &mut Loc, end: Loc) {
        if TYPESCRIPT && let Some(syntax) = &mut self.type_syntax {
            let entry = syntax.notes.entry(at);
            syntax.notes.nodes[entry].end = end;
        }
    }

    /// `finishNode(node, pos)`: the node whose `loc` is `at` has the full start `full_start` and
    /// ends at the end of the previous token.
    #[inline]
    pub(crate) fn finish_node(&mut self, at: &mut Loc, full_start: Loc) {
        let end = self.lexer.full_start();
        if TYPESCRIPT && let Some(syntax) = &mut self.type_syntax {
            let entry = syntax.notes.entry(at);
            let node = &mut syntax.notes.nodes[entry];
            (node.full_start, node.end) = (full_start, end);
        }
    }

    /// The same for the class or object literal member whose name is at `named_at`. The name is an
    /// expression, which has its own end.
    #[inline]
    pub(crate) fn finish_member(&mut self, named_at: &mut Loc, full_start: Loc) {
        self.note_loc(named_at, Mark::MemberFullStart, full_start);
        self.note_token_full_start(named_at, Mark::MemberEnd);
    }

    /// `mark`: pass the result to `rewind_type_syntax` if the parse from this point on is
    /// abandoned.
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
                type_stack: syntax.type_stack.len() as u32,
                name_stack: syntax.name_stack.len() as u32,
                rows: syntax.rows(),
            },
            _ => Checkpoint::default(),
        }
    }

    /// `rewind`: an abandoned speculative parse leaves nothing behind, including on nodes that
    /// existed before it.
    #[inline]
    pub(crate) fn rewind_type_syntax(&mut self, to: &Checkpoint) {
        if TYPESCRIPT && let Some(syntax) = &mut self.type_syntax {
            syntax.rewind(to);
        }
    }
}

impl TypeSyntax<'_> {
    /// The type that `parse_and_keep_type` parsed last. If it is unusable, an error type at its
    /// start.
    pub(super) fn last_type_or_error(&mut self) -> ts::TypeId {
        if self.last_type.is_none() {
            self.last_type = self.b.error_type(self.last_type_start.max(0) as u32);
        }
        self.last_type
    }

    #[cold]
    #[inline(never)]
    fn rewind(&mut self, snapshot: &Checkpoint) {
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
        self.type_stack.truncate(snapshot.type_stack as usize);
        self.name_stack.truncate(snapshot.name_stack as usize);
        self.rewind_rows(snapshot.rows);
        // A result parsed last during the speculative parse is gone with its nodes. A result parsed
        // before it remains the last parsed one.
        let file = &self.b.file;
        if self.last_type.is_some() && self.last_type.idx() >= file.types.len() {
            self.last_type = ts::TypeId::NONE;
        }
        if self.last_binding.is_some() && self.last_binding.idx() >= file.pats.len() {
            self.last_binding = ts::PatternId::NONE;
        }
        // An empty list still has the start index at which it was created.
        macro_rules! remaining {
            ($list:expr, $rows:expr) => {
                match $list {
                    Some(list) if list.is_empty() => Some(Default::default()),
                    list => list.filter(|list| list.range().end <= $rows.len()),
                }
            };
        }
        self.last_type_args = remaining!(self.last_type_args, file.ids);
        self.last_params = remaining!(self.last_params, file.params);
        self.last_type_params = remaining!(self.last_type_params, file.type_params);
        self.last_object_type = self.last_object_type.filter(|body| match body {
            super::keep::ObjectTypeBody::Members(members) => {
                members.range().end <= file.members.len()
            }
            super::keep::ObjectTypeBody::Mapped(mapped) => {
                mapped.param.idx() < file.type_params.len()
                    && mapped.members.range().end <= file.members.len()
                    && (mapped.ty.is_none() || mapped.ty.idx() < file.types.len())
            }
        });
        self.pending_fn_type_head = self
            .pending_fn_type_head
            .filter(|head| head.is_within(file.type_params.len()));
        self.last_index_signature = self
            .last_index_signature
            .filter(|member| member.signature.idx() < file.fns.len());
    }
}

/// End of the string literal whose contents are `inside`, if they are a slice of `source`: after
/// the quote that follows them.
#[inline]
pub(crate) fn end_of_quoted(source: &[u8], inside: &[u8]) -> Option<usize> {
    let offset = (inside.as_ptr() as usize).checked_sub(source.as_ptr() as usize)?;
    (offset + inside.len() < source.len()).then_some(offset + inside.len() + 1)
}
