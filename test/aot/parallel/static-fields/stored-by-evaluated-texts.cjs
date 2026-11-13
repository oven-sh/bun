// An evaluated text stores into a static field of a class whose object has not been made yet: the store makes it, so nothing is cached.
class A { static v; static { eval("A.v = 5; A.v = 6;"); } }
class B { static v = 1; static w; static { (0, eval)("globalThis.put = (c, v) => { c.v = v; };"); put(B, 2); put(B, 3); put(B, "four"); } }
class C { static m() { return 1; } static { eval("C.m = 3;"); } }
class D { static u; static { eval("for (let i = 0; i < 40; i++) D.u = i;"); } }
class E { static x; static { eval("Object.defineProperty(E, 'x', { value: 1, configurable: true }); try { E.x = 2; } catch (e) { console.log(e.name); }"); } }
class F { static #p; static q; static { eval("F.q = { a: 1 }; F.r = 2;"); this.q.a++; } }
const store = new Function("c", "n", "c.v = n; return c.v;");
class G { static v; }
class H extends G { static w; static { eval("H.v = 9; H.w = 8;"); } }
console.log(A.v, B.v, C.m, D.u, E.x, F.q.a, F.r, store(G, 1), store(G, 2), store(A, 7), store(H, 3), G.v, H.v, H.w, Object.keys(H).join(), Object.keys(G).join());
