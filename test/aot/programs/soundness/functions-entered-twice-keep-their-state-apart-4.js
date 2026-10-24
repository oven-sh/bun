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
