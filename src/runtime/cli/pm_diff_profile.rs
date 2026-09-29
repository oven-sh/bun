//! Name-free fingerprints for lockstep renaming: how a symbol is *used* (which properties are read off it, whether
//! and with how many arguments it is called, constructed, indexed, awaited) survives bundling and minification
//! untouched, so `utils`, `utils$1` and `e` all profile the same when they are the same thing.

use bun_ast::walk::{self, Visitor};
use bun_ast::{E, Expr, ExprData, Loc, S};

/// One order-independent hash per symbol (indexed by `Ref::inner_index`); 0 when the symbol is never used.
pub(crate) fn profiles(ast: &bun_ast::Ast<'_>, symbol_count: usize) -> Vec<u64> {
    let mut w = Walker {
        acc: vec![0u64; symbol_count],
    };
    for part in ast.parts.iter() {
        for stmt in part.stmts.slice() {
            w.visit_stmt(stmt);
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
        if let ExprData::EIdentifier(id) = &target.data {
            if let Some(slot) = self.acc.get_mut(id.ref_.inner_index() as usize) {
                // Sum of per-use hashes: a multiset, so use order and count both matter but position does not.
                *slot = slot.wrapping_add(mix(tag, bytes, n));
            }
        }
    }
}

impl<'ast> Visitor<'ast> for Walker {
    // A profile does not count what is used in these.
    #[inline]
    fn visit_s_enum(&mut self, _: &'ast S::Enum, _: Loc) {}

    #[inline]
    fn visit_s_export_equals(&mut self, _: &'ast S::ExportEquals, _: Loc) {}

    #[inline]
    fn visit_s_namespace(&mut self, _: &'ast S::Namespace, _: Loc) {}

    #[inline]
    fn visit_e_inlined_enum(&mut self, _: &'ast E::InlinedEnum, _: Loc) {}

    #[inline]
    fn visit_decorator(&mut self, _: &'ast Expr) {}

    #[inline]
    fn visit_e_unary(&mut self, x: &'ast E::Unary, _: Loc) {
        self.note(&x.value, b'u', &[x.op as u8], 0);
        walk::walk_e_unary(self, x);
    }

    #[inline]
    fn visit_e_binary(&mut self, x: &'ast E::Binary, _: Loc) -> Option<&'ast Expr> {
        self.note(&x.left, b'l', &[x.op as u8], 0);
        self.note(&x.right, b'r', &[x.op as u8], 0);
        walk::walk_e_binary(self, x)
    }

    #[inline]
    fn visit_e_new(&mut self, x: &'ast E::New, _: Loc) {
        self.note(&x.target, b'n', b"", x.args.len() as u64);
        walk::walk_e_new(self, x);
    }

    #[inline]
    fn visit_e_call(&mut self, x: &'ast E::Call, _: Loc) {
        match &x.target.data {
            // `sym.method(a, b)`: the method name and arity describe `sym`.
            ExprData::EDot(d) => self.note(&d.target, b'm', d.name.slice(), x.args.len() as u64),
            _ => self.note(&x.target, b'c', b"", x.args.len() as u64),
        }
        for (i, a) in x.args.iter().enumerate() {
            // Being passed as argument i of an N-ary call is also part of a symbol's shape.
            self.note(a, b'a', &[i.min(255) as u8], x.args.len() as u64);
        }
        walk::walk_e_call(self, x);
    }

    #[inline]
    fn visit_e_dot(&mut self, x: &'ast E::Dot, _: Loc) {
        self.note(&x.target, b'.', x.name.slice(), 0);
        walk::walk_e_dot(self, x);
    }

    #[inline]
    fn visit_e_index(&mut self, x: &'ast E::Index, _: Loc) {
        self.note(&x.target, b'[', b"", 0);
        walk::walk_e_index(self, x);
    }

    #[inline]
    fn visit_e_object(&mut self, x: &'ast E::Object, _: Loc) {
        for p in x.properties.iter() {
            if let (Some(k), Some(v)) = (&p.key, &p.value) {
                // `{ name: sym }`: the key it is filed under says what `sym` is for.
                if let ExprData::EString(k) = &k.data {
                    if k.is_utf8() {
                        self.note(v, b':', k.slice8(), 0);
                    }
                }
            }
        }
        walk::walk_e_object(self, x);
    }

    #[inline]
    fn visit_e_await(&mut self, x: &'ast E::Await, _: Loc) {
        self.note(&x.value, b'w', b"", 0);
        walk::walk_e_await(self, x);
    }
}
