const settle = () => new Promise(resolve => setTimeout(resolve, 5));

// array like element getter
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
    if (all.length < 2) { console.log("array-like-element-getter", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("array-like-element-getter", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const g = { get() { once(); return 1; }, enumerable: true }; const o = Object.defineProperties({ length: 2 }, { 0: g, 1: g }); Array.prototype.join.bind(o)();
  report();
})();

// array like length getter
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
    if (all.length < 2) { console.log("array-like-length-getter", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("array-like-length-getter", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { get length() { once(); return 0; } }; Array.prototype.join.bind(o)(); Array.prototype.indexOf.bind(o)(1);
  report();
})();

// async generator
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
    if (all.length < 2) { console.log("async-generator", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("async-generator", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  async function* g() { for (let i = 0; i < 2; i++) { once(); yield i; } } (async () => { for await (const x of g()) ; })(); 
  await settle();
  report();
})();

// bound called twice
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
    if (all.length < 2) { console.log("bound-called-twice", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("bound-called-twice", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const b = once.bind(null); b(); b();
  report();
})();

// bound twice bound
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
    if (all.length < 2) { console.log("bound-twice-bound", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("bound-twice-bound", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const b = once.bind(null).bind(null); const list = [b, b]; list[0](); list[1]();
  report();
})();

// callee from two element array
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
    if (all.length < 2) { console.log("callee-from-two-element-array", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("callee-from-two-element-array", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const f = () => { once(); }; const fs = [f, f]; for (let i = 0; i < fs.length; i++) fs[i]();
  report();
})();

// class getter static
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
    if (all.length < 2) { console.log("class-getter-static", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("class-getter-static", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  class C { static get x() { return once(); } } C.x; Object.getOwnPropertyDescriptor(C, "x").get.bind(C)();
  report();
})();

// closure created in loop called once each
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
    if (all.length < 2) { console.log("closure-created-in-loop-called-once-each", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("closure-created-in-loop-called-once-each", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const fs = []; for (let i = 0; i < 2; i++) fs[i] = () => once(); fs[0](); fs[1]();
  report();
})();

// comma and logical
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
    if (all.length < 2) { console.log("comma-and-logical", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("comma-and-logical", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const f = () => { once(); return 0; }; f() || f();
  report();
})();

// computed key in function
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
    if (all.length < 2) { console.log("computed-key-in-function", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("computed-key-in-function", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  function make() { return class { [(once(), "m")]() {} }; } make(); make();
  report();
})();

// concat spreadable getter
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
    if (all.length < 2) { console.log("concat-spreadable-getter", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("concat-spreadable-getter", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { get [Symbol.isConcatSpreadable]() { once(); return false; } }; [].concat(o, o);
  report();
})();

// conditional callee
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
    if (all.length < 2) { console.log("conditional-callee", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("conditional-callee", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const f = () => { once(); }; const g = JSON.parse("true") ? f : () => 0; f(); g();
  report();
})();

// control two sites
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
    if (all.length < 2) { console.log("control-two-sites", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("control-two-sites", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  once(); once();
  report();
})();

// date to json
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
    if (all.length < 2) { console.log("date-to-json", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("date-to-json", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { toISOString() { once(); return "d"; }, valueOf() { return 1; } }; Date.prototype.toJSON.bind(o)(); Date.prototype.toJSON.bind(o)();
  report();
})();

// default in destructuring
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
    if (all.length < 2) { console.log("default-in-destructuring", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("default-in-destructuring", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  for (const { a = once() } of [{}, {}]) ;
  report();
})();

// default parameter
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
    if (all.length < 2) { console.log("default-parameter", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("default-parameter", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  function f(a = once()) {} f(); f();
  report();
})();

// define properties getter
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
    if (all.length < 2) { console.log("define-properties-getter", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("define-properties-getter", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const d = { get value() { once(); return 1; } }; Object.defineProperties({}, { a: d, b: d });
  report();
})();

// do while
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
    if (all.length < 2) { console.log("do-while", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("do-while", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  let i = 0; do { once(); } while (++i < 2);
  report();
})();

// escaped by closure
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
    if (all.length < 2) { console.log("escaped-by-closure", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("escaped-by-closure", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const O = structuredClone({}).constructor;
  const f = () => { once(); }; const wrap = () => f; f(); O(wrap)()();
  report();
})();

// escaped in object to unknown
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
    if (all.length < 2) { console.log("escaped-in-object-to-unknown", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("escaped-in-object-to-unknown", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const O = structuredClone({}).constructor;
  const h = { f() { once(); } }; h.f(); O(h).f();
  report();
})();

// escaped through arguments
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
    if (all.length < 2) { console.log("escaped-through-arguments", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("escaped-through-arguments", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const f = () => { once(); }; function call() { arguments[0](); } f(); call(f);
  report();
})();

// escaped through array
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
    if (all.length < 2) { console.log("escaped-through-array", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("escaped-through-array", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const O = structuredClone({}).constructor;
  const f = () => { once(); }; f(); O([f])[0]();
  report();
})();

// escaped through generator send
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
    if (all.length < 2) { console.log("escaped-through-generator-send", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("escaped-through-generator-send", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const f = () => { once(); }; function* g() { (yield)(); } f(); const it = g(); it.next(); it.next(f);
  report();
})();

// escaped through json reviver this
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
    if (all.length < 2) { console.log("escaped-through-json-reviver-this", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("escaped-through-json-reviver-this", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const f = () => { once(); }; f(); JSON.parse("1", function () { f(); });
  report();
})();

// escaped through prototype
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
    if (all.length < 2) { console.log("escaped-through-prototype", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("escaped-through-prototype", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const O = structuredClone({}).constructor;
  class C { m() { once(); } } const c = new C(); c.m(); O.getPrototypeOf(c).m();
  report();
})();

// escaped through rejection
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
    if (all.length < 2) { console.log("escaped-through-rejection", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("escaped-through-rejection", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const f = () => { once(); }; f(); Promise.reject(f).catch(e => e()); 
  await settle();
  report();
})();

// escaped through rest
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
    if (all.length < 2) { console.log("escaped-through-rest", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("escaped-through-rest", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const f = () => { once(); }; function call(...fs) { fs[0](); } f(); call(f);
  report();
})();

// escaped through spread call
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
    if (all.length < 2) { console.log("escaped-through-spread-call", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("escaped-through-spread-call", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const f = () => { once(); }; function call(g) { g(); } f(); call(...[f]);
  report();
})();

// escaped through this
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
    if (all.length < 2) { console.log("escaped-through-this", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("escaped-through-this", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const O = structuredClone({}).constructor;
  class C { m() { once(); } } const c = new C(); c.m(); O(c).m();
  report();
})();

// escaped through thrown
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
    if (all.length < 2) { console.log("escaped-through-thrown", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("escaped-through-thrown", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const f = () => { once(); }; f(); try { throw f; } catch (e) { e(); }
  report();
})();

// escaped to unknown callee
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
    if (all.length < 2) { console.log("escaped-to-unknown-callee", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("escaped-to-unknown-callee", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const f = () => { once(); }; setTimeout(f); setTimeout(f); 
  await settle();
  report();
})();

// field initializer
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
    if (all.length < 2) { console.log("field-initializer", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("field-initializer", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  class C { f = once(); } new C(); new C();
  report();
})();

// field initializer bound
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
    if (all.length < 2) { console.log("field-initializer-bound", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("field-initializer-bound", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  class C { f = once(); } const B = C.bind(null); new C(); new B();
  report();
})();

// field initializer one site factory
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
    if (all.length < 2) { console.log("field-initializer-one-site-factory", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("field-initializer-one-site-factory", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  class C { f = once(); } const make = () => new C(); make(); make();
  report();
})();

// field initializer other new target
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
    if (all.length < 2) { console.log("field-initializer-other-new-target", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("field-initializer-other-new-target", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  class C { f = once(); } function F() {} new C(); Reflect.construct(C, [], F);
  report();
})();
