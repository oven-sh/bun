// The programs of soundness that are mostly a loop written out: thousands of fields, variables or functions that differ in a number.
import { family, programsOf, text } from "../generate";

export const programs = () =>
  programsOf({
    "functions-entered-twice-keep-their-state-apart-2.js": text(
      `const settle = () => new Promise(resolve => setTimeout(resolve, 5));`,
      [
        `promise species	promise-species	extends Promise { f = once(); } const c = new C(() => {}); c.then(() => {}
reflect	reflect	{ f = once(); } new C(); Reflect.construct(C, []
species	species	extends Array { f = once(); } const c = new C(); c.slice(
subclass	subclass	{ f = once(); } class D extends C {} new C(); new D(`,
        (n, a, b, c) => `
// field initializer ${a}
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
    if (all.length < 2) { console.log("field-initializer-${b}", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("field-initializer-${b}", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  class C ${c});
  report();
})();`,
      ],
      `
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
  function f() { try { return 1; } finally { once(); } } f(); f();`,
      [
        `in	const x in { a: 1, b: 2 }
loop	let i = 0; i < 2; i++
of	const x of [1, 2]`,
        (n, a, b) => `  report();
})();

// for ${a}
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
    if (all.length < 2) { console.log("for-${a}", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("for-${a}", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  for (${b}) once();`,
      ],
      [
        `one site next in loop	one-site-next-in-loop	once(); yield; once(); } const it = g(); for (const x of it) ;
resumed loop	resumed-loop	while (true) { once(); yield; } } const it = g(); it.next(); it.next();
return finally	return-finally	try { yield; } finally { once(); } } for (const i of [0, 1]) { const it = g(); it.next(); it.return(); }
two objects	two-objects	once(); yield; } const make = () => g(); const a = make(), b = make(); a.next(); b.next();`,
        (n, a, b, c) => `  report();
})();

// generator ${a}
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
    if (all.length < 2) { console.log("generator-${b}", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("generator-${b}", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  function* g() { ${c}`,
      ],
      [
        `assign	assign	return once(); } }; o.x; Object.assign({}, o)
computed	computed	return once(); } }; o.x; o[JSON.parse('"x"')]
descriptor call	descriptor-call	return once(); } }; o.x; Object.getOwnPropertyDescriptor(o, "x").get()
lookup getter	lookup-getter	return once(); } }; o.x; o.__lookupGetter__("x")()
rest	rest	return once(); }, y: 1 }; o.x; const { y, ...rest } = o
spread	spread	return once(); } }; o.x; ({ ...o })
stringify	stringify	once(); return 1; } }; o.x; JSON.stringify(o)`,
        (n, a, b, c) => `  report();
})();

// getter and ${a}
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
    if (all.length < 2) { console.log("getter-and-${b}", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("getter-and-${b}", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { get x() { ${c};`,
      ],
      [
        `		(o).x
 values	-values	.values(o)`,
        (n, a, b, c) => `  report();
})();

// getter and unknown${a}
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
    if (all.length < 2) { console.log("getter-and-unknown${b}", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("getter-and-unknown${b}", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const O = structuredClone({}).constructor;
  const o = { get x() { return once(); } }; o.x; O${c};`,
      ],
      [
        `and values	and-values	return once(); } }; o.x; Object.values(o)
compound	compound	once(); return 1; }, set x(v) {} }; o.x += 1; o.x++`,
        (n, a, b, c) => `  report();
})();

// getter ${a}
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
    if (all.length < 2) { console.log("getter-${b}", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("getter-${b}", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  const o = { get x() { ${c};`,
      ],
      `  report();
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
  const o = { [Symbol.iterator]() { return this; }, next() { return { done: false }; }, return() { once(); return {}; } }; const [a] = o; for (const x of o) break;`,
      [
        `plac	stringify([1]
viv	parse("[1]"`,
        (n, a, b) => `  report();
})();

// json re${a}er
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
    if (all.length < 2) { console.log("json-re${a}er", "runs", all.length); return; }
    const a = all[0], b = all[1];
    a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
    const holder = {}; holder[a.sym] = "a"; holder[b.sym] = "b";
    console.log("json-re${a}er", "runs", all.length, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, holder[a.sym], a.obj === b.obj, b.obj.n, new a.K() instanceof b.K, b.K.has(new a.K()));
  }
  JSON.${b}, function (k, v) { once(); return v; });`,
      ],
      `  report();
})();
`,
    ),
    "many-values-live-across-calls-of-every-kind.json": text(
      `{ "skipInShell": "it calls host functions (Buffer, URL, structuredClone), which the jsc shell does not have" }
`,
    ),
    "many-values-live-across-calls-of-every-kind.ts": text(
      `// Every function keeps 14 integers, 30 doubles and 6 strings live across one kind of call in a loop: more than any register file holds, so every register that
// the call is said to keep holds one of them. The checksum shows a value that came back changed.
const seed = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"].map((word, at) => word + at);
function add(a: number, b: number): number { return a + b; }
function many(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number): number { return a + b * 2 + c * 3 + d * 4 + e * 5 + f * 6 + g * 7 + h * 8 + i * 9 + j * 10; }
function manyFractions(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number): number { return a / 2 + b / 4 + c / 8 + d / 16 + e / 32 + f / 64 + g / 128 + h / 256 + i / 512 + j / 1024; }
function mixedKinds(a: number, b: string, c: number, d: number[], e: number, f: boolean, g: number, h: string | undefined): number { return a + b.length + c + d.length + e + (f ? 1 : 0) + g + (h ? h.length : 0); }
function busy(a: number): number { let p = a, q = a + 1, r = a + 2, s = a + 3, t = a + 4, u = a + 5, v = a + 6, w = a + 7; for (let at = 0; at < 3; at++) { p += add(q, r); q ^= p; r += s; s ^= add(t, u); t += u; u ^= v; v += w; w ^= p; } return (p + q + r + s + t + u + v + w) | 0; }
function busyFractions(a: number): number { let p = a, q = a + 1.5, r = a + 2.5, s = a + 3.5, t = a + 4.5, u = a + 5.5, v = a + 6.5, w = a + 7.5, x = a + 8.5, y = a + 9.5; for (let at = 0; at < 3; at++) { p += Math.sin(q); q += r / 2; r += s / 2; s += t / 2; t += u / 2; u += v / 2; v += w / 2; w += x / 2; x += y / 2; y += p / 2; } return p + q + r + s + t + u + v + w + x + y; }
function tail(a: number, b: number): number { "use strict"; return a <= 0 ? b : tail(a - 1, b + a); }
function passesMore(a: number, b: number): number { "use strict"; return many(a, b, 1, 2, 3, 4, 5, 6, 7, a + b); }
function passesFewer(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number): number { "use strict"; return add(a + j, b + i + c + d + e + f + g + h); }
function defaults(a: number, b = a + 1, c = b * 2): number { return a + b + c; }
function pair(a: number): [number, number] { return [a, a + 1]; }
const anyFunctions: ((a: number, b: number) => number)[] = [add, (a, b) => a - b, Math.max, function (a, b) { return a * b; }, add.bind(null, 5), Math.imul];
const receiver = { base: 10, plus(a: number) { return this.base + a; } };
const proxied = new Proxy({ a: 1 } as Record<string, number>, { get(target, key) { return key === "a" ? 41 : (key as string).length; }, has() { return true; }, set() { return true; } });
const primitive = { [Symbol.toPrimitive](hint: string) { return hint.length; } };
const withToString = { toString() { return "text"; } }, withValueOf = { valueOf() { return 6; } };
const moduleBytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 11, 2, 96, 1, 127, 1, 127, 96, 1, 124, 1, 124, 3, 3, 2, 0, 1, 7, 17, 2, 6, 116, 114, 105, 112, 108, 101, 0, 0, 4, 104, 97, 108, 102, 0, 1, 10, 24, 2, 7, 0, 32, 0, 65, 3, 108, 11, 14, 0, 32, 0, 68, 0, 0, 0, 0, 0, 0, 224, 63, 162, 11]);
const exported = new WebAssembly.Instance(new WebAssembly.Module(moduleBytes)).exports as { triple(value: number): number; half(value: number): number };`,
      [
        `smallFunction(seed: string[], rounds: number	add(k, 1)
tenIntegers(seed: string[], rounds: number	many(k, 1, 2, 3, 4, 5, 6, 7, 8, k)
tenFractions(seed: string[], rounds: number	manyFractions(k + 0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, k + 9.5) * 1024 | 0
argumentsOfMixedKinds(seed: string[], rounds: number, list: number[]	mixedKinds(k, seed[k % 8], k + 0.5, list, 3, k % 2 === 0, 2.25, k % 3 ? undefined : seed[0]) * 4 | 0
calleeUsesEveryRegister(seed: string[], rounds: number	busy(k)
calleeUsesEveryFractionRegister(seed: string[], rounds: number	busyFractions(k) * 16 | 0
tailCalls(seed: string[], rounds: number	tail(k, 0)
tailCallsWithMoreArguments(seed: string[], rounds: number	passesMore(k, 2)
tailCallsWithFewerArguments(seed: string[], rounds: number	passesFewer(k, 1, 2, 3, 4, 5, 6, 7, 8, 9)
defaultParameters(seed: string[], rounds: number	defaults(k) + defaults(k, 1) + defaults(k, undefined, 2)`,
        (n, a, b) => `
function ${a}) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = ${b};
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}`,
      ],
      `
function twoResults(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const [first, second] = pair(k);`,
      [
        `first * second	unknownCallee(seed: string[], rounds: number, functions: ((a: number, b: number) => number)[]
functions[k % functions.length](k, 3)	methodOfObject(seed: string[], rounds: number
receiver.plus(k)	callAndApply(seed: string[], rounds: number`,
        (n, a, b) => `    const n = ${a};
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function ${b}) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {`,
      ],
      `    const n = add.call(null, k, 1) + add.apply(null, [k, 2]) + receiver.plus.call({ base: 1 }, k) + Reflect.apply(add, null, [k, 3]);
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function boundFunctions(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  const bound = add.bind(null, 7);`,
      [
        `bound(k) + add.bind(null, k, 2)()	tooFewAndTooManyArguments(seed: string[], rounds: number
((add as any)(k) | 0) + (add as any)(k, 1, 2, 3, 4, 5, 6, 7, 8, 9)	constructors(seed: string[], rounds: number
new (class { v: number; constructor(v: number) { this.v = v * 2; } })(k).v + Reflect.construct(Array, [k % 5]).length	mapAndFilter(seed: string[], rounds: number, list: number[]
list.map(value => value * k).filter(value => value % 2 === 0).length + list.reduce((sum, value) => sum + value, k)	forEachAndSome(seed: string[], rounds: number, list: number[]`,
        (n, a, b) => `  for (let k = 0; k < rounds; k++) {
    const n = ${a};
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function ${b}) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];`,
      ],
      `  for (let k = 0; k < rounds; k++) {
    let n = 0;
    list.forEach(value => { n += value + k; });
    n += (list.some(value => value > k) ? 1 : 0) + (list.every(value => value < k) ? 2 : 0) + (list.find(value => value === k % 5) ?? -1) + list.findIndex(value => value === k % 5);`,
      [
        `sortWithComparator(seed: string[], rounds: number, list: number[]	list.slice().sort((a, b) => (a ^ k) - (b ^ k))[0] + list.toSorted((a, b) => b - a)[0]
replaceWithFunction(seed: string[], rounds: number	seed[k % 8].replace(/[aeiou]/g, vowel => vowel + k).length
reviverAndReplacer(seed: string[], rounds: number	JSON.parse("[1,2,3]", (key, value) => typeof value === "number" ? value + k : value)[2] + JSON.stringify({ a: k, b: 2 }, (key, value) => key === "b" ? undefined : value).length + JSON.stringify({ toJSON() { return k; } }).length
arrayFromWithFunction(seed: string[], rounds: number	Array.from({ length: 3 }, (_, at) => at * k)[2] + Array.from(new Set([k, 1]), value => value + 1).length`,
        (
          n,
          a,
          b,
        ) => `    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function ${a}) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = ${b};`,
      ],
      `    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function proxies(seed: string[], rounds: number, object: Record<string, number>) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    object.b = k;`,
      [
        `object.a + object[seed[k % 8]] + ("zz" in object ? 1 : 0)	conversionsThatRunCode
+(primitive as any) + \`\${primitive as any}\`.length + (withToString + "").length + (withValueOf as any) * 2 + ((withValueOf as any) < k ? 1 : 0) + seed.indexOf(withToString as any)	webAssemblyExports
exported.triple(k) + exported.half(k) * 2	hostFunctions`,
        (n, a, b) => `    const n = ${a};
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function ${b}(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {`,
      ],
      `    const n = Buffer.from(seed[k % 8]).length + new TextEncoder().encode(seed[k % 8]).length + performance.now() * 0 + structuredClone({ a: k }).a + new URL("http://a/b?c=" + k).search.length + btoa(seed[k % 8]).length;
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

console.log("smallFunction", smallFunction(seed, 23));
console.log("tenIntegers", tenIntegers(seed, 23));
console.log("tenFractions", tenFractions(seed, 23));
console.log("argumentsOfMixedKinds", argumentsOfMixedKinds(seed, 23, [1, 2]));
console.log("calleeUsesEveryRegister", calleeUsesEveryRegister(seed, 23));
console.log("calleeUsesEveryFractionRegister", calleeUsesEveryFractionRegister(seed, 23));
console.log("tailCalls", tailCalls(seed, 23));
console.log("tailCallsWithMoreArguments", tailCallsWithMoreArguments(seed, 23));
console.log("tailCallsWithFewerArguments", tailCallsWithFewerArguments(seed, 23));
console.log("defaultParameters", defaultParameters(seed, 23));
console.log("twoResults", twoResults(seed, 23));
console.log("unknownCallee", unknownCallee(seed, 23, anyFunctions));
console.log("methodOfObject", methodOfObject(seed, 23));
console.log("callAndApply", callAndApply(seed, 23));
console.log("boundFunctions", boundFunctions(seed, 23));
console.log("tooFewAndTooManyArguments", tooFewAndTooManyArguments(seed, 23));
console.log("constructors", constructors(seed, 23));
console.log("mapAndFilter", mapAndFilter(seed, 23, [1, 2, 3, 4]));
console.log("forEachAndSome", forEachAndSome(seed, 23, [1, 2, 3, 4]));
console.log("sortWithComparator", sortWithComparator(seed, 23, [5, 3, 8, 1, 9, 2]));
console.log("replaceWithFunction", replaceWithFunction(seed, 23));
console.log("reviverAndReplacer", reviverAndReplacer(seed, 23));
console.log("arrayFromWithFunction", arrayFromWithFunction(seed, 23));
console.log("proxies", proxies(seed, 23, proxied));
console.log("conversionsThatRunCode", conversionsThatRunCode(seed, 23));
console.log("webAssemblyExports", webAssemblyExports(seed, 23));
console.log("hostFunctions", hostFunctions(seed, 23));
`,
    ),
    "many-values-live-across-number-functions-and-typed-arrays.ts": text(
      `// Every function keeps 14 integers, 30 doubles and 6 strings live across one kind of call in a loop: more than any register file holds, so every register that
// the call is said to keep holds one of them. The checksum shows a value that came back changed.
const seed = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"].map((word, at) => word + at);
const bytes = new Uint8Array([1, 2, 250, 4]), shorts = new Int16Array([-1, 300, 5]), words32 = new Int32Array([1 << 30, -5, 9]), unsigned = new Uint32Array([4000000000, 7]);
const singles = new Float32Array([0.5, 1.25, -3]), wide = new Float64Array([0.1, 2.5, -7.75]), clamped = new Uint8ClampedArray(4), big = new BigInt64Array([5n, -6n]);
const view = new DataView(new ArrayBuffer(32));
const numerals = ["12", "3.5", " 7 ", "0x1f", "abc", "", "1e3", "-0"];`,
      [
        `sineAndCosine	Math.sin(x) + Math.cos(x)
tangents	Math.tan(x) + Math.atan(x) + Math.atan2(x, 2)
inverseFunctions	Math.asin(x % 1) + Math.acos(x % 1)
hyperbolicFunctions	Math.sinh(x % 3) + Math.cosh(x % 3) + Math.tanh(x) + Math.asinh(x) + Math.acosh(x + 1) + Math.atanh(x % 1)
exponentials	Math.exp(x % 4) + Math.expm1(x % 2) + Math.pow(x, 1.5) + x ** 2.5 + 2 ** (k % 9)
logarithms	Math.log(x) + Math.log2(x) + Math.log10(x) + Math.log1p(x)
roots	Math.sqrt(x) + Math.cbrt(x) + Math.hypot(x, 3) + Math.hypot(x, 2, 1)
rounding	Math.floor(x) + Math.ceil(x) + Math.round(x) + Math.trunc(-x) + Math.fround(x)
smallIntegerFunctions	Math.imul(k, 77777) % 100 + Math.clz32(k) + Math.sign(x - 2) + Math.abs(2 - x)
extremes	Math.min(x, 2, k) + Math.max(x, 2) + Math.min(x, NaN || 1)
remainders	x % 0.7 + (k % 7) + (-k % 3) + (x * 1e10) % 3.3 + k / 3
conversionsToIntegers	((x * 1e10) | 0) % 1000 + ((x * 1e20) >>> 0) % 1000 + (~~(x * 3e9)) % 1000`,
        (n, a, b) => `
function ${a}(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const x = k * 0.37 + 0.1;
    const n = (${b}) * 1000 | 0;
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}`,
      ],
      `
function numbersToStrings(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = String(k * 0.37).length + (k * 1001).toString().length + (k * 7).toString(16).length + (k * 0.37).toFixed(2).length + (k + 0.5).toPrecision(3).length;
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function stringsToNumbers(seed: string[], rounds: number, texts: string[]) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const text = texts[k % texts.length];
    const n = (Number(text) | 0) + (parseInt(text) | 0) + (parseFloat(text) | 0) + (+text | 0) + (Number.isNaN(+text) ? 1 : 0);
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function bigIntegers(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const value = BigInt(k) * 123456789012345678901n + 5n;`,
      [
        `Number(value % 1000n) + Number(BigInt.asIntN(8, value)) + (value > 10n ? 1 : 0)	(seed: string[], rounds: number, a: Uint8Array, b: Int16Array, c: Int32Array, d: Uint32Array, e: Float32
(a[k % 4] + b[k % 3] + c[k % 3] % 100 + d[k % 2] % 100 + e[k % 3] + f[k % 3]) | 0	PastTheEnd(seed: string[], rounds: number, a: Uint8`,
        (n, a, b) => `    const n = ${a};
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function typedArrayReads${b}Array, f: Float64Array) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {`,
      ],
      `    const byte = a[k], number = f[k];
    const n = (byte === undefined ? -1 : byte) + (number === undefined ? -2 : number | 0);
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function typedArrayStores(seed: string[], rounds: number, a: Uint8Array, c: Uint8ClampedArray, e: Float32Array, f: Float64Array) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    a[k % 4] = k * 77; c[k % 4] = k * 20.5; e[k % 3] = k / 3; f[k % 3] = k / 7; a[k] = 1;
    const n = (a[k % 4] + c[k % 4] + e[k % 3] * 100 + f[k % 3] * 100) | 0;
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function bigTypedArrays(seed: string[], rounds: number, a: BigInt64Array) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    a[k % 2] = a[(k + 1) % 2] + BigInt(k);
    const n = Number(a[k % 2]);
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function dataViews(seed: string[], rounds: number, v: DataView) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    v.setFloat64(8, k / 3); v.setInt16(0, k * 999, true); v.setUint32(4, k * 99999);
    const n = (v.getFloat64(8) * 100 + v.getInt16(0, true) + v.getUint32(4) % 1000 + v.getUint8(1)) | 0;
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function typedArrayMethods(seed: string[], rounds: number, c: Int32Array, f: Float64Array) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = c.indexOf(9) + (f.includes(2.5) ? 1 : 0) + c.subarray(1).length + f.slice(1).length + c.lastIndexOf(-5) + (f.join().length);
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function boxedDoubles(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  const holder: { value: any } = { value: 0 };
  const holders: any[] = ["", {}, 1];
  for (let k = 0; k < rounds; k++) {
    holder.value = k + 0.5;
    holders[k % 3] = holder.value * 2;
    const n = (holder.value + holders[k % 3]) | 0;
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function dates(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const date = new Date(86400000 * k + 12345);
    const n = date.getUTCDate() + date.getUTCDay() + date.toISOString().length + (date.getTime() % 1000);
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

console.log("sineAndCosine", sineAndCosine(seed, 23));
console.log("tangents", tangents(seed, 23));
console.log("inverseFunctions", inverseFunctions(seed, 23));
console.log("hyperbolicFunctions", hyperbolicFunctions(seed, 23));
console.log("exponentials", exponentials(seed, 23));
console.log("logarithms", logarithms(seed, 23));
console.log("roots", roots(seed, 23));
console.log("rounding", rounding(seed, 23));
console.log("smallIntegerFunctions", smallIntegerFunctions(seed, 23));
console.log("extremes", extremes(seed, 23));
console.log("remainders", remainders(seed, 23));
console.log("conversionsToIntegers", conversionsToIntegers(seed, 23));
console.log("numbersToStrings", numbersToStrings(seed, 23));
console.log("stringsToNumbers", stringsToNumbers(seed, 23, numerals));
console.log("bigIntegers", bigIntegers(seed, 23));
console.log("typedArrayReads", typedArrayReads(seed, 23, bytes, shorts, words32, unsigned, singles, wide));
console.log("typedArrayReadsPastTheEnd", typedArrayReadsPastTheEnd(seed, 23, bytes, wide));
console.log("typedArrayStores", typedArrayStores(seed, 23, bytes.slice(), clamped, singles.slice(), wide.slice()));
console.log("bigTypedArrays", bigTypedArrays(seed, 23, big.slice()));
console.log("dataViews", dataViews(seed, 23, view));
console.log("typedArrayMethods", typedArrayMethods(seed, 23, words32, wide));
console.log("boxedDoubles", boxedDoubles(seed, 23));
console.log("dates", dates(seed, 23));
`,
    ),
    "members-for-built-ins-added-by-a-function-found-late.js": text(
      `// A member that a built-in reads or calls by name (join, exec, set, add, resolve, then, length, @@toStringTag ..) appears after the built-in has run once, in a function that is found under a key read from a field before the constructor stores it.
function print(a, b, c) { let s = "" + a; if (b !== undefined) s += " " + b; if (c !== undefined) s += " " + c; console.log(s); }
function show(tag, v) {
  let t = typeof v;
  let extra = "";
  if (t === "number") extra = v + 1;
  else if (t === "string") extra = v + "!";
  else if (t === "object" && v !== null) extra = Object.keys(v).join(",");
  print(tag, t, extra);
}
function nothing() {}
let leaked = "a";
function probe(x) { leaked = x.k; }
class Leak { constructor() { probe(this); this.k = "a"; } }
function h0(f) { const choices = { a: nothing, undefined: f }; new Leak(); return choices[leaked](); }`,
      [
        `ArrayOwnJoin	const a = [1, 2];	a.join = function () { state = "changed"; return "late"; }	show(tag, String(a)); show(tag, \`\${a}\`); show(tag, a + ''); show(tag, [a, 3] + ''
RegexpOwnExec	const re = /a/;	re.exec = function (s) { state = "changed"; return null; }	show(tag, re.test('a')); show(tag, 'a'.replace(re, 'b')); show(tag, 'a'.match(re) === null); show(tag, 'a'.search(re)); show(tag, 'bab'.split(re).length
TostringtagGetter	const o = { v: 1 };	Object.defineProperty(o, Symbol.toStringTag, { get() { state = "changed"; return "Late"; } })	show(tag, \`\${o}\`); show(tag, Object.prototype.toString.call(o)); show(tag, o + ''
TostringtagOnClass	class C {} const o = new C();	Object.defineProperty(C.prototype, Symbol.toStringTag, { get() { state = "changed"; return "Late"; } })	show(tag, \`\${o}\`); show(tag, String(o)
ErrorNameGetter	const e = new Error('m');	Object.defineProperty(e, "name", { get() { state = "changed"; return "Late"; } })	show(tag, String(e)); show(tag, \`\${e}\`); show(tag, e + ''
ErrorMessageObject	const e = new Error('m');	e.message = { toString() { state = "changed"; return "late"; } }	show(tag, String(e)
MapSubclassSet	class M extends Map {}	M.prototype.set = function (k, v) { state = "changed"; return Map.prototype.set.call(this, k, "late"); }	const m = new M([[1, 2]]); show(tag, m.get(1)
SetSubclassAdd	class Z extends Set {}	Z.prototype.add = function (v) { state = "changed"; return Set.prototype.add.call(this, "late"); }	const z = new Z([1]); show(tag, [...z][0]
PromiseSubclassResolve	class P extends Promise {}	P.resolve = function (v) { state = "changed"; return Promise.resolve("late"); }	show(tag, (await P.all([1]))[0]); show(tag, await P.race([1])); show(tag, (await P.allSettled([1]))[0].value); show(tag, await P.any([1])
PromiseOwnThenForCatch	const p = Promise.resolve(1);	p.then = function (a, b) { state = "changed"; return Promise.resolve("late"); }	show(tag, await p.catch(() => 0)); show(tag, await p.finally(() => {})
DateOwnMethods	const d = new Date(0);	d.valueOf = () => { state = "changed"; return 7; }; d.toString = () => "late"; d.toISOString = () => "iso"	show(tag, d - 0); show(tag, typeof (d + '')); show(tag, (d + '').length < 6); show(tag, JSON.stringify(d).length < 8
WrapperOwnValueof	const n = new Number(1); const s = new String('s');	n.valueOf = () => { state = "changed"; return "late"; }; s.toString = () => "late"	show(tag, n + 1); show(tag, \`\${s}\`); show(tag, JSON.stringify([n, s])
SpeciesStaticGetter	class L extends Array {}	Object.defineProperty(L, Symbol.species, { get() { state = "changed"; return Array; } })	const l = L.from([1]); show(tag, l.map(x => x) instanceof L); show(tag, l.filter(x => x) instanceof L); show(tag, l.slice() instanceof L
ArrayLikeIndexGetter	const al = { length: 1, 0: 1 };	Object.defineProperty(al, "0", { get() { state = "changed"; return "late"; } })	show(tag, Array.prototype.map.call(al, x => x)[0]); show(tag, Array.from(al)[0]); show(tag, Array.prototype.join.call(al)); show(tag, Array.prototype.indexOf.call(al, 'late')); show(tag, Math.max.apply(null, al)
ArrayLikeLengthGetter	const al = { length: 1, 0: 1, 1: 'late' };	Object.defineProperty(al, "length", { get() { state = "changed"; return 2; } })	show(tag, Array.from(al).length); show(tag, Array.prototype.slice.call(al)[1]); show(tag, Array.prototype.at.call(al, -1)
ArrayLikeLengthObject	const al = { length: 1, 0: 'x' };	al.length = { valueOf() { state = "changed"; return 0; } }	show(tag, Array.from(al).length); show(tag, Array.prototype.join.call(al)); show(tag, Array.prototype.includes.call(al, 'x')
MatchSymbol	const o = { toString() { return 'a'; } };	o[Symbol.match] = function (s) { state = "changed"; return "late"; }; o[Symbol.replace] = function () { return "late"; }; o[Symbol.search] = function () { return "late"; }; o[Symbol.split] = function () { return "late"; }	show(tag, 'abc'.match(o) + ''); show(tag, 'abc'.replace(o, 'x')); show(tag, 'abc'.search(o)); show(tag, 'abc'.split(o) + ''
ReplacementResultConverted	const o = { v: 1 };	o.toString = function () { state = "changed"; return "late"; }	show(tag, 'a'.replace('a', () => o)); show(tag, 'a'.replace(/a/, () => o)); show(tag, 'a'.replaceAll('a', () => o)
ElementTostring	const o = { v: 1 };	o.toString = function () { state = "changed"; return "late"; }; o.toLocaleString = function () { return "local"; }	show(tag, [o].join()); show(tag, [[o]] + ''); show(tag, [o].toLocaleString()); show(tag, String([o, [o]])
BindReadsName	function f(a, b) {}	Object.defineProperty(f, "name", { get() { state = "changed"; return "late"; } }); Object.defineProperty(f, "length", { get() { return 7; } })	const b = f.bind(null); show(tag, b.name); show(tag, b.length
AssignSetter	const target = { a: 1 };	Object.defineProperty(target, "a", { set(v) { state = "changed"; }, get() { return "late"; } })	Object.assign(target, { a: 2 }); show(tag, target.a); const copy = { ...target }; show(tag, copy.a
DescriptorGetters	const d = { value: 1, enumerable: true };	Object.defineProperty(d, "value", { get() { state = "changed"; return "late"; } })	const o = Object.defineProperty({}, 'x', d); show(tag, o.x); show(tag, Object.create(null, { y: d }).y
InspectCustom	const o = { v: 1 };	o[Symbol.for("nodejs.util.inspect.custom")] = function () { state = "changed"; return "late"; }	console.log(o
StringifyReplacerArray	const keys = ['a']; const o = { a: 1, late: 2 };	keys.push({ toString() { state = "changed"; return "late"; } })	show(tag, JSON.stringify(o, keys)
ParseReviver	let reviver = (k, v) => v;	reviver = function (k, v) { state = "changed"; return typeof v === "number" ? "late" : v; }	show(tag, JSON.parse('{"a":1}', reviver).a
IteratorHelperNext	let n = 0; const it = { next() { return { done: n++ > 0, value: 1 }; } };	it.next = function () { state = "changed"; return { done: n++ > 0, value: "late" }; }	n = 0; show(tag, Iterator.from(it).toArray()[0]); n = 0; show(tag, Iterator.from(it).map(x => x).next().value
SetLike	const like = { size: 1, has() { return false; }, keys() { return [1][Symbol.iterator](); } };	like.keys = function () { state = "changed"; return ["late"][Symbol.iterator](); }	show(tag, [...new Set([0]).union(like)][1]
ConstructorForFrom	let C = Array;	C = function (n) { state = "changed"; this.made = "late"; }	const r = Array.from.call(C, [1]); show(tag, r.made); show(tag, Array.of.call(C, 1).made
TojsonOnClass	class K { constructor() { this.v = 1; } } const k = new K();	K.prototype.toJSON = function () { state = "changed"; return "late"; }	show(tag, JSON.stringify(k)); show(tag, JSON.stringify({ k })); show(tag, JSON.stringify(new Map([[1, k]]).get(1))`,
        (n, a, b, c, d) => `
async function named${a}() {
  let state = 0; ${b}
  function install() { ${c}; }
  async function use(tag) { ${d});show(tag, state); }
  await use('first');
  h0(install);
  await use('second');
}`,
      ],
      `
async function main() {
  print('# named array own join');
  await namedArrayOwnJoin().catch(e => print('failed', String(e)));
  print('# named regexp own exec');
  await namedRegexpOwnExec().catch(e => print('failed', String(e)));
  print('# named tostringtag getter');
  await namedTostringtagGetter().catch(e => print('failed', String(e)));
  print('# named tostringtag on class');
  await namedTostringtagOnClass().catch(e => print('failed', String(e)));
  print('# named error name getter');
  await namedErrorNameGetter().catch(e => print('failed', String(e)));
  print('# named error message object');
  await namedErrorMessageObject().catch(e => print('failed', String(e)));
  print('# named map subclass set');
  await namedMapSubclassSet().catch(e => print('failed', String(e)));
  print('# named set subclass add');
  await namedSetSubclassAdd().catch(e => print('failed', String(e)));
  print('# named promise subclass resolve');
  await namedPromiseSubclassResolve().catch(e => print('failed', String(e)));
  print('# named promise own then for catch');
  await namedPromiseOwnThenForCatch().catch(e => print('failed', String(e)));
  print('# named date own methods');
  await namedDateOwnMethods().catch(e => print('failed', String(e)));
  print('# named wrapper own valueof');
  await namedWrapperOwnValueof().catch(e => print('failed', String(e)));
  print('# named species static getter');
  await namedSpeciesStaticGetter().catch(e => print('failed', String(e)));
  print('# named array like index getter');
  await namedArrayLikeIndexGetter().catch(e => print('failed', String(e)));
  print('# named array like length getter');
  await namedArrayLikeLengthGetter().catch(e => print('failed', String(e)));
  print('# named array like length object');
  await namedArrayLikeLengthObject().catch(e => print('failed', String(e)));
  print('# named match symbol');
  await namedMatchSymbol().catch(e => print('failed', String(e)));
  print('# named replacement result converted');
  await namedReplacementResultConverted().catch(e => print('failed', String(e)));
  print('# named element tostring');
  await namedElementTostring().catch(e => print('failed', String(e)));
  print('# named bind reads name');
  await namedBindReadsName().catch(e => print('failed', String(e)));
  print('# named assign setter');
  await namedAssignSetter().catch(e => print('failed', String(e)));
  print('# named descriptor getters');
  await namedDescriptorGetters().catch(e => print('failed', String(e)));
  print('# named inspect custom');
  await namedInspectCustom().catch(e => print('failed', String(e)));
  print('# named stringify replacer array');
  await namedStringifyReplacerArray().catch(e => print('failed', String(e)));
  print('# named parse reviver');
  await namedParseReviver().catch(e => print('failed', String(e)));
  print('# named iterator helper next');
  await namedIteratorHelperNext().catch(e => print('failed', String(e)));
  print('# named set like');
  await namedSetLike().catch(e => print('failed', String(e)));
  print('# named constructor for from');
  await namedConstructorForFrom().catch(e => print('failed', String(e)));
  print('# named tojson on class');
  await namedTojsonOnClass().catch(e => print('failed', String(e)));
}
main();
`,
    ),
    "members-that-built-ins-find-by-name-appear-late.js": text(
      `// A member that a built-in reads or calls by name (join, exec, set, add, resolve, then, length, @@toStringTag ..) appears after the built-in has run once, in code that is reached through a chain of calls.
function print(a, b, c) { let s = "" + a; if (b !== undefined) s += " " + b; if (c !== undefined) s += " " + c; console.log(s); }
function show(tag, v) {
  let t = typeof v;
  let extra = "";
  if (t === "number") extra = v + 1;
  else if (t === "string") extra = v + "!";
  else if (t === "object" && v !== null) extra = Object.keys(v).join(",");
  print(tag, t, extra);
}
function h0(f) { return h1(f); }
function h1(f) { return h2(f); }
function h2(f) { return h3(f); }
function h3(f) { return h4(f); }
function h4(f) { return h5(f); }
function h5(f) { return h6(f); }
function h6(f) { return h7(f); }
function h7(f) { return h8(f); }
function h8(f) { return f(); }`,
      [
        `ArrayOwnJoin	const a = [1, 2];	a.join = function () { state = "changed"; return "late"; }	show(tag, String(a)); show(tag, \`\${a}\`); show(tag, a + ''); show(tag, [a, 3] + ''
RegexpOwnExec	const re = /a/;	re.exec = function (s) { state = "changed"; return null; }	show(tag, re.test('a')); show(tag, 'a'.replace(re, 'b')); show(tag, 'a'.match(re) === null); show(tag, 'a'.search(re)); show(tag, 'bab'.split(re).length
TostringtagGetter	const o = { v: 1 };	Object.defineProperty(o, Symbol.toStringTag, { get() { state = "changed"; return "Late"; } })	show(tag, \`\${o}\`); show(tag, Object.prototype.toString.call(o)); show(tag, o + ''
TostringtagOnClass	class C {} const o = new C();	Object.defineProperty(C.prototype, Symbol.toStringTag, { get() { state = "changed"; return "Late"; } })	show(tag, \`\${o}\`); show(tag, String(o)
ErrorNameGetter	const e = new Error('m');	Object.defineProperty(e, "name", { get() { state = "changed"; return "Late"; } })	show(tag, String(e)); show(tag, \`\${e}\`); show(tag, e + ''
ErrorMessageObject	const e = new Error('m');	e.message = { toString() { state = "changed"; return "late"; } }	show(tag, String(e)
MapSubclassSet	class M extends Map {}	M.prototype.set = function (k, v) { state = "changed"; return Map.prototype.set.call(this, k, "late"); }	const m = new M([[1, 2]]); show(tag, m.get(1)
SetSubclassAdd	class Z extends Set {}	Z.prototype.add = function (v) { state = "changed"; return Set.prototype.add.call(this, "late"); }	const z = new Z([1]); show(tag, [...z][0]
PromiseSubclassResolve	class P extends Promise {}	P.resolve = function (v) { state = "changed"; return Promise.resolve("late"); }	show(tag, (await P.all([1]))[0]); show(tag, await P.race([1])); show(tag, (await P.allSettled([1]))[0].value); show(tag, await P.any([1])
PromiseOwnThenForCatch	const p = Promise.resolve(1);	p.then = function (a, b) { state = "changed"; return Promise.resolve("late"); }	show(tag, await p.catch(() => 0)); show(tag, await p.finally(() => {})
DateOwnMethods	const d = new Date(0);	d.valueOf = () => { state = "changed"; return 7; }; d.toString = () => "late"; d.toISOString = () => "iso"	show(tag, d - 0); show(tag, typeof (d + '')); show(tag, (d + '').length < 6); show(tag, JSON.stringify(d).length < 8
WrapperOwnValueof	const n = new Number(1); const s = new String('s');	n.valueOf = () => { state = "changed"; return "late"; }; s.toString = () => "late"	show(tag, n + 1); show(tag, \`\${s}\`); show(tag, JSON.stringify([n, s])
SpeciesStaticGetter	class L extends Array {}	Object.defineProperty(L, Symbol.species, { get() { state = "changed"; return Array; } })	const l = L.from([1]); show(tag, l.map(x => x) instanceof L); show(tag, l.filter(x => x) instanceof L); show(tag, l.slice() instanceof L
ArrayLikeIndexGetter	const al = { length: 1, 0: 1 };	Object.defineProperty(al, "0", { get() { state = "changed"; return "late"; } })	show(tag, Array.prototype.map.call(al, x => x)[0]); show(tag, Array.from(al)[0]); show(tag, Array.prototype.join.call(al)); show(tag, Array.prototype.indexOf.call(al, 'late')); show(tag, Math.max.apply(null, al)
ArrayLikeLengthGetter	const al = { length: 1, 0: 1, 1: 'late' };	Object.defineProperty(al, "length", { get() { state = "changed"; return 2; } })	show(tag, Array.from(al).length); show(tag, Array.prototype.slice.call(al)[1]); show(tag, Array.prototype.at.call(al, -1)
ArrayLikeLengthObject	const al = { length: 1, 0: 'x' };	al.length = { valueOf() { state = "changed"; return 0; } }	show(tag, Array.from(al).length); show(tag, Array.prototype.join.call(al)); show(tag, Array.prototype.includes.call(al, 'x')
MatchSymbol	const o = { toString() { return 'a'; } };	o[Symbol.match] = function (s) { state = "changed"; return "late"; }; o[Symbol.replace] = function () { return "late"; }; o[Symbol.search] = function () { return "late"; }; o[Symbol.split] = function () { return "late"; }	show(tag, 'abc'.match(o) + ''); show(tag, 'abc'.replace(o, 'x')); show(tag, 'abc'.search(o)); show(tag, 'abc'.split(o) + ''
ReplacementResultConverted	const o = { v: 1 };	o.toString = function () { state = "changed"; return "late"; }	show(tag, 'a'.replace('a', () => o)); show(tag, 'a'.replace(/a/, () => o)); show(tag, 'a'.replaceAll('a', () => o)
ElementTostring	const o = { v: 1 };	o.toString = function () { state = "changed"; return "late"; }; o.toLocaleString = function () { return "local"; }	show(tag, [o].join()); show(tag, [[o]] + ''); show(tag, [o].toLocaleString()); show(tag, String([o, [o]])
BindReadsName	function f(a, b) {}	Object.defineProperty(f, "name", { get() { state = "changed"; return "late"; } }); Object.defineProperty(f, "length", { get() { return 7; } })	const b = f.bind(null); show(tag, b.name); show(tag, b.length
AssignSetter	const target = { a: 1 };	Object.defineProperty(target, "a", { set(v) { state = "changed"; }, get() { return "late"; } })	Object.assign(target, { a: 2 }); show(tag, target.a); const copy = { ...target }; show(tag, copy.a
DescriptorGetters	const d = { value: 1, enumerable: true };	Object.defineProperty(d, "value", { get() { state = "changed"; return "late"; } })	const o = Object.defineProperty({}, 'x', d); show(tag, o.x); show(tag, Object.create(null, { y: d }).y
InspectCustom	const o = { v: 1 };	o[Symbol.for("nodejs.util.inspect.custom")] = function () { state = "changed"; return "late"; }	console.log(o
StringifyReplacerArray	const keys = ['a']; const o = { a: 1, late: 2 };	keys.push({ toString() { state = "changed"; return "late"; } })	show(tag, JSON.stringify(o, keys)
ParseReviver	let reviver = (k, v) => v;	reviver = function (k, v) { state = "changed"; return typeof v === "number" ? "late" : v; }	show(tag, JSON.parse('{"a":1}', reviver).a
IteratorHelperNext	let n = 0; const it = { next() { return { done: n++ > 0, value: 1 }; } };	it.next = function () { state = "changed"; return { done: n++ > 0, value: "late" }; }	n = 0; show(tag, Iterator.from(it).toArray()[0]); n = 0; show(tag, Iterator.from(it).map(x => x).next().value
SetLike	const like = { size: 1, has() { return false; }, keys() { return [1][Symbol.iterator](); } };	like.keys = function () { state = "changed"; return ["late"][Symbol.iterator](); }	show(tag, [...new Set([0]).union(like)][1]
ConstructorForFrom	let C = Array;	C = function (n) { state = "changed"; this.made = "late"; }	const r = Array.from.call(C, [1]); show(tag, r.made); show(tag, Array.of.call(C, 1).made
TojsonOnClass	class K { constructor() { this.v = 1; } } const k = new K();	K.prototype.toJSON = function () { state = "changed"; return "late"; }	show(tag, JSON.stringify(k)); show(tag, JSON.stringify({ k })); show(tag, JSON.stringify(new Map([[1, k]]).get(1))`,
        (n, a, b, c, d) => `
async function named${a}() {
  let state = 0; ${b}
  function install() { ${c}; }
  async function use(tag) { ${d});show(tag, state); }
  await use('first');
  h0(install);
  await use('second');
}`,
      ],
      `
async function main() {
  print('# named array own join');
  await namedArrayOwnJoin().catch(e => print('failed', String(e)));
  print('# named regexp own exec');
  await namedRegexpOwnExec().catch(e => print('failed', String(e)));
  print('# named tostringtag getter');
  await namedTostringtagGetter().catch(e => print('failed', String(e)));
  print('# named tostringtag on class');
  await namedTostringtagOnClass().catch(e => print('failed', String(e)));
  print('# named error name getter');
  await namedErrorNameGetter().catch(e => print('failed', String(e)));
  print('# named error message object');
  await namedErrorMessageObject().catch(e => print('failed', String(e)));
  print('# named map subclass set');
  await namedMapSubclassSet().catch(e => print('failed', String(e)));
  print('# named set subclass add');
  await namedSetSubclassAdd().catch(e => print('failed', String(e)));
  print('# named promise subclass resolve');
  await namedPromiseSubclassResolve().catch(e => print('failed', String(e)));
  print('# named promise own then for catch');
  await namedPromiseOwnThenForCatch().catch(e => print('failed', String(e)));
  print('# named date own methods');
  await namedDateOwnMethods().catch(e => print('failed', String(e)));
  print('# named wrapper own valueof');
  await namedWrapperOwnValueof().catch(e => print('failed', String(e)));
  print('# named species static getter');
  await namedSpeciesStaticGetter().catch(e => print('failed', String(e)));
  print('# named array like index getter');
  await namedArrayLikeIndexGetter().catch(e => print('failed', String(e)));
  print('# named array like length getter');
  await namedArrayLikeLengthGetter().catch(e => print('failed', String(e)));
  print('# named array like length object');
  await namedArrayLikeLengthObject().catch(e => print('failed', String(e)));
  print('# named match symbol');
  await namedMatchSymbol().catch(e => print('failed', String(e)));
  print('# named replacement result converted');
  await namedReplacementResultConverted().catch(e => print('failed', String(e)));
  print('# named element tostring');
  await namedElementTostring().catch(e => print('failed', String(e)));
  print('# named bind reads name');
  await namedBindReadsName().catch(e => print('failed', String(e)));
  print('# named assign setter');
  await namedAssignSetter().catch(e => print('failed', String(e)));
  print('# named descriptor getters');
  await namedDescriptorGetters().catch(e => print('failed', String(e)));
  print('# named inspect custom');
  await namedInspectCustom().catch(e => print('failed', String(e)));
  print('# named stringify replacer array');
  await namedStringifyReplacerArray().catch(e => print('failed', String(e)));
  print('# named parse reviver');
  await namedParseReviver().catch(e => print('failed', String(e)));
  print('# named iterator helper next');
  await namedIteratorHelperNext().catch(e => print('failed', String(e)));
  print('# named set like');
  await namedSetLike().catch(e => print('failed', String(e)));
  print('# named constructor for from');
  await namedConstructorForFrom().catch(e => print('failed', String(e)));
  print('# named tojson on class');
  await namedTojsonOnClass().catch(e => print('failed', String(e)));
}
main();
`,
    ),
    "objects-the-host-has-seen-change-after-the-first-look.js": text(
      `// An object that is the reason of a rejection, so that the host has seen it, gets a method or other contents after it was looked at once, in code that is reached through a chain of calls.
function print(a, b, c) { let s = "" + a; if (b !== undefined) s += " " + b; if (c !== undefined) s += " " + c; console.log(s); }
function show(tag, v) {
  let t = typeof v;
  let extra = "";
  if (t === "number") extra = v + 1;
  else if (t === "string") extra = v + "!";
  else if (t === "object" && v !== null) extra = Object.keys(v).join(",");
  print(tag, t, extra);
}
function h0(f) { return h1(f); }
function h1(f) { return h2(f); }
function h2(f) { return h3(f); }
function h3(f) { return h4(f); }
function h4(f) { return h5(f); }
function h5(f) { return h6(f); }
function h6(f) { return h7(f); }
function h7(f) { return h8(f); }
function h8(f) { return f(); }`,
      [
        `EarlyAwaitThen	const o = { v: 1 };escape(o)	o.then = function (res) { res("late"); }	show(tag, await o);	EarlyAwaitProtoThen	const P = {}; const o = Object.create(P);escape(o)	P.then = function (res) { res("late"); }	show(tag, await o
EarlyIterator	const o = { v: 1 };escape(o)	o[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i++ >= 2, value: "late" }; } }; }	try { for (const x of o) show(tag, x); } catch (e) { print(tag, 'not iterable'); }	EarlyNext	let i = 0; const it = { next() { return { done: i++ >= 2, value: 1 }; } }; const o = { [Symbol.iterator]() { i = 0; return it; } };escape(it)	it.next = function () { return { done: i++ >= 2, value: "late" }; }	for (const x of o) show(tag, x
EarlyReturn	let state = 0; let i = 0; const it = { next() { return { done: false, value: i++ }; } }; const o = { [Symbol.iterator]() { return it; } };escape(it)	it.return = function () { state = "changed"; return {}; }	const before = state; for (const x of o) { show(tag, x); break; } show(tag, state); show(tag, before);	EarlyValueof	let state = 0; const o = { v: 1 };escape(o)	o.valueOf = function () { state = "changed"; return 7; }	const before = state; show(tag, o + 1); show(tag, o * 2); show(tag, state); show(tag, before
EarlyTostringOnClass	let state = 0; class C {} const o = new C();escape(o)	C.prototype.toString = function () { state = "changed"; return "late"; }	const before = state; show(tag, \`\${o}\`); show(tag, ({ late: 1 })[o]); show(tag, state); show(tag, before);	EarlyResultValue	let i = 0; const r = { done: false, value: 1 }; const o = { [Symbol.iterator]() { i = 0; return { next() { r.done = i++ >= 2; return r; } }; } };escape(r)	r.value = "late"	for (const x of o) show(tag, x
EarlyArrayElements	const a = [1, 2];escape(a)	a.push("late")	for (const x of a) show(tag, x); const [p, q, r] = a; show(tag, r);	EarlyGenerator	let sent = 1; function* g() { const x = yield 1; show('sent', x); } const it = g();escape(it)	sent = "late"	if (tag === 'second') { it.next(); it.next(sent); } else show(tag, 0
EarlyPromise	let give; const p = new Promise(r => { give = r; });escape(p)	give("late")	if (tag === 'second') show(tag, await p); else show(tag, 0);	EarlyField	const o = { v: 1 };escape(o)	o.v = "late"	show(tag, o.v); const { v } = o; show(tag, v
LateAwaitThen	const o = { v: 1 }	o.then = function (res) { res("late"); }; escape(o)	show(tag, await o);	LateAwaitProtoThen	const P = {}; const o = Object.create(P)	P.then = function (res) { res("late"); }; escape(o)	show(tag, await o
LateIterator	const o = { v: 1 }	o[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i++ >= 2, value: "late" }; } }; }; escape(o)	try { for (const x of o) show(tag, x); } catch (e) { print(tag, 'not iterable'); }	LateNext	let i = 0; const it = { next() { return { done: i++ >= 2, value: 1 }; } }; const o = { [Symbol.iterator]() { i = 0; return it; } }	it.next = function () { return { done: i++ >= 2, value: "late" }; }; escape(it)	for (const x of o) show(tag, x
LateReturn	let state = 0; let i = 0; const it = { next() { return { done: false, value: i++ }; } }; const o = { [Symbol.iterator]() { return it; } }	it.return = function () { state = "changed"; return {}; }; escape(it)	const before = state; for (const x of o) { show(tag, x); break; } show(tag, state); show(tag, before);	LateValueof	let state = 0; const o = { v: 1 }	o.valueOf = function () { state = "changed"; return 7; }; escape(o)	const before = state; show(tag, o + 1); show(tag, o * 2); show(tag, state); show(tag, before
LateTostringOnClass	let state = 0; class C {} const o = new C()	C.prototype.toString = function () { state = "changed"; return "late"; }; escape(o)	const before = state; show(tag, \`\${o}\`); show(tag, ({ late: 1 })[o]); show(tag, state); show(tag, before);	LateResultValue	let i = 0; const r = { done: false, value: 1 }; const o = { [Symbol.iterator]() { i = 0; return { next() { r.done = i++ >= 2; return r; } }; } }	r.value = "late"; escape(r)	for (const x of o) show(tag, x
LateArrayElements	const a = [1, 2]	a.push("late"); escape(a)	for (const x of a) show(tag, x); const [p, q, r] = a; show(tag, r);	LateGenerator	let sent = 1; function* g() { const x = yield 1; show('sent', x); } const it = g()	sent = "late"; escape(it)	if (tag === 'second') { it.next(); it.next(sent); } else show(tag, 0
LatePromise	let give; const p = new Promise(r => { give = r; })	give("late"); escape(p)	if (tag === 'second') show(tag, await p); else show(tag, 0);	LateField	const o = { v: 1 }	o.v = "late"; escape(o)	show(tag, o.v); const { v } = o; show(tag, v`,
        (n, a, b, c, d, e, f, g, h) => `
async function escaped${a}() {
  async function boom(x) { throw x; } function escape(x) { boom(x).then(undefined, () => {}); } ${b};
  function install() { ${c}; }
  async function use(tag) { ${d} }
  await use('first');
  h0(install);
  await use('second');
}

async function escaped${e}() {
  async function boom(x) { throw x; } function escape(x) { boom(x).then(undefined, () => {}); } ${f};
  function install() { ${g}; }
  async function use(tag) { ${h}); }
  await use('first');
  h0(install);
  await use('second');
}`,
      ],
      `
async function main() {
  print('# escaped early await then');
  await escapedEarlyAwaitThen().catch(e => print('failed', String(e)));
  print('# escaped early await proto then');
  await escapedEarlyAwaitProtoThen().catch(e => print('failed', String(e)));
  print('# escaped early iterator');
  await escapedEarlyIterator().catch(e => print('failed', String(e)));
  print('# escaped early next');
  await escapedEarlyNext().catch(e => print('failed', String(e)));
  print('# escaped early return');
  await escapedEarlyReturn().catch(e => print('failed', String(e)));
  print('# escaped early valueof');
  await escapedEarlyValueof().catch(e => print('failed', String(e)));
  print('# escaped early tostring on class');
  await escapedEarlyTostringOnClass().catch(e => print('failed', String(e)));
  print('# escaped early result value');
  await escapedEarlyResultValue().catch(e => print('failed', String(e)));
  print('# escaped early array elements');
  await escapedEarlyArrayElements().catch(e => print('failed', String(e)));
  print('# escaped early generator');
  await escapedEarlyGenerator().catch(e => print('failed', String(e)));
  print('# escaped early promise');
  await escapedEarlyPromise().catch(e => print('failed', String(e)));
  print('# escaped early field');
  await escapedEarlyField().catch(e => print('failed', String(e)));
  print('# escaped late await then');
  await escapedLateAwaitThen().catch(e => print('failed', String(e)));
  print('# escaped late await proto then');
  await escapedLateAwaitProtoThen().catch(e => print('failed', String(e)));
  print('# escaped late iterator');
  await escapedLateIterator().catch(e => print('failed', String(e)));
  print('# escaped late next');
  await escapedLateNext().catch(e => print('failed', String(e)));
  print('# escaped late return');
  await escapedLateReturn().catch(e => print('failed', String(e)));
  print('# escaped late valueof');
  await escapedLateValueof().catch(e => print('failed', String(e)));
  print('# escaped late tostring on class');
  await escapedLateTostringOnClass().catch(e => print('failed', String(e)));
  print('# escaped late result value');
  await escapedLateResultValue().catch(e => print('failed', String(e)));
  print('# escaped late array elements');
  await escapedLateArrayElements().catch(e => print('failed', String(e)));
  print('# escaped late generator');
  await escapedLateGenerator().catch(e => print('failed', String(e)));
  print('# escaped late promise');
  await escapedLatePromise().catch(e => print('failed', String(e)));
  print('# escaped late field');
  await escapedLateField().catch(e => print('failed', String(e)));
}
main();
`,
    ),
    "objects-the-host-has-seen-changed-by-a-function-found-late.js": text(
      `// An object that is the reason of a rejection, so that the host has seen it, gets a method or other contents after it was looked at once, in a function that is found under a key read from a field before the constructor stores it.
function print(a, b, c) { let s = "" + a; if (b !== undefined) s += " " + b; if (c !== undefined) s += " " + c; console.log(s); }
function show(tag, v) {
  let t = typeof v;
  let extra = "";
  if (t === "number") extra = v + 1;
  else if (t === "string") extra = v + "!";
  else if (t === "object" && v !== null) extra = Object.keys(v).join(",");
  print(tag, t, extra);
}
function nothing() {}
let leaked = "a";
function probe(x) { leaked = x.k; }
class Leak { constructor() { probe(this); this.k = "a"; } }
function h0(f) { const choices = { a: nothing, undefined: f }; new Leak(); return choices[leaked](); }`,
      [
        `EarlyAwaitThen	const o = { v: 1 };escape(o)	o.then = function (res) { res("late"); }	show(tag, await o);	EarlyAwaitProtoThen	const P = {}; const o = Object.create(P);escape(o)	P.then = function (res) { res("late"); }	show(tag, await o
EarlyIterator	const o = { v: 1 };escape(o)	o[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i++ >= 2, value: "late" }; } }; }	try { for (const x of o) show(tag, x); } catch (e) { print(tag, 'not iterable'); }	EarlyNext	let i = 0; const it = { next() { return { done: i++ >= 2, value: 1 }; } }; const o = { [Symbol.iterator]() { i = 0; return it; } };escape(it)	it.next = function () { return { done: i++ >= 2, value: "late" }; }	for (const x of o) show(tag, x
EarlyReturn	let state = 0; let i = 0; const it = { next() { return { done: false, value: i++ }; } }; const o = { [Symbol.iterator]() { return it; } };escape(it)	it.return = function () { state = "changed"; return {}; }	const before = state; for (const x of o) { show(tag, x); break; } show(tag, state); show(tag, before);	EarlyValueof	let state = 0; const o = { v: 1 };escape(o)	o.valueOf = function () { state = "changed"; return 7; }	const before = state; show(tag, o + 1); show(tag, o * 2); show(tag, state); show(tag, before
EarlyTostringOnClass	let state = 0; class C {} const o = new C();escape(o)	C.prototype.toString = function () { state = "changed"; return "late"; }	const before = state; show(tag, \`\${o}\`); show(tag, ({ late: 1 })[o]); show(tag, state); show(tag, before);	EarlyResultValue	let i = 0; const r = { done: false, value: 1 }; const o = { [Symbol.iterator]() { i = 0; return { next() { r.done = i++ >= 2; return r; } }; } };escape(r)	r.value = "late"	for (const x of o) show(tag, x
EarlyArrayElements	const a = [1, 2];escape(a)	a.push("late")	for (const x of a) show(tag, x); const [p, q, r] = a; show(tag, r);	EarlyGenerator	let sent = 1; function* g() { const x = yield 1; show('sent', x); } const it = g();escape(it)	sent = "late"	if (tag === 'second') { it.next(); it.next(sent); } else show(tag, 0
EarlyPromise	let give; const p = new Promise(r => { give = r; });escape(p)	give("late")	if (tag === 'second') show(tag, await p); else show(tag, 0);	EarlyField	const o = { v: 1 };escape(o)	o.v = "late"	show(tag, o.v); const { v } = o; show(tag, v
LateAwaitThen	const o = { v: 1 }	o.then = function (res) { res("late"); }; escape(o)	show(tag, await o);	LateAwaitProtoThen	const P = {}; const o = Object.create(P)	P.then = function (res) { res("late"); }; escape(o)	show(tag, await o
LateIterator	const o = { v: 1 }	o[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i++ >= 2, value: "late" }; } }; }; escape(o)	try { for (const x of o) show(tag, x); } catch (e) { print(tag, 'not iterable'); }	LateNext	let i = 0; const it = { next() { return { done: i++ >= 2, value: 1 }; } }; const o = { [Symbol.iterator]() { i = 0; return it; } }	it.next = function () { return { done: i++ >= 2, value: "late" }; }; escape(it)	for (const x of o) show(tag, x
LateReturn	let state = 0; let i = 0; const it = { next() { return { done: false, value: i++ }; } }; const o = { [Symbol.iterator]() { return it; } }	it.return = function () { state = "changed"; return {}; }; escape(it)	const before = state; for (const x of o) { show(tag, x); break; } show(tag, state); show(tag, before);	LateValueof	let state = 0; const o = { v: 1 }	o.valueOf = function () { state = "changed"; return 7; }; escape(o)	const before = state; show(tag, o + 1); show(tag, o * 2); show(tag, state); show(tag, before
LateTostringOnClass	let state = 0; class C {} const o = new C()	C.prototype.toString = function () { state = "changed"; return "late"; }; escape(o)	const before = state; show(tag, \`\${o}\`); show(tag, ({ late: 1 })[o]); show(tag, state); show(tag, before);	LateResultValue	let i = 0; const r = { done: false, value: 1 }; const o = { [Symbol.iterator]() { i = 0; return { next() { r.done = i++ >= 2; return r; } }; } }	r.value = "late"; escape(r)	for (const x of o) show(tag, x
LateArrayElements	const a = [1, 2]	a.push("late"); escape(a)	for (const x of a) show(tag, x); const [p, q, r] = a; show(tag, r);	LateGenerator	let sent = 1; function* g() { const x = yield 1; show('sent', x); } const it = g()	sent = "late"; escape(it)	if (tag === 'second') { it.next(); it.next(sent); } else show(tag, 0
LatePromise	let give; const p = new Promise(r => { give = r; })	give("late"); escape(p)	if (tag === 'second') show(tag, await p); else show(tag, 0);	LateField	const o = { v: 1 }	o.v = "late"; escape(o)	show(tag, o.v); const { v } = o; show(tag, v`,
        (n, a, b, c, d, e, f, g, h) => `
async function escaped${a}() {
  async function boom(x) { throw x; } function escape(x) { boom(x).then(undefined, () => {}); } ${b};
  function install() { ${c}; }
  async function use(tag) { ${d} }
  await use('first');
  h0(install);
  await use('second');
}

async function escaped${e}() {
  async function boom(x) { throw x; } function escape(x) { boom(x).then(undefined, () => {}); } ${f};
  function install() { ${g}; }
  async function use(tag) { ${h}); }
  await use('first');
  h0(install);
  await use('second');
}`,
      ],
      `
async function main() {
  print('# escaped early await then');
  await escapedEarlyAwaitThen().catch(e => print('failed', String(e)));
  print('# escaped early await proto then');
  await escapedEarlyAwaitProtoThen().catch(e => print('failed', String(e)));
  print('# escaped early iterator');
  await escapedEarlyIterator().catch(e => print('failed', String(e)));
  print('# escaped early next');
  await escapedEarlyNext().catch(e => print('failed', String(e)));
  print('# escaped early return');
  await escapedEarlyReturn().catch(e => print('failed', String(e)));
  print('# escaped early valueof');
  await escapedEarlyValueof().catch(e => print('failed', String(e)));
  print('# escaped early tostring on class');
  await escapedEarlyTostringOnClass().catch(e => print('failed', String(e)));
  print('# escaped early result value');
  await escapedEarlyResultValue().catch(e => print('failed', String(e)));
  print('# escaped early array elements');
  await escapedEarlyArrayElements().catch(e => print('failed', String(e)));
  print('# escaped early generator');
  await escapedEarlyGenerator().catch(e => print('failed', String(e)));
  print('# escaped early promise');
  await escapedEarlyPromise().catch(e => print('failed', String(e)));
  print('# escaped early field');
  await escapedEarlyField().catch(e => print('failed', String(e)));
  print('# escaped late await then');
  await escapedLateAwaitThen().catch(e => print('failed', String(e)));
  print('# escaped late await proto then');
  await escapedLateAwaitProtoThen().catch(e => print('failed', String(e)));
  print('# escaped late iterator');
  await escapedLateIterator().catch(e => print('failed', String(e)));
  print('# escaped late next');
  await escapedLateNext().catch(e => print('failed', String(e)));
  print('# escaped late return');
  await escapedLateReturn().catch(e => print('failed', String(e)));
  print('# escaped late valueof');
  await escapedLateValueof().catch(e => print('failed', String(e)));
  print('# escaped late tostring on class');
  await escapedLateTostringOnClass().catch(e => print('failed', String(e)));
  print('# escaped late result value');
  await escapedLateResultValue().catch(e => print('failed', String(e)));
  print('# escaped late array elements');
  await escapedLateArrayElements().catch(e => print('failed', String(e)));
  print('# escaped late generator');
  await escapedLateGenerator().catch(e => print('failed', String(e)));
  print('# escaped late promise');
  await escapedLatePromise().catch(e => print('failed', String(e)));
  print('# escaped late field');
  await escapedLateField().catch(e => print('failed', String(e)));
}
main();
`,
    ),
    "texts-reach-number-fields-inherited-from-the-value-of-an-expression.ts": text(
      `// Classes whose base is the value of an expression, as the class of a mixin, inherit a field declared as a number. A text reaches the field in every untyped way. Untyped reads get the text back, a typed store puts a number back, and another instance keeps its number.
const names: string[] = JSON.parse('["x", "y"]');
const parsed: any = JSON.parse('{"x": "text"}');
function pick<T>(c: T): T { return c; }
function show(o: object): string { const a = o as any; return typeof a.x + ":" + String(a.x) + " " + Object.keys(o).join("+") + " " + JSON.stringify(o); }`,
      [
        `{ x: number | string }): void { o.x = "text"	wider type
any): void { o.x = "text"	any
any): void { o[names[0]] = "text"	computed key
any): void { for (const k of Object.keys(parsed)) o[k] = parsed[k]	copied data
any): void { Object.assign(o, parsed)	Object.assign
any): void { Reflect.set(o, names[0], "text")	Reflect.set`,
        (n, a, b) => `{
  class P { x: number = 1; sum(): number { return this.x + 1; } }
  const Mix = <B extends new (...a: any[]) => P>(b: B) => class extends b { w: number = 4; };
  const C = Mix(P);
  function act(o: ${a}; }
  const other: P = new C();
  const o: P = new C();
  const before = o.sum();
  act(o);
  const stored = show(o);
  o.x = 2;
  console.log("mixin, ${b}", before, stored, "|", o.sum(), show(o), "|", other.sum(), show(other));
}`,
      ],
      [
        `{ x: number | string }): void { o.x = "text"	wider type
any): void { o.x = "text"	any
any): void { o[names[0]] = "text"	computed key
any): void { for (const k of Object.keys(parsed)) o[k] = parsed[k]	copied data
any): void { Object.assign(o, parsed)	Object.assign
any): void { Reflect.set(o, names[0], "text")	Reflect.set`,
        (n, a, b) => `{
  class P { x: number = 1; sum(): number { return this.x + 1; } }
  const Mix = <B extends new (...a: any[]) => P>(b: B) => class extends b { w: number = 4; };
  const Again = <B extends new (...a: any[]) => P>(b: B) => class extends b { v: number = 5; };
  const C = Again(Mix(P));
  function act(o: ${a}; }
  const other: P = new C();
  const o: P = new C();
  const before = o.sum();
  act(o);
  const stored = show(o);
  o.x = 2;
  console.log("mixin over mixin, ${b}", before, stored, "|", o.sum(), show(o), "|", other.sum(), show(other));
}`,
      ],
      [
        `{ x: number | string }): void { o.x = "text"	wider type
any): void { o.x = "text"	any
any): void { o[names[0]] = "text"	computed key
any): void { for (const k of Object.keys(parsed)) o[k] = parsed[k]	copied data
any): void { Object.assign(o, parsed)	Object.assign
any): void { Reflect.set(o, names[0], "text")	Reflect.set`,
        (n, a, b) => `{
  class P { x: number = 1; sum(): number { return this.x + 1; } }
  const Picked = pick(P);
  class C extends Picked { u: number = 6; }
  function act(o: ${a}; }
  const other: P = new C();
  const o: P = new C();
  const before = o.sum();
  act(o);
  const stored = show(o);
  o.x = 2;
  console.log("base handed through a function, ${b}", before, stored, "|", o.sum(), show(o), "|", other.sum(), show(other));
}`,
      ],
      [
        `{ x: number | string }): void { o.x = "text"	wider type
any): void { o.x = "text"	any
any): void { o[names[0]] = "text"	computed key
any): void { for (const k of Object.keys(parsed)) o[k] = parsed[k]	copied data
any): void { Object.assign(o, parsed)	Object.assign
any): void { Reflect.set(o, names[0], "text")	Reflect.set`,
        (n, a, b) => `{
  class P { x: number = 1; sum(): number { return this.x + 1; } }
  class C extends (names.length > 1 ? P : P) { t: number = 7; }
  function act(o: ${a}; }
  const other: P = new C();
  const o: P = new C();
  const before = o.sum();
  act(o);
  const stored = show(o);
  o.x = 2;
  console.log("base chosen by a condition, ${b}", before, stored, "|", o.sum(), show(o), "|", other.sum(), show(other));
}`,
      ],
      ``,
    ),
    "what-lies-above-new-objects-of-a-typed-class-is-changed.ts": text(
      `// The maker is a class whose constructor stores its declared fields.
// What lies above the objects that a typed maker makes, or who holds them before they are filled, is changed on roads that the types do not show: each is spelled with the casts it needs.
// What lies above afterwards has a setter and a getter for \`pos\`, which the maker fills and its type declares: the objects made from then on have no \`pos\` of their own, and \`end\`, a number, may be missing too.
// Each road has a maker and typed readers of its own, so that nothing but that road decides what the readers may take for granted.
interface Tagged { tag: number; }
const kept: unknown[] = [];
const spy = {
  set pos(value: unknown) {
    kept.push(value);
  },
  get pos(): unknown {
    return "read";
  },
};
function takes(value: unknown) {
  kept.push(value);
}
function gives(): unknown {
  return "read";
}
function storeUnder(target: any, key: string, value: unknown) {
  target[key] = value;
}
const names = ["prototype", "__proto__", "pos", "end"];
function nameAt(index: number): string {
  return names[index % names.length];
}
function report(label: string, made: object, pos: unknown, end: unknown, isInstance: unknown, firstIsInstance: unknown) {
  console.log(label + ":", Object.hasOwn(made, "pos"), typeof pos, typeof pos === "object" && pos ? (pos as Tagged).tag : String(pos), typeof end, String(end), isInstance, firstIsInstance, Object.getPrototypeOf(made) === spy, kept.length);
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  try { storeUnder(Made, nameAt(0), spy); } catch (error) { kept.push((error as Error).constructor.name); }`,
      [
        `new Made({ tag: 1 }, 2	the prototype property of a class cannot be replaced	.prototype
Reflect.construct(Made, [{ tag: 1 }, 2], Other	another new.target	[nameAt(0)]
Reflect.construct(Made, [{ tag: 1 }, 2], Other	another new.target, its prototype under a computed key	[nameAt(0)]`,
        (n, a, b, c) => `  const late: Made = ${a});
  report("${b} " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  function Other() {}
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  (Other as any)${c} = spy;`,
      ],
      `  const late: Made = Reflect.construct(Made, [{ tag: 1 }, 2], Other.bind(null));
  report("a bound function as new.target " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  
  const late: Made = (() => { try { return new (new Proxy(Made, { get: (target, key, receiver) => (key === "prototype" ? spy : Reflect.get(target, key, receiver)) }))({ tag: 1 }, 2); } catch (error) { return { pos: (error as Error).constructor.name, end: 0 } as unknown as Made; } })();
  report("a proxy as new.target " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }`,
      [
        `(Made.bind(null, { tag: 1 }))(	bound maker, the link above changed
Below({ tag: 1 }, 	class below, made before`,
        (n, a, b) => `  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  Reflect.setPrototypeOf(Made.prototype, spy);
  const late: Made = new ${a}2);
  report("a ${b} " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  class Below extends Made {}`,
      ],
      `  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  (Below.prototype as any)[nameAt(1)] = spy;
  const late: Made = new Below({ tag: 1 }, 2);
  report("a class below, above the lower prototype object " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  storeUnder(Made.prototype, ["__pro", "to__"].join(""), spy);`,
      [
        `joined	[nameAt(1)]
out of an array	.__proto__`,
        (n, a, b) => `  const late: Made = new Made({ tag: 1 }, 2);
  report("above the prototype object, __proto__ ${a} " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  (Made.prototype as any)${b} = spy;`,
      ],
      [
        `__proto__ spelled	Object.setPrototypeOf(Made.prototype, spy
Object.setPrototypeOf	Reflect.setPrototypeOf(Made.prototype, spy
Reflect.setPrototypeOf	Object.setPrototypeOf.apply(null, [Made.prototype, spy]
setPrototypeOf by apply	Object.setPrototypeOf(...([Made.prototype, spy] as [object, object])
setPrototypeOf spread	Object.getOwnPropertyDescriptor(Object.prototype, "__proto__")!.set!.call(Made.prototype, spy
the setter of __proto__	Object.setPrototypeOf(Object.getPrototypeOf(first), spy
found from an instance	Object.setPrototypeOf(Made.prototype, new Proxy({}, { set: (target, key, value) => (kept.push(value), true), get: () => "read" })
a proxy	Object.setPrototypeOf(Made.prototype, new Proxy({}, { set: (target, key, value, receiver) => (key === "pos" ? true : Reflect.defineProperty(receiver, key, { value, writable: true, enumerable: true, configurable: true })), get: () => "read" })`,
        (n, a, b) => `  const late: Made = new Made({ tag: 1 }, 2);
  report("above the prototype object, ${a} " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  ${b});`,
      ],
      [
        `bove the prototype object, a proxy that defines on the receiver	y(Made.prototype, "pos", { set: takes, get: gives
n accessor on the prototype object	y(Made.prototype, nameAt(2), { set: takes, get: gives
n accessor on the prototype object, a computed key	y(Made.prototype, nameAt(3), { set: takes, get: gives
n accessor for the number on the prototype object, a computed key	ies(Made.prototype, { [nameAt(2)]: { set: takes, get: gives }`,
        (n, a, b) => `  const late: Made = new Made({ tag: 1 }, 2);
  report("a${a} " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  Object.definePropert${b} });`,
      ],
      `  const late: Made = new Made({ tag: 1 }, 2);
  report("an accessor on the prototype object, a map with a computed key " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  (Made.prototype as any).__defineSetter__(nameAt(2), takes); (Made.prototype as any).__defineGetter__(nameAt(2), gives);
  const late: Made = new Made({ tag: 1 }, 2);
  report("an accessor on the prototype object, the old way " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  Reflect.apply(Reflect.defineProperty, null, [Made.prototype, "pos", { set: takes, get: gives }]);`,
      [
        `new Made({ tag: 1 }, 2	n accessor on the prototype object, Reflect by apply	Object.getPrototypeOf(first), "pos", { set: takes, get: gives
new Made({ tag: 1 }, 2	n accessor on the prototype object, found from an instance	Made.prototype, "pos", { value: "read", writable: false
(() => { try { return new Made({ tag: 1 }, 2); } catch (error) { return { pos: (error as Error).constructor.name, end: 0 } as unknown as Made; } })(	 read-only property on the prototype object	Made.prototype, nameAt(3), { value: -7, writable: false`,
        (n, a, b, c) => `  const late: Made = ${a});
  report("a${b} " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  Object.defineProperty(${c} });`,
      ],
      `  const late: Made = (() => { try { return new Made({ tag: 1 }, 2); } catch (error) { return { pos: (error as Error).constructor.name, end: 0 } as unknown as Made; } })();
  report("a read-only number on the prototype object, a computed key " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  (Made.prototype as any).pos = "read"; Object.freeze(Made.prototype);
  const late: Made = (() => { try { return new Made({ tag: 1 }, 2); } catch (error) { return { pos: (error as Error).constructor.name, end: 0 } as unknown as Made; } })();
  report("the prototype object is frozen over a value " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  const seen: string[] = [];
  function readEarly(made: { pos: Tagged; end: number }): string {
    return typeof made.pos + " " + typeof made.end + " " + (made.end * 2);
  }
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      seen.push(String((this as Made).pos) + "," + String((this as Made).end) + "," + readEarly(this));
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  seen.length = 0;
  const late: Made = (() => { const made = new Made({ tag: 1 }, 2); kept.push(seen.join()); console.log("seen early:", seen.join()); return made; })();
  report("the maker hands the object out before it fills it " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  const held: unknown[] = [];
  const arm = { on: false };
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      held.push(this);`,
      [
        `{ this.pos = pos; throw new RangeError("half"); }	(() => { try { new Made({ tag: 1 }, 2); } catch {} return held[held.length - 1] as Made; })(	keeps the object and throws half wa
return;	new Made({ tag: 1 }, 2	returns earl`,
        (n, a, b, c) => `      if (arm.on) ${a}
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  arm.on = true;
  const late: Made = ${b});
  report("the maker ${c}y " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  const arm = { on: false };
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {`,
      ],
      `      if (arm.on) return Object.create(spy);
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  arm.on = true;
  const late: Made = new Made({ tag: 1 }, 2);
  report("the maker returns another object " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  const seen: string[] = [];
  class Base {
    constructor() {
      const self = this as unknown as { pos: Tagged; end: number };
      seen.push(typeof self.pos + " " + typeof self.end + " " + self.end * 2);
    }
  }
  class Made extends Base {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      super();
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  seen.length = 0;
  const late: Made = (() => { const made = new Made({ tag: 1 }, 2); console.log("seen by the base:", seen.join()); return made; })();
  report("a base that reads the object before it is filled " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  const held: unknown[] = [];
  const arm = { on: false };
  class Base {
    constructor() {
      held.push(this);
    }
  }
  class Made extends Base {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      super();
      if (arm.on) throw new RangeError("half");
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  arm.on = true;
  const late: Made = (() => { try { new Made({ tag: 1 }, 2); } catch {} return held[held.length - 1] as Made; })();
  report("a base that keeps the object, and the constructor throws " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  const arm = { on: false };
  class Base {
    constructor() {
      if (arm.on) return Object.create(spy);
    }
  }
  class Made extends Base {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      super();
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  arm.on = true;
  const late: Made = new Made({ tag: 1 }, 2);
  report("a base that returns another object " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Base {}
  class Made extends Base {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      super();
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  Object.setPrototypeOf(Made, function () { return Object.create(spy); });`,
      [
        `new Made({ tag: 1 }, 2)	the base is replaced
Object.create(Made.prototype) as Made	what Object.create makes below the prototype object
Object.create(Made.prototype, { pos: { get: gives, enumerable: true }, end: { value: "text", enumerable: true } }) as Made	what Object.create makes with descriptors
Object.setPrototypeOf({ end: 2 }, Made.prototype) as Made	a literal put below the prototype object`,
        (n, a, b) => `  const late: Made = ${a};
  report("${b} " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  `,
      ],
      `  const late: Made = new (Made as any)("text", undefined);
  report("the operands are of other types " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
`,
    ),
    "what-lies-above-new-objects-of-a-typed-constructor-function-is-changed.ts": text(
      `// The maker is a constructor function with a declared interface.
// What lies above the objects that a typed maker makes, or who holds them before they are filled, is changed on roads that the types do not show: each is spelled with the casts it needs.
// What lies above afterwards has a setter and a getter for \`pos\`, which the maker fills and its type declares: the objects made from then on have no \`pos\` of their own, and \`end\`, a number, may be missing too.
// Each road has a maker and typed readers of its own, so that nothing but that road decides what the readers may take for granted.
interface Tagged { tag: number; }
const kept: unknown[] = [];
const spy = {
  set pos(value: unknown) {
    kept.push(value);
  },
  get pos(): unknown {
    return "read";
  },
};
function takes(value: unknown) {
  kept.push(value);
}
function gives(): unknown {
  return "read";
}
function storeUnder(target: any, key: string, value: unknown) {
  target[key] = value;
}
const names = ["prototype", "__proto__", "pos", "end"];
function nameAt(index: number): string {
  return names[index % names.length];
}
function report(label: string, made: object, pos: unknown, end: unknown, isInstance: unknown, firstIsInstance: unknown) {
  console.log(label + ":", Object.hasOwn(made, "pos"), typeof pos, typeof pos === "object" && pos ? (pos as Tagged).tag : String(pos), typeof end, String(end), isInstance, firstIsInstance, Object.getPrototypeOf(made) === spy, kept.length);
}
{
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  (Made as any).prototype = spy;
  const late: Made = new Made({ tag: 1 }, 2);
  report("the name is spelled " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  storeUnder(Made, ["proto", "type"].join(""), spy);`,
      [
        `that is joined	"proto" + "type"
that is added up	nameAt(0)
out of an array	kept.length >= 0 ? "prototype" : "other"`,
        (n, a, b) => `  const late: Made = new Made({ tag: 1 }, 2);
  report("a key ${a} " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  (Made as any)[${b}] = spy;`,
      ],
      [
        `one of two keys	any
through a parameter of type any	{ prototype: object }`,
        (n, a, b) => `  const late: Made = new Made({ tag: 1 }, 2);
  report("${a} " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  function replace(target: ${b}) {
    target.prototype = spy;
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  replace(Made);`,
      ],
      [
        `through a parameter with a prototype of type object	set(Made, "prototype", spy
Reflect.set	set(Made, nameAt(0), spy
Reflect.set, a computed key	set(...([Made, "prototype", spy] as [object, string, unknown])
Reflect.set, spread	apply(Reflect.set, undefined, [Made, "prototype", spy]`,
        (n, a, b) => `  const late: Made = new Made({ tag: 1 }, 2);
  report("${a} " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  Reflect.${b});`,
      ],
      [
        `Reflect.set by apply	Object.defineProperty(Made, "prototype", { value: spy
Object.defineProperty	Object.defineProperty(Made, nameAt(0), { value: spy
Object.defineProperty, a computed key	Object.defineProperty.call(null, Made, "prototype", { value: spy
Object.defineProperty by call	(Object.defineProperty.bind(null, Made) as (key: string, descriptor: PropertyDescriptor) => unknown)("prototype", { value: spy
Object.defineProperty, bound	Reflect.defineProperty(Made, "prototype", { value: spy
Reflect.defineProperty	Object.defineProperties(Made, { prototype: { value: spy }
Object.defineProperties	Object.defineProperties(Made, { [nameAt(0)]: { value: spy }
Object.defineProperties, a computed key	Object.assign(Made, { prototype: spy
Object.assign	Object.assign(Made, { [nameAt(0)]: spy`,
        (n, a, b) => `  const late: Made = new Made({ tag: 1 }, 2);
  report("${a} " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  ${b} });`,
      ],
      [
        `, a computed key	Object.fromEntries([["prototype", spy]])
 from entries	{ get prototype() { return spy; } }`,
        (n, a, b) => `  const late: Made = new Made({ tag: 1 }, 2);
  report("Object.assign${a} " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  Object.assign(Made, ${b});`,
      ],
      `  const late: Made = new Made({ tag: 1 }, 2);
  report("Object.assign from a getter " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  const from: Record<string, unknown> = { prototype: spy }; for (const key in from) (Made as unknown as Record<string, unknown>)[key] = from[key];
  const late: Made = new Made({ tag: 1 }, 2);
  report("a loop that copies " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  storeUnder(...([Made, "prototype", spy] as [unknown, string, unknown]));`,
      [
        `a spread into a call	const held: any[] = [Made]; held[0]
the maker out of an array of any	(new Map<number, unknown>([[1, Made]]).get(1) as { prototype: unknown })
the maker out of a map	(new CustomEvent("made", { detail: Made }).detail as unknown as { prototype: unknown })
the maker out of an event	(first as unknown as { constructor: { prototype: unknown } }).constructor`,
        (n, a, b) => `  const late: Made = new Made({ tag: 1 }, 2);
  report("${a} " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  ${b}.prototype = spy;`,
      ],
      `  const late: Made = new Made({ tag: 1 }, 2);
  report("the maker out of the constructor property " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  (Made as any)[nameAt(0)] = 1;`,
      [
        `new Made({ tag: 1 }, 2	what is no object	.prototype
Reflect.construct(Made, [{ tag: 1 }, 2], Other	another new.target	[nameAt(0)]
Reflect.construct(Made, [{ tag: 1 }, 2], Other	another new.target, its prototype under a computed key	[nameAt(0)]`,
        (n, a, b, c) => `  const late: Made = ${a});
  report("${b} " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  function Other() {}
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  (Other as any)${c} = spy;`,
      ],
      `  const late: Made = Reflect.construct(Made, [{ tag: 1 }, 2], Other.bind(null));
  report("a bound function as new.target " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  
  const late: Made = (() => { try { return new (new Proxy(Made, { get: (target, key, receiver) => (key === "prototype" ? spy : Reflect.get(target, key, receiver)) }))({ tag: 1 }, 2); } catch (error) { return { pos: (error as Error).constructor.name, end: 0 } as unknown as Made; } })();
  report("a proxy as new.target " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  (Made as any)[nameAt(0)] = spy;
  const late: Made = new (Made.bind(null, { tag: 1 }))(2);
  report("a bound maker " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }`,
      [
        `(Made.bind(null, { tag: 1 }))(	bound maker, the link above changed
Below({ tag: 1 }, 	class below, made before`,
        (n, a, b) => `  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  Reflect.setPrototypeOf(Made.prototype, spy);
  const late: Made = new ${a}2);
  report("a ${b} " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  class Below extends Made {}`,
      ],
      [
        `Below.prototype as any)[nameAt(1	Below	above the lower prototype object
Made as any)[nameAt(0	(class extends Made {})	made afterwards`,
        (n, a, b, c) => `  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  (${a})] = spy;
  const late: Made = new ${b}({ tag: 1 }, 2);
  report("a class below, ${c} " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }`,
      ],
      `  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  storeUnder(Made.prototype, ["__pro", "to__"].join(""), spy);`,
      [
        `joined	[nameAt(1)]
out of an array	.__proto__`,
        (n, a, b) => `  const late: Made = new Made({ tag: 1 }, 2);
  report("above the prototype object, __proto__ ${a} " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  (Made.prototype as any)${b} = spy;`,
      ],
      [
        `__proto__ spelled	Object.setPrototypeOf(Made.prototype, spy
Object.setPrototypeOf	Reflect.setPrototypeOf(Made.prototype, spy
Reflect.setPrototypeOf	Object.setPrototypeOf.apply(null, [Made.prototype, spy]
setPrototypeOf by apply	Object.setPrototypeOf(...([Made.prototype, spy] as [object, object])
setPrototypeOf spread	Object.getOwnPropertyDescriptor(Object.prototype, "__proto__")!.set!.call(Made.prototype, spy
the setter of __proto__	Object.setPrototypeOf(Object.getPrototypeOf(first), spy
found from an instance	Object.setPrototypeOf(Made.prototype, new Proxy({}, { set: (target, key, value) => (kept.push(value), true), get: () => "read" })
a proxy	Object.setPrototypeOf(Made.prototype, new Proxy({}, { set: (target, key, value, receiver) => (key === "pos" ? true : Reflect.defineProperty(receiver, key, { value, writable: true, enumerable: true, configurable: true })), get: () => "read" })`,
        (n, a, b) => `  const late: Made = new Made({ tag: 1 }, 2);
  report("above the prototype object, ${a} " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  ${b});`,
      ],
      [
        `bove the prototype object, a proxy that defines on the receiver	y(Made.prototype, "pos", { set: takes, get: gives
n accessor on the prototype object	y(Made.prototype, nameAt(2), { set: takes, get: gives
n accessor on the prototype object, a computed key	y(Made.prototype, nameAt(3), { set: takes, get: gives
n accessor for the number on the prototype object, a computed key	ies(Made.prototype, { [nameAt(2)]: { set: takes, get: gives }`,
        (n, a, b) => `  const late: Made = new Made({ tag: 1 }, 2);
  report("a${a} " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  Object.definePropert${b} });`,
      ],
      `  const late: Made = new Made({ tag: 1 }, 2);
  report("an accessor on the prototype object, a map with a computed key " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  (Made.prototype as any).__defineSetter__(nameAt(2), takes); (Made.prototype as any).__defineGetter__(nameAt(2), gives);
  const late: Made = new Made({ tag: 1 }, 2);
  report("an accessor on the prototype object, the old way " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  Reflect.apply(Reflect.defineProperty, null, [Made.prototype, "pos", { set: takes, get: gives }]);`,
      [
        `new Made({ tag: 1 }, 2	n accessor on the prototype object, Reflect by apply	Object.getPrototypeOf(first), "pos", { set: takes, get: gives
new Made({ tag: 1 }, 2	n accessor on the prototype object, found from an instance	Made.prototype, "pos", { value: "read", writable: false
(() => { try { return new Made({ tag: 1 }, 2); } catch (error) { return { pos: (error as Error).constructor.name, end: 0 } as unknown as Made; } })(	 read-only property on the prototype object	Made.prototype, nameAt(3), { value: -7, writable: false`,
        (n, a, b, c) => `  const late: Made = ${a});
  report("a${b} " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  Object.defineProperty(${c} });`,
      ],
      `  const late: Made = (() => { try { return new Made({ tag: 1 }, 2); } catch (error) { return { pos: (error as Error).constructor.name, end: 0 } as unknown as Made; } })();
  report("a read-only number on the prototype object, a computed key " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  (Made.prototype as any).pos = "read"; Object.freeze(Made.prototype);
  const late: Made = (() => { try { return new Made({ tag: 1 }, 2); } catch (error) { return { pos: (error as Error).constructor.name, end: 0 } as unknown as Made; } })();
  report("the prototype object is frozen over a value " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  const seen: string[] = [];
  function readEarly(made: { pos: Tagged; end: number }): string {
    return typeof made.pos + " " + typeof made.end + " " + (made.end * 2);
  }
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    seen.push(String((this as Made).pos) + "," + String((this as Made).end) + "," + readEarly(this));
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  seen.length = 0;
  const late: Made = (() => { const made = new Made({ tag: 1 }, 2); kept.push(seen.join()); console.log("seen early:", seen.join()); return made; })();
  report("the maker hands the object out before it fills it " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  const held: unknown[] = [];
  const arm = { on: false };
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    held.push(this);`,
      [
        `{ this.pos = pos; throw new RangeError("half"); }	(() => { try { new Made({ tag: 1 }, 2); } catch {} return held[held.length - 1] as Made; })(	keeps the object and throws half wa
return;	new Made({ tag: 1 }, 2	returns earl`,
        (n, a, b, c) => `    if (arm.on) ${a}
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  arm.on = true;
  const late: Made = ${b});
  report("the maker ${c}y " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  const arm = { on: false };
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {`,
      ],
      `    if (arm.on) return Object.create(spy);
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  arm.on = true;`,
      [
        `new Made({ tag: 1 }, 2)	the maker returns another object
(() => { const existing = Object.create(spy); (Made as unknown as Function).call(existing, { tag: 1 }, 2); return existing as Made; })()	the maker is called on what lies below the spy
(() => { const existing = new Made({ tag: 5 }, 6); (Made as unknown as Function).call(existing, "text", 0.5); return existing; })()	the maker is called on a finished object with other values
(() => { const existing = Object.freeze(new Made({ tag: 5 }, 6)); try { (Made as unknown as Function).call(existing, { tag: 1 }, 2); } catch (error) { kept.push((error as Error).constructor.name); } return existing; })()	the maker is called on a frozen object
Object.create(Made.prototype) as Made	what Object.create makes below the prototype object
Object.create(Made.prototype, { pos: { get: gives, enumerable: true }, end: { value: "text", enumerable: true } }) as Made	what Object.create makes with descriptors
Object.setPrototypeOf({ end: 2 }, Made.prototype) as Made	a literal put below the prototype object`,
        (n, a, b) => `  const late: Made = ${a};
  report("${b} " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  `,
      ],
      `  const late: Made = new (Made as any)("text", undefined);
  report("the operands are of other types " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
`,
    ),
    ...family(
      `objects-come-back-from-built-ins-under-another-name-1.js	0	array literal', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('array literal	[c][0])(c); if (out instanceof Promise) out.then(done, e => console.log('array literal', "rejected", String(e))); else done(out); } catch (e) { console.log('array literal	1	array at', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('array at	[c].at(-1))(c); if (out instanceof Promise) out.then(done, e => console.log('array at', "rejected", String(e))); else done(out); } catch (e) { console.log('array at	2	array pop', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('array pop	[c].pop())(c); if (out instanceof Promise) out.then(done, e => console.log('array pop', "rejected", String(e))); else done(out); } catch (e) { console.log('array pop	3	array shift', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('array shift	[c].shift())(c); if (out instanceof Promise) out.then(done, e => console.log('array shift', "rejected", String(e))); else done(out); } catch (e) { console.log('array shift	4	array push', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('array push	{ const a = []; a.push(c); return a[0]; })(c); if (out instanceof Promise) out.then(done, e => console.log('array push', "rejected", String(e))); else done(out); } catch (e) { console.log('array push	5	array unshift', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('array unshift	{ const a = []; a.unshift(c); return a[0]; })(c); if (out instanceof Promise) out.then(done, e => console.log('array unshift', "rejected", String(e))); else done(out); } catch (e) { console.log('array unshift	6	splice out', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('splice out	[c].splice(0, 1)[0])(c); if (out instanceof Promise) out.then(done, e => console.log('splice out', "rejected", String(e))); else done(out); } catch (e) { console.log('splice out	7	splice in', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('splice in	{ const a = [0]; a.splice(0, 1, c); return a[0]; })(c); if (out instanceof Promise) out.then(done, e => console.log('splice in', "rejected", String(e))); else done(out); } catch (e) { console.log('splice in	8	slice', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('slice	[c].slice()[0])(c); if (out instanceof Promise) out.then(done, e => console.log('slice', "rejected", String(e))); else done(out); } catch (e) { console.log('slice	9	concat', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('concat	[].concat([c])[0])(c); if (out instanceof Promise) out.then(done, e => console.log('concat', "rejected", String(e))); else done(out); } catch (e) { console.log('concat	10	concat value', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('concat value	[].concat(c)[0])(c); if (out instanceof Promise) out.then(done, e => console.log('concat value', "rejected", String(e))); else done(out); } catch (e) { console.log('concat value	11	flat', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('flat	c => [[c]].flat()[0])(c); if (out instanceof Promise) out.then(done, e => console.log('flat', "rejected", String(e))); else done(out); } catch (e) { console.log('flat	12	flatMap', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('flatMap	c => [0].flatMap(() => [c])[0])(c); if (out instanceof Promise) out.then(done, e => console.log('flatMap', "rejected", String(e))); else done(out); } catch (e) { console.log('flatMap	13	map', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('map	c => [c].map(id)[0])(c); if (out instanceof Promise) out.then(done, e => console.log('map', "rejected", String(e))); else done(out); } catch (e) { console.log('map	14	filter', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('filter	c => [c].filter(() => true)[0])(c); if (out instanceof Promise) out.then(done, e => console.log('filter', "rejected", String(e))); else done(out); } catch (e) { console.log('filter	15	find', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('find	c => [c].find(() => true))(c); if (out instanceof Promise) out.then(done, e => console.log('find', "rejected", String(e))); else done(out); } catch (e) { console.log('find	16	findLast', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('findLast	c => [c].findLast(() => true))(c); if (out instanceof Promise) out.then(done, e => console.log('findLast', "rejected", String(e))); else done(out); } catch (e) { console.log('findLast	17	reduce', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('reduce	[c].reduce((a, b) => b, null))(c); if (out instanceof Promise) out.then(done, e => console.log('reduce', "rejected", String(e))); else done(out); } catch (e) { console.log('reduce	18	reduce seed', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('reduce seed	[0].reduce(a => a, c))(c); if (out instanceof Promise) out.then(done, e => console.log('reduce seed', "rejected", String(e))); else done(out); } catch (e) { console.log('reduce seed	19	reduceRight', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('reduceRight	[c].reduceRight((a, b) => b, null))(c); if (out instanceof Promise) out.then(done, e => console.log('reduceRight', "rejected", String(e))); else done(out); } catch (e) { console.log('reduceRight	20	forEach', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('forEach	{ let r; [c].forEach(v => { r = v; }); return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('forEach', "rejected", String(e))); else done(out); } catch (e) { console.log('forEach	21	forEach this', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('forEach this	{ let r; [0].forEach(function () { r = this; }, c); return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('forEach this', "rejected", String(e))); else done(out); } catch (e) { console.log('forEach this	22	some', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('some	{ let r; [c].some(v => (r = v, true)); return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('some', "rejected", String(e))); else done(out); } catch (e) { console.log('some	23	every', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('every	{ let r; [c].every(v => (r = v, true)); return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('every', "rejected", String(e))); else done(out); } catch (e) { console.log('every	24	sort', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('sort	[c, c].sort(() => 0)[1])(c); if (out instanceof Promise) out.then(done, e => console.log('sort', "rejected", String(e))); else done(out); } catch (e) { console.log('sort
objects-come-back-from-built-ins-under-another-name-2.js	25	sort argument', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('sort argument	{ let r; [c, c].sort(a => (r = a, 0)); return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('sort argument', "rejected", String(e))); else done(out); } catch (e) { console.log('sort argument	26	toSorted', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('toSorted	[c].toSorted()[0])(c); if (out instanceof Promise) out.then(done, e => console.log('toSorted', "rejected", String(e))); else done(out); } catch (e) { console.log('toSorted	27	toReversed', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('toReversed	[c].toReversed()[0])(c); if (out instanceof Promise) out.then(done, e => console.log('toReversed', "rejected", String(e))); else done(out); } catch (e) { console.log('toReversed	28	toSpliced', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('toSpliced	[0].toSpliced(0, 1, c)[0])(c); if (out instanceof Promise) out.then(done, e => console.log('toSpliced', "rejected", String(e))); else done(out); } catch (e) { console.log('toSpliced	29	with', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('with	[0].with(0, c)[0])(c); if (out instanceof Promise) out.then(done, e => console.log('with', "rejected", String(e))); else done(out); } catch (e) { console.log('with	30	reverse', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('reverse	[c].reverse()[0])(c); if (out instanceof Promise) out.then(done, e => console.log('reverse', "rejected", String(e))); else done(out); } catch (e) { console.log('reverse	31	fill', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('fill	new Array(2).fill(c)[1])(c); if (out instanceof Promise) out.then(done, e => console.log('fill', "rejected", String(e))); else done(out); } catch (e) { console.log('fill	32	copyWithin', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('copyWithin	[c, 0].copyWithin(1, 0)[1])(c); if (out instanceof Promise) out.then(done, e => console.log('copyWithin', "rejected", String(e))); else done(out); } catch (e) { console.log('copyWithin	33	Array.of', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Array.of	Array.of(c)[0])(c); if (out instanceof Promise) out.then(done, e => console.log('Array.of', "rejected", String(e))); else done(out); } catch (e) { console.log('Array.of	34	Array.from', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Array.from	Array.from([c])[0])(c); if (out instanceof Promise) out.then(done, e => console.log('Array.from', "rejected", String(e))); else done(out); } catch (e) { console.log('Array.from	35	Array.from map', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Array.from map	Array.from([0], () => c)[0])(c); if (out instanceof Promise) out.then(done, e => console.log('Array.from map', "rejected", String(e))); else done(out); } catch (e) { console.log('Array.from map	36	Array.from like', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Array.from like	c => Array.from({ length: 1, 0: c })[0])(c); if (out instanceof Promise) out.then(done, e => console.log('Array.from like', "rejected", String(e))); else done(out); } catch (e) { console.log('Array.from like	37	new Array', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('new Array	c => new Array(c, c)[1])(c); if (out instanceof Promise) out.then(done, e => console.log('new Array', "rejected", String(e))); else done(out); } catch (e) { console.log('new Array	38	Array call', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Array call	c => Array(c, c)[0])(c); if (out instanceof Promise) out.then(done, e => console.log('Array call', "rejected", String(e))); else done(out); } catch (e) { console.log('Array call	39	spread', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('spread	c => [...[c]][0])(c); if (out instanceof Promise) out.then(done, e => console.log('spread', "rejected", String(e))); else done(out); } catch (e) { console.log('spread	40	spread call', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('spread call	c => id(...[c]))(c); if (out instanceof Promise) out.then(done, e => console.log('spread call', "rejected", String(e))); else done(out); } catch (e) { console.log('spread call	41	rest', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('rest	c => ((...r) => r[0])(c))(c); if (out instanceof Promise) out.then(done, e => console.log('rest', "rejected", String(e))); else done(out); } catch (e) { console.log('rest	42	arguments', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('arguments	(function () { return arguments[0]; })(c))(c); if (out instanceof Promise) out.then(done, e => console.log('arguments', "rejected", String(e))); else done(out); } catch (e) { console.log('arguments	43	destructure', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('destructure	{ const [a] = [c]; return a; })(c); if (out instanceof Promise) out.then(done, e => console.log('destructure', "rejected", String(e))); else done(out); } catch (e) { console.log('destructure	44	destructure rest', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('destructure rest	{ const [, ...r] = [0, c]; return r[0]; })(c); if (out instanceof Promise) out.then(done, e => console.log('destructure rest', "rejected", String(e))); else done(out); } catch (e) { console.log('destructure rest	45	object rest', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('object rest	{ const { a, ...r } = { a: 0, b: c }; return r.b; })(c); if (out instanceof Promise) out.then(done, e => console.log('object rest', "rejected", String(e))); else done(out); } catch (e) { console.log('object rest	46	values', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('values	[c].values().next().value)(c); if (out instanceof Promise) out.then(done, e => console.log('values', "rejected", String(e))); else done(out); } catch (e) { console.log('values	47	entries', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('entries	[c].entries().next().value[1])(c); if (out instanceof Promise) out.then(done, e => console.log('entries', "rejected", String(e))); else done(out); } catch (e) { console.log('entries	48	iterator', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('iterator	[c][Symbol.iterator]().next().value)(c); if (out instanceof Promise) out.then(done, e => console.log('iterator', "rejected", String(e))); else done(out); } catch (e) { console.log('iterator	49	for of', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('for of	{ for (const v of [c]) return v; })(c); if (out instanceof Promise) out.then(done, e => console.log('for of', "rejected", String(e))); else done(out); } catch (e) { console.log('for of
objects-come-back-from-built-ins-under-another-name-3.js	50	for in', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('for in	{ const o = { k: c }; for (const k in o) return o[k]; })(c); if (out instanceof Promise) out.then(done, e => console.log('for in', "rejected", String(e))); else done(out); } catch (e) { console.log('for in	51	iterator map', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('iterator map	[c].values().map(id).toArray()[0])(c); if (out instanceof Promise) out.then(done, e => console.log('iterator map', "rejected", String(e))); else done(out); } catch (e) { console.log('iterator map	52	iterator filter', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('iterator filter	[c].values().filter(() => true).next().value)(c); if (out instanceof Promise) out.then(done, e => console.log('iterator filter', "rejected", String(e))); else done(out); } catch (e) { console.log('iterator filter	53	iterator find', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('iterator find	[c].values().find(() => true))(c); if (out instanceof Promise) out.then(done, e => console.log('iterator find', "rejected", String(e))); else done(out); } catch (e) { console.log('iterator find	54	Iterator.from', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Iterator.from	Iterator.from([c]).next().value)(c); if (out instanceof Promise) out.then(done, e => console.log('Iterator.from', "rejected", String(e))); else done(out); } catch (e) { console.log('Iterator.from	55	includes index', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('includes index	{ const a = [c]; return a[a.indexOf(c)]; })(c); if (out instanceof Promise) out.then(done, e => console.log('includes index', "rejected", String(e))); else done(out); } catch (e) { console.log('includes index	56	join free', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('join free	{ const a = [c]; a.join; return a[0]; })(c); if (out instanceof Promise) out.then(done, e => console.log('join free', "rejected", String(e))); else done(out); } catch (e) { console.log('join free	57	Object.values', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Object.values	Object.values({ k: c })[0])(c); if (out instanceof Promise) out.then(done, e => console.log('Object.values', "rejected", String(e))); else done(out); } catch (e) { console.log('Object.values	58	Object.entries', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Object.entries	Object.entries({ k: c })[0][1])(c); if (out instanceof Promise) out.then(done, e => console.log('Object.entries', "rejected", String(e))); else done(out); } catch (e) { console.log('Object.entries	59	Object.fromEntries', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Object.fromEntries	Object.fromEntries([["k", c]]).k)(c); if (out instanceof Promise) out.then(done, e => console.log('Object.fromEntries', "rejected", String(e))); else done(out); } catch (e) { console.log('Object.fromEntries	60	Object.assign', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Object.assign	Object.assign({}, { k: c }).k)(c); if (out instanceof Promise) out.then(done, e => console.log('Object.assign', "rejected", String(e))); else done(out); } catch (e) { console.log('Object.assign	61	Object.assign target', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Object.assign target	c => Object.assign(c, {}))(c); if (out instanceof Promise) out.then(done, e => console.log('Object.assign target', "rejected", String(e))); else done(out); } catch (e) { console.log('Object.assign target	62	object spread', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('object spread	c => ({ ...{ k: c } }).k)(c); if (out instanceof Promise) out.then(done, e => console.log('object spread', "rejected", String(e))); else done(out); } catch (e) { console.log('object spread	63	Object.create', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Object.create	c => Object.getPrototypeOf(Object.create(c)))(c); if (out instanceof Promise) out.then(done, e => console.log('Object.create', "rejected", String(e))); else done(out); } catch (e) { console.log('Object.create	64	setPrototypeOf', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('setPrototypeOf	c => Object.getPrototypeOf(Object.setPrototypeOf({}, c)))(c); if (out instanceof Promise) out.then(done, e => console.log('setPrototypeOf', "rejected", String(e))); else done(out); } catch (e) { console.log('setPrototypeOf	65	setPrototypeOf result', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('setPrototypeOf result	c => Object.setPrototypeOf(c, Cell.prototype))(c); if (out instanceof Promise) out.then(done, e => console.log('setPrototypeOf result', "rejected", String(e))); else done(out); } catch (e) { console.log('setPrototypeOf result	66	__proto__', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('__proto__	c => ({ __proto__: c }).__proto__)(c); if (out instanceof Promise) out.then(done, e => console.log('__proto__', "rejected", String(e))); else done(out); } catch (e) { console.log('__proto__	67	inherit read', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('inherit read	Object.create({ k: c }).k)(c); if (out instanceof Promise) out.then(done, e => console.log('inherit read', "rejected", String(e))); else done(out); } catch (e) { console.log('inherit read	68	descriptor', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('descriptor	Object.getOwnPropertyDescriptor({ k: c }, "k").value)(c); if (out instanceof Promise) out.then(done, e => console.log('descriptor', "rejected", String(e))); else done(out); } catch (e) { console.log('descriptor	69	descriptors', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('descriptors	Object.getOwnPropertyDescriptors({ k: c }).k.value)(c); if (out instanceof Promise) out.then(done, e => console.log('descriptors', "rejected", String(e))); else done(out); } catch (e) { console.log('descriptors	70	defineProperty', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('defineProperty	Object.defineProperty({}, "k", { value: c }).k)(c); if (out instanceof Promise) out.then(done, e => console.log('defineProperty', "rejected", String(e))); else done(out); } catch (e) { console.log('defineProperty	71	defineProperty result', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('defineProperty result	Object.defineProperty(c, "extra", { value: 1 }))(c); if (out instanceof Promise) out.then(done, e => console.log('defineProperty result', "rejected", String(e))); else done(out); } catch (e) { console.log('defineProperty result	72	defineProperties', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('defineProperties	Object.defineProperties({}, { k: { value: c } }).k)(c); if (out instanceof Promise) out.then(done, e => console.log('defineProperties', "rejected", String(e))); else done(out); } catch (e) { console.log('defineProperties	73	getter', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('getter	({ get k() { return c; } }).k)(c); if (out instanceof Promise) out.then(done, e => console.log('getter', "rejected", String(e))); else done(out); } catch (e) { console.log('getter	74	define getter', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('define getter	Object.defineProperty({}, "k", { get: () => c }).k)(c); if (out instanceof Promise) out.then(done, e => console.log('define getter', "rejected", String(e))); else done(out); } catch (e) { console.log('define getter
objects-come-back-from-built-ins-under-another-name-4.js	75	freeze', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('freeze	Object.isFrozen(c) ? null : Object.preventExtensions({ k: c }).k)(c); if (out instanceof Promise) out.then(done, e => console.log('freeze', "rejected", String(e))); else done(out); } catch (e) { console.log('freeze	76	Object()', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Object()	Object(c))(c); if (out instanceof Promise) out.then(done, e => console.log('Object()', "rejected", String(e))); else done(out); } catch (e) { console.log('Object()	77	new Object', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('new Object	new Object(c))(c); if (out instanceof Promise) out.then(done, e => console.log('new Object', "rejected", String(e))); else done(out); } catch (e) { console.log('new Object	78	valueOf', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('valueOf	c.valueOf())(c); if (out instanceof Promise) out.then(done, e => console.log('valueOf', "rejected", String(e))); else done(out); } catch (e) { console.log('valueOf	79	groupBy', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('groupBy	Object.groupBy([c], () => "k").k[0])(c); if (out instanceof Promise) out.then(done, e => console.log('groupBy', "rejected", String(e))); else done(out); } catch (e) { console.log('groupBy	80	Map.groupBy', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Map.groupBy	Map.groupBy([c], () => "k").get("k")[0])(c); if (out instanceof Promise) out.then(done, e => console.log('Map.groupBy', "rejected", String(e))); else done(out); } catch (e) { console.log('Map.groupBy	81	Reflect.get', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Reflect.get	Reflect.get({ k: c }, "k"))(c); if (out instanceof Promise) out.then(done, e => console.log('Reflect.get', "rejected", String(e))); else done(out); } catch (e) { console.log('Reflect.get	82	Reflect.set', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Reflect.set	{ const o = {}; Reflect.set(o, "k", c); return o.k; })(c); if (out instanceof Promise) out.then(done, e => console.log('Reflect.set', "rejected", String(e))); else done(out); } catch (e) { console.log('Reflect.set	83	Reflect.get receiver', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Reflect.get receiver	Reflect.get({ get k() { return this; } }, "k", c))(c); if (out instanceof Promise) out.then(done, e => console.log('Reflect.get receiver', "rejected", String(e))); else done(out); } catch (e) { console.log('Reflect.get receiver	84	Reflect.apply', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Reflect.apply	Reflect.apply(id, null, [c]))(c); if (out instanceof Promise) out.then(done, e => console.log('Reflect.apply', "rejected", String(e))); else done(out); } catch (e) { console.log('Reflect.apply	85	Reflect.apply this', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Reflect.apply this	Reflect.apply(function () { return this; }, c, []))(c); if (out instanceof Promise) out.then(done, e => console.log('Reflect.apply this', "rejected", String(e))); else done(out); } catch (e) { console.log('Reflect.apply this	86	Reflect.construct', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Reflect.construct	c => Reflect.construct(function (v) { this.v = v; }, [c]).v)(c); if (out instanceof Promise) out.then(done, e => console.log('Reflect.construct', "rejected", String(e))); else done(out); } catch (e) { console.log('Reflect.construct	87	Reflect.getPrototypeOf', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Reflect.getPrototypeOf	c => Reflect.getPrototypeOf(Object.create(c)))(c); if (out instanceof Promise) out.then(done, e => console.log('Reflect.getPrototypeOf', "rejected", String(e))); else done(out); } catch (e) { console.log('Reflect.getPrototypeOf	88	Reflect descriptor', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Reflect descriptor	c => Reflect.getOwnPropertyDescriptor({ k: c }, "k").value)(c); if (out instanceof Promise) out.then(done, e => console.log('Reflect descriptor', "rejected", String(e))); else done(out); } catch (e) { console.log('Reflect descriptor	89	call', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('call	c => id.call(null, c))(c); if (out instanceof Promise) out.then(done, e => console.log('call', "rejected", String(e))); else done(out); } catch (e) { console.log('call	90	call this', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('call this	c => (function () { return this; }).call(c))(c); if (out instanceof Promise) out.then(done, e => console.log('call this', "rejected", String(e))); else done(out); } catch (e) { console.log('call this	91	apply', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('apply	c => id.apply(null, [c]))(c); if (out instanceof Promise) out.then(done, e => console.log('apply', "rejected", String(e))); else done(out); } catch (e) { console.log('apply	92	bind', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('bind	id.bind(null, c)())(c); if (out instanceof Promise) out.then(done, e => console.log('bind', "rejected", String(e))); else done(out); } catch (e) { console.log('bind	93	bind this', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('bind this	(function () { return this; }).bind(c)())(c); if (out instanceof Promise) out.then(done, e => console.log('bind this', "rejected", String(e))); else done(out); } catch (e) { console.log('bind this	94	Map', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Map	new Map([["k", c]]).get("k"))(c); if (out instanceof Promise) out.then(done, e => console.log('Map', "rejected", String(e))); else done(out); } catch (e) { console.log('Map	95	Map set', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Map set	new Map().set("k", c).get("k"))(c); if (out instanceof Promise) out.then(done, e => console.log('Map set', "rejected", String(e))); else done(out); } catch (e) { console.log('Map set	96	Map key', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Map key	new Map([[c, 1]]).keys().next().value)(c); if (out instanceof Promise) out.then(done, e => console.log('Map key', "rejected", String(e))); else done(out); } catch (e) { console.log('Map key	97	Map values', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Map values	[...new Map([["k", c]]).values()][0])(c); if (out instanceof Promise) out.then(done, e => console.log('Map values', "rejected", String(e))); else done(out); } catch (e) { console.log('Map values	98	Map entries', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Map entries	[...new Map([["k", c]])][0][1])(c); if (out instanceof Promise) out.then(done, e => console.log('Map entries', "rejected", String(e))); else done(out); } catch (e) { console.log('Map entries	99	Map forEach', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Map forEach	{ let r; new Map([["k", c]]).forEach(v => { r = v; }); return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('Map forEach', "rejected", String(e))); else done(out); } catch (e) { console.log('Map forEach
objects-come-back-from-built-ins-under-another-name-5.js	100	Map copy', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Map copy	new Map(new Map([["k", c]])).get("k"))(c); if (out instanceof Promise) out.then(done, e => console.log('Map copy', "rejected", String(e))); else done(out); } catch (e) { console.log('Map copy	101	Set', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Set	[...new Set([c])][0])(c); if (out instanceof Promise) out.then(done, e => console.log('Set', "rejected", String(e))); else done(out); } catch (e) { console.log('Set	102	Set add', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Set add	new Set().add(c).values().next().value)(c); if (out instanceof Promise) out.then(done, e => console.log('Set add', "rejected", String(e))); else done(out); } catch (e) { console.log('Set add	103	Set forEach', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Set forEach	{ let r; new Set([c]).forEach(v => { r = v; }); return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('Set forEach', "rejected", String(e))); else done(out); } catch (e) { console.log('Set forEach	104	Set union', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Set union	[...new Set([c]).union(new Set())][0])(c); if (out instanceof Promise) out.then(done, e => console.log('Set union', "rejected", String(e))); else done(out); } catch (e) { console.log('Set union	105	WeakMap', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('WeakMap	{ const k = {}; return new WeakMap([[k, c]]).get(k); })(c); if (out instanceof Promise) out.then(done, e => console.log('WeakMap', "rejected", String(e))); else done(out); } catch (e) { console.log('WeakMap	106	WeakRef', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('WeakRef	new WeakRef(c).deref())(c); if (out instanceof Promise) out.then(done, e => console.log('WeakRef', "rejected", String(e))); else done(out); } catch (e) { console.log('WeakRef	107	Proxy', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Proxy	{ const p = new Proxy(c, {}); p.n = 21; return Reflect.getPrototypeOf(p) === Cell.prototype ? c : null; })(c); if (out instanceof Promise) out.then(done, e => console.log('Proxy', "rejected", String(e))); else done(out); } catch (e) { console.log('Proxy	108	Proxy target', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Proxy target	{ let r; new Proxy(c, { get(t) { r = t; } }).x; return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('Proxy target', "rejected", String(e))); else done(out); } catch (e) { console.log('Proxy target	109	Proxy receiver', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Proxy receiver	{ let r; Reflect.get(new Proxy({}, { get(t, k, rc) { r = rc; } }), "k", c); return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('Proxy receiver', "rejected", String(e))); else done(out); } catch (e) { console.log('Proxy receiver	110	Error cause', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Error cause	new Error("m", { cause: c }).cause)(c); if (out instanceof Promise) out.then(done, e => console.log('Error cause', "rejected", String(e))); else done(out); } catch (e) { console.log('Error cause	111	AggregateError', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('AggregateError	c => new AggregateError([c]).errors[0])(c); if (out instanceof Promise) out.then(done, e => console.log('AggregateError', "rejected", String(e))); else done(out); } catch (e) { console.log('AggregateError	112	throw', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('throw	c => { try { throw c; } catch (e) { return e; } })(c); if (out instanceof Promise) out.then(done, e => console.log('throw', "rejected", String(e))); else done(out); } catch (e) { console.log('throw	113	generator', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('generator	c => (function* () { yield c; })().next().value)(c); if (out instanceof Promise) out.then(done, e => console.log('generator', "rejected", String(e))); else done(out); } catch (e) { console.log('generator	114	generator send', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('generator send	c => { const g = (function* () { return yield; })(); g.next(); return g.next(c).value; })(c); if (out instanceof Promise) out.then(done, e => console.log('generator send', "rejected", String(e))); else done(out); } catch (e) { console.log('generator send	115	generator return', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('generator return	c => (function* () {})().return(c).value)(c); if (out instanceof Promise) out.then(done, e => console.log('generator return', "rejected", String(e))); else done(out); } catch (e) { console.log('generator return	116	yield star', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('yield star	c => (function* () { yield* [c]; })().next().value)(c); if (out instanceof Promise) out.then(done, e => console.log('yield star', "rejected", String(e))); else done(out); } catch (e) { console.log('yield star	117	generator throw', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('generator throw	{ const g = (function* () { try { yield; } catch (e) { yield e; } })(); g.next(); return g.throw(c).value; })(c); if (out instanceof Promise) out.then(done, e => console.log('generator throw', "rejected", String(e))); else done(out); } catch (e) { console.log('generator throw	118	tagged', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('tagged	((s, v) => v)\`\${c}\`)(c); if (out instanceof Promise) out.then(done, e => console.log('tagged', "rejected", String(e))); else done(out); } catch (e) { console.log('tagged	119	optional', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('optional	({ k: c })?.k)(c); if (out instanceof Promise) out.then(done, e => console.log('optional', "rejected", String(e))); else done(out); } catch (e) { console.log('optional	120	comma', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('comma	(0, c))(c); if (out instanceof Promise) out.then(done, e => console.log('comma', "rejected", String(e))); else done(out); } catch (e) { console.log('comma	121	ternary', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('ternary	(c.n ? c : null))(c); if (out instanceof Promise) out.then(done, e => console.log('ternary', "rejected", String(e))); else done(out); } catch (e) { console.log('ternary	122	or', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('or	null || c)(c); if (out instanceof Promise) out.then(done, e => console.log('or', "rejected", String(e))); else done(out); } catch (e) { console.log('or	123	nullish', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('nullish	null ?? c)(c); if (out instanceof Promise) out.then(done, e => console.log('nullish', "rejected", String(e))); else done(out); } catch (e) { console.log('nullish	124	and', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('and	1 && c)(c); if (out instanceof Promise) out.then(done, e => console.log('and', "rejected", String(e))); else done(out); } catch (e) { console.log('and
objects-come-back-from-built-ins-under-another-name-6.js	125	class field', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('class field	new (class { f = c; })().f)(c); if (out instanceof Promise) out.then(done, e => console.log('class field', "rejected", String(e))); else done(out); } catch (e) { console.log('class field	126	static', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('static	(class { static f = c; }).f)(c); if (out instanceof Promise) out.then(done, e => console.log('static', "rejected", String(e))); else done(out); } catch (e) { console.log('static	127	private', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('private	new (class { #f = c; get() { return this.#f; } })().get())(c); if (out instanceof Promise) out.then(done, e => console.log('private', "rejected", String(e))); else done(out); } catch (e) { console.log('private	128	super return', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('super return	new (class extends (class { constructor() { return c; } }) {})())(c); if (out instanceof Promise) out.then(done, e => console.log('super return', "rejected", String(e))); else done(out); } catch (e) { console.log('super return	129	constructor return', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('constructor return	new (function () { return c; })())(c); if (out instanceof Promise) out.then(done, e => console.log('constructor return', "rejected", String(e))); else done(out); } catch (e) { console.log('constructor return	130	symbol key', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('symbol key	{ const s = Symbol(); return { [s]: c }[s]; })(c); if (out instanceof Promise) out.then(done, e => console.log('symbol key', "rejected", String(e))); else done(out); } catch (e) { console.log('symbol key	131	computed', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('computed	({ ["a" + 1]: c }).a1)(c); if (out instanceof Promise) out.then(done, e => console.log('computed', "rejected", String(e))); else done(out); } catch (e) { console.log('computed	132	index key', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('index key	({ 0: c })[0])(c); if (out instanceof Promise) out.then(done, e => console.log('index key', "rejected", String(e))); else done(out); } catch (e) { console.log('index key	133	globalThis', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('globalThis	{ globalThis.__cell = c; const r = globalThis.__cell; delete globalThis.__cell; return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('globalThis', "rejected", String(e))); else done(out); } catch (e) { console.log('globalThis	134	closure', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('closure	(() => () => c)()())(c); if (out instanceof Promise) out.then(done, e => console.log('closure', "rejected", String(e))); else done(out); } catch (e) { console.log('closure	135	JSON reviver', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('JSON reviver	JSON.parse("[0]", (k, v) => (k === "0" ? c : v))[0])(c); if (out instanceof Promise) out.then(done, e => console.log('JSON reviver', "rejected", String(e))); else done(out); } catch (e) { console.log('JSON reviver	136	JSON replacer this', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('JSON replacer this	c => { let r; JSON.stringify({ k: c }, function (k, v) { if (k === "n") r = this; return v; }); return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('JSON replacer this', "rejected", String(e))); else done(out); } catch (e) { console.log('JSON replacer this	137	toJSON this', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('toJSON this	c => { let r; c.toJSON = function () { r = this; return 0; }; JSON.stringify(c); delete c.toJSON; return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('toJSON this', "rejected", String(e))); else done(out); } catch (e) { console.log('toJSON this	138	replace fn', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('replace fn	c => { let r; "a".replace("a", () => { r = c; return ""; }); return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('replace fn', "rejected", String(e))); else done(out); } catch (e) { console.log('replace fn	139	toString this', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('toString this	c => { let r; c.toString = function () { r = this; return ""; }; \`\${c}\`; delete c.toString; return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('toString this', "rejected", String(e))); else done(out); } catch (e) { console.log('toString this	140	structuredClone', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('structuredClone	c => (structuredClone({ n: 1 }), c))(c); if (out instanceof Promise) out.then(done, e => console.log('structuredClone', "rejected", String(e))); else done(out); } catch (e) { console.log('structuredClone	141	AbortSignal', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('AbortSignal	c => AbortSignal.abort(c).reason)(c); if (out instanceof Promise) out.then(done, e => console.log('AbortSignal', "rejected", String(e))); else done(out); } catch (e) { console.log('AbortSignal	142	abort', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('abort	{ const a = new AbortController(); a.abort(c); return a.signal.reason; })(c); if (out instanceof Promise) out.then(done, e => console.log('abort', "rejected", String(e))); else done(out); } catch (e) { console.log('abort	143	CustomEvent', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('CustomEvent	new CustomEvent("e", { detail: c }).detail)(c); if (out instanceof Promise) out.then(done, e => console.log('CustomEvent', "rejected", String(e))); else done(out); } catch (e) { console.log('CustomEvent	144	dispatch', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('dispatch	{ let r; const t = new EventTarget(); t.addEventListener("e", e => { r = e.detail; }); t.dispatchEvent(new CustomEvent("e", { detail: c })); return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('dispatch', "rejected", String(e))); else done(out); } catch (e) { console.log('dispatch	145	emitter', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('emitter	{ let r; const e = new (require("node:events"))(); e.on("e", v => { r = v; }); e.emit("e", c); return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('emitter', "rejected", String(e))); else done(out); } catch (e) { console.log('emitter	146	emitter this', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('emitter this	{ const E = require("node:events"); let r; const e = new E(); e.cell = c; e.on("e", function () { r = this.cell; }); e.emit("e"); return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('emitter this', "rejected", String(e))); else done(out); } catch (e) { console.log('emitter this	147	AsyncLocalStorage', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('AsyncLocalStorage	{ const { AsyncLocalStorage } = require("node:async_hooks"); const s = new AsyncLocalStorage(); return s.run(c, () => s.getStore()); })(c); if (out instanceof Promise) out.then(done, e => console.log('AsyncLocalStorage', "rejected", String(e))); else done(out); } catch (e) { console.log('AsyncLocalStorage	148	util.inspect', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('util.inspect	{ let r; c[require("node:util").inspect.custom] = function () { r = this; return ""; }; require("node:util").inspect(c); return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('util.inspect', "rejected", String(e))); else done(out); } catch (e) { console.log('util.inspect	149	Promise.resolve', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Promise.resolve	Promise.resolve(c))(c); if (out instanceof Promise) out.then(done, e => console.log('Promise.resolve', "rejected", String(e))); else done(out); } catch (e) { console.log('Promise.resolve
objects-come-back-from-built-ins-under-another-name-7.js	150	then', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('then	Promise.resolve(0).then(() => c))(c); if (out instanceof Promise) out.then(done, e => console.log('then', "rejected", String(e))); else done(out); } catch (e) { console.log('then	151	catch', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('catch	Promise.reject(c).catch(id))(c); if (out instanceof Promise) out.then(done, e => console.log('catch', "rejected", String(e))); else done(out); } catch (e) { console.log('catch	152	finally', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('finally	Promise.resolve(c).finally(() => 0))(c); if (out instanceof Promise) out.then(done, e => console.log('finally', "rejected", String(e))); else done(out); } catch (e) { console.log('finally	153	new Promise', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('new Promise	new Promise(r => r(c)))(c); if (out instanceof Promise) out.then(done, e => console.log('new Promise', "rejected", String(e))); else done(out); } catch (e) { console.log('new Promise	154	withResolvers', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('withResolvers	{ const w = Promise.withResolvers(); w.resolve(c); return w.promise; })(c); if (out instanceof Promise) out.then(done, e => console.log('withResolvers', "rejected", String(e))); else done(out); } catch (e) { console.log('withResolvers	155	thenable', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('thenable	Promise.resolve({ then(r) { r(c); } }))(c); if (out instanceof Promise) out.then(done, e => console.log('thenable', "rejected", String(e))); else done(out); } catch (e) { console.log('thenable	156	all', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('all	Promise.all([c]).then(a => a[0]))(c); if (out instanceof Promise) out.then(done, e => console.log('all', "rejected", String(e))); else done(out); } catch (e) { console.log('all	157	allSettled', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('allSettled	Promise.allSettled([c]).then(a => a[0].value))(c); if (out instanceof Promise) out.then(done, e => console.log('allSettled', "rejected", String(e))); else done(out); } catch (e) { console.log('allSettled	158	race', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('race	Promise.race([c]))(c); if (out instanceof Promise) out.then(done, e => console.log('race', "rejected", String(e))); else done(out); } catch (e) { console.log('race	159	any', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('any	Promise.any([c]))(c); if (out instanceof Promise) out.then(done, e => console.log('any', "rejected", String(e))); else done(out); } catch (e) { console.log('any	160	any errors', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('any errors	Promise.any([Promise.reject(c)]).catch(e => e.errors[0]))(c); if (out instanceof Promise) out.then(done, e => console.log('any errors', "rejected", String(e))); else done(out); } catch (e) { console.log('any errors	161	await', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('await	async c => await c)(c); if (out instanceof Promise) out.then(done, e => console.log('await', "rejected", String(e))); else done(out); } catch (e) { console.log('await	162	async return', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('async return	async c => c)(c); if (out instanceof Promise) out.then(done, e => console.log('async return', "rejected", String(e))); else done(out); } catch (e) { console.log('async return	163	await thenable', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('await thenable	async c => await { then(r) { r(c); } })(c); if (out instanceof Promise) out.then(done, e => console.log('await thenable', "rejected", String(e))); else done(out); } catch (e) { console.log('await thenable	164	async throw', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('async throw	async c => { try { await Promise.reject(c); } catch (e) { return e; } })(c); if (out instanceof Promise) out.then(done, e => console.log('async throw', "rejected", String(e))); else done(out); } catch (e) { console.log('async throw	165	async generator', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('async generator	async c => (await (async function* () { yield c; })().next()).value)(c); if (out instanceof Promise) out.then(done, e => console.log('async generator', "rejected", String(e))); else done(out); } catch (e) { console.log('async generator	166	for await', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('for await	async c => { for await (const v of [c]) return v; })(c); if (out instanceof Promise) out.then(done, e => console.log('for await', "rejected", String(e))); else done(out); } catch (e) { console.log('for await	167	fromAsync', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('fromAsync	Array.fromAsync([c]).then(a => a[0]))(c); if (out instanceof Promise) out.then(done, e => console.log('fromAsync', "rejected", String(e))); else done(out); } catch (e) { console.log('fromAsync	168	timeout', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('timeout	new Promise(r => setTimeout(r, 0, c)))(c); if (out instanceof Promise) out.then(done, e => console.log('timeout', "rejected", String(e))); else done(out); } catch (e) { console.log('timeout	169	immediate', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('immediate	new Promise(r => setImmediate(r, c)))(c); if (out instanceof Promise) out.then(done, e => console.log('immediate', "rejected", String(e))); else done(out); } catch (e) { console.log('immediate	170	nextTick', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('nextTick	new Promise(r => process.nextTick(r, c)))(c); if (out instanceof Promise) out.then(done, e => console.log('nextTick', "rejected", String(e))); else done(out); } catch (e) { console.log('nextTick	171	microtask', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('microtask	new Promise(r => queueMicrotask(() => r(c))))(c); if (out instanceof Promise) out.then(done, e => console.log('microtask', "rejected", String(e))); else done(out); } catch (e) { console.log('microtask	172	promisify', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('promisify	require("node:util").promisify(cb => cb(null, c))())(c); if (out instanceof Promise) out.then(done, e => console.log('promisify', "rejected", String(e))); else done(out); } catch (e) { console.log('promisify	173	once', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('once	{ const E = require("node:events"); const e = new E(); const p = E.once(e, "e").then(a => a[0]); e.emit("e", c); return p; })(c); if (out instanceof Promise) out.then(done, e => console.log('once', "rejected", String(e))); else done(out); } catch (e) { console.log('once	174	Bun.peek', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Bun.peek	Bun.peek(Promise.resolve(c)))(c); if (out instanceof Promise) out.then(done, e => console.log('Bun.peek', "rejected", String(e))); else done(out); } catch (e) { console.log('Bun.peek`,
      (
        a,
        b,
        c,
        d,
        e,
        f,
        g,
        h,
        i,
        j,
        k,
        l,
        m,
        o,
        p,
        q,
        r,
        s,
        t,
        u,
        v,
        w,
        x,
        y,
        z,
        a0,
        a1,
        a2,
        a3,
        a4,
        a5,
        a6,
        a7,
        a8,
        a9,
        a10,
        a11,
        a12,
        a13,
        a14,
        a15,
        a16,
        a17,
        a18,
        a19,
        a20,
        a21,
        a22,
        a23,
        a24,
        a25,
        a26,
        a27,
        a28,
        a29,
        a30,
        a31,
        a32,
        a33,
        a34,
        a35,
        a36,
        a37,
        a38,
        a39,
        a40,
        a41,
        a42,
        a43,
        a44,
        a45,
        a46,
        a47,
        a48,
        a49,
      ) => `// An object goes into a built-in and comes out under another name: a store through that name is seen by reads through the first. Each case has a class, an allocation and a store of its own.
const id = x => x;
class Cell${a} { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell${a}(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('${b}', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => ${c}', "threw", e.name); }
}
class Cell${d} { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell${d}(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('${e}', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => ${f}', "threw", e.name); }
}
class Cell${g} { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell${g}(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('${h}', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => ${i}', "threw", e.name); }
}
class Cell${j} { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell${j}(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('${k}', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => ${l}', "threw", e.name); }
}
class Cell${m} { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell${m}(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('${o}', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => ${p}', "threw", e.name); }
}
class Cell${q} { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell${q}(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('${r}', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => ${s}', "threw", e.name); }
}
class Cell${t} { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell${t}(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('${u}', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => ${v}', "threw", e.name); }
}
class Cell${w} { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell${w}(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('${x}', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => ${y}', "threw", e.name); }
}
class Cell${z} { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell${z}(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('${a0}', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => ${a1}', "threw", e.name); }
}
class Cell${a2} { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell${a2}(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('${a3}', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => ${a4}', "threw", e.name); }
}
class Cell${a5} { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell${a5}(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('${a6}', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => ${a7}', "threw", e.name); }
}
class Cell${a8} { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell${a8}(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('${a9}', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (${a10}', "threw", e.name); }
}
class Cell${a11} { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell${a11}(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('${a12}', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (${a13}', "threw", e.name); }
}
class Cell${a14} { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell${a14}(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('${a15}', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (${a16}', "threw", e.name); }
}
class Cell${a17} { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell${a17}(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('${a18}', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (${a19}', "threw", e.name); }
}
class Cell${a20} { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell${a20}(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('${a21}', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (${a22}', "threw", e.name); }
}
class Cell${a23} { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell${a23}(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('${a24}', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (${a25}', "threw", e.name); }
}
class Cell${a26} { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell${a26}(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('${a27}', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => ${a28}', "threw", e.name); }
}
class Cell${a29} { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell${a29}(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('${a30}', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => ${a31}', "threw", e.name); }
}
class Cell${a32} { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell${a32}(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('${a33}', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => ${a34}', "threw", e.name); }
}
class Cell${a35} { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell${a35}(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('${a36}', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => ${a37}', "threw", e.name); }
}
class Cell${a38} { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell${a38}(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('${a39}', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => ${a40}', "threw", e.name); }
}
class Cell${a41} { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell${a41}(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('${a42}', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => ${a43}', "threw", e.name); }
}
class Cell${a44} { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell${a44}(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('${a45}', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => ${a46}', "threw", e.name); }
}
class Cell${a47} { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell${a47}(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('${a48}', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => ${a49}', "threw", e.name); }
}
`,
    ),
    ...family(
      `a-hidden-native-function-defines-a-getter-on-a-built-in-prototype.mjs	__defineGetter__, hidden from the compiler, puts a getter	prototype.__defineGetter__).call(target, "added", () => one
a-hidden-native-function-defines-a-property-on-a-built-in-prototype-through-apply.mjs	Object.defineProperty, hidden from the compiler and called through apply(), puts a new name	defineProperty).apply(null, [target, "added", descriptor]
a-hidden-native-function-defines-a-property-on-a-built-in-prototype-through-bind.mjs	Object.defineProperty, hidden from the compiler and bound, puts a new name	defineProperty).bind(null, target, "added", descriptor)(
a-hidden-native-function-defines-a-property-on-a-built-in-prototype-through-call.mjs	Object.defineProperty, hidden from the compiler and called through call(), puts a new name	defineProperty).call(null, target, "added", descriptor
a-hidden-native-function-defines-a-property-on-a-built-in-prototype-with-spread-arguments.mjs	Object.defineProperty, hidden from the compiler and called with spread arguments, puts a new name	defineProperty)(...[target, "added", descriptor]
a-hidden-native-function-defines-a-property-on-a-built-in-prototype.mjs	Object.defineProperty, called as a value that the compiler cannot follow, puts a new name	defineProperty)(target, "added", descriptor`,
      (a, b) => `// ${a} on Set.prototype, which the program holds as a value that the compiler cannot follow.
const hide = value => new CustomEvent("x", { detail: value }).detail;
function one() {
  return "one";
}
const descriptor = { value: one, configurable: true, writable: true };
function look(label) {
  const found = new Set().added ?? "none";
  console.log(label, typeof found, found.length, found === "none");
}
look("before:");
const target = Object.getPrototypeOf(hide(new Set()));
hide(Object.${b});
look("after:");
`,
    ),
    "many-values-live-across-searches-in-arrays-and-strings.ts": text(
      `// Every function keeps 14 integers, 30 doubles and 6 strings live across one kind of call in a loop: more than any register file holds, so every register that
// the call is said to keep holds one of them. The checksum shows a value that came back changed.
const seed = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"].map((word, at) => word + at);
const words: string[] = ["a whole text with a tail", "tail", "alpha0", "beta1", "", "zeta5"].map(word => word + "");
const asked: string[] = ["a whole text with a tai", "whole", "beta" + 1, "alph" + "a0", "", "tail", "zeta" + 5].map(word => (word + "!").slice(0, -1));
const integers: number[] = [5, 3, 8, 1, 9, 2, 7];
const fractions: number[] = [0.5, 1.5, 2.5, NaN, 3.5, -0];
const mixed: unknown[] = ["tail", 3, 2.5, null, undefined, NaN, { a: 1 }, "beta1", true];
const holes: unknown[] = ["x", , "tail", , "beta1"];
const sparse: unknown[] = []; sparse[3] = "tail"; sparse[70000] = "beta1"; sparse[5] = "alpha0";`,
      [
        `includesString	includes(text) ? 1 : 0
indexOfString	indexOf(text)
lastIndexOfString	lastIndexOf(text)
includesFrom	includes(text, k % 3) ? 1 : 0
indexOfFromEnd	indexOf(text, -(k % 4))`,
        (n, a, b) => `
function ${a}(seed: string[], rounds: number, list: string[], asked: string[]) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const text = asked[k % asked.length];
    const n = list.${b};
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}`,
      ],
      [
        `cludesInteger	cludes(k % 11) ? 1 : 0
dexOfInteger	dexOf(k % 11)
cludesFraction	cludes(k % 5 ? k % 5 + 0.5 : NaN) ? 1 : 0
dexOfFraction	dexOf(k % 5 + 0.5)`,
        (n, a, b) => `
function in${a}(seed: string[], rounds: number, list: number[]) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = list.in${b};
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}`,
      ],
      [
        `includesMixed(seed: string[], rounds: number, list: unknown[]	(list.includes(text) ? 1 : 0) + (list.includes(k % 4) ? 2 : 0) + (list.includes(undefined) ? 4 : 0)
indexOfMixed(seed: string[], rounds: number, list: unknown[]	list.indexOf(text) + list.indexOf(k % 4 + 0.5) + list.indexOf(null)
includesHoles(seed: string[], rounds: number, list: unknown[]	(list.includes(text) ? 1 : 0) + (list.includes(undefined) ? 2 : 0)
indexOfHoles(seed: string[], rounds: number, list: unknown[]	list.indexOf(text) + list.indexOf(undefined)
includesSparse(seed: string[], rounds: number, list: unknown[]	list.includes(text) ? 1 : 0
indexOfSparse(seed: string[], rounds: number, list: unknown[]	k % 8 ? 0 : list.indexOf(text)
stringEquality(seed: string[], rounds: number, list: string[]	text === list[k % list.length] ? 1 : 0
stringInequality(seed: string[], rounds: number, list: string[]	text !== list[k % list.length] ? 1 : 0
stringLess(seed: string[], rounds: number, list: string[]	(text < list[k % list.length] ? 1 : 0) + (text >= list[(k + 1) % list.length] ? 2 : 0)
stringIndexOf(seed: string[], rounds: number, list: string[]	list[0].indexOf(text) + list[0].lastIndexOf(text)
stringIncludes(seed: string[], rounds: number, list: string[]	(list[0].includes(text) ? 1 : 0) + (list[0].startsWith(text) ? 2 : 0) + (list[0].endsWith(text) ? 4 : 0)
characterCodes(seed: string[], rounds: number	text.length ? text.charCodeAt(k % text.length) + text.codePointAt(0)! : -1
characters(seed: string[], rounds: number	text.charAt(k % 5).length + (text[k % 7] === undefined ? 0 : 1) + (text.at(-1 - (k % 2))?.length ?? 0)
stringSlices(seed: string[], rounds: number	text.slice(1, 1 + (k % 4)).length + text.substring(k % 3).length + text.trim().length
stringCase(seed: string[], rounds: number	text.toUpperCase().charCodeAt(0) | 0 + text.toLowerCase().length
stringConcatenation(seed: string[], rounds: number	(text + "-" + k + asked[(k + 1) % asked.length]).length + \`\${text}:\${k * 0.5}\`.length + text.concat(text, "x").length
stringPadding(seed: string[], rounds: number	text.padStart(k % 9, "ab").length + text.padEnd(k % 7).length + text.repeat(k % 3).length
stringSplit(seed: string[], rounds: number	text.split(" ").length + text.split("").length + text.split("a", 2).length
stringReplace(seed: string[], rounds: number	text.replace("a", "bb").length + text.replaceAll("t", "").length + text.replace(/[aeiou]/g, "_").length
stringCompare(seed: string[], rounds: number, list: string[]	text.localeCompare(list[k % list.length])
regularExpressions(seed: string[], rounds: number	(/t(a|e)/.test(text) ? 1 : 0) + (text.match(/[a-z]+/g)?.length ?? 0) + text.search(/l/) + (/(\\w)(\\w)/.exec(text)?.index ?? 7)`,
        (n, a, b) => `
function ${a}, asked: string[]) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const text = asked[k % asked.length];
    const n = ${b};
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}`,
      ],
      `
console.log("includesString", includesString(seed, 23, words, asked));
console.log("indexOfString", indexOfString(seed, 23, words, asked));
console.log("lastIndexOfString", lastIndexOfString(seed, 23, words, asked));
console.log("includesFrom", includesFrom(seed, 23, words, asked));
console.log("indexOfFromEnd", indexOfFromEnd(seed, 23, words, asked));
console.log("includesInteger", includesInteger(seed, 23, integers));
console.log("indexOfInteger", indexOfInteger(seed, 23, integers));
console.log("includesFraction", includesFraction(seed, 23, fractions));
console.log("indexOfFraction", indexOfFraction(seed, 23, fractions));
console.log("includesMixed", includesMixed(seed, 23, mixed, asked));
console.log("indexOfMixed", indexOfMixed(seed, 23, mixed, asked));
console.log("includesHoles", includesHoles(seed, 23, holes, asked));
console.log("indexOfHoles", indexOfHoles(seed, 23, holes, asked));
console.log("includesSparse", includesSparse(seed, 23, sparse.slice(0, 8), asked));
console.log("indexOfSparse", indexOfSparse(seed, 23, sparse, asked));
console.log("stringEquality", stringEquality(seed, 23, words, asked));
console.log("stringInequality", stringInequality(seed, 23, words, asked));
console.log("stringLess", stringLess(seed, 23, words, asked));
console.log("stringIndexOf", stringIndexOf(seed, 23, words, asked));
console.log("stringIncludes", stringIncludes(seed, 23, words, asked));
console.log("characterCodes", characterCodes(seed, 23, asked));
console.log("characters", characters(seed, 23, asked));
console.log("stringSlices", stringSlices(seed, 23, asked));
console.log("stringCase", stringCase(seed, 23, asked));
console.log("stringConcatenation", stringConcatenation(seed, 23, asked));
console.log("stringPadding", stringPadding(seed, 23, asked));
console.log("stringSplit", stringSplit(seed, 23, asked));
console.log("stringReplace", stringReplace(seed, 23, asked));
console.log("stringCompare", stringCompare(seed, 23, words, asked));
console.log("regularExpressions", regularExpressions(seed, 23, asked));
`,
    ),
    "proto-key-stored-on-a-bound-function.js": text(
      `function key(s) { return JSON.parse('"' + s + '"'); }
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const k = key("__proto__");`,
      [
        `computed-obj", attempt(() => { t[k] = V	computed-null", attempt(() => { t[k] = V	computed-num", attempt(() => { t[k] = V
constkey-obj", attempt(() => { t["__proto__"] = V	constkey-null", attempt(() => { t["__proto__"] = V	constkey-num", attempt(() => { t["__proto__"] = V
dot-obj", attempt(() => { t.__proto__ = V	dot-null", attempt(() => { t.__proto__ = V	dot-num", attempt(() => { t.__proto__ = V
reflectset-obj", attempt(() => { Reflect.set(t, k, V)	reflectset-null", attempt(() => { Reflect.set(t, k, V)	reflectset-num", attempt(() => { Reflect.set(t, k, V)
reflectsetconst-obj", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-null", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-num", attempt(() => { Reflect.set(t, "__proto__", V)
define-obj", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-null", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-num", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
defineconst-obj", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-null", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-num", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })
assignparsed-obj", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-null", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-num", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
assigncomputed-obj", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-null", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-num", attempt(() => { Object.assign(t, { [k]: V })
assignconst-obj", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-null", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-num", attempt(() => { Object.assign(t, { ["__proto__"]: V })
setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)
lookupsetter-obj", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-null", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-num", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)
lookupsetterconst-obj", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-null", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-num", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)
compound-obj", attempt(() => { t[k] ||= V; t[k] &&= V	compound-null", attempt(() => { t[k] ||= V; t[k] &&= V	compound-num", attempt(() => { t[k] ||= V; t[k] &&= V
destructure-obj", attempt(() => { [t[k]] = [V]	destructure-null", attempt(() => { [t[k]] = [V]	destructure-num", attempt(() => { [t[k]] = [V]
destructureobj-obj", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-null", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-num", attempt(() => { ({ x: t[k] } = { x: V })
forin-obj", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-null", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-num", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V
loopkeys-obj", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-null", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-num", attempt(() => { for (const n of [key("q"), k]) t[n] = V
merge-obj", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-null", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-num", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
definegetter-obj", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-null", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-num", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0
entries-obj", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-null", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-num", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V
reflectdefine-obj", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-null", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-num", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
fromentries-obj", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-null", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-num", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))
spreadparsed-obj", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-null", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-num", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })
call-setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)`,
        (n, a, b, c) => `(() => {
let t2;
const t = function () { return 1; }.bind(null);
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("${a}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = function () { return 1; }.bind(null);
const V = null;
console.log("${b}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = function () { return 1; }.bind(null);
const V = 5;
console.log("${c}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();`,
      ],
      ``,
    ),
    "proto-key-stored-on-a-class-instance.js": text(
      `function key(s) { return JSON.parse('"' + s + '"'); }
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const k = key("__proto__");`,
      [
        `computed-obj", attempt(() => { t[k] = V	computed-null", attempt(() => { t[k] = V	computed-num", attempt(() => { t[k] = V
constkey-obj", attempt(() => { t["__proto__"] = V	constkey-null", attempt(() => { t["__proto__"] = V	constkey-num", attempt(() => { t["__proto__"] = V
dot-obj", attempt(() => { t.__proto__ = V	dot-null", attempt(() => { t.__proto__ = V	dot-num", attempt(() => { t.__proto__ = V
reflectset-obj", attempt(() => { Reflect.set(t, k, V)	reflectset-null", attempt(() => { Reflect.set(t, k, V)	reflectset-num", attempt(() => { Reflect.set(t, k, V)
reflectsetconst-obj", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-null", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-num", attempt(() => { Reflect.set(t, "__proto__", V)
define-obj", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-null", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-num", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
defineconst-obj", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-null", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-num", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })
assignparsed-obj", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-null", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-num", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
assigncomputed-obj", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-null", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-num", attempt(() => { Object.assign(t, { [k]: V })
assignconst-obj", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-null", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-num", attempt(() => { Object.assign(t, { ["__proto__"]: V })
setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)
lookupsetter-obj", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-null", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-num", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)
lookupsetterconst-obj", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-null", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-num", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)
compound-obj", attempt(() => { t[k] ||= V; t[k] &&= V	compound-null", attempt(() => { t[k] ||= V; t[k] &&= V	compound-num", attempt(() => { t[k] ||= V; t[k] &&= V
destructure-obj", attempt(() => { [t[k]] = [V]	destructure-null", attempt(() => { [t[k]] = [V]	destructure-num", attempt(() => { [t[k]] = [V]
destructureobj-obj", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-null", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-num", attempt(() => { ({ x: t[k] } = { x: V })
forin-obj", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-null", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-num", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V
loopkeys-obj", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-null", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-num", attempt(() => { for (const n of [key("q"), k]) t[n] = V
merge-obj", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-null", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-num", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
definegetter-obj", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-null", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-num", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0
entries-obj", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-null", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-num", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V
reflectdefine-obj", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-null", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-num", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
fromentries-obj", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-null", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-num", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))
spreadparsed-obj", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-null", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-num", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })
call-setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)`,
        (n, a, b, c) => `(() => {
let t2;
class Q { constructor() { this.a = 1; this.b = 2; } m() { return "Q.m"; } get g() { return "Q.g"; } }
const t = new Q();
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("${a}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
class Q { constructor() { this.a = 1; this.b = 2; } m() { return "Q.m"; } get g() { return "Q.g"; } }
const t = new Q();
const V = null;
console.log("${b}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
class Q { constructor() { this.a = 1; this.b = 2; } m() { return "Q.m"; } get g() { return "Q.g"; } }
const t = new Q();
const V = 5;
console.log("${c}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();`,
      ],
      ``,
    ),
    "proto-key-stored-on-a-class.js": text(
      `function key(s) { return JSON.parse('"' + s + '"'); }
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const k = key("__proto__");`,
      [
        `computed-obj", attempt(() => { t[k] = V	computed-null", attempt(() => { t[k] = V	computed-num", attempt(() => { t[k] = V
constkey-obj", attempt(() => { t["__proto__"] = V	constkey-null", attempt(() => { t["__proto__"] = V	constkey-num", attempt(() => { t["__proto__"] = V
dot-obj", attempt(() => { t.__proto__ = V	dot-null", attempt(() => { t.__proto__ = V	dot-num", attempt(() => { t.__proto__ = V
reflectset-obj", attempt(() => { Reflect.set(t, k, V)	reflectset-null", attempt(() => { Reflect.set(t, k, V)	reflectset-num", attempt(() => { Reflect.set(t, k, V)
reflectsetconst-obj", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-null", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-num", attempt(() => { Reflect.set(t, "__proto__", V)
define-obj", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-null", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-num", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
defineconst-obj", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-null", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-num", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })
assignparsed-obj", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-null", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-num", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
assigncomputed-obj", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-null", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-num", attempt(() => { Object.assign(t, { [k]: V })
assignconst-obj", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-null", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-num", attempt(() => { Object.assign(t, { ["__proto__"]: V })
setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)
lookupsetter-obj", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-null", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-num", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)
lookupsetterconst-obj", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-null", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-num", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)
compound-obj", attempt(() => { t[k] ||= V; t[k] &&= V	compound-null", attempt(() => { t[k] ||= V; t[k] &&= V	compound-num", attempt(() => { t[k] ||= V; t[k] &&= V
destructure-obj", attempt(() => { [t[k]] = [V]	destructure-null", attempt(() => { [t[k]] = [V]	destructure-num", attempt(() => { [t[k]] = [V]
destructureobj-obj", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-null", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-num", attempt(() => { ({ x: t[k] } = { x: V })
forin-obj", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-null", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-num", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V
loopkeys-obj", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-null", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-num", attempt(() => { for (const n of [key("q"), k]) t[n] = V
merge-obj", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-null", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-num", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
definegetter-obj", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-null", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-num", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0
entries-obj", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-null", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-num", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V
reflectdefine-obj", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-null", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-num", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
fromentries-obj", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-null", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-num", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))
spreadparsed-obj", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-null", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-num", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })
call-setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)`,
        (n, a, b, c) => `(() => {
let t2;
class B1 { static s() { return "B1.s"; } }
class t extends B1 {}
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("${a}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
class B1 { static s() { return "B1.s"; } }
class t extends B1 {}
const V = null;
console.log("${b}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
class B1 { static s() { return "B1.s"; } }
class t extends B1 {}
const V = 5;
console.log("${c}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();`,
      ],
      ``,
    ),
    "proto-key-stored-on-a-date.js": text(
      `function key(s) { return JSON.parse('"' + s + '"'); }
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const k = key("__proto__");`,
      [
        `computed-obj", attempt(() => { t[k] = V	computed-null", attempt(() => { t[k] = V	computed-num", attempt(() => { t[k] = V
constkey-obj", attempt(() => { t["__proto__"] = V	constkey-null", attempt(() => { t["__proto__"] = V	constkey-num", attempt(() => { t["__proto__"] = V
dot-obj", attempt(() => { t.__proto__ = V	dot-null", attempt(() => { t.__proto__ = V	dot-num", attempt(() => { t.__proto__ = V
reflectset-obj", attempt(() => { Reflect.set(t, k, V)	reflectset-null", attempt(() => { Reflect.set(t, k, V)	reflectset-num", attempt(() => { Reflect.set(t, k, V)
reflectsetconst-obj", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-null", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-num", attempt(() => { Reflect.set(t, "__proto__", V)
define-obj", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-null", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-num", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
defineconst-obj", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-null", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-num", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })
assignparsed-obj", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-null", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-num", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
assigncomputed-obj", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-null", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-num", attempt(() => { Object.assign(t, { [k]: V })
assignconst-obj", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-null", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-num", attempt(() => { Object.assign(t, { ["__proto__"]: V })
setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)
lookupsetter-obj", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-null", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-num", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)
lookupsetterconst-obj", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-null", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-num", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)
compound-obj", attempt(() => { t[k] ||= V; t[k] &&= V	compound-null", attempt(() => { t[k] ||= V; t[k] &&= V	compound-num", attempt(() => { t[k] ||= V; t[k] &&= V
destructure-obj", attempt(() => { [t[k]] = [V]	destructure-null", attempt(() => { [t[k]] = [V]	destructure-num", attempt(() => { [t[k]] = [V]
destructureobj-obj", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-null", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-num", attempt(() => { ({ x: t[k] } = { x: V })
forin-obj", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-null", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-num", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V
loopkeys-obj", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-null", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-num", attempt(() => { for (const n of [key("q"), k]) t[n] = V
merge-obj", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-null", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-num", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
definegetter-obj", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-null", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-num", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0
entries-obj", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-null", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-num", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V
reflectdefine-obj", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-null", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-num", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
fromentries-obj", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-null", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-num", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))
spreadparsed-obj", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-null", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-num", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })
call-setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)`,
        (n, a, b, c) => `(() => {
let t2;
const t = new Date(0);
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("${a}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = new Date(0);
const V = null;
console.log("${b}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = new Date(0);
const V = 5;
console.log("${c}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();`,
      ],
      ``,
    ),
    "proto-key-stored-on-a-dictionary.js": text(
      `function key(s) { return JSON.parse('"' + s + '"'); }
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const k = key("__proto__");`,
      [
        `computed-obj", attempt(() => { t[k] = V	computed-null", attempt(() => { t[k] = V	computed-num", attempt(() => { t[k] = V
constkey-obj", attempt(() => { t["__proto__"] = V	constkey-null", attempt(() => { t["__proto__"] = V	constkey-num", attempt(() => { t["__proto__"] = V
dot-obj", attempt(() => { t.__proto__ = V	dot-null", attempt(() => { t.__proto__ = V	dot-num", attempt(() => { t.__proto__ = V
reflectset-obj", attempt(() => { Reflect.set(t, k, V)	reflectset-null", attempt(() => { Reflect.set(t, k, V)	reflectset-num", attempt(() => { Reflect.set(t, k, V)
reflectsetconst-obj", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-null", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-num", attempt(() => { Reflect.set(t, "__proto__", V)
define-obj", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-null", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-num", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
defineconst-obj", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-null", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-num", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })
assignparsed-obj", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-null", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-num", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
assigncomputed-obj", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-null", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-num", attempt(() => { Object.assign(t, { [k]: V })
assignconst-obj", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-null", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-num", attempt(() => { Object.assign(t, { ["__proto__"]: V })
setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)
lookupsetter-obj", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-null", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-num", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)
lookupsetterconst-obj", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-null", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-num", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)
compound-obj", attempt(() => { t[k] ||= V; t[k] &&= V	compound-null", attempt(() => { t[k] ||= V; t[k] &&= V	compound-num", attempt(() => { t[k] ||= V; t[k] &&= V
destructure-obj", attempt(() => { [t[k]] = [V]	destructure-null", attempt(() => { [t[k]] = [V]	destructure-num", attempt(() => { [t[k]] = [V]
destructureobj-obj", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-null", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-num", attempt(() => { ({ x: t[k] } = { x: V })
forin-obj", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-null", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-num", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V
loopkeys-obj", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-null", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-num", attempt(() => { for (const n of [key("q"), k]) t[n] = V
merge-obj", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-null", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-num", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
definegetter-obj", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-null", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-num", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0
entries-obj", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-null", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-num", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V
reflectdefine-obj", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-null", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-num", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
fromentries-obj", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-null", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-num", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))
spreadparsed-obj", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-null", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-num", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })
call-setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)`,
        (n, a, b, c) => `(() => {
let t2;
const t = {}; for (const n of ["x", "y", "z"]) t[key(n)] = 1;
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("${a}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = {}; for (const n of ["x", "y", "z"]) t[key(n)] = 1;
const V = null;
console.log("${b}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = {}; for (const n of ["x", "y", "z"]) t[key(n)] = 1;
const V = 5;
console.log("${c}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();`,
      ],
      ``,
    ),
    "proto-key-stored-on-a-frozen-object.js": text(
      `function key(s) { return JSON.parse('"' + s + '"'); }
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const k = key("__proto__");`,
      [
        `computed-obj", attempt(() => { t[k] = V	computed-null", attempt(() => { t[k] = V	computed-num", attempt(() => { t[k] = V
constkey-obj", attempt(() => { t["__proto__"] = V	constkey-null", attempt(() => { t["__proto__"] = V	constkey-num", attempt(() => { t["__proto__"] = V
dot-obj", attempt(() => { t.__proto__ = V	dot-null", attempt(() => { t.__proto__ = V	dot-num", attempt(() => { t.__proto__ = V
reflectset-obj", attempt(() => { Reflect.set(t, k, V)	reflectset-null", attempt(() => { Reflect.set(t, k, V)	reflectset-num", attempt(() => { Reflect.set(t, k, V)
reflectsetconst-obj", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-null", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-num", attempt(() => { Reflect.set(t, "__proto__", V)
define-obj", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-null", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-num", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
defineconst-obj", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-null", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-num", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })
assignparsed-obj", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-null", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-num", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
assigncomputed-obj", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-null", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-num", attempt(() => { Object.assign(t, { [k]: V })
assignconst-obj", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-null", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-num", attempt(() => { Object.assign(t, { ["__proto__"]: V })
setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)
lookupsetter-obj", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-null", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-num", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)
lookupsetterconst-obj", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-null", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-num", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)
compound-obj", attempt(() => { t[k] ||= V; t[k] &&= V	compound-null", attempt(() => { t[k] ||= V; t[k] &&= V	compound-num", attempt(() => { t[k] ||= V; t[k] &&= V
destructure-obj", attempt(() => { [t[k]] = [V]	destructure-null", attempt(() => { [t[k]] = [V]	destructure-num", attempt(() => { [t[k]] = [V]
destructureobj-obj", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-null", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-num", attempt(() => { ({ x: t[k] } = { x: V })
forin-obj", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-null", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-num", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V
loopkeys-obj", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-null", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-num", attempt(() => { for (const n of [key("q"), k]) t[n] = V
merge-obj", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-null", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-num", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
definegetter-obj", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-null", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-num", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0
entries-obj", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-null", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-num", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V
reflectdefine-obj", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-null", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-num", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
fromentries-obj", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-null", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-num", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))
spreadparsed-obj", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-null", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-num", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })
call-setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)`,
        (n, a, b, c) => `(() => {
let t2;
const t = Object.freeze({ a: 1 });
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("${a}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = Object.freeze({ a: 1 });
const V = null;
console.log("${b}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = Object.freeze({ a: 1 });
const V = 5;
console.log("${c}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();`,
      ],
      ``,
    ),
    "proto-key-stored-on-a-function.js": text(
      `function key(s) { return JSON.parse('"' + s + '"'); }
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const k = key("__proto__");`,
      [
        `computed-obj", attempt(() => { t[k] = V	computed-null", attempt(() => { t[k] = V	computed-num", attempt(() => { t[k] = V
constkey-obj", attempt(() => { t["__proto__"] = V	constkey-null", attempt(() => { t["__proto__"] = V	constkey-num", attempt(() => { t["__proto__"] = V
dot-obj", attempt(() => { t.__proto__ = V	dot-null", attempt(() => { t.__proto__ = V	dot-num", attempt(() => { t.__proto__ = V
reflectset-obj", attempt(() => { Reflect.set(t, k, V)	reflectset-null", attempt(() => { Reflect.set(t, k, V)	reflectset-num", attempt(() => { Reflect.set(t, k, V)
reflectsetconst-obj", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-null", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-num", attempt(() => { Reflect.set(t, "__proto__", V)
define-obj", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-null", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-num", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
defineconst-obj", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-null", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-num", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })
assignparsed-obj", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-null", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-num", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
assigncomputed-obj", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-null", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-num", attempt(() => { Object.assign(t, { [k]: V })
assignconst-obj", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-null", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-num", attempt(() => { Object.assign(t, { ["__proto__"]: V })
setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)
lookupsetter-obj", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-null", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-num", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)
lookupsetterconst-obj", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-null", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-num", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)
compound-obj", attempt(() => { t[k] ||= V; t[k] &&= V	compound-null", attempt(() => { t[k] ||= V; t[k] &&= V	compound-num", attempt(() => { t[k] ||= V; t[k] &&= V
destructure-obj", attempt(() => { [t[k]] = [V]	destructure-null", attempt(() => { [t[k]] = [V]	destructure-num", attempt(() => { [t[k]] = [V]
destructureobj-obj", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-null", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-num", attempt(() => { ({ x: t[k] } = { x: V })
forin-obj", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-null", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-num", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V
loopkeys-obj", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-null", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-num", attempt(() => { for (const n of [key("q"), k]) t[n] = V
merge-obj", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-null", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-num", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
definegetter-obj", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-null", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-num", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0
entries-obj", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-null", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-num", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V
reflectdefine-obj", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-null", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-num", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
fromentries-obj", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-null", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-num", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))
spreadparsed-obj", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-null", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-num", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })
call-setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)`,
        (n, a, b, c) => `(() => {
let t2;
const t = function () { return 1; };
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("${a}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = function () { return 1; };
const V = null;
console.log("${b}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = function () { return 1; };
const V = 5;
console.log("${c}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();`,
      ],
      ``,
    ),
    "proto-key-stored-on-a-generator-object.js": text(
      `function key(s) { return JSON.parse('"' + s + '"'); }
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const k = key("__proto__");`,
      [
        `computed-obj", attempt(() => { t[k] = V	computed-null", attempt(() => { t[k] = V	computed-num", attempt(() => { t[k] = V
constkey-obj", attempt(() => { t["__proto__"] = V	constkey-null", attempt(() => { t["__proto__"] = V	constkey-num", attempt(() => { t["__proto__"] = V
dot-obj", attempt(() => { t.__proto__ = V	dot-null", attempt(() => { t.__proto__ = V	dot-num", attempt(() => { t.__proto__ = V
reflectset-obj", attempt(() => { Reflect.set(t, k, V)	reflectset-null", attempt(() => { Reflect.set(t, k, V)	reflectset-num", attempt(() => { Reflect.set(t, k, V)
reflectsetconst-obj", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-null", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-num", attempt(() => { Reflect.set(t, "__proto__", V)
define-obj", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-null", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-num", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
defineconst-obj", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-null", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-num", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })
assignparsed-obj", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-null", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-num", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
assigncomputed-obj", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-null", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-num", attempt(() => { Object.assign(t, { [k]: V })
assignconst-obj", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-null", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-num", attempt(() => { Object.assign(t, { ["__proto__"]: V })
setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)
lookupsetter-obj", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-null", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-num", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)
lookupsetterconst-obj", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-null", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-num", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)
compound-obj", attempt(() => { t[k] ||= V; t[k] &&= V	compound-null", attempt(() => { t[k] ||= V; t[k] &&= V	compound-num", attempt(() => { t[k] ||= V; t[k] &&= V
destructure-obj", attempt(() => { [t[k]] = [V]	destructure-null", attempt(() => { [t[k]] = [V]	destructure-num", attempt(() => { [t[k]] = [V]
destructureobj-obj", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-null", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-num", attempt(() => { ({ x: t[k] } = { x: V })
forin-obj", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-null", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-num", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V
loopkeys-obj", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-null", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-num", attempt(() => { for (const n of [key("q"), k]) t[n] = V
merge-obj", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-null", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-num", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
definegetter-obj", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-null", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-num", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0
entries-obj", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-null", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-num", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V
reflectdefine-obj", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-null", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-num", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
fromentries-obj", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-null", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-num", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))
spreadparsed-obj", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-null", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-num", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })
call-setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)`,
        (n, a, b, c) => `(() => {
let t2;
function* G() { yield 1; }
const t = G();
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("${a}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
function* G() { yield 1; }
const t = G();
const V = null;
console.log("${b}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
function* G() { yield 1; }
const t = G();
const V = 5;
console.log("${c}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();`,
      ],
      ``,
    ),
    "proto-key-stored-on-a-literal-without-prototype.js": text(
      `function key(s) { return JSON.parse('"' + s + '"'); }
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const k = key("__proto__");`,
      [
        `computed-obj", attempt(() => { t[k] = V	computed-null", attempt(() => { t[k] = V	computed-num", attempt(() => { t[k] = V
constkey-obj", attempt(() => { t["__proto__"] = V	constkey-null", attempt(() => { t["__proto__"] = V	constkey-num", attempt(() => { t["__proto__"] = V
dot-obj", attempt(() => { t.__proto__ = V	dot-null", attempt(() => { t.__proto__ = V	dot-num", attempt(() => { t.__proto__ = V
reflectset-obj", attempt(() => { Reflect.set(t, k, V)	reflectset-null", attempt(() => { Reflect.set(t, k, V)	reflectset-num", attempt(() => { Reflect.set(t, k, V)
reflectsetconst-obj", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-null", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-num", attempt(() => { Reflect.set(t, "__proto__", V)
define-obj", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-null", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-num", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
defineconst-obj", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-null", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-num", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })
assignparsed-obj", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-null", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-num", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
assigncomputed-obj", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-null", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-num", attempt(() => { Object.assign(t, { [k]: V })
assignconst-obj", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-null", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-num", attempt(() => { Object.assign(t, { ["__proto__"]: V })
setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)
lookupsetter-obj", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-null", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-num", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)
lookupsetterconst-obj", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-null", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-num", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)
compound-obj", attempt(() => { t[k] ||= V; t[k] &&= V	compound-null", attempt(() => { t[k] ||= V; t[k] &&= V	compound-num", attempt(() => { t[k] ||= V; t[k] &&= V
destructure-obj", attempt(() => { [t[k]] = [V]	destructure-null", attempt(() => { [t[k]] = [V]	destructure-num", attempt(() => { [t[k]] = [V]
destructureobj-obj", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-null", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-num", attempt(() => { ({ x: t[k] } = { x: V })
forin-obj", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-null", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-num", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V
loopkeys-obj", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-null", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-num", attempt(() => { for (const n of [key("q"), k]) t[n] = V
merge-obj", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-null", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-num", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
definegetter-obj", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-null", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-num", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0
entries-obj", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-null", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-num", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V
reflectdefine-obj", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-null", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-num", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
fromentries-obj", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-null", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-num", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))
spreadparsed-obj", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-null", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-num", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })
call-setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)`,
        (n, a, b, c) => `(() => {
let t2;
const t = { __proto__: null, a: 1 };
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("${a}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = { __proto__: null, a: 1 };
const V = null;
console.log("${b}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = { __proto__: null, a: 1 };
const V = 5;
console.log("${c}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();`,
      ],
      ``,
    ),
    "proto-key-stored-on-a-map.js": text(
      `function key(s) { return JSON.parse('"' + s + '"'); }
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const k = key("__proto__");`,
      [
        `computed-obj", attempt(() => { t[k] = V	computed-null", attempt(() => { t[k] = V	computed-num", attempt(() => { t[k] = V
constkey-obj", attempt(() => { t["__proto__"] = V	constkey-null", attempt(() => { t["__proto__"] = V	constkey-num", attempt(() => { t["__proto__"] = V
dot-obj", attempt(() => { t.__proto__ = V	dot-null", attempt(() => { t.__proto__ = V	dot-num", attempt(() => { t.__proto__ = V
reflectset-obj", attempt(() => { Reflect.set(t, k, V)	reflectset-null", attempt(() => { Reflect.set(t, k, V)	reflectset-num", attempt(() => { Reflect.set(t, k, V)
reflectsetconst-obj", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-null", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-num", attempt(() => { Reflect.set(t, "__proto__", V)
define-obj", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-null", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-num", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
defineconst-obj", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-null", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-num", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })
assignparsed-obj", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-null", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-num", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
assigncomputed-obj", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-null", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-num", attempt(() => { Object.assign(t, { [k]: V })
assignconst-obj", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-null", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-num", attempt(() => { Object.assign(t, { ["__proto__"]: V })
setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)
lookupsetter-obj", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-null", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-num", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)
lookupsetterconst-obj", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-null", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-num", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)
compound-obj", attempt(() => { t[k] ||= V; t[k] &&= V	compound-null", attempt(() => { t[k] ||= V; t[k] &&= V	compound-num", attempt(() => { t[k] ||= V; t[k] &&= V
destructure-obj", attempt(() => { [t[k]] = [V]	destructure-null", attempt(() => { [t[k]] = [V]	destructure-num", attempt(() => { [t[k]] = [V]
destructureobj-obj", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-null", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-num", attempt(() => { ({ x: t[k] } = { x: V })
forin-obj", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-null", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-num", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V
loopkeys-obj", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-null", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-num", attempt(() => { for (const n of [key("q"), k]) t[n] = V
merge-obj", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-null", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-num", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
definegetter-obj", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-null", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-num", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0
entries-obj", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-null", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-num", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V
reflectdefine-obj", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-null", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-num", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
fromentries-obj", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-null", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-num", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))
spreadparsed-obj", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-null", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-num", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })
call-setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)`,
        (n, a, b, c) => `(() => {
let t2;
const t = new Map([[1, 2]]);
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("${a}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = new Map([[1, 2]]);
const V = null;
console.log("${b}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = new Map([[1, 2]]);
const V = 5;
console.log("${c}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();`,
      ],
      ``,
    ),
    "proto-key-stored-on-a-non-extensible-object.js": text(
      `function key(s) { return JSON.parse('"' + s + '"'); }
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const k = key("__proto__");`,
      [
        `computed-obj", attempt(() => { t[k] = V	computed-null", attempt(() => { t[k] = V	computed-num", attempt(() => { t[k] = V
constkey-obj", attempt(() => { t["__proto__"] = V	constkey-null", attempt(() => { t["__proto__"] = V	constkey-num", attempt(() => { t["__proto__"] = V
dot-obj", attempt(() => { t.__proto__ = V	dot-null", attempt(() => { t.__proto__ = V	dot-num", attempt(() => { t.__proto__ = V
reflectset-obj", attempt(() => { Reflect.set(t, k, V)	reflectset-null", attempt(() => { Reflect.set(t, k, V)	reflectset-num", attempt(() => { Reflect.set(t, k, V)
reflectsetconst-obj", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-null", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-num", attempt(() => { Reflect.set(t, "__proto__", V)
define-obj", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-null", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-num", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
defineconst-obj", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-null", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-num", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })
assignparsed-obj", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-null", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-num", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
assigncomputed-obj", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-null", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-num", attempt(() => { Object.assign(t, { [k]: V })
assignconst-obj", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-null", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-num", attempt(() => { Object.assign(t, { ["__proto__"]: V })
setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)
lookupsetter-obj", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-null", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-num", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)
lookupsetterconst-obj", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-null", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-num", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)
compound-obj", attempt(() => { t[k] ||= V; t[k] &&= V	compound-null", attempt(() => { t[k] ||= V; t[k] &&= V	compound-num", attempt(() => { t[k] ||= V; t[k] &&= V
destructure-obj", attempt(() => { [t[k]] = [V]	destructure-null", attempt(() => { [t[k]] = [V]	destructure-num", attempt(() => { [t[k]] = [V]
destructureobj-obj", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-null", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-num", attempt(() => { ({ x: t[k] } = { x: V })
forin-obj", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-null", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-num", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V
loopkeys-obj", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-null", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-num", attempt(() => { for (const n of [key("q"), k]) t[n] = V
merge-obj", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-null", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-num", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
definegetter-obj", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-null", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-num", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0
entries-obj", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-null", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-num", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V
reflectdefine-obj", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-null", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-num", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
fromentries-obj", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-null", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-num", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))
spreadparsed-obj", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-null", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-num", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })
call-setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)`,
        (n, a, b, c) => `(() => {
let t2;
const t = Object.preventExtensions({ a: 1 });
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("${a}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = Object.preventExtensions({ a: 1 });
const V = null;
console.log("${b}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = Object.preventExtensions({ a: 1 });
const V = 5;
console.log("${c}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();`,
      ],
      ``,
    ),
    "proto-key-stored-on-a-number-object.js": text(
      `function key(s) { return JSON.parse('"' + s + '"'); }
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const k = key("__proto__");`,
      [
        `computed-obj", attempt(() => { t[k] = V	computed-null", attempt(() => { t[k] = V	computed-num", attempt(() => { t[k] = V
constkey-obj", attempt(() => { t["__proto__"] = V	constkey-null", attempt(() => { t["__proto__"] = V	constkey-num", attempt(() => { t["__proto__"] = V
dot-obj", attempt(() => { t.__proto__ = V	dot-null", attempt(() => { t.__proto__ = V	dot-num", attempt(() => { t.__proto__ = V
reflectset-obj", attempt(() => { Reflect.set(t, k, V)	reflectset-null", attempt(() => { Reflect.set(t, k, V)	reflectset-num", attempt(() => { Reflect.set(t, k, V)
reflectsetconst-obj", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-null", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-num", attempt(() => { Reflect.set(t, "__proto__", V)
define-obj", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-null", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-num", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
defineconst-obj", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-null", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-num", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })
assignparsed-obj", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-null", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-num", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
assigncomputed-obj", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-null", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-num", attempt(() => { Object.assign(t, { [k]: V })
assignconst-obj", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-null", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-num", attempt(() => { Object.assign(t, { ["__proto__"]: V })
setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)
lookupsetter-obj", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-null", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-num", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)
lookupsetterconst-obj", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-null", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-num", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)
compound-obj", attempt(() => { t[k] ||= V; t[k] &&= V	compound-null", attempt(() => { t[k] ||= V; t[k] &&= V	compound-num", attempt(() => { t[k] ||= V; t[k] &&= V
destructure-obj", attempt(() => { [t[k]] = [V]	destructure-null", attempt(() => { [t[k]] = [V]	destructure-num", attempt(() => { [t[k]] = [V]
destructureobj-obj", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-null", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-num", attempt(() => { ({ x: t[k] } = { x: V })
forin-obj", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-null", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-num", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V
loopkeys-obj", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-null", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-num", attempt(() => { for (const n of [key("q"), k]) t[n] = V
merge-obj", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-null", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-num", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
definegetter-obj", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-null", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-num", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0
entries-obj", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-null", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-num", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V
reflectdefine-obj", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-null", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-num", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
fromentries-obj", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-null", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-num", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))
spreadparsed-obj", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-null", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-num", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })
call-setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)`,
        (n, a, b, c) => `(() => {
let t2;
const t = Object(1);
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("${a}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = Object(1);
const V = null;
console.log("${b}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = Object(1);
const V = 5;
console.log("${c}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();`,
      ],
      ``,
    ),
    "proto-key-stored-on-a-promise.js": text(
      `function key(s) { return JSON.parse('"' + s + '"'); }
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const k = key("__proto__");`,
      [
        `computed-obj", attempt(() => { t[k] = V	computed-null", attempt(() => { t[k] = V	computed-num", attempt(() => { t[k] = V
constkey-obj", attempt(() => { t["__proto__"] = V	constkey-null", attempt(() => { t["__proto__"] = V	constkey-num", attempt(() => { t["__proto__"] = V
dot-obj", attempt(() => { t.__proto__ = V	dot-null", attempt(() => { t.__proto__ = V	dot-num", attempt(() => { t.__proto__ = V
reflectset-obj", attempt(() => { Reflect.set(t, k, V)	reflectset-null", attempt(() => { Reflect.set(t, k, V)	reflectset-num", attempt(() => { Reflect.set(t, k, V)
reflectsetconst-obj", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-null", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-num", attempt(() => { Reflect.set(t, "__proto__", V)
define-obj", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-null", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-num", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
defineconst-obj", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-null", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-num", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })
assignparsed-obj", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-null", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-num", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
assigncomputed-obj", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-null", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-num", attempt(() => { Object.assign(t, { [k]: V })
assignconst-obj", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-null", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-num", attempt(() => { Object.assign(t, { ["__proto__"]: V })
setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)
lookupsetter-obj", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-null", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-num", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)
lookupsetterconst-obj", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-null", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-num", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)
compound-obj", attempt(() => { t[k] ||= V; t[k] &&= V	compound-null", attempt(() => { t[k] ||= V; t[k] &&= V	compound-num", attempt(() => { t[k] ||= V; t[k] &&= V
destructure-obj", attempt(() => { [t[k]] = [V]	destructure-null", attempt(() => { [t[k]] = [V]	destructure-num", attempt(() => { [t[k]] = [V]
destructureobj-obj", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-null", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-num", attempt(() => { ({ x: t[k] } = { x: V })
forin-obj", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-null", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-num", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V
loopkeys-obj", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-null", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-num", attempt(() => { for (const n of [key("q"), k]) t[n] = V
merge-obj", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-null", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-num", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
definegetter-obj", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-null", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-num", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0
entries-obj", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-null", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-num", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V
reflectdefine-obj", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-null", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-num", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
fromentries-obj", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-null", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-num", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))
spreadparsed-obj", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-null", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-num", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })
call-setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)`,
        (n, a, b, c) => `(() => {
let t2;
const t = Promise.resolve(1);
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("${a}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = Promise.resolve(1);
const V = null;
console.log("${b}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = Promise.resolve(1);
const V = 5;
console.log("${c}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();`,
      ],
      ``,
    ),
    "proto-key-stored-on-a-prototype-object.js": text(
      `function key(s) { return JSON.parse('"' + s + '"'); }
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const k = key("__proto__");`,
      [
        `computed-obj", attempt(() => { t[k] = V	computed-null", attempt(() => { t[k] = V	computed-num", attempt(() => { t[k] = V
constkey-obj", attempt(() => { t["__proto__"] = V	constkey-null", attempt(() => { t["__proto__"] = V	constkey-num", attempt(() => { t["__proto__"] = V
dot-obj", attempt(() => { t.__proto__ = V	dot-null", attempt(() => { t.__proto__ = V	dot-num", attempt(() => { t.__proto__ = V
reflectset-obj", attempt(() => { Reflect.set(t, k, V)	reflectset-null", attempt(() => { Reflect.set(t, k, V)	reflectset-num", attempt(() => { Reflect.set(t, k, V)
reflectsetconst-obj", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-null", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-num", attempt(() => { Reflect.set(t, "__proto__", V)
define-obj", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-null", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-num", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
defineconst-obj", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-null", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-num", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })
assignparsed-obj", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-null", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-num", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
assigncomputed-obj", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-null", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-num", attempt(() => { Object.assign(t, { [k]: V })
assignconst-obj", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-null", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-num", attempt(() => { Object.assign(t, { ["__proto__"]: V })
setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)
lookupsetter-obj", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-null", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-num", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)
lookupsetterconst-obj", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-null", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-num", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)
compound-obj", attempt(() => { t[k] ||= V; t[k] &&= V	compound-null", attempt(() => { t[k] ||= V; t[k] &&= V	compound-num", attempt(() => { t[k] ||= V; t[k] &&= V
destructure-obj", attempt(() => { [t[k]] = [V]	destructure-null", attempt(() => { [t[k]] = [V]	destructure-num", attempt(() => { [t[k]] = [V]
destructureobj-obj", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-null", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-num", attempt(() => { ({ x: t[k] } = { x: V })
forin-obj", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-null", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-num", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V
loopkeys-obj", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-null", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-num", attempt(() => { for (const n of [key("q"), k]) t[n] = V
merge-obj", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-null", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-num", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
definegetter-obj", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-null", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-num", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0
entries-obj", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-null", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-num", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V
reflectdefine-obj", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-null", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-num", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
fromentries-obj", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-null", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-num", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))
spreadparsed-obj", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-null", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-num", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })
call-setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)`,
        (n, a, b, c) => `(() => {
let t2;
class Q { m() { return "Q.m"; } }
const t = Q.prototype; const i0 = new Q();
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("${a}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
class Q { m() { return "Q.m"; } }
const t = Q.prototype; const i0 = new Q();
const V = null;
console.log("${b}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
class Q { m() { return "Q.m"; } }
const t = Q.prototype; const i0 = new Q();
const V = 5;
console.log("${c}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();`,
      ],
      ``,
    ),
    "proto-key-stored-on-a-regular-expression.js": text(
      `function key(s) { return JSON.parse('"' + s + '"'); }
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const k = key("__proto__");`,
      [
        `computed-obj", attempt(() => { t[k] = V	computed-null", attempt(() => { t[k] = V	computed-num", attempt(() => { t[k] = V
constkey-obj", attempt(() => { t["__proto__"] = V	constkey-null", attempt(() => { t["__proto__"] = V	constkey-num", attempt(() => { t["__proto__"] = V
dot-obj", attempt(() => { t.__proto__ = V	dot-null", attempt(() => { t.__proto__ = V	dot-num", attempt(() => { t.__proto__ = V
reflectset-obj", attempt(() => { Reflect.set(t, k, V)	reflectset-null", attempt(() => { Reflect.set(t, k, V)	reflectset-num", attempt(() => { Reflect.set(t, k, V)
reflectsetconst-obj", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-null", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-num", attempt(() => { Reflect.set(t, "__proto__", V)
define-obj", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-null", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-num", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
defineconst-obj", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-null", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-num", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })
assignparsed-obj", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-null", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-num", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
assigncomputed-obj", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-null", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-num", attempt(() => { Object.assign(t, { [k]: V })
assignconst-obj", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-null", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-num", attempt(() => { Object.assign(t, { ["__proto__"]: V })
setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)
lookupsetter-obj", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-null", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-num", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)
lookupsetterconst-obj", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-null", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-num", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)
compound-obj", attempt(() => { t[k] ||= V; t[k] &&= V	compound-null", attempt(() => { t[k] ||= V; t[k] &&= V	compound-num", attempt(() => { t[k] ||= V; t[k] &&= V
destructure-obj", attempt(() => { [t[k]] = [V]	destructure-null", attempt(() => { [t[k]] = [V]	destructure-num", attempt(() => { [t[k]] = [V]
destructureobj-obj", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-null", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-num", attempt(() => { ({ x: t[k] } = { x: V })
forin-obj", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-null", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-num", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V
loopkeys-obj", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-null", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-num", attempt(() => { for (const n of [key("q"), k]) t[n] = V
merge-obj", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-null", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-num", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
definegetter-obj", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-null", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-num", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0
entries-obj", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-null", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-num", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V
reflectdefine-obj", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-null", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-num", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
fromentries-obj", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-null", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-num", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))
spreadparsed-obj", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-null", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-num", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })
call-setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)`,
        (n, a, b, c) => `(() => {
let t2;
const t = /a/;
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("${a}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = null;
console.log("${b}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = 5;
console.log("${c}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();`,
      ],
      ``,
    ),
    "proto-key-stored-on-a-subclass-instance.js": text(
      `function key(s) { return JSON.parse('"' + s + '"'); }
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const k = key("__proto__");`,
      [
        `computed-obj", attempt(() => { t[k] = V	computed-null", attempt(() => { t[k] = V	computed-num", attempt(() => { t[k] = V
constkey-obj", attempt(() => { t["__proto__"] = V	constkey-null", attempt(() => { t["__proto__"] = V	constkey-num", attempt(() => { t["__proto__"] = V
dot-obj", attempt(() => { t.__proto__ = V	dot-null", attempt(() => { t.__proto__ = V	dot-num", attempt(() => { t.__proto__ = V
reflectset-obj", attempt(() => { Reflect.set(t, k, V)	reflectset-null", attempt(() => { Reflect.set(t, k, V)	reflectset-num", attempt(() => { Reflect.set(t, k, V)
reflectsetconst-obj", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-null", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-num", attempt(() => { Reflect.set(t, "__proto__", V)
define-obj", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-null", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-num", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
defineconst-obj", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-null", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-num", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })
assignparsed-obj", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-null", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-num", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
assigncomputed-obj", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-null", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-num", attempt(() => { Object.assign(t, { [k]: V })
assignconst-obj", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-null", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-num", attempt(() => { Object.assign(t, { ["__proto__"]: V })
setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)
lookupsetter-obj", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-null", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-num", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)
lookupsetterconst-obj", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-null", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-num", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)
compound-obj", attempt(() => { t[k] ||= V; t[k] &&= V	compound-null", attempt(() => { t[k] ||= V; t[k] &&= V	compound-num", attempt(() => { t[k] ||= V; t[k] &&= V
destructure-obj", attempt(() => { [t[k]] = [V]	destructure-null", attempt(() => { [t[k]] = [V]	destructure-num", attempt(() => { [t[k]] = [V]
destructureobj-obj", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-null", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-num", attempt(() => { ({ x: t[k] } = { x: V })
forin-obj", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-null", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-num", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V
loopkeys-obj", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-null", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-num", attempt(() => { for (const n of [key("q"), k]) t[n] = V
merge-obj", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-null", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-num", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
definegetter-obj", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-null", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-num", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0
entries-obj", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-null", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-num", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V
reflectdefine-obj", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-null", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-num", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
fromentries-obj", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-null", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-num", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))
spreadparsed-obj", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-null", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-num", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })
call-setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)`,
        (n, a, b, c) => `(() => {
let t2;
class B0 { m() { return "B0.m"; } }
class Q extends B0 { constructor() { super(); this.a = 1; } n() { return super.m(); } }
const t = new Q();
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("${a}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
class B0 { m() { return "B0.m"; } }
class Q extends B0 { constructor() { super(); this.a = 1; } n() { return super.m(); } }
const t = new Q();
const V = null;
console.log("${b}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
class B0 { m() { return "B0.m"; } }
class Q extends B0 { constructor() { super(); this.a = 1; } n() { return super.m(); } }
const t = new Q();
const V = 5;
console.log("${c}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();`,
      ],
      ``,
    ),
    "proto-key-stored-on-a-typed-array.js": text(
      `function key(s) { return JSON.parse('"' + s + '"'); }
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const k = key("__proto__");`,
      [
        `computed-obj", attempt(() => { t[k] = V	computed-null", attempt(() => { t[k] = V	computed-num", attempt(() => { t[k] = V
constkey-obj", attempt(() => { t["__proto__"] = V	constkey-null", attempt(() => { t["__proto__"] = V	constkey-num", attempt(() => { t["__proto__"] = V
dot-obj", attempt(() => { t.__proto__ = V	dot-null", attempt(() => { t.__proto__ = V	dot-num", attempt(() => { t.__proto__ = V
reflectset-obj", attempt(() => { Reflect.set(t, k, V)	reflectset-null", attempt(() => { Reflect.set(t, k, V)	reflectset-num", attempt(() => { Reflect.set(t, k, V)
reflectsetconst-obj", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-null", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-num", attempt(() => { Reflect.set(t, "__proto__", V)
define-obj", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-null", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-num", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
defineconst-obj", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-null", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-num", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })
assignparsed-obj", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-null", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-num", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
assigncomputed-obj", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-null", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-num", attempt(() => { Object.assign(t, { [k]: V })
assignconst-obj", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-null", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-num", attempt(() => { Object.assign(t, { ["__proto__"]: V })
setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)
lookupsetter-obj", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-null", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-num", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)
lookupsetterconst-obj", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-null", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-num", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)
compound-obj", attempt(() => { t[k] ||= V; t[k] &&= V	compound-null", attempt(() => { t[k] ||= V; t[k] &&= V	compound-num", attempt(() => { t[k] ||= V; t[k] &&= V
destructure-obj", attempt(() => { [t[k]] = [V]	destructure-null", attempt(() => { [t[k]] = [V]	destructure-num", attempt(() => { [t[k]] = [V]
destructureobj-obj", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-null", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-num", attempt(() => { ({ x: t[k] } = { x: V })
forin-obj", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-null", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-num", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V
loopkeys-obj", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-null", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-num", attempt(() => { for (const n of [key("q"), k]) t[n] = V
merge-obj", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-null", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-num", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
definegetter-obj", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-null", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-num", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0
entries-obj", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-null", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-num", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V
reflectdefine-obj", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-null", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-num", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
fromentries-obj", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-null", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-num", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))
spreadparsed-obj", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-null", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-num", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })
call-setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)`,
        (n, a, b, c) => `(() => {
let t2;
const t = new Uint8Array(2);
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("${a}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = new Uint8Array(2);
const V = null;
console.log("${b}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = new Uint8Array(2);
const V = 5;
console.log("${c}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();`,
      ],
      ``,
    ),
    "proto-key-stored-on-an-arguments-object.js": text(
      `function key(s) { return JSON.parse('"' + s + '"'); }
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const k = key("__proto__");`,
      [
        `computed-obj", attempt(() => { t[k] = V	computed-null", attempt(() => { t[k] = V	computed-num", attempt(() => { t[k] = V
constkey-obj", attempt(() => { t["__proto__"] = V	constkey-null", attempt(() => { t["__proto__"] = V	constkey-num", attempt(() => { t["__proto__"] = V
dot-obj", attempt(() => { t.__proto__ = V	dot-null", attempt(() => { t.__proto__ = V	dot-num", attempt(() => { t.__proto__ = V
reflectset-obj", attempt(() => { Reflect.set(t, k, V)	reflectset-null", attempt(() => { Reflect.set(t, k, V)	reflectset-num", attempt(() => { Reflect.set(t, k, V)
reflectsetconst-obj", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-null", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-num", attempt(() => { Reflect.set(t, "__proto__", V)
define-obj", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-null", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-num", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
defineconst-obj", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-null", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-num", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })
assignparsed-obj", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-null", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-num", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
assigncomputed-obj", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-null", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-num", attempt(() => { Object.assign(t, { [k]: V })
assignconst-obj", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-null", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-num", attempt(() => { Object.assign(t, { ["__proto__"]: V })
setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)
lookupsetter-obj", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-null", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-num", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)
lookupsetterconst-obj", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-null", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-num", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)
compound-obj", attempt(() => { t[k] ||= V; t[k] &&= V	compound-null", attempt(() => { t[k] ||= V; t[k] &&= V	compound-num", attempt(() => { t[k] ||= V; t[k] &&= V
destructure-obj", attempt(() => { [t[k]] = [V]	destructure-null", attempt(() => { [t[k]] = [V]	destructure-num", attempt(() => { [t[k]] = [V]
destructureobj-obj", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-null", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-num", attempt(() => { ({ x: t[k] } = { x: V })
forin-obj", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-null", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-num", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V
loopkeys-obj", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-null", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-num", attempt(() => { for (const n of [key("q"), k]) t[n] = V
merge-obj", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-null", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-num", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
definegetter-obj", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-null", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-num", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0
entries-obj", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-null", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-num", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V
reflectdefine-obj", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-null", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-num", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
fromentries-obj", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-null", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-num", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))
spreadparsed-obj", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-null", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-num", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })
call-setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)`,
        (n, a, b, c) => `(() => {
let t2;
const t = (function () { return arguments; })(1, 2);
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("${a}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = (function () { return arguments; })(1, 2);
const V = null;
console.log("${b}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = (function () { return arguments; })(1, 2);
const V = 5;
console.log("${c}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();`,
      ],
      ``,
    ),
    "proto-key-stored-on-an-array.js": text(
      `function key(s) { return JSON.parse('"' + s + '"'); }
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const k = key("__proto__");`,
      [
        `computed-obj", attempt(() => { t[k] = V	computed-null", attempt(() => { t[k] = V	computed-num", attempt(() => { t[k] = V
constkey-obj", attempt(() => { t["__proto__"] = V	constkey-null", attempt(() => { t["__proto__"] = V	constkey-num", attempt(() => { t["__proto__"] = V
dot-obj", attempt(() => { t.__proto__ = V	dot-null", attempt(() => { t.__proto__ = V	dot-num", attempt(() => { t.__proto__ = V
reflectset-obj", attempt(() => { Reflect.set(t, k, V)	reflectset-null", attempt(() => { Reflect.set(t, k, V)	reflectset-num", attempt(() => { Reflect.set(t, k, V)
reflectsetconst-obj", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-null", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-num", attempt(() => { Reflect.set(t, "__proto__", V)
define-obj", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-null", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-num", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
defineconst-obj", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-null", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-num", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })
assignparsed-obj", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-null", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-num", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
assigncomputed-obj", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-null", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-num", attempt(() => { Object.assign(t, { [k]: V })
assignconst-obj", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-null", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-num", attempt(() => { Object.assign(t, { ["__proto__"]: V })
setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)
lookupsetter-obj", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-null", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-num", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)
lookupsetterconst-obj", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-null", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-num", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)
compound-obj", attempt(() => { t[k] ||= V; t[k] &&= V	compound-null", attempt(() => { t[k] ||= V; t[k] &&= V	compound-num", attempt(() => { t[k] ||= V; t[k] &&= V
destructure-obj", attempt(() => { [t[k]] = [V]	destructure-null", attempt(() => { [t[k]] = [V]	destructure-num", attempt(() => { [t[k]] = [V]
destructureobj-obj", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-null", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-num", attempt(() => { ({ x: t[k] } = { x: V })
forin-obj", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-null", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-num", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V
loopkeys-obj", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-null", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-num", attempt(() => { for (const n of [key("q"), k]) t[n] = V
merge-obj", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-null", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-num", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
definegetter-obj", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-null", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-num", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0
entries-obj", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-null", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-num", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V
reflectdefine-obj", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-null", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-num", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
fromentries-obj", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-null", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-num", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))
spreadparsed-obj", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-null", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-num", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })
call-setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)`,
        (n, a, b, c) => `(() => {
let t2;
const t = [1, 2, 3];
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("${a}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = [1, 2, 3];
const V = null;
console.log("${b}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = [1, 2, 3];
const V = 5;
console.log("${c}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();`,
      ],
      ``,
    ),
    "proto-key-stored-on-an-arrow-function.js": text(
      `function key(s) { return JSON.parse('"' + s + '"'); }
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const k = key("__proto__");`,
      [
        `computed-obj", attempt(() => { t[k] = V	computed-null", attempt(() => { t[k] = V	computed-num", attempt(() => { t[k] = V
constkey-obj", attempt(() => { t["__proto__"] = V	constkey-null", attempt(() => { t["__proto__"] = V	constkey-num", attempt(() => { t["__proto__"] = V
dot-obj", attempt(() => { t.__proto__ = V	dot-null", attempt(() => { t.__proto__ = V	dot-num", attempt(() => { t.__proto__ = V
reflectset-obj", attempt(() => { Reflect.set(t, k, V)	reflectset-null", attempt(() => { Reflect.set(t, k, V)	reflectset-num", attempt(() => { Reflect.set(t, k, V)
reflectsetconst-obj", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-null", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-num", attempt(() => { Reflect.set(t, "__proto__", V)
define-obj", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-null", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-num", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
defineconst-obj", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-null", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-num", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })
assignparsed-obj", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-null", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-num", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
assigncomputed-obj", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-null", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-num", attempt(() => { Object.assign(t, { [k]: V })
assignconst-obj", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-null", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-num", attempt(() => { Object.assign(t, { ["__proto__"]: V })
setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)
lookupsetter-obj", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-null", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-num", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)
lookupsetterconst-obj", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-null", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-num", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)
compound-obj", attempt(() => { t[k] ||= V; t[k] &&= V	compound-null", attempt(() => { t[k] ||= V; t[k] &&= V	compound-num", attempt(() => { t[k] ||= V; t[k] &&= V
destructure-obj", attempt(() => { [t[k]] = [V]	destructure-null", attempt(() => { [t[k]] = [V]	destructure-num", attempt(() => { [t[k]] = [V]
destructureobj-obj", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-null", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-num", attempt(() => { ({ x: t[k] } = { x: V })
forin-obj", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-null", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-num", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V
loopkeys-obj", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-null", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-num", attempt(() => { for (const n of [key("q"), k]) t[n] = V
merge-obj", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-null", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-num", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
definegetter-obj", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-null", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-num", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0
entries-obj", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-null", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-num", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V
reflectdefine-obj", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-null", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-num", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
fromentries-obj", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-null", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-num", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))
spreadparsed-obj", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-null", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-num", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })
call-setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)`,
        (n, a, b, c) => `(() => {
let t2;
const t = () => 1;
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("${a}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = () => 1;
const V = null;
console.log("${b}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = () => 1;
const V = 5;
console.log("${c}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();`,
      ],
      ``,
    ),
    "proto-key-stored-on-an-empty-literal.js": text(
      `function key(s) { return JSON.parse('"' + s + '"'); }
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const k = key("__proto__");`,
      [
        `computed-obj", attempt(() => { t[k] = V	computed-null", attempt(() => { t[k] = V	computed-num", attempt(() => { t[k] = V
constkey-obj", attempt(() => { t["__proto__"] = V	constkey-null", attempt(() => { t["__proto__"] = V	constkey-num", attempt(() => { t["__proto__"] = V
dot-obj", attempt(() => { t.__proto__ = V	dot-null", attempt(() => { t.__proto__ = V	dot-num", attempt(() => { t.__proto__ = V
reflectset-obj", attempt(() => { Reflect.set(t, k, V)	reflectset-null", attempt(() => { Reflect.set(t, k, V)	reflectset-num", attempt(() => { Reflect.set(t, k, V)
reflectsetconst-obj", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-null", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-num", attempt(() => { Reflect.set(t, "__proto__", V)
define-obj", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-null", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-num", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
defineconst-obj", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-null", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-num", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })
assignparsed-obj", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-null", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-num", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
assigncomputed-obj", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-null", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-num", attempt(() => { Object.assign(t, { [k]: V })
assignconst-obj", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-null", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-num", attempt(() => { Object.assign(t, { ["__proto__"]: V })
setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)
lookupsetter-obj", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-null", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-num", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)
lookupsetterconst-obj", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-null", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-num", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)
compound-obj", attempt(() => { t[k] ||= V; t[k] &&= V	compound-null", attempt(() => { t[k] ||= V; t[k] &&= V	compound-num", attempt(() => { t[k] ||= V; t[k] &&= V
destructure-obj", attempt(() => { [t[k]] = [V]	destructure-null", attempt(() => { [t[k]] = [V]	destructure-num", attempt(() => { [t[k]] = [V]
destructureobj-obj", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-null", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-num", attempt(() => { ({ x: t[k] } = { x: V })
forin-obj", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-null", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-num", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V
loopkeys-obj", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-null", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-num", attempt(() => { for (const n of [key("q"), k]) t[n] = V
merge-obj", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-null", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-num", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
definegetter-obj", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-null", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-num", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0
entries-obj", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-null", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-num", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V
reflectdefine-obj", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-null", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-num", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
fromentries-obj", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-null", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-num", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))
spreadparsed-obj", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-null", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-num", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })
call-setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)`,
        (n, a, b, c) => `(() => {
let t2;
const t = {};
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("${a}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = {};
const V = null;
console.log("${b}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = {};
const V = 5;
console.log("${c}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();`,
      ],
      ``,
    ),
    "proto-key-stored-on-an-error.js": text(
      `function key(s) { return JSON.parse('"' + s + '"'); }
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const k = key("__proto__");`,
      [
        `computed-obj", attempt(() => { t[k] = V	computed-null", attempt(() => { t[k] = V	computed-num", attempt(() => { t[k] = V
constkey-obj", attempt(() => { t["__proto__"] = V	constkey-null", attempt(() => { t["__proto__"] = V	constkey-num", attempt(() => { t["__proto__"] = V
dot-obj", attempt(() => { t.__proto__ = V	dot-null", attempt(() => { t.__proto__ = V	dot-num", attempt(() => { t.__proto__ = V
reflectset-obj", attempt(() => { Reflect.set(t, k, V)	reflectset-null", attempt(() => { Reflect.set(t, k, V)	reflectset-num", attempt(() => { Reflect.set(t, k, V)
reflectsetconst-obj", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-null", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-num", attempt(() => { Reflect.set(t, "__proto__", V)
define-obj", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-null", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-num", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
defineconst-obj", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-null", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-num", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })
assignparsed-obj", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-null", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-num", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
assigncomputed-obj", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-null", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-num", attempt(() => { Object.assign(t, { [k]: V })
assignconst-obj", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-null", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-num", attempt(() => { Object.assign(t, { ["__proto__"]: V })
setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)
lookupsetter-obj", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-null", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-num", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)
lookupsetterconst-obj", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-null", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-num", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)
compound-obj", attempt(() => { t[k] ||= V; t[k] &&= V	compound-null", attempt(() => { t[k] ||= V; t[k] &&= V	compound-num", attempt(() => { t[k] ||= V; t[k] &&= V
destructure-obj", attempt(() => { [t[k]] = [V]	destructure-null", attempt(() => { [t[k]] = [V]	destructure-num", attempt(() => { [t[k]] = [V]
destructureobj-obj", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-null", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-num", attempt(() => { ({ x: t[k] } = { x: V })
forin-obj", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-null", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-num", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V
loopkeys-obj", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-null", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-num", attempt(() => { for (const n of [key("q"), k]) t[n] = V
merge-obj", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-null", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-num", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
definegetter-obj", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-null", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-num", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0
entries-obj", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-null", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-num", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V
reflectdefine-obj", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-null", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-num", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
fromentries-obj", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-null", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-num", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))
spreadparsed-obj", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-null", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-num", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })
call-setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)`,
        (n, a, b, c) => `(() => {
let t2;
const t = new Error("e");
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("${a}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = new Error("e");
const V = null;
console.log("${b}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = new Error("e");
const V = 5;
console.log("${c}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();`,
      ],
      ``,
    ),
    "proto-key-stored-on-an-object-literal.js": text(
      `function key(s) { return JSON.parse('"' + s + '"'); }
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const k = key("__proto__");`,
      [
        `computed-obj", attempt(() => { t[k] = V	computed-null", attempt(() => { t[k] = V	computed-num", attempt(() => { t[k] = V
constkey-obj", attempt(() => { t["__proto__"] = V	constkey-null", attempt(() => { t["__proto__"] = V	constkey-num", attempt(() => { t["__proto__"] = V
dot-obj", attempt(() => { t.__proto__ = V	dot-null", attempt(() => { t.__proto__ = V	dot-num", attempt(() => { t.__proto__ = V
reflectset-obj", attempt(() => { Reflect.set(t, k, V)	reflectset-null", attempt(() => { Reflect.set(t, k, V)	reflectset-num", attempt(() => { Reflect.set(t, k, V)
reflectsetconst-obj", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-null", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-num", attempt(() => { Reflect.set(t, "__proto__", V)
define-obj", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-null", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-num", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
defineconst-obj", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-null", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-num", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })
assignparsed-obj", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-null", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-num", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
assigncomputed-obj", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-null", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-num", attempt(() => { Object.assign(t, { [k]: V })
assignconst-obj", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-null", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-num", attempt(() => { Object.assign(t, { ["__proto__"]: V })
setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)
lookupsetter-obj", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-null", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-num", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)
lookupsetterconst-obj", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-null", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-num", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)
compound-obj", attempt(() => { t[k] ||= V; t[k] &&= V	compound-null", attempt(() => { t[k] ||= V; t[k] &&= V	compound-num", attempt(() => { t[k] ||= V; t[k] &&= V
destructure-obj", attempt(() => { [t[k]] = [V]	destructure-null", attempt(() => { [t[k]] = [V]	destructure-num", attempt(() => { [t[k]] = [V]
destructureobj-obj", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-null", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-num", attempt(() => { ({ x: t[k] } = { x: V })
forin-obj", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-null", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-num", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V
loopkeys-obj", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-null", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-num", attempt(() => { for (const n of [key("q"), k]) t[n] = V
merge-obj", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-null", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-num", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
definegetter-obj", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-null", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-num", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0
entries-obj", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-null", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-num", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V
reflectdefine-obj", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-null", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-num", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
fromentries-obj", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-null", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-num", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))
spreadparsed-obj", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-null", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-num", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })
call-setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)`,
        (n, a, b, c) => `(() => {
let t2;
const t = { a: 1, b: 2 };
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("${a}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = { a: 1, b: 2 };
const V = null;
console.log("${b}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = { a: 1, b: 2 };
const V = 5;
console.log("${c}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();`,
      ],
      ``,
    ),
    "proto-key-stored-on-an-object-made-by-object-create.js": text(
      `function key(s) { return JSON.parse('"' + s + '"'); }
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const k = key("__proto__");`,
      [
        `computed-obj", attempt(() => { t[k] = V	computed-null", attempt(() => { t[k] = V	computed-num", attempt(() => { t[k] = V
constkey-obj", attempt(() => { t["__proto__"] = V	constkey-null", attempt(() => { t["__proto__"] = V	constkey-num", attempt(() => { t["__proto__"] = V
dot-obj", attempt(() => { t.__proto__ = V	dot-null", attempt(() => { t.__proto__ = V	dot-num", attempt(() => { t.__proto__ = V
reflectset-obj", attempt(() => { Reflect.set(t, k, V)	reflectset-null", attempt(() => { Reflect.set(t, k, V)	reflectset-num", attempt(() => { Reflect.set(t, k, V)
reflectsetconst-obj", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-null", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-num", attempt(() => { Reflect.set(t, "__proto__", V)
define-obj", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-null", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-num", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
defineconst-obj", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-null", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-num", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })
assignparsed-obj", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-null", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-num", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
assigncomputed-obj", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-null", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-num", attempt(() => { Object.assign(t, { [k]: V })
assignconst-obj", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-null", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-num", attempt(() => { Object.assign(t, { ["__proto__"]: V })
setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)
lookupsetter-obj", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-null", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-num", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)
lookupsetterconst-obj", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-null", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-num", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)
compound-obj", attempt(() => { t[k] ||= V; t[k] &&= V	compound-null", attempt(() => { t[k] ||= V; t[k] &&= V	compound-num", attempt(() => { t[k] ||= V; t[k] &&= V
destructure-obj", attempt(() => { [t[k]] = [V]	destructure-null", attempt(() => { [t[k]] = [V]	destructure-num", attempt(() => { [t[k]] = [V]
destructureobj-obj", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-null", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-num", attempt(() => { ({ x: t[k] } = { x: V })
forin-obj", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-null", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-num", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V
loopkeys-obj", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-null", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-num", attempt(() => { for (const n of [key("q"), k]) t[n] = V
merge-obj", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-null", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-num", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
definegetter-obj", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-null", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-num", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0
entries-obj", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-null", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-num", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V
reflectdefine-obj", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-null", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-num", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
fromentries-obj", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-null", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-num", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))
spreadparsed-obj", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-null", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-num", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })
call-setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)`,
        (n, a, b, c) => `(() => {
let t2;
const base = { m() { return "base.m"; } };
const t = Object.create(base); t.a = 1;
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("${a}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const base = { m() { return "base.m"; } };
const t = Object.create(base); t.a = 1;
const V = null;
console.log("${b}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const base = { m() { return "base.m"; } };
const t = Object.create(base); t.a = 1;
const V = 5;
console.log("${c}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();`,
      ],
      ``,
    ),
    "proto-key-stored-on-an-object-without-prototype.js": text(
      `function key(s) { return JSON.parse('"' + s + '"'); }
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const k = key("__proto__");`,
      [
        `computed-obj", attempt(() => { t[k] = V	computed-null", attempt(() => { t[k] = V	computed-num", attempt(() => { t[k] = V
constkey-obj", attempt(() => { t["__proto__"] = V	constkey-null", attempt(() => { t["__proto__"] = V	constkey-num", attempt(() => { t["__proto__"] = V
dot-obj", attempt(() => { t.__proto__ = V	dot-null", attempt(() => { t.__proto__ = V	dot-num", attempt(() => { t.__proto__ = V
reflectset-obj", attempt(() => { Reflect.set(t, k, V)	reflectset-null", attempt(() => { Reflect.set(t, k, V)	reflectset-num", attempt(() => { Reflect.set(t, k, V)
reflectsetconst-obj", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-null", attempt(() => { Reflect.set(t, "__proto__", V)	reflectsetconst-num", attempt(() => { Reflect.set(t, "__proto__", V)
define-obj", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-null", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	define-num", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
defineconst-obj", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-null", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })	defineconst-num", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true })
assignparsed-obj", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-null", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	assignparsed-num", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
assigncomputed-obj", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-null", attempt(() => { Object.assign(t, { [k]: V })	assigncomputed-num", attempt(() => { Object.assign(t, { [k]: V })
assignconst-obj", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-null", attempt(() => { Object.assign(t, { ["__proto__"]: V })	assignconst-num", attempt(() => { Object.assign(t, { ["__proto__"]: V })
setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)	setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V)
lookupsetter-obj", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-null", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)	lookupsetter-num", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V)
lookupsetterconst-obj", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-null", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)	lookupsetterconst-num", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V)
compound-obj", attempt(() => { t[k] ||= V; t[k] &&= V	compound-null", attempt(() => { t[k] ||= V; t[k] &&= V	compound-num", attempt(() => { t[k] ||= V; t[k] &&= V
destructure-obj", attempt(() => { [t[k]] = [V]	destructure-null", attempt(() => { [t[k]] = [V]	destructure-num", attempt(() => { [t[k]] = [V]
destructureobj-obj", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-null", attempt(() => { ({ x: t[k] } = { x: V })	destructureobj-num", attempt(() => { ({ x: t[k] } = { x: V })
forin-obj", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-null", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V	forin-num", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V
loopkeys-obj", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-null", attempt(() => { for (const n of [key("q"), k]) t[n] = V	loopkeys-num", attempt(() => { for (const n of [key("q"), k]) t[n] = V
merge-obj", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-null", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))	merge-num", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}'))
definegetter-obj", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-null", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0	definegetter-num", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0
entries-obj", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-null", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V	entries-num", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V
reflectdefine-obj", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-null", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })	reflectdefine-num", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true })
fromentries-obj", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-null", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))	fromentries-num", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]]))
spreadparsed-obj", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-null", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })	spreadparsed-num", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') })
call-setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)	call-setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V)`,
        (n, a, b, c) => `(() => {
let t2;
const t = Object.create(null); t.a = 1;
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("${a}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = Object.create(null); t.a = 1;
const V = null;
console.log("${b}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = Object.create(null); t.a = 1;
const V = 5;
console.log("${c}; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();`,
      ],
      ``,
    ),
    "static-members-taken-out-of-an-unknown-constructor-change-their-operands.js": text(
      `function key(s) { return JSON.parse('"' + s + '"'); }
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const C = structuredClone({}).constructor;`,
      [
        `apply	((...a) => C.assign.apply(C, a))	apply	bound null	C.assign.bind(null)	bound-null
bound	C.assign.bind(C)	bound	bracket	C["assign"]	bracket
call	((...a) => C.assign.call(C, ...a))	call	closure	((...a) => C.assign(...a))	closure
comma	(0, C.assign)	comma	computed	C[key("assign")]	computed
conditional	(key("y") === "y" ? C.assign : () => 0)	conditional	created computed	Object.create(C)[key("assign")]	created-computed
created	Object.create(C).assign	created	descriptor computed	Object.getOwnPropertyDescriptor(C, key("assign")).value	descriptor-computed
descriptor	Object.getOwnPropertyDescriptor(C, "assign").value	descriptor	descriptors	Object.getOwnPropertyDescriptors(C).assign.value	descriptors
destructured	(({ assign: f }) => f)(C)	destructured	get prototype of instance	C.getPrototypeOf({}).constructor.assign	get-prototype-of-instance
identity of global computed	C(globalThis)[key("Object")][key("assign")]	identity-of-global-computed	identity of global	C(globalThis).Object.assign	identity-of-global
identity of object computed	C(Object)[key("assign")]	identity-of-object-computed	identity of object	C(Object).assign	identity-of-object
in array	[C.assign][0]	in-array	in map	new Map([["f", C.assign]]).get("f")	in-map
in object	({ f: C.assign }).f	in-object	known names loop	(() => { let f; for (const n of Object.getOwnPropertyNames(C)) if (n === "assign") f = C[n]; return f; })()	known-names-loop
literal proto	({ __proto__: C }).assign	literal-proto	logical	(C.nothing || C.assign)	logical
name	C.assign	name	names loop	(() => { let f; for (const n of C.getOwnPropertyNames(C)) if (n === "assign") f = C[n]; return f; })()	names-loop
optional	C?.assign	optional	own descriptor	C.getOwnPropertyDescriptor(C, "assign").value	own-descriptor
own descriptors computed	C.getOwnPropertyDescriptors(C)[key("assign")].value	own-descriptors-computed	prototype constructor	C.prototype.constructor.assign	prototype-constructor
proxy	new Proxy(C, {}).assign	proxy	reflect apply	((...a) => Reflect.apply(C.assign, C, a))	reflect-apply
reflect get computed	Reflect.get(C, key("assign"))	reflect-get-computed	reflect get	Reflect.get(C, "assign")	reflect-get
set prototype	Object.setPrototypeOf({}, C).assign	set-prototype	subclass super	(class X extends C { static get() { return super.assign; } }).get()	subclass-super
subclass	(class X extends C {}).assign	subclass	through identity	C(C.assign)	through-identity`,
        (n, a, b, c, d, e, f) => `
// assign ints ${a}
{
  const t = [1, 2, 3];
  const F = ${b};
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-${c}", s);
}

// assign ints ${d}
{
  const t = [1, 2, 3];
  const F = ${e};
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-${f}", s);
}`,
      ],
      [
        `apply	((...a) => C.defineProperty.apply(C, a))	apply	bound null	C.defineProperty.bind(null)	bound-null
bound	C.defineProperty.bind(C)	bound	bracket	C["defineProperty"]	bracket
call	((...a) => C.defineProperty.call(C, ...a))	call	closure	((...a) => C.defineProperty(...a))	closure
comma	(0, C.defineProperty)	comma	computed	C[key("defineProperty")]	computed
conditional	(key("y") === "y" ? C.defineProperty : () => 0)	conditional	created computed	Object.create(C)[key("defineProperty")]	created-computed
created	Object.create(C).defineProperty	created	descriptor computed	Object.getOwnPropertyDescriptor(C, key("defineProperty")).value	descriptor-computed
descriptor	Object.getOwnPropertyDescriptor(C, "defineProperty").value	descriptor	descriptors	Object.getOwnPropertyDescriptors(C).defineProperty.value	descriptors
destructured	(({ defineProperty: f }) => f)(C)	destructured	get prototype of instance	C.getPrototypeOf({}).constructor.defineProperty	get-prototype-of-instance
identity of global computed	C(globalThis)[key("Object")][key("defineProperty")]	identity-of-global-computed	identity of global	C(globalThis).Object.defineProperty	identity-of-global
identity of object computed	C(Object)[key("defineProperty")]	identity-of-object-computed	identity of object	C(Object).defineProperty	identity-of-object
in array	[C.defineProperty][0]	in-array	in map	new Map([["f", C.defineProperty]]).get("f")	in-map
in object	({ f: C.defineProperty }).f	in-object	known names loop	(() => { let f; for (const n of Object.getOwnPropertyNames(C)) if (n === "defineProperty") f = C[n]; return f; })()	known-names-loop
literal proto	({ __proto__: C }).defineProperty	literal-proto	logical	(C.nothing || C.defineProperty)	logical
name	C.defineProperty	name	names loop	(() => { let f; for (const n of C.getOwnPropertyNames(C)) if (n === "defineProperty") f = C[n]; return f; })()	names-loop
optional	C?.defineProperty	optional	own descriptor	C.getOwnPropertyDescriptor(C, "defineProperty").value	own-descriptor
own descriptors computed	C.getOwnPropertyDescriptors(C)[key("defineProperty")].value	own-descriptors-computed	prototype constructor	C.prototype.constructor.defineProperty	prototype-constructor
proxy	new Proxy(C, {}).defineProperty	proxy	reflect apply	((...a) => Reflect.apply(C.defineProperty, C, a))	reflect-apply
reflect get computed	Reflect.get(C, key("defineProperty"))	reflect-get-computed	reflect get	Reflect.get(C, "defineProperty")	reflect-get
set prototype	Object.setPrototypeOf({}, C).defineProperty	set-prototype	subclass super	(class X extends C { static get() { return super.defineProperty; } }).get()	subclass-super
subclass	(class X extends C {}).defineProperty	subclass	through identity	C(C.defineProperty)	through-identity`,
        (n, a, b, c, d, e, f) => `
// define plain ${a}
{
  const t = { a: 1, b: 2 };
  const F = ${b};
  F(t, "a", { value: "s" });
  console.log("define-plain-${c}", t.a + t.b, typeof t.a);
}

// define plain ${d}
{
  const t = { a: 1, b: 2 };
  const F = ${e};
  F(t, "a", { value: "s" });
  console.log("define-plain-${f}", t.a + t.b, typeof t.a);
}`,
      ],
      [
        `apply	((...a) => C.freeze.apply(C, a))	apply	bound null	C.freeze.bind(null)	bound-null
bound	C.freeze.bind(C)	bound	bracket	C["freeze"]	bracket
call	((...a) => C.freeze.call(C, ...a))	call	closure	((...a) => C.freeze(...a))	closure
comma	(0, C.freeze)	comma	computed	C[key("freeze")]	computed
conditional	(key("y") === "y" ? C.freeze : () => 0)	conditional	created computed	Object.create(C)[key("freeze")]	created-computed
created	Object.create(C).freeze	created	descriptor computed	Object.getOwnPropertyDescriptor(C, key("freeze")).value	descriptor-computed
descriptor	Object.getOwnPropertyDescriptor(C, "freeze").value	descriptor	descriptors	Object.getOwnPropertyDescriptors(C).freeze.value	descriptors
destructured	(({ freeze: f }) => f)(C)	destructured	get prototype of instance	C.getPrototypeOf({}).constructor.freeze	get-prototype-of-instance
identity of global computed	C(globalThis)[key("Object")][key("freeze")]	identity-of-global-computed	identity of global	C(globalThis).Object.freeze	identity-of-global
identity of object computed	C(Object)[key("freeze")]	identity-of-object-computed	identity of object	C(Object).freeze	identity-of-object
in array	[C.freeze][0]	in-array	in map	new Map([["f", C.freeze]]).get("f")	in-map
in object	({ f: C.freeze }).f	in-object	known names loop	(() => { let f; for (const n of Object.getOwnPropertyNames(C)) if (n === "freeze") f = C[n]; return f; })()	known-names-loop
literal proto	({ __proto__: C }).freeze	literal-proto	logical	(C.nothing || C.freeze)	logical
name	C.freeze	name	names loop	(() => { let f; for (const n of C.getOwnPropertyNames(C)) if (n === "freeze") f = C[n]; return f; })()	names-loop
optional	C?.freeze	optional	own descriptor	C.getOwnPropertyDescriptor(C, "freeze").value	own-descriptor
own descriptors computed	C.getOwnPropertyDescriptors(C)[key("freeze")].value	own-descriptors-computed	prototype constructor	C.prototype.constructor.freeze	prototype-constructor
proxy	new Proxy(C, {}).freeze	proxy	reflect apply	((...a) => Reflect.apply(C.freeze, C, a))	reflect-apply
reflect get computed	Reflect.get(C, key("freeze"))	reflect-get-computed	reflect get	Reflect.get(C, "freeze")	reflect-get
set prototype	Object.setPrototypeOf({}, C).freeze	set-prototype	subclass super	(class X extends C { static get() { return super.freeze; } }).get()	subclass-super
subclass	(class X extends C {}).freeze	subclass	through identity	C(C.freeze)	through-identity`,
        (n, a, b, c, d, e, f) => `
// freeze plain ${a}
{
  const t = { a: 1 };
  const F = ${b};
  F(t);
  console.log("freeze-plain-${c}", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain ${d}
{
  const t = { a: 1 };
  const F = ${e};
  F(t);
  console.log("freeze-plain-${f}", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}`,
      ],
      [
        `apply	((...a) => C.setPrototypeOf.apply(C, a))	apply	bound null	C.setPrototypeOf.bind(null)	bound-null
bound	C.setPrototypeOf.bind(C)	bound	bracket	C["setPrototypeOf"]	bracket
call	((...a) => C.setPrototypeOf.call(C, ...a))	call	closure	((...a) => C.setPrototypeOf(...a))	closure
comma	(0, C.setPrototypeOf)	comma	computed	C[key("setPrototypeOf")]	computed
conditional	(key("y") === "y" ? C.setPrototypeOf : () => 0)	conditional	created computed	Object.create(C)[key("setPrototypeOf")]	created-computed
created	Object.create(C).setPrototypeOf	created	descriptor computed	Object.getOwnPropertyDescriptor(C, key("setPrototypeOf")).value	descriptor-computed
descriptor	Object.getOwnPropertyDescriptor(C, "setPrototypeOf").value	descriptor	descriptors	Object.getOwnPropertyDescriptors(C).setPrototypeOf.value	descriptors
destructured	(({ setPrototypeOf: f }) => f)(C)	destructured	get prototype of instance	C.getPrototypeOf({}).constructor.setPrototypeOf	get-prototype-of-instance
identity of global computed	C(globalThis)[key("Object")][key("setPrototypeOf")]	identity-of-global-computed	identity of global	C(globalThis).Object.setPrototypeOf	identity-of-global
identity of object computed	C(Object)[key("setPrototypeOf")]	identity-of-object-computed	identity of object	C(Object).setPrototypeOf	identity-of-object
in array	[C.setPrototypeOf][0]	in-array	in map	new Map([["f", C.setPrototypeOf]]).get("f")	in-map
in object	({ f: C.setPrototypeOf }).f	in-object	known names loop	(() => { let f; for (const n of Object.getOwnPropertyNames(C)) if (n === "setPrototypeOf") f = C[n]; return f; })()	known-names-loop
literal proto	({ __proto__: C }).setPrototypeOf	literal-proto	logical	(C.nothing || C.setPrototypeOf)	logical
name	C.setPrototypeOf	name	names loop	(() => { let f; for (const n of C.getOwnPropertyNames(C)) if (n === "setPrototypeOf") f = C[n]; return f; })()	names-loop
optional	C?.setPrototypeOf	optional	own descriptor	C.getOwnPropertyDescriptor(C, "setPrototypeOf").value	own-descriptor
own descriptors computed	C.getOwnPropertyDescriptors(C)[key("setPrototypeOf")].value	own-descriptors-computed	prototype constructor	C.prototype.constructor.setPrototypeOf	prototype-constructor
proxy	new Proxy(C, {}).setPrototypeOf	proxy	reflect apply	((...a) => Reflect.apply(C.setPrototypeOf, C, a))	reflect-apply
reflect get computed	Reflect.get(C, key("setPrototypeOf"))	reflect-get-computed	reflect get	Reflect.get(C, "setPrototypeOf")	reflect-get
set prototype	Object.setPrototypeOf({}, C).setPrototypeOf	set-prototype	subclass super	(class X extends C { static get() { return super.setPrototypeOf; } }).get()	subclass-super
subclass	(class X extends C {}).setPrototypeOf	subclass	through identity	C(C.setPrototypeOf)	through-identity`,
        (n, a, b, c, d, e, f) => `
// setproto inst ${a}
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = ${b};
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-${c}", t.m(), t instanceof Q);
}

// setproto inst ${d}
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = ${e};
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-${f}", t.m(), t instanceof Q);
}`,
      ],
      ``,
    ),
    "what-lies-above-new-objects-is-changed-on-object-prototype.expected.txt": text(
      [
        `setter on Object.prototype	setter on Object.prototype, a computed key
setter for the number on Object.prototype, a computed key	setter on Object.prototype, the old way
read-only property on Object.prototype	read-only property on Object.prototype, a computed key
value on Object.prototype by a store	proxy above Object.prototype
setter on Object.prototype	setter on Object.prototype, a computed key
setter for the number on Object.prototype, a computed key	setter on Object.prototype, the old way
read-only property on Object.prototype	read-only property on Object.prototype, a computed key
value on Object.prototype by a store	proxy above Object.prototype`,
        (n, a, b) => `refused: TypeError
while it lies there: [object Object],2 true
a ${a} 4925: true object 1 string 2,4 true true false 0
refused: TypeError
while it lies there: [object Object],2 true
a ${b} 4925: true object 1 string 2,4 true true false 0`,
      ],
      ``,
    ),
    "what-lies-above-new-objects-is-changed-on-object-prototype.ts": text(
      `// The roads over Object.prototype, for a constructor function and for a class. An executable of --aot refuses them (built-in objects are locked), so its lines differ from plain Bun on purpose.
// What lies above the objects that a typed maker makes, or who holds them before they are filled, is changed on roads that the types do not show: each is spelled with the casts it needs.
// What lies above afterwards has a setter and a getter for \`pos\`, which the maker fills and its type declares: the objects made from then on have no \`pos\` of their own, and \`end\`, a number, may be missing too.
// Each road has a maker and typed readers of its own, so that nothing but that road decides what the readers may take for granted.
interface Tagged { tag: number; }
const kept: unknown[] = [];
const spy = {
  set pos(value: unknown) {
    kept.push(value);
  },
  get pos(): unknown {
    return "read";
  },
};
function takes(value: unknown) {
  kept.push(value);
}
function gives(): unknown {
  return "read";
}
function storeUnder(target: any, key: string, value: unknown) {
  target[key] = value;
}
const names = ["prototype", "__proto__", "pos", "end"];
function nameAt(index: number): string {
  return names[index % names.length];
}
function report(label: string, made: object, pos: unknown, end: unknown, isInstance: unknown, firstIsInstance: unknown) {
  console.log(label + ":", Object.hasOwn(made, "pos"), typeof pos, typeof pos === "object" && pos ? (pos as Tagged).tag : String(pos), typeof end, String(end), isInstance, firstIsInstance, Object.getPrototypeOf(made) === spy, kept.length);`,
      [
        `Object.defineProperty(Object.prototype, "pos", { set: takes, get: gives, configurable: true })	setter on Object.prototype
Object.defineProperty(Object.prototype, nameAt(2), { set: takes, get: gives, configurable: true })	setter on Object.prototype, a computed key
Object.defineProperty(Object.prototype, nameAt(3), { set: takes, get: gives, configurable: true })	setter for the number on Object.prototype, a computed key
(Object.prototype as any).__defineSetter__(nameAt(2), takes)	setter on Object.prototype, the old way
Object.defineProperty(Object.prototype, "pos", { value: "read", writable: false, configurable: true })	read-only property on Object.prototype
Object.defineProperty(Object.prototype, nameAt(2), { value: "read", writable: false, configurable: true })	read-only property on Object.prototype, a computed key
(Object.prototype as any).pos = "read"	value on Object.prototype by a store
Object.setPrototypeOf(Object.prototype, new Proxy({}, { set: () => true }))	proxy above Object.prototype`,
        (n, a, b) => `}
{
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  try { ${a}; } catch (error) { console.log("refused:", (error as Error).constructor.name); }
  const late: Made = (() => { const made = (() => { try { return new Made({ tag: 1 }, 2); } catch (error) { return { pos: (error as Error).constructor.name, end: 0 } as unknown as Made; } })(); const seen = [String(posOf(made)), String(endOf(made))].join(); console.log("while it lies there:", seen, Object.hasOwn(made, "pos")); delete (Object.prototype as any).pos; delete (Object.prototype as any).end; return made; })();
  report("a ${b} " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));`,
      ],
      [
        `Object.defineProperty(Object.prototype, "pos", { set: takes, get: gives, configurable: true })	setter on Object.prototype
Object.defineProperty(Object.prototype, nameAt(2), { set: takes, get: gives, configurable: true })	setter on Object.prototype, a computed key
Object.defineProperty(Object.prototype, nameAt(3), { set: takes, get: gives, configurable: true })	setter for the number on Object.prototype, a computed key
(Object.prototype as any).__defineSetter__(nameAt(2), takes)	setter on Object.prototype, the old way
Object.defineProperty(Object.prototype, "pos", { value: "read", writable: false, configurable: true })	read-only property on Object.prototype
Object.defineProperty(Object.prototype, nameAt(2), { value: "read", writable: false, configurable: true })	read-only property on Object.prototype, a computed key
(Object.prototype as any).pos = "read"	value on Object.prototype by a store
Object.setPrototypeOf(Object.prototype, new Proxy({}, { set: () => true }))	proxy above Object.prototype`,
        (n, a, b) => `}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  try { ${a}; } catch (error) { console.log("refused:", (error as Error).constructor.name); }
  const late: Made = (() => { const made = (() => { try { return new Made({ tag: 1 }, 2); } catch (error) { return { pos: (error as Error).constructor.name, end: 0 } as unknown as Made; } })(); const seen = [String(posOf(made)), String(endOf(made))].join(); console.log("while it lies there:", seen, Object.hasOwn(made, "pos")); delete (Object.prototype as any).pos; delete (Object.prototype as any).end; return made; })();
  report("a ${b} " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));`,
      ],
      `}
`,
    ),
    "a-field-at-two-offsets-in-classes-declared-far-apart.ts": text(
      `// Three names, each held by two kinds of classes whose cells are full: only two of the names can have one offset. The third is read through a union of 40 classes at two offsets.
// Every class is made in a loop, so that no cell may grow. The classes of the first family are declared far apart, among 1,320 other classes; those of the second side by side.
const sink: unknown[] = [];
class Bw { xw: number = 0.5; yw: number = 0.5; }
class Aw0 { xw: number = 0.5; zw: number = 0.5; }`,
      [33, n => `class F${n} { q: number = ${n}; } sink.push(new F${n}());`],
      `class Cw0 { yw: number = 0.5; zw: number = 0.25; }`,
      [33, n => `class F${n + 33} { q: number = ${n + 33}; } sink.push(new F${n + 33}());`],
      `class Aw1 { xw: number = 0.5; zw: number = 1.5; }`,
      [33, n => `class F${n + 66} { q: number = ${n + 66}; } sink.push(new F${n + 66}());`],
      `class Cw1 { yw: number = 0.5; zw: number = 1.25; }`,
      [33, n => `class F${n + 99} { q: number = ${n + 99}; } sink.push(new F${n + 99}());`],
      `class Aw2 { xw: number = 0.5; zw: number = 2.5; }`,
      [33, n => `class F${n + 132} { q: number = ${n + 132}; } sink.push(new F${n + 132}());`],
      `class Cw2 { yw: number = 0.5; zw: number = 2.25; }`,
      [33, n => `class F${n + 165} { q: number = ${n + 165}; } sink.push(new F${n + 165}());`],
      `class Aw3 { xw: number = 0.5; zw: number = 3.5; }`,
      [33, n => `class F${n + 198} { q: number = ${n + 198}; } sink.push(new F${n + 198}());`],
      `class Cw3 { yw: number = 0.5; zw: number = 3.25; }`,
      [33, n => `class F${n + 231} { q: number = ${n + 231}; } sink.push(new F${n + 231}());`],
      `class Aw4 { xw: number = 0.5; zw: number = 4.5; }`,
      [33, n => `class F${n + 264} { q: number = ${n + 264}; } sink.push(new F${n + 264}());`],
      `class Cw4 { yw: number = 0.5; zw: number = 4.25; }`,
      [33, n => `class F${n + 297} { q: number = ${n + 297}; } sink.push(new F${n + 297}());`],
      `class Aw5 { xw: number = 0.5; zw: number = 5.5; }`,
      [33, n => `class F${n + 330} { q: number = ${n + 330}; } sink.push(new F${n + 330}());`],
      `class Cw5 { yw: number = 0.5; zw: number = 5.25; }`,
      [33, n => `class F${n + 363} { q: number = ${n + 363}; } sink.push(new F${n + 363}());`],
      `class Aw6 { xw: number = 0.5; zw: number = 6.5; }`,
      [33, n => `class F${n + 396} { q: number = ${n + 396}; } sink.push(new F${n + 396}());`],
      `class Cw6 { yw: number = 0.5; zw: number = 6.25; }`,
      [33, n => `class F${n + 429} { q: number = ${n + 429}; } sink.push(new F${n + 429}());`],
      `class Aw7 { xw: number = 0.5; zw: number = 7.5; }`,
      [33, n => `class F${n + 462} { q: number = ${n + 462}; } sink.push(new F${n + 462}());`],
      `class Cw7 { yw: number = 0.5; zw: number = 7.25; }`,
      [33, n => `class F${n + 495} { q: number = ${n + 495}; } sink.push(new F${n + 495}());`],
      `class Aw8 { xw: number = 0.5; zw: number = 8.5; }`,
      [33, n => `class F${n + 528} { q: number = ${n + 528}; } sink.push(new F${n + 528}());`],
      `class Cw8 { yw: number = 0.5; zw: number = 8.25; }`,
      [33, n => `class F${n + 561} { q: number = ${n + 561}; } sink.push(new F${n + 561}());`],
      `class Aw9 { xw: number = 0.5; zw: number = 9.5; }`,
      [33, n => `class F${n + 594} { q: number = ${n + 594}; } sink.push(new F${n + 594}());`],
      `class Cw9 { yw: number = 0.5; zw: number = 9.25; }`,
      [33, n => `class F${n + 627} { q: number = ${n + 627}; } sink.push(new F${n + 627}());`],
      `class Aw10 { xw: number = 0.5; zw: number = 10.5; }`,
      [33, n => `class F${n + 660} { q: number = ${n + 660}; } sink.push(new F${n + 660}());`],
      `class Cw10 { yw: number = 0.5; zw: number = 10.25; }`,
      [33, n => `class F${n + 693} { q: number = ${n + 693}; } sink.push(new F${n + 693}());`],
      `class Aw11 { xw: number = 0.5; zw: number = 11.5; }`,
      [33, n => `class F${n + 726} { q: number = ${n + 726}; } sink.push(new F${n + 726}());`],
      `class Cw11 { yw: number = 0.5; zw: number = 11.25; }`,
      [33, n => `class F${n + 759} { q: number = ${n + 759}; } sink.push(new F${n + 759}());`],
      `class Aw12 { xw: number = 0.5; zw: number = 12.5; }`,
      [33, n => `class F${n + 792} { q: number = ${n + 792}; } sink.push(new F${n + 792}());`],
      `class Cw12 { yw: number = 0.5; zw: number = 12.25; }`,
      [33, n => `class F${n + 825} { q: number = ${n + 825}; } sink.push(new F${n + 825}());`],
      `class Aw13 { xw: number = 0.5; zw: number = 13.5; }`,
      [33, n => `class F${n + 858} { q: number = ${n + 858}; } sink.push(new F${n + 858}());`],
      `class Cw13 { yw: number = 0.5; zw: number = 13.25; }`,
      [33, n => `class F${n + 891} { q: number = ${n + 891}; } sink.push(new F${n + 891}());`],
      `class Aw14 { xw: number = 0.5; zw: number = 14.5; }`,
      [33, n => `class F${n + 924} { q: number = ${n + 924}; } sink.push(new F${n + 924}());`],
      `class Cw14 { yw: number = 0.5; zw: number = 14.25; }`,
      [33, n => `class F${n + 957} { q: number = ${n + 957}; } sink.push(new F${n + 957}());`],
      `class Aw15 { xw: number = 0.5; zw: number = 15.5; }`,
      [33, n => `class F${n + 990} { q: number = ${n + 990}; } sink.push(new F${n + 990}());`],
      `class Cw15 { yw: number = 0.5; zw: number = 15.25; }`,
      [33, n => `class F${n + 1023} { q: number = ${n + 1023}; } sink.push(new F${n + 1023}());`],
      `class Aw16 { xw: number = 0.5; zw: number = 16.5; }`,
      [33, n => `class F${n + 1056} { q: number = ${n + 1056}; } sink.push(new F${n + 1056}());`],
      `class Cw16 { yw: number = 0.5; zw: number = 16.25; }`,
      [33, n => `class F${n + 1089} { q: number = ${n + 1089}; } sink.push(new F${n + 1089}());`],
      `class Aw17 { xw: number = 0.5; zw: number = 17.5; }`,
      [33, n => `class F${n + 1122} { q: number = ${n + 1122}; } sink.push(new F${n + 1122}());`],
      `class Cw17 { yw: number = 0.5; zw: number = 17.25; }`,
      [33, n => `class F${n + 1155} { q: number = ${n + 1155}; } sink.push(new F${n + 1155}());`],
      `class Aw18 { xw: number = 0.5; zw: number = 18.5; }`,
      [33, n => `class F${n + 1188} { q: number = ${n + 1188}; } sink.push(new F${n + 1188}());`],
      `class Cw18 { yw: number = 0.5; zw: number = 18.25; }`,
      [33, n => `class F${n + 1221} { q: number = ${n + 1221}; } sink.push(new F${n + 1221}());`],
      `class Aw19 { xw: number = 0.5; zw: number = 19.5; }`,
      [33, n => `class F${n + 1254} { q: number = ${n + 1254}; } sink.push(new F${n + 1254}());`],
      `class Cw19 { yw: number = 0.5; zw: number = 19.25; }`,
      [33, n => `class F${n + 1287} { q: number = ${n + 1287}; } sink.push(new F${n + 1287}());`],
      `let xsw: (Aw0 | Aw1 | Aw2 | Aw3 | Aw4 | Aw5 | Aw6 | Aw7 | Aw8 | Aw9 | Aw10 | Aw11 | Aw12 | Aw13 | Aw14 | Aw15 | Aw16 | Aw17 | Aw18 | Aw19 | Bw)[] = [];
let ysw: (Cw0 | Cw1 | Cw2 | Cw3 | Cw4 | Cw5 | Cw6 | Cw7 | Cw8 | Cw9 | Cw10 | Cw11 | Cw12 | Cw13 | Cw14 | Cw15 | Cw16 | Cw17 | Cw18 | Cw19 | Bw)[] = [];
let zsw: (Aw0 | Cw0 | Aw1 | Cw1 | Aw2 | Cw2 | Aw3 | Cw3 | Aw4 | Cw4 | Aw5 | Cw5 | Aw6 | Cw6 | Aw7 | Cw7 | Aw8 | Cw8 | Aw9 | Cw9 | Aw10 | Cw10 | Aw11 | Cw11 | Aw12 | Cw12 | Aw13 | Cw13 | Aw14 | Cw14 | Aw15 | Cw15 | Aw16 | Cw16 | Aw17 | Cw17 | Aw18 | Cw18 | Aw19 | Cw19)[] = [];

function fillw(): void {
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 3; c++) {
    xsw = [new Aw0(), new Aw1(), new Aw2(), new Aw3(), new Aw4(), new Aw5(), new Aw6(), new Aw7(), new Aw8(), new Aw9(), new Aw10(), new Aw11(), new Aw12(), new Aw13(), new Aw14(), new Aw15(), new Aw16(), new Aw17(), new Aw18(), new Aw19(), new Bw()];
    ysw = [new Cw0(), new Cw1(), new Cw2(), new Cw3(), new Cw4(), new Cw5(), new Cw6(), new Cw7(), new Cw8(), new Cw9(), new Cw10(), new Cw11(), new Cw12(), new Cw13(), new Cw14(), new Cw15(), new Cw16(), new Cw17(), new Cw18(), new Cw19(), new Bw()];
    zsw = [new Aw0(), new Cw0(), new Aw1(), new Cw1(), new Aw2(), new Cw2(), new Aw3(), new Cw3(), new Aw4(), new Cw4(), new Aw5(), new Cw5(), new Aw6(), new Cw6(), new Aw7(), new Cw7(), new Aw8(), new Cw8(), new Aw9(), new Cw9(), new Aw10(), new Cw10(), new Aw11(), new Cw11(), new Aw12(), new Cw12(), new Aw13(), new Cw13(), new Aw14(), new Cw14(), new Aw15(), new Cw15(), new Aw16(), new Cw16(), new Aw17(), new Cw17(), new Aw18(), new Cw18(), new Aw19(), new Cw19()];
  }
}
function heavyw(): number {
  let sum = 0;
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 3; c++) for (let d = 0; d < 3; d++) for (let i = 0; i < xsw.length; i++) sum += xsw[i].xw + xsw[i].xw * 2;
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 3; c++) for (let i = 0; i < ysw.length; i++) sum += ysw[i].yw;
  return sum;
}
function sumw(turns: number): number {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += zsw[i % 40].zw;
  return sum;
}
class Bn { xn: number = 0.5; yn: number = 0.5; }`,
      [
        20,
        n => `class An${n} { xn: number = 0.5; zn: number = ${n}.5; }
class Cn${n} { yn: number = 0.5; zn: number = ${n}.25; }`,
      ],
      `let xsn: (An0 | An1 | An2 | An3 | An4 | An5 | An6 | An7 | An8 | An9 | An10 | An11 | An12 | An13 | An14 | An15 | An16 | An17 | An18 | An19 | Bn)[] = [];
let ysn: (Cn0 | Cn1 | Cn2 | Cn3 | Cn4 | Cn5 | Cn6 | Cn7 | Cn8 | Cn9 | Cn10 | Cn11 | Cn12 | Cn13 | Cn14 | Cn15 | Cn16 | Cn17 | Cn18 | Cn19 | Bn)[] = [];
let zsn: (An0 | Cn0 | An1 | Cn1 | An2 | Cn2 | An3 | Cn3 | An4 | Cn4 | An5 | Cn5 | An6 | Cn6 | An7 | Cn7 | An8 | Cn8 | An9 | Cn9 | An10 | Cn10 | An11 | Cn11 | An12 | Cn12 | An13 | Cn13 | An14 | Cn14 | An15 | Cn15 | An16 | Cn16 | An17 | Cn17 | An18 | Cn18 | An19 | Cn19)[] = [];

function filln(): void {
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 3; c++) {
    xsn = [new An0(), new An1(), new An2(), new An3(), new An4(), new An5(), new An6(), new An7(), new An8(), new An9(), new An10(), new An11(), new An12(), new An13(), new An14(), new An15(), new An16(), new An17(), new An18(), new An19(), new Bn()];
    ysn = [new Cn0(), new Cn1(), new Cn2(), new Cn3(), new Cn4(), new Cn5(), new Cn6(), new Cn7(), new Cn8(), new Cn9(), new Cn10(), new Cn11(), new Cn12(), new Cn13(), new Cn14(), new Cn15(), new Cn16(), new Cn17(), new Cn18(), new Cn19(), new Bn()];
    zsn = [new An0(), new Cn0(), new An1(), new Cn1(), new An2(), new Cn2(), new An3(), new Cn3(), new An4(), new Cn4(), new An5(), new Cn5(), new An6(), new Cn6(), new An7(), new Cn7(), new An8(), new Cn8(), new An9(), new Cn9(), new An10(), new Cn10(), new An11(), new Cn11(), new An12(), new Cn12(), new An13(), new Cn13(), new An14(), new Cn14(), new An15(), new Cn15(), new An16(), new Cn16(), new An17(), new Cn17(), new An18(), new Cn18(), new An19(), new Cn19()];
  }
}
function heavyn(): number {
  let sum = 0;
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 3; c++) for (let d = 0; d < 3; d++) for (let i = 0; i < xsn.length; i++) sum += xsn[i].xn + xsn[i].xn * 2;
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 3; c++) for (let i = 0; i < ysn.length; i++) sum += ysn[i].yn;
  return sum;
}
function sumn(turns: number): number {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += zsn[i % 40].zn;
  return sum;
}

const part = process.env.PART ?? "all";
const turns = Number(process.env.TURNS ?? 1000000);
fillw(); filln();
console.log(heavyw(), heavyn(), sink.length);
if (part === "wide" || part === "all") console.log("wide", sumw(turns));
if (part === "narrow" || part === "all") console.log("narrow", sumn(turns));

`,
    ),
    "variables-of-three-hundred-scopes-are-stored-to-by-the-innermost-function.js": text(
      `// 300 functions nested in one another, each with a variable of its own that the innermost function stores to. A closure has room for 255 captures, so the innermost
// functions get the scopes around them in one object: a scope that is held by another. Each function reads its variable again behind the call that changed it.
const seen = [];`,
      [
        301,
        n => `function m${n}() {
let v${n} = ${n};`,
      ],
      `v0++;v1++;v2++;v3++;v4++;v5++;v6++;v7++;v8++;v9++;v10++;v11++;v12++;v13++;v14++;v15++;v16++;v17++;v18++;v19++;v20++;v21++;v22++;v23++;v24++;v25++;v26++;v27++;v28++;v29++;v30++;v31++;v32++;v33++;v34++;v35++;v36++;v37++;v38++;v39++;v40++;v41++;v42++;v43++;v44++;v45++;v46++;v47++;v48++;v49++;v50++;v51++;v52++;v53++;v54++;v55++;v56++;v57++;v58++;v59++;v60++;v61++;v62++;v63++;v64++;v65++;v66++;v67++;v68++;v69++;v70++;v71++;v72++;v73++;v74++;v75++;v76++;v77++;v78++;v79++;v80++;v81++;v82++;v83++;v84++;v85++;v86++;v87++;v88++;v89++;v90++;v91++;v92++;v93++;v94++;v95++;v96++;v97++;v98++;v99++;v100++;v101++;v102++;v103++;v104++;v105++;v106++;v107++;v108++;v109++;v110++;v111++;v112++;v113++;v114++;v115++;v116++;v117++;v118++;v119++;v120++;v121++;v122++;v123++;v124++;v125++;v126++;v127++;v128++;v129++;v130++;v131++;v132++;v133++;v134++;v135++;v136++;v137++;v138++;v139++;v140++;v141++;v142++;v143++;v144++;v145++;v146++;v147++;v148++;v149++;v150++;v151++;v152++;v153++;v154++;v155++;v156++;v157++;v158++;v159++;v160++;v161++;v162++;v163++;v164++;v165++;v166++;v167++;v168++;v169++;v170++;v171++;v172++;v173++;v174++;v175++;v176++;v177++;v178++;v179++;v180++;v181++;v182++;v183++;v184++;v185++;v186++;v187++;v188++;v189++;v190++;v191++;v192++;v193++;v194++;v195++;v196++;v197++;v198++;v199++;v200++;v201++;v202++;v203++;v204++;v205++;v206++;v207++;v208++;v209++;v210++;v211++;v212++;v213++;v214++;v215++;v216++;v217++;v218++;v219++;v220++;v221++;v222++;v223++;v224++;v225++;v226++;v227++;v228++;v229++;v230++;v231++;v232++;v233++;v234++;v235++;v236++;v237++;v238++;v239++;v240++;v241++;v242++;v243++;v244++;v245++;v246++;v247++;v248++;v249++;v250++;v251++;v252++;v253++;v254++;v255++;v256++;v257++;v258++;v259++;v260++;v261++;v262++;v263++;v264++;v265++;v266++;v267++;v268++;v269++;v270++;v271++;v272++;v273++;v274++;v275++;v276++;v277++;v278++;v279++;v280++;v281++;v282++;v283++;v284++;v285++;v286++;v287++;v288++;v289++;v290++;v291++;v292++;v293++;v294++;v295++;v296++;v297++;v298++;v299++;v300++;
return 0;`,
      [
        300,
        n => `}
m${300 - n}(); seen.push(v${299 - n} - ${299 - n});`,
      ],
      `}
m0();
const stale = [];
seen.reverse().forEach((difference, level) => { if (difference !== 1) stale.push(level + ":" + difference); });
console.log(seen.length, stale.length, stale.join(" "));
`,
    ),
  });
