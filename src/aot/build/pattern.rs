//! What binding patterns and assignment patterns have in common: the iterator of an array pattern, RequireObjectCoercible, and the
//! names that anonymous functions take from where they are written.

use super::fit::Ty;
use super::{FileBuild, Fx, Jump};
use crate::builder::Var;
use crate::id::{BlockId, StrId, TyId, V};
use crate::ir::{self, Op, Target, Term, Why};
use bun_sema::atom::Atom;
use bun_sema::hir::{ClassId, ExprId, ExprKind};
use bun_sema::program::FileId;

/// The iterator record of an array pattern (IteratorBindingInitialization, IteratorDestructuringAssignmentEvaluation).
pub(crate) struct PatternIterator {
    iter: V,
    /// [[Done]]: it has ended, or a step has thrown. It is not asked again and not closed.
    done: Var,
    /// Closes the iterator, unless it is done, and throws on.
    closing: BlockId,
}

impl<'c, 'p, 's> FileBuild<'c, 'p, 's> {
    pub(crate) fn open_pattern_iterator(&mut self, fx: &mut Fx, value: V) -> PatternIterator {
        let iter = self.emit_throwing(fx, Op::IterOpen(value));
        let done = self.new_flag(fx);
        let no = self.emit(fx, Op::Bool(false));
        self.write(fx, done, no);
        PatternIterator { iter, done, closing: fx.b.new_block() }
    }

    /// One step. The value, which is held to `claim`, or `undefined` once the iterator has ended. What a step throws leaves the iterator
    /// as it is.
    pub(crate) fn step_pattern_iterator(&mut self, fx: &mut Fx, it: &PatternIterator, index: i64, wants_value: bool, claim: TyId) -> V {
        let (step, there, ended, join) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
        let result = if claim.is_some() { fx.b.new_var(self.or_undefined(claim)) } else { self.new_temporary(fx) };
        let undefined = self.emit(fx, Op::Undefined);
        self.write(fx, result, undefined);
        let done = self.read(fx, it.done);
        self.branch(fx, done, join, step);
        fx.b.seal(step);
        fx.b.switch_to(step);
        let index = self.emit(fx, Op::Int(index));
        let has = self.emit_throwing(fx, Op::IterHas { iter: it.iter, index });
        self.branch(fx, has, there, ended);
        fx.b.seal(there);
        fx.b.seal(ended);
        fx.b.switch_to(there);
        let got = self.emit_throwing(fx, Op::IterGet { iter: it.iter, index });
        if wants_value {
            let got = self.fit(fx, got, Ty::of(claim), Why::Claim);
            self.write(fx, result, got);
        }
        fx.b.jump(join);
        fx.b.switch_to(ended);
        let yes = self.emit(fx, Op::Bool(true));
        self.write(fx, it.done, yes);
        fx.b.jump(join);
        fx.b.seal(join);
        fx.b.switch_to(join);
        self.read(fx, result)
    }

    /// An array of what is left.
    pub(crate) fn rest_of_pattern_iterator(&mut self, fx: &mut Fx, it: &PatternIterator, from: i64) -> V {
        let array = self.emit_throwing(fx, Op::NewArray(ir::Args::new()));
        let index = self.new_counter(fx, from);
        let (header, step, inside, exit) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
        let done = self.read(fx, it.done);
        self.branch(fx, done, exit, header);
        fx.b.switch_to(header);
        fx.b.jump(step);
        fx.b.seal(step);
        fx.b.switch_to(step);
        let at = self.read(fx, index);
        let has = self.emit_throwing(fx, Op::IterHas { iter: it.iter, index: at });
        self.branch(fx, has, inside, exit);
        fx.b.seal(inside);
        fx.b.switch_to(inside);
        self.emit(fx, Op::Poll);
        let value = self.emit_throwing(fx, Op::IterGet { iter: it.iter, index: at });
        let push = self.out.strs.intern(b"push");
        self.emit_throwing(fx, Op::CallMethod { obj: array, name: push, args: [value].into_iter().collect() });
        self.count(fx, index, at);
        fx.b.jump(header);
        fx.b.seal(header);
        fx.b.seal(exit);
        fx.b.switch_to(exit);
        let yes = self.emit(fx, Op::Bool(true));
        self.write(fx, it.done, yes);
        array
    }

    /// What `f` emits is not a step of the iterator: an initializer, a target, a nested pattern. If it throws, the iterator is closed.
    pub(crate) fn closing_pattern_iterator<R>(&mut self, fx: &mut Fx, it: &PatternIterator, f: impl FnOnce(&mut Self, &mut Fx) -> R) -> R {
        if !self.out.funcs[fx.id.idx()].has(ir::func_flags::GENERATOR) {
            fx.handlers.push(it.closing);
            let result = f(self, fx);
            fx.handlers.pop();
            return result;
        }
        let done = self.read(fx, it.done);
        let outer = fx.not_closed_if.insert(it.iter, done);
        let unwind_depth = fx.handlers.len();
        fx.handlers.push(it.closing);
        fx.jumps.push(Jump { label: Atom::NONE, break_to: BlockId::NONE, continue_to: BlockId::NONE, iter: it.iter, unwind_depth, is_unlabeled_break_target: false, finally_context: None });
        let result = f(self, fx);
        fx.jumps.pop();
        fx.handlers.pop();
        match outer {
            Some(outer) => fx.not_closed_if.insert(it.iter, outer),
            None => fx.not_closed_if.remove(&it.iter),
        };
        result
    }

