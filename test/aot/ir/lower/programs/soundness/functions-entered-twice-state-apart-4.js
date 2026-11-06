// RUN: lower
// OPTIONS: builtin-modules

// Functions entered twice keep their state apart 4.
const settle = () => new Promise(resolve => setTimeout(resolve, 5));

// recursion through symbol key
await (async () => {
  const all = [];
  function once() {
    let c = 0;
    class K { static s = 0; #p = 1; static has(o) { return #p in o; } }
    const sym = Symbol("s");
    const obj = { n: 0 };
    const r = { inc: () => ++c, K, sym, obj };
    all[all.length] = r;
    return r;
  }
  function report() {
    if (all.length < 2) { console.log("recursion-through-symbol-key", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("recursion-through-symbol-key", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const s = Symbol(); const o = { [s](n) { once(); if (n) o[s](n - 1); } }; o[s](1);
  report();
})();

// recursion through thrown function
await (async () => {
  const all = [];
  function once() {
    let c = 0;
    class K { static s = 0; #p = 1; static has(o) { return #p in o; } }
    const sym = Symbol("s");
    const obj = { n: 0 };
    const r = { inc: () => ++c, K, sym, obj };
    all[all.length] = r;
    return r;
  }
  function report() {
    if (all.length < 2) { console.log("recursion-through-thrown-function", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("recursion-through-thrown-function", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  function rec(n) { once(); if (n) { try { throw rec; } catch (f) { f(n - 1); } } } rec(1);
  report();
})();

// recursion through unknown constructor
await (async () => {
  const all = [];
  function once() {
    let c = 0;
    class K { static s = 0; #p = 1; static has(o) { return #p in o; } }
    const sym = Symbol("s");
    const obj = { n: 0 };
    const r = { inc: () => ++c, K, sym, obj };
    all[all.length] = r;
    return r;
  }
  function report() {
    if (all.length < 2) { console.log("recursion-through-unknown-constructor", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("recursion-through-unknown-constructor", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const O = structuredClone({}).constructor;
  class A { constructor(n) { once(); if (n) new (O(this).constructor)(n - 1); } } new A(1);
  report();
})();

// recursion through unknown identity
await (async () => {
  const all = [];
  function once() {
    let c = 0;
    class K { static s = 0; #p = 1; static has(o) { return #p in o; } }
    const sym = Symbol("s");
    const obj = { n: 0 };
    const r = { inc: () => ++c, K, sym, obj };
    all[all.length] = r;
    return r;
  }
  function report() {
    if (all.length < 2) { console.log("recursion-through-unknown-identity", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("recursion-through-unknown-identity", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const O = structuredClone({}).constructor;
  function rec(n) { once(); if (n) O(rec)(n - 1); } rec(1);
  report();
})();

// recursion through values
await (async () => {
  const all = [];
  function once() {
    let c = 0;
    class K { static s = 0; #p = 1; static has(o) { return #p in o; } }
    const sym = Symbol("s");
    const obj = { n: 0 };
    const r = { inc: () => ++c, K, sym, obj };
    all[all.length] = r;
    return r;
  }
  function report() {
    if (all.length < 2) { console.log("recursion-through-values", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("recursion-through-values", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { m(n) { once(); if (n) Object.values(o)[0](n - 1); } }; o.m(1);
  report();
})();

// recursion through weakref
await (async () => {
  const all = [];
  function once() {
    let c = 0;
    class K { static s = 0; #p = 1; static has(o) { return #p in o; } }
    const sym = Symbol("s");
    const obj = { n: 0 };
    const r = { inc: () => ++c, K, sym, obj };
    all[all.length] = r;
    return r;
  }
  function report() {
    if (all.length < 2) { console.log("recursion-through-weakref", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("recursion-through-weakref", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  function rec(n) { once(); if (n) w.deref()(n - 1); } const w = new WeakRef(rec); rec(1);
  report();
})();

// reflect apply loop helper
await (async () => {
  const all = [];
  function once() {
    let c = 0;
    class K { static s = 0; #p = 1; static has(o) { return #p in o; } }
    const sym = Symbol("s");
    const obj = { n: 0 };
    const r = { inc: () => ++c, K, sym, obj };
    all[all.length] = r;
    return r;
  }
  function report() {
    if (all.length < 2) { console.log("reflect-apply-loop-helper", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("reflect-apply-loop-helper", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  function call(f) { return Reflect.apply(f, undefined, []); } call(once); call(once);
  report();
})();

// reflect apply twice
await (async () => {
  const all = [];
  function once() {
    let c = 0;
    class K { static s = 0; #p = 1; static has(o) { return #p in o; } }
    const sym = Symbol("s");
    const obj = { n: 0 };
    const r = { inc: () => ++c, K, sym, obj };
    all[all.length] = r;
    return r;
  }
  function report() {
    if (all.length < 2) { console.log("reflect-apply-twice", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("reflect-apply-twice", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  Reflect.apply(once, undefined, []); Reflect.apply(once, undefined, []);
  report();
})();

// regexp exec override
await (async () => {
  const all = [];
  function once() {
    let c = 0;
    class K { static s = 0; #p = 1; static has(o) { return #p in o; } }
    const sym = Symbol("s");
    const obj = { n: 0 };
    const r = { inc: () => ++c, K, sym, obj };
    all[all.length] = r;
    return r;
  }
  function report() {
    if (all.length < 2) { console.log("regexp-exec-override", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("regexp-exec-override", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  let n = 0; const r = /a/g; r.exec = function () { once(); return n++ < 1 ? Object.assign(["a"], { index: 0 }) : null; }; RegExp.prototype[Symbol.replace].bind(r)("aa", "b");
  report();
})();

// replace all string
await (async () => {
  const all = [];
  function once() {
    let c = 0;
    class K { static s = 0; #p = 1; static has(o) { return #p in o; } }
    const sym = Symbol("s");
    const obj = { n: 0 };
    const r = { inc: () => ++c, K, sym, obj };
    all[all.length] = r;
    return r;
  }
  function report() {
    if (all.length < 2) { console.log("replace-all-string", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("replace-all-string", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  "aXbX".replaceAll("X", () => { once(); return ""; });
  report();
})();

// replace custom symbol
await (async () => {
  const all = [];
  function once() {
    let c = 0;
    class K { static s = 0; #p = 1; static has(o) { return #p in o; } }
    const sym = Symbol("s");
    const obj = { n: 0 };
    const r = { inc: () => ++c, K, sym, obj };
    all[all.length] = r;
    return r;
  }
  function report() {
    if (all.length < 2) { console.log("replace-custom-symbol", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("replace-custom-symbol", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  "aXbX".replace({ [Symbol.replace](s, f) { f(); f(); return s; } }, () => { once(); return ""; });
  report();
})();

// replace global regexp
await (async () => {
  const all = [];
  function once() {
    let c = 0;
    class K { static s = 0; #p = 1; static has(o) { return #p in o; } }
    const sym = Symbol("s");
    const obj = { n: 0 };
    const r = { inc: () => ++c, K, sym, obj };
    all[all.length] = r;
    return r;
  }
  function report() {
    if (all.length < 2) { console.log("replace-global-regexp", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("replace-global-regexp", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  "aXbX".replace(/X/g, () => { once(); return ""; });
  report();
})();

// replace parsed flags
await (async () => {
  const all = [];
  function once() {
    let c = 0;
    class K { static s = 0; #p = 1; static has(o) { return #p in o; } }
    const sym = Symbol("s");
    const obj = { n: 0 };
    const r = { inc: () => ++c, K, sym, obj };
    all[all.length] = r;
    return r;
  }
  function report() {
    if (all.length < 2) { console.log("replace-parsed-flags", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("replace-parsed-flags", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  "aXbX".replace(new RegExp("X", JSON.parse('"g"')), () => { once(); return ""; });
  report();
})();

// replace string pattern control
await (async () => {
  const all = [];
  function once() {
    let c = 0;
    class K { static s = 0; #p = 1; static has(o) { return #p in o; } }
    const sym = Symbol("s");
    const obj = { n: 0 };
    const r = { inc: () => ++c, K, sym, obj };
    all[all.length] = r;
    return r;
  }
  function report() {
    if (all.length < 2) { console.log("replace-string-pattern-control", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("replace-string-pattern-control", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  "aXbX".replace("X", () => { once(); return ""; });
  report();
})();

// replace unknown pattern
await (async () => {
  const all = [];
  function once() {
    let c = 0;
    class K { static s = 0; #p = 1; static has(o) { return #p in o; } }
    const sym = Symbol("s");
    const obj = { n: 0 };
    const r = { inc: () => ++c, K, sym, obj };
    all[all.length] = r;
    return r;
  }
  function report() {
    if (all.length < 2) { console.log("replace-unknown-pattern", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("replace-unknown-pattern", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const O = structuredClone({}).constructor;
  "aXbX".replace(O(/X/g), () => { once(); return ""; });
  report();
})();

// setter and assign
await (async () => {
  const all = [];
  function once() {
    let c = 0;
    class K { static s = 0; #p = 1; static has(o) { return #p in o; } }
    const sym = Symbol("s");
    const obj = { n: 0 };
    const r = { inc: () => ++c, K, sym, obj };
    all[all.length] = r;
    return r;
  }
  function report() {
    if (all.length < 2) { console.log("setter-and-assign", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("setter-and-assign", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { set x(v) { once(); } }; o.x = 1; Object.assign(o, { x: 2 });
  report();
})();

// setter and reflect set
await (async () => {
  const all = [];
  function once() {
    let c = 0;
    class K { static s = 0; #p = 1; static has(o) { return #p in o; } }
    const sym = Symbol("s");
    const obj = { n: 0 };
    const r = { inc: () => ++c, K, sym, obj };
    all[all.length] = r;
    return r;
  }
  function report() {
    if (all.length < 2) { console.log("setter-and-reflect-set", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("setter-and-reflect-set", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { set x(v) { once(); } }; o.x = 1; Reflect.set(o, "x", 2);
  report();
})();

// setter inherited by literal
await (async () => {
  const all = [];
  function once() {
    let c = 0;
    class K { static s = 0; #p = 1; static has(o) { return #p in o; } }
    const sym = Symbol("s");
    const obj = { n: 0 };
    const r = { inc: () => ++c, K, sym, obj };
    all[all.length] = r;
    return r;
  }
  function report() {
    if (all.length < 2) { console.log("setter-inherited-by-literal", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("setter-inherited-by-literal", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const p = { set x(v) { once(); } }; const a = { __proto__: p }; a.x = 1; const b = Object.create(p); b[JSON.parse('"x"')] = 2;
  report();
})();

// sort comparator
await (async () => {
  const all = [];
  function once() {
    let c = 0;
    class K { static s = 0; #p = 1; static has(o) { return #p in o; } }
    const sym = Symbol("s");
    const obj = { n: 0 };
    const r = { inc: () => ++c, K, sym, obj };
    all[all.length] = r;
    return r;
  }
  function report() {
    if (all.length < 2) { console.log("sort-comparator", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("sort-comparator", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  [3, 1, 2].sort(() => { if (all.length < 2) once(); return 0; });
  report();
})();

// species getter
await (async () => {
  const all = [];
  function once() {
    let c = 0;
    class K { static s = 0; #p = 1; static has(o) { return #p in o; } }
    const sym = Symbol("s");
    const obj = { n: 0 };
    const r = { inc: () => ++c, K, sym, obj };
    all[all.length] = r;
    return r;
  }
  function report() {
    if (all.length < 2) { console.log("species-getter", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("species-getter", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  class C extends Array { static get [Symbol.species]() { once(); return Array; } } const c = new C(); c.slice(); c.concat();
  report();
})();

// static block control
await (async () => {
  const all = [];
  function once() {
    let c = 0;
    class K { static s = 0; #p = 1; static has(o) { return #p in o; } }
    const sym = Symbol("s");
    const obj = { n: 0 };
    const r = { inc: () => ++c, K, sym, obj };
    all[all.length] = r;
    return r;
  }
  function report() {
    if (all.length < 2) { console.log("static-block-control", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("static-block-control", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  class C { static { once(); } }
  report();
})();

// static block in function
await (async () => {
  const all = [];
  function once() {
    let c = 0;
    class K { static s = 0; #p = 1; static has(o) { return #p in o; } }
    const sym = Symbol("s");
    const obj = { n: 0 };
    const r = { inc: () => ++c, K, sym, obj };
    all[all.length] = r;
    return r;
  }
  function report() {
    if (all.length < 2) { console.log("static-block-in-function", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("static-block-in-function", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  function make() { return class { static { once(); } }; } make(); make();
  report();
})();

// switch fallthrough
await (async () => {
  const all = [];
  function once() {
    let c = 0;
    class K { static s = 0; #p = 1; static has(o) { return #p in o; } }
    const sym = Symbol("s");
    const obj = { n: 0 };
    const r = { inc: () => ++c, K, sym, obj };
    all[all.length] = r;
    return r;
  }
  function report() {
    if (all.length < 2) { console.log("switch-fallthrough", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("switch-fallthrough", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  function s(x) { switch (x) { case 1: once(); case 2: break; } } s(1); s(1);
  report();
})();

// tag function
await (async () => {
  const all = [];
  function once() {
    let c = 0;
    class K { static s = 0; #p = 1; static has(o) { return #p in o; } }
    const sym = Symbol("s");
    const obj = { n: 0 };
    const r = { inc: () => ++c, K, sym, obj };
    all[all.length] = r;
    return r;
  }
  function report() {
    if (all.length < 2) { console.log("tag-function", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("tag-function", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  function tag() { once(); } const run = () => tag`x`; run(); run();
  report();
})();

// thenable all
await (async () => {
  const all = [];
  function once() {
    let c = 0;
    class K { static s = 0; #p = 1; static has(o) { return #p in o; } }
    const sym = Symbol("s");
    const obj = { n: 0 };
    const r = { inc: () => ++c, K, sym, obj };
    all[all.length] = r;
    return r;
  }
  function report() {
    if (all.length < 2) { console.log("thenable-all", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("thenable-all", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { then(r) { once(); r(1); } }; Promise.all([o, o]); 
  await settle();
  report();
})();

// thenable await loop
await (async () => {
  const all = [];
  function once() {
    let c = 0;
    class K { static s = 0; #p = 1; static has(o) { return #p in o; } }
    const sym = Symbol("s");
    const obj = { n: 0 };
    const r = { inc: () => ++c, K, sym, obj };
    all[all.length] = r;
    return r;
  }
  function report() {
    if (all.length < 2) { console.log("thenable-await-loop", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("thenable-await-loop", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { then(r) { once(); r(1); } }; (async () => { await o; await o; })(); 
  await settle();
  report();
})();

// thenable resolve and await
await (async () => {
  const all = [];
  function once() {
    let c = 0;
    class K { static s = 0; #p = 1; static has(o) { return #p in o; } }
    const sym = Symbol("s");
    const obj = { n: 0 };
    const r = { inc: () => ++c, K, sym, obj };
    all[all.length] = r;
    return r;
  }
  function report() {
    if (all.length < 2) { console.log("thenable-resolve-and-await", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("thenable-resolve-and-await", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { then(r) { once(); r(1); } }; (async () => { await o; })(); Promise.resolve(o); 
  await settle();
  report();
})();

// to json twice
await (async () => {
  const all = [];
  function once() {
    let c = 0;
    class K { static s = 0; #p = 1; static has(o) { return #p in o; } }
    const sym = Symbol("s");
    const obj = { n: 0 };
    const r = { inc: () => ++c, K, sym, obj };
    all[all.length] = r;
    return r;
  }
  function report() {
    if (all.length < 2) { console.log("to-json-twice", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("to-json-twice", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { toJSON() { once(); return 1; } }; JSON.stringify([o, o]);
  report();
})();

// to primitive multiply
await (async () => {
  const all = [];
  function once() {
    let c = 0;
    class K { static s = 0; #p = 1; static has(o) { return #p in o; } }
    const sym = Symbol("s");
    const obj = { n: 0 };
    const r = { inc: () => ++c, K, sym, obj };
    all[all.length] = r;
    return r;
  }
  function report() {
    if (all.length < 2) { console.log("to-primitive-multiply", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("to-primitive-multiply", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { [Symbol.toPrimitive]() { once(); return 1; } }; o * o;
  report();
})();

// to string as key
await (async () => {
  const all = [];
  function once() {
    let c = 0;
    class K { static s = 0; #p = 1; static has(o) { return #p in o; } }
    const sym = Symbol("s");
    const obj = { n: 0 };
    const r = { inc: () => ++c, K, sym, obj };
    all[all.length] = r;
    return r;
  }
  function report() {
    if (all.length < 2) { console.log("to-string-as-key", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("to-string-as-key", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { toString() { once(); return "k"; } }; const t = {}; t[o] = t[o];
  report();
})();

// to string join
await (async () => {
  const all = [];
  function once() {
    let c = 0;
    class K { static s = 0; #p = 1; static has(o) { return #p in o; } }
    const sym = Symbol("s");
    const obj = { n: 0 };
    const r = { inc: () => ++c, K, sym, obj };
    all[all.length] = r;
    return r;
  }
  function report() {
    if (all.length < 2) { console.log("to-string-join", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("to-string-join", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { toString() { once(); return "s"; } }; [o, o].join();
  report();
})();

// to string template
await (async () => {
  const all = [];
  function once() {
    let c = 0;
    class K { static s = 0; #p = 1; static has(o) { return #p in o; } }
    const sym = Symbol("s");
    const obj = { n: 0 };
    const r = { inc: () => ++c, K, sym, obj };
    all[all.length] = r;
    return r;
  }
  function report() {
    if (all.length < 2) { console.log("to-string-template", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("to-string-template", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { toString() { once(); return "s"; } }; `${o}${o}`;
  report();
})();

// value of both operands
await (async () => {
  const all = [];
  function once() {
    let c = 0;
    class K { static s = 0; #p = 1; static has(o) { return #p in o; } }
    const sym = Symbol("s");
    const obj = { n: 0 };
    const r = { inc: () => ++c, K, sym, obj };
    all[all.length] = r;
    return r;
  }
  function report() {
    if (all.length < 2) { console.log("value-of-both-operands", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("value-of-both-operands", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { valueOf() { once(); return 1; } }; o + o;
  report();
})();

// while true break
await (async () => {
  const all = [];
  function once() {
    let c = 0;
    class K { static s = 0; #p = 1; static has(o) { return #p in o; } }
    const sym = Symbol("s");
    const obj = { n: 0 };
    const r = { inc: () => ++c, K, sym, obj };
    all[all.length] = r;
    return r;
  }
  function report() {
    if (all.length < 2) { console.log("while-true-break", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("while-true-break", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  let i = 0; while (true) { once(); if (++i === 2) break; }
  report();
})();

// GENERATED: m call C [Symbol.species] make run
// CHECK-LABEL: function {{*}}name="m"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=1 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}, {type=[[f_2]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: [[f_2]], v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Call v1 calleeName="once"
// CHECK-NEXT: v4 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v5 = ToBoolean v4
// CHECK-NEXT: Branch v5 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v7 = Builtin builtin=Object
// CHECK-NEXT: v8 = Builtin builtin=ObjectValues
// CHECK-NEXT: v9 = GetEnvironmentField v0 layout=[[L_1]] field=1
// CHECK-NEXT: v10 = CheckInitialized v9 name="o"
// CHECK-NEXT: v11 = Call v8, v7, v10 calleeName="Object.values"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Array<undefined|null|[[f_3]]> flags=[IsExpected]}
// CHECK-NEXT: v13 = Integer
// CHECK-NEXT: v14 = ElemGet v12, v13
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v16 = Convert v6 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v17 = Integer integer=1
// CHECK-NEXT: v18 = Sub v16, v17
// CHECK-NEXT: v19 = Call v15, v12, v18
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4(v20):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v21 = Undefined
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="call"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_4]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Reflect
// CHECK-NEXT: v2 = Builtin builtin=ReflectApply
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: v4 = Data data=[[d_5]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v6 = Call v2, v1, v0, v3, v5 calleeName="Reflect.apply"
// CHECK-NEXT: ReturnCall v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="C"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_6]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.species]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsNamedByComputedKey] captures=[{type=[[f_7]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=undefined|null|[[f_8]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: [[f_7]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Call v0 calleeName="once"
// CHECK-NEXT: v2 = Builtin builtin=Array
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="C"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_9]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_9]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_9]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] captures=[{type=env [[L_10]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=undefined|null|[[f_11]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: env [[L_10]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewClosure function=[[f_12]]
// CHECK-NEXT: v2 = NewClass v1 layout=[[L_13]]
// CHECK-NEXT: v3 = FinishClass v2 layout=[[L_13]]
// CHECK-NEXT: v4 = Convert v3 declared={type=function flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v0, v2, v4 function=[[f_14]]
// CHECK-NEXT: v6 = Convert v3 declared={type=undefined|null|[[f_11]] flags=[IsExpected]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="run"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow captures=[{type=[[f_15]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_16]]] {
// CHECK-NEXT: b0(v0: [[f_15]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewTemplateObject templateStrings=[{cooked="x" raw="x"}]
// CHECK-NEXT: v2 = Call v0, -, v1 calleeName="tag"
// CHECK-NEXT: ReturnCall v2
// CHECK-NEXT: }
