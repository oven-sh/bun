//! Layout the parser remembers from the source (`{a, b}` on one line or three) must not survive into a canonical
//! print, so every `is_single_line` is re-decided from the node itself. For the un-minified display, `split` also
//! undoes the tricks minifiers use to save bytes — `var a = 1, b = 2, …` chains and `a(), b(), c()` comma statements
//! — so a bundle reads one thing per line. All of it is meaning-preserving.

use bun_alloc::Arena;
use bun_ast::binding::Data as B;
use bun_ast::expr::Data as E;
use bun_ast::stmt::Data as S;
use bun_ast::{Binding, Expr, Stmt, StoreSlice};

pub(crate) fn relayout(arena: &Arena, ast: &mut bun_ast::Ast<'_>, split: bool) {
    let cx = Cx { arena, split };
    for part in ast.parts.iter_mut() {
        stmt_list(&cx, &mut part.stmts);
    }
}

struct Cx<'a> {
    arena: &'a Arena,
    split: bool,
}
type C<'c, 'a> = &'c Cx<'a>;

/// Short literals and clauses on one line, longer ones one entry per line — decided by count, never by source.
const ONE_LINE_MAX: usize = 3;

fn stmt_list(arena: C, list: &mut StoreSlice<Stmt>) {
    let stmts = list.slice_mut();
    let needs = arena.split
        && stmts.iter().any(|s| match &s.data {
            S::SLocal(l) => l.decls.len() > 1,
            S::SExpr(x) => {
                matches!(&x.value.data, E::EBinary(b) if b.op == bun_ast::OpCode::BinComma)
            }
            _ => false,
        });
    for s in stmts.iter_mut() {
        stmt(arena, s);
    }
    if !needs {
        return;
    }
    let mut out: Vec<Stmt> = Vec::with_capacity(stmts.len() * 2);
    for s in stmts.iter() {
        match &s.data {
            S::SLocal(l) if l.decls.len() > 1 => {
                for d in l.decls.iter() {
                    let mut decls = bun_alloc::AstAlloc::vec();
                    decls.push(*d);
                    out.push(Stmt::allocate(
                        arena.arena,
                        bun_ast::S::Local {
                            kind: l.kind,
                            decls,
                            is_export: l.is_export,
                            origin: l.origin,
                        },
                        s.loc,
                    ));
                }
            }
            S::SExpr(x) => {
                let mut leaves = Vec::new();
                comma_leaves(&x.value, &mut leaves);
                if leaves.len() > 1 {
                    for e in leaves {
                        out.push(Stmt::allocate_expr(arena.arena, e));
                    }
                } else {
                    out.push(*s);
                }
            }
            _ => out.push(*s),
        }
    }
    *list = StoreSlice::new_mut(arena.arena.alloc_slice_copy(&out));
}

/// `a, b, c, …` parses as a left-leaning spine; walk it with a stack, not the call stack.
fn comma_leaves(e: &Expr, out: &mut Vec<Expr>) {
    let mut rights = Vec::new();
    let mut cur = *e;
    loop {
        match &cur.data {
            E::EBinary(b) if b.op == bun_ast::OpCode::BinComma => {
                rights.push(b.right);
                cur = b.left;
            }
            _ => break,
        }
    }
    out.push(cur);
    out.extend(rights.into_iter().rev());
}

/// A body position holds one statement; when splitting turns it into several, wrap them in a block.
fn body(arena: C, s: &mut Stmt) {
    if let S::SBlock(b) = &mut s.data {
        stmt_list(arena, &mut b.stmts);
        return;
    }
    let mut list = StoreSlice::new_mut(core::slice::from_mut(s));
    stmt_list(arena, &mut list);
    if list.len() > 1 {
        *s = Stmt::allocate(
            arena.arena,
            bun_ast::S::Block {
                stmts: list,
                close_brace_loc: bun_ast::Loc::EMPTY,
            },
            s.loc,
        );
    }
}

fn func(arena: C, f: &mut bun_ast::G::Fn) {
    for arg in f.args.slice_mut() {
        binding(arena, &mut arg.binding);
        opt_expr(arena, &mut arg.default);
    }
    stmt_list(arena, &mut f.body.stmts);
}

fn class(arena: C, c: &mut bun_ast::G::Class) {
    opt_expr(arena, &mut c.extends);
    for p in c.properties.slice_mut() {
        opt_expr(arena, &mut p.key);
        opt_expr(arena, &mut p.value);
        opt_expr(arena, &mut p.initializer);
        if let Some(block) = &mut p.class_static_block {
            let mut list = StoreSlice::new_mut(block.stmts.as_mut_slice());
            stmt_list(arena, &mut list);
            if list.len() != block.stmts.len() {
                block.stmts.clear();
                block.stmts.extend_from_slice(list.slice());
            }
        }
    }
}

fn binding(arena: C, b: &mut Binding) {
    match &mut b.data {
        B::BArray(a) => {
            a.is_single_line = a.items.len() <= 8;
            for item in a.items.slice_mut() {
                binding(arena, &mut item.binding);
                opt_expr(arena, &mut item.default_value);
            }
        }
        B::BObject(o) => {
            o.is_single_line = o.properties.len() <= ONE_LINE_MAX;
            for p in o.properties.slice_mut() {
                expr(arena, &mut p.key);
                binding(arena, &mut p.value);
                opt_expr(arena, &mut p.default_value);
            }
        }
        B::BIdentifier(_) | B::BMissing(_) => {}
    }
}

fn opt_expr(arena: C, e: &mut Option<Expr>) {
    if let Some(e) = e {
        expr(arena, e);
    }
}

