//! Name-free fingerprints for lockstep renaming: how a symbol is *used* (which properties are read off it, whether
//! and with how many arguments it is called, constructed, indexed, awaited) survives bundling and minification
//! untouched, so `utils`, `utils$1` and `e` all profile the same when they are the same thing.

use bun_ast::binding::Data as B;
use bun_ast::expr::Data as E;
use bun_ast::stmt::Data as S;
use bun_ast::{Binding, Expr, Stmt};

/// One order-independent hash per symbol (indexed by `Ref::inner_index`); 0 when the symbol is never used.
pub(crate) fn profiles(ast: &bun_ast::Ast<'_>, symbol_count: usize) -> Vec<u64> {
    let mut w = Walker {
        acc: vec![0u64; symbol_count],
    };
    for part in ast.parts.iter() {
        for stmt in part.stmts.slice() {
            w.stmt(stmt);
        }
    }
    w.acc
}

struct Walker {
    acc: Vec<u64>,
}

fn mix(tag: u8, bytes: &[u8], n: u64) -> u64 {
    // FNV-1a over (tag, bytes, n); commutative accumulation happens in `note`.
    let mut h: u64 = 0xcbf29ce484222325 ^ u64::from(tag);
    for &b in bytes {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x100000001b3);
    }
    (h ^ n).wrapping_mul(0x100000001b3) | 1
}

impl Walker {
    fn note(&mut self, target: &Expr, tag: u8, bytes: &[u8], n: u64) {
        if let E::EIdentifier(id) = &target.data {
            if let Some(slot) = self.acc.get_mut(id.ref_.inner_index() as usize) {
                // Sum of per-use hashes: a multiset, so use order and count both matter but position does not.
                *slot = slot.wrapping_add(mix(tag, bytes, n));
            }
        }
    }

    fn stmts(&mut self, stmts: &[Stmt]) {
        for s in stmts {
            self.stmt(s);
        }
    }

    fn opt_expr(&mut self, e: &Option<Expr>) {
        if let Some(e) = e {
            self.expr(e);
        }
    }

    fn func(&mut self, f: &bun_ast::G::Fn) {
        for arg in f.args.slice() {
            self.binding(&arg.binding);
            self.opt_expr(&arg.default);
        }
        self.stmts(f.body.stmts.slice());
    }

    fn class(&mut self, c: &bun_ast::G::Class) {
        self.opt_expr(&c.extends);
        for p in c.properties.slice() {
            self.opt_expr(&p.key);
            self.opt_expr(&p.value);
            self.opt_expr(&p.initializer);
            if let Some(block) = &p.class_static_block {
                self.stmts(&block.stmts);
            }
        }
    }

    fn binding(&mut self, b: &Binding) {
        match &b.data {
            B::BArray(a) => {
                for item in a.items.slice() {
                    self.binding(&item.binding);
                    self.opt_expr(&item.default_value);
                }
            }
            B::BObject(o) => {
                for p in o.properties.slice() {
                    self.expr(&p.key);
                    self.binding(&p.value);
                    self.opt_expr(&p.default_value);
                }
            }
            B::BIdentifier(_) | B::BMissing(_) => {}
        }
    }

    fn stmt(&mut self, s: &Stmt) {
        match &s.data {
            S::SBlock(b) => self.stmts(b.stmts.slice()),
            S::SClass(c) => self.class(&c.class),
            S::SDoWhile(x) => {
                self.stmt(&x.body);
                self.expr(&x.test);
            }
            S::SExportDefault(x) => match &x.value {
                bun_ast::StmtOrExpr::Stmt(s) => self.stmt(s),
                bun_ast::StmtOrExpr::Expr(e) => self.expr(e),
            },
            S::SExpr(x) => self.expr(&x.value),
            S::SForIn(x) => {
                self.stmt(&x.init);
                self.expr(&x.value);
                self.stmt(&x.body);
            }
            S::SForOf(x) => {
                self.stmt(&x.init);
                self.expr(&x.value);
                self.stmt(&x.body);
            }
            S::SFor(x) => {
                if let Some(i) = &x.init {
                    self.stmt(i);
                }
                self.opt_expr(&x.test);
                self.opt_expr(&x.update);
                self.stmt(&x.body);
            }
            S::SFunction(f) => self.func(&f.func),
            S::SIf(x) => {
                self.expr(&x.test);
                self.stmt(&x.yes);
                if let Some(n) = &x.no {
                    self.stmt(n);
                }
            }
            S::SLabel(x) => self.stmt(&x.stmt),
            S::SLocal(x) => {
                for d in x.decls.iter() {
                    self.binding(&d.binding);
                    self.opt_expr(&d.value);
                }
            }
            S::SReturn(x) => self.opt_expr(&x.value),
            S::SSwitch(x) => {
                self.expr(&x.test);
                for c in x.cases.slice() {
                    self.opt_expr(&c.value);
                    self.stmts(c.body.slice());
                }
            }
            S::SThrow(x) => self.expr(&x.value),
            S::STry(x) => {
                self.stmts(x.body.slice());
                if let Some(c) = &x.catch {
                    if let Some(b) = &c.binding {
                        self.binding(b);
                    }
                    self.stmts(c.body.slice());
                }
                if let Some(f) = &x.finally {
                    self.stmts(f.stmts.slice());
                }
            }
            S::SWhile(x) => {
                self.expr(&x.test);
                self.stmt(&x.body);
            }
            S::SWith(x) => {
                self.expr(&x.value);
                self.stmt(&x.body);
            }
            _ => {}
        }
    }

