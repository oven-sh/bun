const o = { mk: n => ({ a: n, m: () => n + 1 }) }; function use(f, n) { let s = 0; for (let i = 0; i < n; i++) s += f(i & 3).a; return s; } console.log(use(o.mk, 400), o.mk(4).m());
