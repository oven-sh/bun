const settle = () => new Promise(resolve => setTimeout(resolve, 5));

// field initializer promise species
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
    if (all.length < 2) { console.log("field-initializer-promise-species", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("field-initializer-promise-species", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  class C extends Promise { f = once(); } const c = new C(() => {}); c.then(() => {});
  report();
})();

// field initializer reflect
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
    if (all.length < 2) { console.log("field-initializer-reflect", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("field-initializer-reflect", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  class C { f = once(); } new C(); Reflect.construct(C, []);
  report();
})();

// field initializer species
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
    if (all.length < 2) { console.log("field-initializer-species", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("field-initializer-species", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  class C extends Array { f = once(); } const c = new C(); c.slice();
  report();
})();

// field initializer subclass
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
    if (all.length < 2) { console.log("field-initializer-subclass", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("field-initializer-subclass", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  class C { f = once(); } class D extends C {} new C(); new D();
  report();
})();

// finally block
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
    if (all.length < 2) { console.log("finally-block", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("finally-block", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  function f() { try { return 1; } finally { once(); } } f(); f();
  report();
})();

// for in
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
    if (all.length < 2) { console.log("for-in", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("for-in", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  for (const x in { a: 1, b: 2 }) once();
  report();
})();

// for loop
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
    if (all.length < 2) { console.log("for-loop", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("for-loop", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  for (let i = 0; i < 2; i++) once();
  report();
})();

// for of
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
    if (all.length < 2) { console.log("for-of", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("for-of", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  for (const x of [1, 2]) once();
  report();
})();

// generator one site next in loop
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
    if (all.length < 2) { console.log("generator-one-site-next-in-loop", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("generator-one-site-next-in-loop", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  function* g() { once(); yield; once(); } const it = g(); for (const x of it) ;
  report();
})();

// generator resumed loop
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
    if (all.length < 2) { console.log("generator-resumed-loop", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("generator-resumed-loop", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  function* g() { while (true) { once(); yield; } } const it = g(); it.next(); it.next();
  report();
})();

// generator return finally
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
    if (all.length < 2) { console.log("generator-return-finally", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("generator-return-finally", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  function* g() { try { yield; } finally { once(); } } for (const i of [0, 1]) { const it = g(); it.next(); it.return(); }
  report();
})();

// generator two objects
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
    if (all.length < 2) { console.log("generator-two-objects", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("generator-two-objects", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  function* g() { once(); yield; } const make = () => g(); const a = make(), b = make(); a.next(); b.next();
  report();
})();

// getter and assign
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
    if (all.length < 2) { console.log("getter-and-assign", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("getter-and-assign", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { get x() { return once(); } }; o.x; Object.assign({}, o);
  report();
})();

// getter and computed
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
    if (all.length < 2) { console.log("getter-and-computed", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("getter-and-computed", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { get x() { return once(); } }; o.x; o[JSON.parse('"x"')];
  report();
})();

// getter and descriptor call
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
    if (all.length < 2) { console.log("getter-and-descriptor-call", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("getter-and-descriptor-call", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { get x() { return once(); } }; o.x; Object.getOwnPropertyDescriptor(o, "x").get();
  report();
})();

// getter and lookup getter
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
    if (all.length < 2) { console.log("getter-and-lookup-getter", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("getter-and-lookup-getter", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { get x() { return once(); } }; o.x; o.__lookupGetter__("x")();
  report();
})();

// getter and rest
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
    if (all.length < 2) { console.log("getter-and-rest", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("getter-and-rest", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { get x() { return once(); }, y: 1 }; o.x; const { y, ...rest } = o;
  report();
})();

// getter and spread
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
    if (all.length < 2) { console.log("getter-and-spread", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("getter-and-spread", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { get x() { return once(); } }; o.x; ({ ...o });
  report();
})();

// getter and stringify
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
    if (all.length < 2) { console.log("getter-and-stringify", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("getter-and-stringify", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { get x() { once(); return 1; } }; o.x; JSON.stringify(o);
  report();
})();

// getter and unknown
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
    if (all.length < 2) { console.log("getter-and-unknown", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("getter-and-unknown", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const O = structuredClone({}).constructor;
  const o = { get x() { return once(); } }; o.x; O(o).x;
  report();
})();

// getter and unknown values
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
    if (all.length < 2) { console.log("getter-and-unknown-values", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("getter-and-unknown-values", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const O = structuredClone({}).constructor;
  const o = { get x() { return once(); } }; o.x; O.values(o);
  report();
})();

// getter and values
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
    if (all.length < 2) { console.log("getter-and-values", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("getter-and-values", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { get x() { return once(); } }; o.x; Object.values(o);
  report();
})();

// getter compound
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
    if (all.length < 2) { console.log("getter-compound", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("getter-compound", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { get x() { once(); return 1; }, set x(v) {} }; o.x += 1; o.x++;
  report();
})();

// getter in array destructuring
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
    if (all.length < 2) { console.log("getter-in-array-destructuring", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("getter-in-array-destructuring", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { get 0() { once(); return 1; }, length: 1, [Symbol.iterator]: Array.prototype[Symbol.iterator] }; const [a] = o; const [b] = o;
  report();
})();

// getter inherited
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
    if (all.length < 2) { console.log("getter-inherited", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("getter-inherited", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const p = { get x() { return once(); } }; const a = Object.create(p), b = Object.create(p); function read(o) { return o.x; } read(a); read(b);
  report();
})();

// getter one site increment
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
    if (all.length < 2) { console.log("getter-one-site-increment", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("getter-one-site-increment", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { get x() { once(); return 1; }, set x(v) { once(); } }; o.x++;
  report();
})();

// getter two sites
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
    if (all.length < 2) { console.log("getter-two-sites", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("getter-two-sites", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { get x() { return once(); } }; o.x; o.x;
  report();
})();

// has instance
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
    if (all.length < 2) { console.log("has-instance", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("has-instance", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  class C { static [Symbol.hasInstance]() { once(); return true; } } 1 instanceof C; Function.prototype[Symbol.hasInstance].bind(C); 2 instanceof C;
  report();
})();

// helper called twice
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
    if (all.length < 2) { console.log("helper-called-twice", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("helper-called-twice", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  function call(f) { return f(); } call(once); call(once);
  report();
})();

// helper with other function
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
    if (all.length < 2) { console.log("helper-with-other-function", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("helper-with-other-function", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  function call(f) { return f(); } call(once); call(() => 0); call(once);
  report();
})();

// iterator method spread twice
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
    if (all.length < 2) { console.log("iterator-method-spread-twice", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("iterator-method-spread-twice", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { [Symbol.iterator]() { once(); return [][Symbol.iterator](); } }; [...o, ...o];
  report();
})();

// iterator next
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
    if (all.length < 2) { console.log("iterator-next", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("iterator-next", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  let n = 0; const o = { [Symbol.iterator]() { return this; }, next() { once(); return { done: n++ > 0 }; } }; for (const x of o) ;
  report();
})();

// iterator return
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
    if (all.length < 2) { console.log("iterator-return", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("iterator-return", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { [Symbol.iterator]() { return this; }, next() { return { done: false }; }, return() { once(); return {}; } }; const [a] = o; for (const x of o) break;
  report();
})();

// json replacer
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
    if (all.length < 2) { console.log("json-replacer", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("json-replacer", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  JSON.stringify([1], function (k, v) { once(); return v; });
  report();
})();

// json reviver
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
    if (all.length < 2) { console.log("json-reviver", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("json-reviver", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  JSON.parse("[1]", function (k, v) { once(); return v; });
  report();
})();
