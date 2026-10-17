use super::coerce::Ty;
use super::{FileBuild, Fx, Jump};
use crate::builder::Var;
use crate::id::{BlockId, StrId, TyId, V};
use crate::ir::{self, Op, Target, Term, CoerceReason};
use bun_sema::atom::Atom;
use bun_sema::hir::{ClassId, ExprId, ExprKind};
use bun_sema::program::FileId;

pub(crate) struct PatternIterator {
    iter: V,
    done: Var,
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
            let got = self.coerce_to(fx, got, Ty::from_id(claim), CoerceReason::Claim);
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

    pub(crate) fn collect_pattern_iterator_rest(&mut self, fx: &mut Fx, it: &PatternIterator, from: i64) -> V {
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

    pub(crate) fn with_pattern_iterator_close<R>(&mut self, fx: &mut Fx, it: &PatternIterator, f: impl FnOnce(&mut Self, &mut Fx) -> R) -> R {
        if !self.out.funcs[fx.id.idx()].has(ir::func_flags::GENERATOR) {
            fx.handlers.push(it.closing);
            let result = f(self, fx);
            fx.handlers.pop();
            return result;
        }
        let done = self.read(fx, it.done);
        let outer = fx.skip_close_if.insert(it.iter, done);
        let unwind_depth = fx.handlers.len();
        fx.handlers.push(it.closing);
        fx.jumps.push(Jump { label: Atom::NONE, break_to: BlockId::NONE, continue_to: BlockId::NONE, iter: it.iter, unwind_depth, is_unlabeled_break_target: false, finally_context: None });
        let result = f(self, fx);
        fx.jumps.pop();
        fx.handlers.pop();
        match outer {
            Some(outer) => fx.skip_close_if.insert(it.iter, outer),
            None => fx.skip_close_if.remove(&it.iter),
        };
        result
    }

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
        fx.b.terminate(Term::Throw { value: caught, unwind, pos: 0 });

        fx.b.switch_to(after);
    }

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

    pub(crate) fn throw_error(&mut self, fx: &mut Fx, class: &[u8], message: &[u8]) {
        let name = self.out.strs.intern(class);
        let callee = self.emit_throwing(fx, Op::FreeGet { name, is_typeof: false });
        let message = self.out.strs.intern(message);
        let message = self.emit(fx, Op::Str(message));
        let error = self.emit_throwing(fx, Op::Construct { callee, args: [message].into_iter().collect() });
        let unwind = fx.handlers.last().map(|&handler| Target::new(handler));
        fx.b.terminate(Term::Throw { value: error, unwind, pos: 0 });
    }

    pub(crate) fn expr_with_name(&mut self, fx: &mut Fx, e: ExprId, name: Atom) -> V {
        if name.is_some() {
            let name = match self.private_name_text(name) {
                Some(written) => self.out.strs.intern(&written),
                None => match self.c.constant_symbol_of_property(name) {
                    Some(symbol) => {
                        let text = symbol.description.map_or(Vec::new(), |description| [b"[", self.c.atoms().bytes(description), b"]"].concat());
                        self.out.strs.intern(&text)
                    }
                    None => self.str(name),
                },
            };
            self.set_inferred_name(fx, e, name);
        }
        self.expr(fx, e)
    }

    pub(crate) fn expr_with_key_name(&mut self, fx: &mut Fx, e: ExprId, written: ExprId, key: V) -> V {
        let hir = self.hir(fx.file);
        match hir[self.inferred_name_target(fx, e)].kind {
            ExprKind::Fn(function) if hir[function].name.is_none() => {
                self.name_from_well_known_symbol(fx.file, function, written, b"");
                self.key_name_value = key;
                let value = self.expr(fx, e);
                self.key_name_value = V::NONE;
                value
            }
            ExprKind::Class(class) if hir[class].name.is_none() => {
                self.key_name_value = key;
                let value = self.expr(fx, e);
                self.key_name_value = V::NONE;
                value
            }
            _ => self.expr(fx, e),
        }
    }

    pub(crate) fn expr_with_name_into(&mut self, fx: &mut Fx, e: ExprId, name: Atom, want: Ty, why: CoerceReason) -> V {
        if matches!(self.hir(fx.file)[self.inferred_name_target(fx, e)].kind, ExprKind::Fn(_) | ExprKind::Class(_)) {
            let value = self.expr_with_name(fx, e, name);
            return self.coerce_to(fx, value, want, why);
        }
        self.expr_into(fx, e, want, why)
    }

    pub(crate) fn expr_with_name_into_if_convertible(&mut self, fx: &mut Fx, e: ExprId, name: Atom, want: Ty) -> V {
        if matches!(self.hir(fx.file)[self.inferred_name_target(fx, e)].kind, ExprKind::Fn(_) | ExprKind::Class(_)) {
            return self.expr_with_name_into(fx, e, name, want, CoerceReason::Cast);
        }
        self.expr_into_if_convertible(fx, e, want)
    }

    pub(crate) fn name_of_class(&mut self, file: FileId, class: ClassId) -> StrId {
        let name = self.hir(file)[class].name;
        let is_default_export = self.hir(file)[class].flags.contains(bun_sema::hir::Flags::DEFAULT);
        match self.inferred_class_names.get(&(file, class)) {
            _ if name.is_some() => self.str(name),
            Some(&given) => given,
            None if is_default_export => self.out.strs.intern(b"default"),
            None => self.out.strs.intern(b""),
        }
    }

    fn inferred_name_target(&self, fx: &Fx, mut e: ExprId) -> ExprId {
        let hir = self.hir(fx.file);
        while let ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) | ExprKind::NonNull(expr) | ExprKind::Instantiation { expr, .. } = hir[e].kind {
            e = expr;
        }
        e
    }

    pub(crate) fn set_inferred_name(&mut self, fx: &Fx, e: ExprId, name: StrId) {
        let hir = self.hir(fx.file);
        match hir[self.inferred_name_target(fx, e)].kind {
            ExprKind::Fn(func) if hir[func].name.is_none() => {
                self.inferred_function_names.entry((fx.file, func)).or_insert(name);
            }
            ExprKind::Class(class) if hir[class].name.is_none() => {
                self.inferred_class_names.entry((fx.file, class)).or_insert(name);
            }
            _ => {}
        }
    }
}