    fn expr(&mut self, e: &Expr) {
        match &e.data {
            E::EArray(x) => {
                for i in x.items.iter() {
                    self.expr(i);
                }
            }
            E::EUnary(x) => {
                self.note(&x.value, b'u', &[x.op as u8], 0);
                self.expr(&x.value);
            }
            E::EBinary(x) => {
                // Left-associative chains are a deep left spine in minified code: iterate it.
                let mut cur = x;
                loop {
                    self.note(&cur.left, b'l', &[cur.op as u8], 0);
                    self.note(&cur.right, b'r', &[cur.op as u8], 0);
                    self.expr(&cur.right);
                    match &cur.left.data {
                        E::EBinary(inner) => cur = inner,
                        _ => {
                            self.expr(&cur.left);
                            break;
                        }
                    }
                }
            }
            E::EClass(c) => self.class(c),
            E::ENew(x) => {
                self.note(&x.target, b'n', b"", x.args.len() as u64);
                self.expr(&x.target);
                for a in x.args.iter() {
                    self.expr(a);
                }
            }
            E::EFunction(f) => self.func(&f.func),
            E::ECall(x) => {
                match &x.target.data {
                    // `sym.method(a, b)`: the method name and arity describe `sym`.
                    E::EDot(d) => self.note(&d.target, b'm', d.name.slice(), x.args.len() as u64),
                    _ => self.note(&x.target, b'c', b"", x.args.len() as u64),
                }
                self.expr(&x.target);
                for (i, a) in x.args.iter().enumerate() {
                    // Being passed as argument i of an N-ary call is also part of a symbol's shape.
                    self.note(a, b'a', &[i.min(255) as u8], x.args.len() as u64);
                    self.expr(a);
                }
            }
            E::EDot(x) => {
                self.note(&x.target, b'.', x.name.slice(), 0);
                self.expr(&x.target);
            }
            E::EIndex(x) => {
                self.note(&x.target, b'[', b"", 0);
                self.expr(&x.target);
                self.expr(&x.index);
            }
            E::EArrow(x) => {
                for arg in x.args.slice() {
                    self.binding(&arg.binding);
                    self.opt_expr(&arg.default);
                }
                self.stmts(x.body.stmts.slice());
            }
            E::EJsxElement(x) => {
                self.opt_expr(&x.tag);
                for p in x.properties.iter() {
                    self.opt_expr(&p.key);
                    self.opt_expr(&p.value);
                    self.opt_expr(&p.initializer);
                }
                for c in x.children.iter() {
                    self.expr(c);
                }
            }
            E::EObject(x) => {
                for p in x.properties.iter() {
                    self.opt_expr(&p.key);
                    if let (Some(k), Some(v)) = (&p.key, &p.value) {
                        // `{ name: sym }`: the key it is filed under says what `sym` is for.
                        if let E::EString(k) = &k.data {
                            if k.is_utf8() {
                                self.note(v, b':', k.slice8(), 0);
                            }
                        }
                    }
                    self.opt_expr(&p.value);
                    self.opt_expr(&p.initializer);
                }
            }
            E::ESpread(x) => self.expr(&x.value),
            E::ETemplate(x) => {
                self.opt_expr(&x.tag);
                for part in x.parts.slice() {
                    self.expr(&part.value);
                }
            }
            E::EAwait(x) => {
                self.note(&x.value, b'w', b"", 0);
                self.expr(&x.value);
            }
            E::EYield(x) => self.opt_expr(&x.value),
            E::EIf(x) => {
                self.expr(&x.test);
                self.expr(&x.yes);
                self.expr(&x.no);
            }
            E::EImport(x) => {
                self.expr(&x.expr);
                self.expr(&x.options);
            }
            _ => {}
        }
    }
}
