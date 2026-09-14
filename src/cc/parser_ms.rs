//! What Microsoft C has that is spelled like a function call.
//!
//! `__noop`, `__assume`, `__annotation` and `__va_start` are part of the language. The
//! intrinsics (`_BitScanForward`, `_InterlockedExchangeAdd`, `__readgsqword`, ...) are functions
//! that headers declare, anyone may declare, and nothing defines: a call to one that the
//! program does not define itself goes to the definition of the same name in the prelude
//! (`include/ms_intrinsics.h`, read ahead of every translation unit for a Windows target),
//! where each one is written in C.

use std::rc::Rc;

use super::Parser;
use crate::ast::{Expr, Intrinsic, Stmt};
use crate::sema::Symbol;
use crate::token::{Kw, Loc, Punct, Res, TokenSource, err};
use crate::types::{FuncType, Type};

/// What the prelude's definitions are called: `__bun_ms_` and the intrinsic's name.
pub(crate) const PRELUDE_PREFIX: &str = "__bun_ms_";

impl<S: TokenSource> Parser<S> {
    /// An identifier followed by `(`, for a Windows target. Returns `None` for an ordinary call.
    pub(super) fn parse_microsoft_call(&mut self, name: &Rc<str>, loc: Loc) -> Res<Option<Expr>> {
        match &**name {
            // The arguments are not evaluated, nor even compiled.
            "__noop" | "__annotation" => {
                self.bump()?;
                self.skip_balanced(Punct::LParen, Punct::RParen)?;
                let zero = self.sema.int_lit(0, Type::Int, loc)?;
                if &**name == "__noop" {
                    return Ok(Some(zero));
                }
                Ok(Some(self.sema.cast(zero, &Type::Void, loc)?))
            }
            // A promise, not a computation: only `__assume(0)`, "control does not get here",
            // says something this compiler uses.
            "__assume" => {
                let mut args = self.parse_builtin_args()?;
                if args.len() != 1 {
                    return err(loc, "__assume takes one argument");
                }
                let promised = args.swap_remove(0);
                if matches!(self.sema.const_int(&promised), Ok(0)) {
                    return Ok(Some(self.sema.intrinsic(
                        Intrinsic::Unreachable,
                        None,
                        Type::Void,
                        loc,
                    )?));
                }
                Ok(Some(self.sema.discard_all(Vec::new(), loc)?))
            }
            // `__va_start(&list, last)`, behind <vadefs.h>'s `va_start`; the ARM64 form has
            // more operands, which describe `last` again.
            "__va_start" => {
                let mut args = self.parse_builtin_args()?;
                if args.is_empty() {
                    return err(loc, "__va_start takes the address of a va_list");
                }
                let list = self.sema.rvalue(args.swap_remove(0))?;
                let list = self.sema.deref(list, loc)?;
                Ok(Some(self.sema.va_start(list, loc)?))
            }
            // `setjmp` in Microsoft's <setjmp.h>. Their compiler passes it a second argument
            // the prototype does not have, the frame that `longjmp` is to unwind to through the
            // tables of every function on the way. This compiler's functions have no such
            // tables: null there says to restore the registers and nothing more.
            "_setjmp" if matches!(self.sema.lookup(name), Some(Symbol::Func(_))) => {
                let mut args = self.parse_builtin_args()?;
                let callee = self.sema.ident(name, loc)?;
                if args.len() != 1 {
                    return Ok(Some(self.sema.call(callee, args, loc)?));
                }
                let pointer = Type::Void.ptr_to();
                let with_frame = Type::Func(Rc::new(FuncType {
                    ret: Type::Int,
                    params: vec![pointer.clone(), pointer.clone()],
                    variadic: false,
                    unprototyped: false,
                }));
                let callee = self.sema.rvalue(callee)?;
                let callee = self.sema.cast(callee, &with_frame.ptr_to(), loc)?;
                let null = self.sema.int_lit(0, Type::Int, loc)?;
                args.push(self.sema.cast(null, &pointer, loc)?);
                Ok(Some(self.sema.call(callee, args, loc)?))
            }
            _ => self.microsoft_intrinsic(name, loc),
        }
    }

    /// `__try { } __except (filter) { }`, `__try { } __finally { }` and `__leave;`: parsed, and
    /// an error in a function that is compiled, which the inline functions of headers that
    /// use them seldom are. There is no unwinding through this compiler's frames.
    pub(super) fn parse_structured_exception_handling(&mut self) -> Res<Stmt> {
        let loc = self.loc();
        let message = "structured exception handling (__try) is not supported";
        let marker = self
            .sema
            .unsupported_value(Type::Void, message.to_string(), loc)?;
        if self.eat_kw(Kw::Leave)? {
            self.expect(Punct::Semi)?;
            return Ok(Stmt::Expr(marker));
        }
        self.bump()?;
        if !self.at(Punct::LBrace) {
            return err(self.loc(), "expected '{' after __try");
        }
        let guarded = self.parse_statement()?;
        let mut parts = vec![Stmt::Expr(marker), guarded];
        if self.eat_kw(Kw::Except)? {
            self.expect(Punct::LParen)?;
            let filter = self.parse_expr()?;
            self.expect(Punct::RParen)?;
            parts.push(Stmt::Expr(self.sema.expression_statement(filter)));
        } else if !self.eat_kw(Kw::Finally)? {
            return err(
                self.loc(),
                "expected __except or __finally after the block of __try",
            );
        }
        if !self.at(Punct::LBrace) {
            return err(self.loc(), "expected '{'");
        }
        parts.push(self.parse_statement()?);
        Ok(Stmt::Block(parts))
    }

    /// The prelude's definition of intrinsic `name`, when the program has none of its own.
    fn microsoft_intrinsic(&mut self, name: &Rc<str>, loc: Loc) -> Res<Option<Expr>> {
        let in_its_definition = self.sema.func.as_ref().is_some_and(|f| f.name == *name);
        let defined_by_the_program = match self.sema.lookup(name) {
            Some(Symbol::Func(id)) => self.sema.funcs[*id as usize].body.is_some(),
            Some(_) => true,
            None => false,
        };
        if in_its_definition || defined_by_the_program {
            return Ok(None);
        }
        let ours = format!("{PRELUDE_PREFIX}{name}");
        match self.sema.lookup(&ours) {
            Some(Symbol::Func(_)) => Ok(Some(self.sema.ident(&ours, loc)?)),
            _ => Ok(None),
        }
    }
}
