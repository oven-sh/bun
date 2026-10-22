const settle = () => new Promise(resolve => setTimeout(resolve, 5));

// labeled continue
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
    if (all.length < 2) { console.log("labeled-continue", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("labeled-continue", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  let i = 0; outer: while (true) { while (true) { once(); if (++i === 2) break outer; continue outer; } }
  report();
})();

// module function hoisted before
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
    if (all.length < 2) { console.log("module-function-hoisted-before", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("module-function-hoisted-before", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  hoisted(); function hoisted() { once(); } hoisted();
  report();
})();

// mutual recursion variables
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
    if (all.length < 2) { console.log("mutual-recursion-variables", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("mutual-recursion-variables", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  let f = n => { once(); if (n) g(n - 1); }; let g = n => f(n); f(1);
  report();
})();

// named function expression
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
    if (all.length < 2) { console.log("named-function-expression", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("named-function-expression", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  (function f(n) { once(); if (n) f(n - 1); })(1);
  report();
})();

// optional call
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
    if (all.length < 2) { console.log("optional-call", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("optional-call", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { f() { once(); } }; o.f?.(); o?.f();
  report();
})();

// promise executor control
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
    if (all.length < 2) { console.log("promise-executor-control", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("promise-executor-control", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  new Promise(() => { once(); });
  report();
})();

// promise executor subclass
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
    if (all.length < 2) { console.log("promise-executor-subclass", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("promise-executor-subclass", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  class P2 extends Promise {} const e = () => { once(); }; new P2(e); P2.resolve(1).then(() => {});
  report();
})();

// promise finally
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
    if (all.length < 2) { console.log("promise-finally", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("promise-finally", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const f = () => { once(); }; for (const p of [Promise.resolve(1), Promise.reject(2)]) p.finally(f).catch(() => {}); 
  await settle();
  report();
})();

// promise then and catch same
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
    if (all.length < 2) { console.log("promise-then-and-catch-same", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("promise-then-and-catch-same", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const f = () => { once(); }; Promise.resolve(1).then(f, f); Promise.reject(1).then(f, f); 
  await settle();
  report();
})();

// promise then two
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
    if (all.length < 2) { console.log("promise-then-two", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("promise-then-two", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const f = () => { once(); }; const p = Promise.resolve(1); p.then(f); p.then(f); 
  await settle();
  report();
})();

// proxy apply trap
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
    if (all.length < 2) { console.log("proxy-apply-trap", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("proxy-apply-trap", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const p = new Proxy(function () {}, { apply() { once(); } }); [p, p].forEach ? (p(), Reflect.apply(p, undefined, [])) : 0;
  report();
})();

// proxy descriptor trap
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
    if (all.length < 2) { console.log("proxy-descriptor-trap", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("proxy-descriptor-trap", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const p = new Proxy({ a: 1, b: 2 }, { getOwnPropertyDescriptor(t, k) { once(); return Reflect.getOwnPropertyDescriptor(t, k); } }); Object.keys(p);
  report();
})();

// proxy get trap
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
    if (all.length < 2) { console.log("proxy-get-trap", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("proxy-get-trap", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const p = new Proxy({}, { get() { once(); } }); const { a, b } = p;
  report();
})();

// proxy has trap with
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
    if (all.length < 2) { console.log("proxy-has-trap-with", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("proxy-has-trap-with", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const p = new Proxy({}, { has() { once(); return false; } }); "a" in p; Reflect.has(p, "b");
  report();
})();

// recursion
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
    if (all.length < 2) { console.log("recursion", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("recursion", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  function rec(n) { once(); if (n) rec(n - 1); } rec(1);
  report();
})();

// recursion through array
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
    if (all.length < 2) { console.log("recursion-through-array", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("recursion-through-array", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const fs = [n => { once(); if (n) fs[0](n - 1); }]; fs[0](1);
  report();
})();

// recursion through await
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
    if (all.length < 2) { console.log("recursion-through-await", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("recursion-through-await", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  async function rec(n) { once(); await 0; if (n) await rec(n - 1); } rec(1); 
  await settle();
  report();
})();

// recursion through bound
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
    if (all.length < 2) { console.log("recursion-through-bound", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("recursion-through-bound", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  function rec(n) { once(); if (n) again(n - 1); } const again = rec.bind(null); rec(1);
  report();
})();

// recursion through catch
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
    if (all.length < 2) { console.log("recursion-through-catch", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("recursion-through-catch", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  function rec(n) { try { once(); if (n) throw n; } catch (e) { rec(e - 1); } } rec(1);
  report();
})();

// recursion through computed key
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
    if (all.length < 2) { console.log("recursion-through-computed-key", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("recursion-through-computed-key", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { m(n) { once(); if (n) o[JSON.parse('"m"')](n - 1); } }; o.m(1);
  report();
})();

// recursion through constructor
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
    if (all.length < 2) { console.log("recursion-through-constructor", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("recursion-through-constructor", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  class A { constructor(n) { once(); if (n) new this.constructor(n - 1); } } new A(1);
  report();
})();

// recursion through descriptor
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
    if (all.length < 2) { console.log("recursion-through-descriptor", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("recursion-through-descriptor", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { m(n) { once(); if (n) Object.getOwnPropertyDescriptor(o, "m").value(n - 1); } }; o.m(1);
  report();
})();

// recursion through finally
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
    if (all.length < 2) { console.log("recursion-through-finally", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("recursion-through-finally", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  function rec(n) { try { once(); } finally { if (n) rec(n - 1); } } rec(1);
  report();
})();

// recursion through generator
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
    if (all.length < 2) { console.log("recursion-through-generator", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("recursion-through-generator", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  function* g(n) { once(); if (n) yield* g(n - 1); } for (const x of g(1)) ;
  report();
})();

// recursion through getter
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
    if (all.length < 2) { console.log("recursion-through-getter", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("recursion-through-getter", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  let n = 1; const o = { get x() { once(); return n-- ? this.x : 0; } }; o.x;
  report();
})();

// recursion through global
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
    if (all.length < 2) { console.log("recursion-through-global", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("recursion-through-global", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  globalThis.again = function rec(n) { once(); if (n) globalThis.again(n - 1); }; globalThis.again(1);
  report();
})();

// recursion through global computed
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
    if (all.length < 2) { console.log("recursion-through-global-computed", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("recursion-through-global-computed", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  globalThis.again = function rec(n) { once(); if (n) globalThis[JSON.parse('"again"')](n - 1); }; globalThis.again(1);
  report();
})();

// recursion through map
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
    if (all.length < 2) { console.log("recursion-through-map", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("recursion-through-map", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const m = new Map(); m.set("f", n => { once(); if (n) m.get("f")(n - 1); }); m.get("f")(1);
  report();
})();

// recursion through new target
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
    if (all.length < 2) { console.log("recursion-through-new-target", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("recursion-through-new-target", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  class A { constructor(n) { once(); if (n) new new.target(n - 1); } } new A(1);
  report();
})();

// recursion through object
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
    if (all.length < 2) { console.log("recursion-through-object", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("recursion-through-object", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { m(n) { once(); if (n) this.m(n - 1); } }; o.m(1);
  report();
})();

// recursion through parameter
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
    if (all.length < 2) { console.log("recursion-through-parameter", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("recursion-through-parameter", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  function run(f, n) { once(); if (n) f(f, n - 1); } run(run, 1);
  report();
})();

// recursion through promise
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
    if (all.length < 2) { console.log("recursion-through-promise", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("recursion-through-promise", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  function rec(n) { once(); if (n) Promise.resolve(n - 1).then(rec); } rec(1); 
  await settle();
  report();
})();

// recursion through proxy
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
    if (all.length < 2) { console.log("recursion-through-proxy", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("recursion-through-proxy", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  function rec(n) { once(); if (n) p(n - 1); } const p = new Proxy(rec, {}); rec(1);
  report();
})();

// recursion through reflect apply
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
    if (all.length < 2) { console.log("recursion-through-reflect-apply", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("recursion-through-reflect-apply", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  function rec(n) { once(); if (n) Reflect.apply(rec, undefined, [n - 1]); } rec(1);
  report();
})();

// recursion through setter
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
    if (all.length < 2) { console.log("recursion-through-setter", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("recursion-through-setter", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { set x(n) { once(); if (n) this.x = n - 1; } }; o.x = 1;
  report();
})();
