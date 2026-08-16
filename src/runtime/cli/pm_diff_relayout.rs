//! Undoes the layout tricks minifiers use to save bytes — `var a = 1, b = 2, …` chains, `a(), b(), c()` comma
//! statements, one-line object literals — so the un-minified view of a bundle reads one thing per line. All of it is
//! meaning-preserving, and this only ever feeds a display print.

use bun_alloc::Arena;
use bun_ast::binding::Data as B;
use bun_ast::expr::Data as E;
use bun_ast::stmt::Data as S;
use bun_ast::{Binding, Expr, Stmt, StoreSlice};

pub(crate) fn relayout(arena: &Arena, ast: &mut bun_ast::Ast<'_>) {
    for part in ast.parts.iter_mut() {
        stmt_list(arena, &mut part.stmts);
    }
}

fn stmt_list(arena: &Arena, list: &mut StoreSlice<Stmt>) {
    let stmts = list.slice_mut();
    let needs = stmts.iter().any(|s| match &s.data {
        S::SLocal(l) => l.decls.len() > 1,
        S::SExpr(x) => matches!(&x.value.data, E::EBinary(b) if b.op == bun_ast::OpCode::BinComma),
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
                        arena,
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
                        out.push(Stmt::allocate_expr(arena, e));
                    }
                } else {
                    out.push(*s);
                }
            }
            _ => out.push(*s),
        }
    }
    *list = StoreSlice::new_mut(arena.alloc_slice_copy(&out));
}

fn comma_leaves(e: &Expr, out: &mut Vec<Expr>) {
    match &e.data {
        E::EBinary(b) if b.op == bun_ast::OpCode::BinComma => {
            comma_leaves(&b.left, out);
            comma_leaves(&b.right, out);
        }
        _ => out.push(*e),
    }
}

fn body(arena: &Arena, s: &mut Stmt) {
    // A lone statement in a body position may itself need splitting; give it a list to split into.
    if let S::SBlock(b) = &mut s.data {
        stmt_list(arena, &mut b.stmts);
    } else {
        stmt(arena, s);
    }
}

fn func(arena: &Arena, f: &mut bun_ast::G::Fn) {
    for arg in f.args.slice_mut() {
        binding(arena, &mut arg.binding);
        opt_expr(arena, &mut arg.default);
    }
    stmt_list(arena, &mut f.body.stmts);
}

fn class(arena: &Arena, c: &mut bun_ast::G::Class) {
    opt_expr(arena, &mut c.extends);
    for p in c.properties.slice_mut() {
        opt_expr(arena, &mut p.key);
        opt_expr(arena, &mut p.value);
        opt_expr(arena, &mut p.initializer);
        if let Some(block) = &mut p.class_static_block {
            for s in block.stmts.iter_mut() {
                stmt(arena, s);
            }
        }
    }
}

fn binding(arena: &Arena, b: &mut Binding) {
    match &mut b.data {
        B::BArray(a) => {
            for item in a.items.slice_mut() {
                binding(arena, &mut item.binding);
                opt_expr(arena, &mut item.default_value);
            }
        }
        B::BObject(o) => {
            for p in o.properties.slice_mut() {
                expr(arena, &mut p.key);
                binding(arena, &mut p.value);
                opt_expr(arena, &mut p.default_value);
            }
        }
        B::BIdentifier(_) | B::BMissing(_) => {}
    }
}

fn opt_expr(arena: &Arena, e: &mut Option<Expr>) {
    if let Some(e) = e {
        expr(arena, e);
    }
}

fn stmt(arena: &Arena, s: &mut Stmt) {
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
            expr(arena, &mut x.value);
            body(arena, &mut x.body);
        }
        S::SForOf(x) => {
            expr(arena, &mut x.value);
            body(arena, &mut x.body);
        }
        S::SFor(x) => {
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
        _ => {}
    }
}

fn expr(arena: &Arena, e: &mut Expr) {
    match &mut e.data {
        E::EArray(x) => {
            if x.items.len() > 8 {
                x.is_single_line = false;
            }
            for i in x.items.iter_mut() {
                expr(arena, i);
            }
        }
        E::EUnary(x) => expr(arena, &mut x.value),
        E::EBinary(x) => {
            expr(arena, &mut x.left);
            expr(arena, &mut x.right);
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
            // A minifier's one-line `{a:1,b:2,…}` reads (and diffs) better one property per line.
            if x.properties.len() > 3 {
                x.is_single_line = false;
            }
            for p in x.properties.iter_mut() {
                opt_expr(arena, &mut p.key);
                opt_expr(arena, &mut p.value);
                opt_expr(arena, &mut p.initializer);
            }
        }
        E::ESpread(x) => expr(arena, &mut x.value),
        E::ETemplate(x) => {
            opt_expr(arena, &mut x.tag);
            for part in x.parts.slice_mut() {
                expr(arena, &mut part.value);
            }
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