    /// The end of the pattern.
    pub(crate) fn close_pattern_iterator(&mut self, fx: &mut Fx, it: PatternIterator) {
        let (close, after) = (fx.b.new_block(), fx.b.new_block());
        let done = self.read(fx, it.done);
        self.branch(fx, done, after, close);
        fx.b.seal(close);
        fx.b.switch_to(close);
        self.emit_throwing(fx, Op::IterClose(it.iter));
        fx.b.jump(after);
        fx.b.seal(after);

        fx.b.seal(it.closing);
        fx.b.switch_to(it.closing);
        if !fx.b.has_preds(it.closing) {
            fx.b.terminate(Term::Unreachable);
            fx.b.switch_to(after);
            return;
        }
        let caught = self.emit(fx, Op::CaughtException);
        let (close, throw) = (fx.b.new_block(), fx.b.new_block());
        let done = self.read(fx, it.done);
        self.branch(fx, done, throw, close);
        fx.b.seal(close);
        fx.b.switch_to(close);
        self.emit(fx, Op::IterCloseForThrow(it.iter));
        fx.b.jump(throw);
        fx.b.seal(throw);
        fx.b.switch_to(throw);
        let unwind = fx.handlers.last().map(|&handler| Target::new(handler));
        fx.b.terminate(Term::Throw { value: caught, unwind });

        fx.b.switch_to(after);
    }

    /// RequireObjectCoercible, for a pattern that may read no property of the value: `({} = null)` throws.
    pub(crate) fn require_object_coercible(&mut self, fx: &mut Fx, value: V) {
        let nullish = self.emit(fx, Op::IsNullish(value));
        let (throw, fine) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, nullish, throw, fine);
        fx.b.seal(throw);
        fx.b.seal(fine);
        fx.b.switch_to(throw);
        self.throw_error(fx, b"TypeError", b"Cannot destructure a value that is undefined or null");
        fx.b.switch_to(fine);
    }

    /// `throw new <class>(<message>)`. Ends the block.
    pub(crate) fn throw_error(&mut self, fx: &mut Fx, class: &[u8], message: &[u8]) {
        let name = self.out.strs.intern(class);
        let callee = self.emit_throwing(fx, Op::FreeGet { name, is_typeof: false });
        let message = self.out.strs.intern(message);
        let message = self.emit(fx, Op::Str(message));
        let error = self.emit_throwing(fx, Op::Construct { callee, args: [message].into_iter().collect() });
        let unwind = fx.handlers.last().map(|&handler| Target::new(handler));
        fx.b.terminate(Term::Throw { value: error, unwind });
    }

    // ───────────────────────────── NamedEvaluation ─────────────────────────────

    /// The expression, which if it is an anonymous function or class takes `name` for its own.
    pub(crate) fn expr_named(&mut self, fx: &mut Fx, e: ExprId, name: Atom) -> V {
        if name.is_some() {
            // `#x = () => {}` is named `#x`, as it is written.
            let name = match self.private_name_text(name) {
                Some(written) => self.out.strs.intern(&written),
                None => self.str(name),
            };
            self.give_name(fx, e, name);
        }
        self.expr(fx, e)
    }

    pub(crate) fn expr_named_by_key(&mut self, fx: &mut Fx, e: ExprId, written: ExprId, key: V) -> V {
        let hir = self.hir(fx.file);
        match hir[self.what_takes_the_name(fx, e)].kind {
            ExprKind::Fn(function) if hir[function].name.is_none() => {
                self.name_by_well_known_symbol(fx.file, function, written, b"");
                self.name_by_key = key;
                let value = self.expr(fx, e);
                self.name_by_key = V::NONE;
                value
            }
            ExprKind::Class(class) if hir[class].name.is_none() => {
                self.name_by_key = key;
                let value = self.expr(fx, e);
                self.name_by_key = V::NONE;
                value
            }
            _ => self.expr(fx, e),
        }
    }

    /// The same as what it goes straight to holds it to: see `expr_into`.
    pub(crate) fn expr_named_into(&mut self, fx: &mut Fx, e: ExprId, name: Atom, want: Ty, why: Why) -> V {
        // A function or a class, which is all that takes a name, is held to nothing.
        if matches!(self.hir(fx.file)[self.what_takes_the_name(fx, e)].kind, ExprKind::Fn(_) | ExprKind::Class(_)) {
            let value = self.expr_named(fx, e, name);
            return self.fit(fx, value, want, why);
        }
        self.expr_into(fx, e, want, why)
    }

    /// Its own name, the one it takes from where it is written, or none.
    pub(crate) fn name_of_class(&mut self, file: FileId, class: ClassId) -> StrId {
        let name = self.hir(file)[class].name;
        let is_default_export = self.hir(file)[class].flags.contains(bun_sema::hir::Flags::DEFAULT);
        match self.given_class_names.get(&(file, class)) {
            _ if name.is_some() => self.str(name),
            Some(&given) => given,
            None if is_default_export => self.out.strs.intern(b"default"),
            None => self.out.strs.intern(b""),
        }
    }

    fn what_takes_the_name(&self, fx: &Fx, mut e: ExprId) -> ExprId {
        let hir = self.hir(fx.file);
        while let ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) | ExprKind::NonNull(expr) | ExprKind::Instantiation { expr, .. } = hir[e].kind {
            e = expr;
        }
        e
    }

    pub(crate) fn give_name(&mut self, fx: &Fx, e: ExprId, name: StrId) {
        let hir = self.hir(fx.file);
        match hir[self.what_takes_the_name(fx, e)].kind {
            ExprKind::Fn(func) if hir[func].name.is_none() => {
                self.given_function_names.entry((fx.file, func)).or_insert(name);
            }
            ExprKind::Class(class) if hir[class].name.is_none() => {
                self.given_class_names.entry((fx.file, class)).or_insert(name);
            }
            _ => {}
        }
    }
}