fn stmt(arena: C, s: &mut Stmt) {
    match &mut s.data {
        S::SBlock(b) => stmt_list(arena, &mut b.stmts),
        S::SClass(c) => class(arena, &mut c.class),
        S::SDoWhile(x) => {
            body(arena, &mut x.body);
            expr(arena, &mut x.test);
        }
        S::SExportDefault(x) => match &mut x.value {
            bun_ast::StmtOrExpr::Stmt(s) => stmt(arena, s),
            bun_ast::StmtOrExpr::Expr(e) => expr(arena, e),
        },
        S::SExpr(x) => expr(arena, &mut x.value),
        S::SForIn(x) => {
            stmt(arena, &mut x.init);
            expr(arena, &mut x.value);
            body(arena, &mut x.body);
        }
        S::SForOf(x) => {
            stmt(arena, &mut x.init);
            expr(arena, &mut x.value);
            body(arena, &mut x.body);
        }
        S::SFor(x) => {
            if let Some(i) = &mut x.init {
                stmt(arena, i);
            }
            opt_expr(arena, &mut x.test);
            opt_expr(arena, &mut x.update);
            body(arena, &mut x.body);
        }
        S::SFunction(f) => func(arena, &mut f.func),
        S::SIf(x) => {
            expr(arena, &mut x.test);
            body(arena, &mut x.yes);
            if let Some(n) = &mut x.no {
                body(arena, n);
            }
        }
        S::SLabel(x) => body(arena, &mut x.stmt),
        S::SLocal(x) => {
            for d in x.decls.iter_mut() {
                binding(arena, &mut d.binding);
                opt_expr(arena, &mut d.value);
            }
        }
        S::SReturn(x) => opt_expr(arena, &mut x.value),
        S::SSwitch(x) => {
            expr(arena, &mut x.test);
            for c in x.cases.slice_mut() {
                opt_expr(arena, &mut c.value);
                stmt_list(arena, &mut c.body);
            }
        }
        S::SThrow(x) => expr(arena, &mut x.value),
        S::STry(x) => {
            stmt_list(arena, &mut x.body);
            if let Some(c) = &mut x.catch {
                if let Some(b) = &mut c.binding {
                    binding(arena, b);
                }
                stmt_list(arena, &mut c.body);
            }
            if let Some(f) = &mut x.finally {
                stmt_list(arena, &mut f.stmts);
            }
        }
        S::SWhile(x) => {
            expr(arena, &mut x.test);
            body(arena, &mut x.body);
        }
        S::SWith(x) => {
            expr(arena, &mut x.value);
            body(arena, &mut x.body);
        }
        S::SImport(x) => x.is_single_line = x.items.len() <= ONE_LINE_MAX,
        S::SExportClause(x) => x.is_single_line = x.items.len() <= ONE_LINE_MAX,
        S::SExportFrom(x) => x.is_single_line = x.items.len() <= ONE_LINE_MAX,
        _ => {}
    }
}

fn expr(arena: C, e: &mut Expr) {
    match &mut e.data {
        E::EArray(x) => {
            x.is_single_line = x.items.len() <= 8;
            for i in x.items.iter_mut() {
                expr(arena, i);
            }
        }
        E::EUnary(x) => expr(arena, &mut x.value),
        E::EBinary(x) => {
            // Binary chains (`a+b+c`, `a,b,c`, `a=b=c`) are deep spines in minified code: walk both sides with a
            // work-list, only leaving it for non-binary operands.
            let mut work = vec![x.left, x.right];
            while let Some(mut e) = work.pop() {
                match &e.data {
                    E::EBinary(inner) => {
                        work.push(inner.left);
                        work.push(inner.right);
                    }
                    _ => expr(arena, &mut e),
                }
            }
        }
        E::EClass(c) => class(arena, c),
        E::ENew(x) => {
            expr(arena, &mut x.target);
            for a in x.args.iter_mut() {
                expr(arena, a);
            }
        }
        E::EFunction(f) => func(arena, &mut f.func),
        E::ECall(x) => {
            expr(arena, &mut x.target);
            for a in x.args.iter_mut() {
                expr(arena, a);
            }
        }
        E::EDot(x) => expr(arena, &mut x.target),
        E::EIndex(x) => {
            expr(arena, &mut x.target);
            expr(arena, &mut x.index);
        }
        E::EArrow(x) => {
            for arg in x.args.slice_mut() {
                binding(arena, &mut arg.binding);
                opt_expr(arena, &mut arg.default);
            }
            stmt_list(arena, &mut x.body.stmts);
        }
        E::EObject(x) => {
            x.is_single_line = x.properties.len() <= ONE_LINE_MAX;
            for p in x.properties.iter_mut() {
                opt_expr(arena, &mut p.key);
                opt_expr(arena, &mut p.value);
                opt_expr(arena, &mut p.initializer);
            }
        }
        E::EJsxElement(x) => {
            opt_expr(arena, &mut x.tag);
            for p in x.properties.iter_mut() {
                opt_expr(arena, &mut p.key);
                opt_expr(arena, &mut p.value);
                opt_expr(arena, &mut p.initializer);
            }
            for c in x.children.iter_mut() {
                expr(arena, c);
            }
        }
        E::ESpread(x) => expr(arena, &mut x.value),
        E::ETemplate(x) => {
            opt_expr(arena, &mut x.tag);
            for part in x.parts.slice_mut() {
                expr(arena, &mut part.value);
            }
        }
        E::EImport(x) => {
            expr(arena, &mut x.expr);
            expr(arena, &mut x.options);
        }
        E::EAwait(x) => expr(arena, &mut x.value),
        E::EYield(x) => opt_expr(arena, &mut x.value),
        E::EIf(x) => {
            expr(arena, &mut x.test);
            expr(arena, &mut x.yes);
            expr(arena, &mut x.no);
        }
        _ => {}
    }
}
