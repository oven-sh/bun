function key(s) { return JSON.parse('"' + s + '"'); }
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const k = key("__proto__");
const p = { m() { return "p.m"; }, c: "inherited" };
function look(t) { return [attempt(() => t.m()), attempt(() => t.c), Object.getPrototypeOf(t) === p, Object.getPrototypeOf(t) === Object.prototype, Object.getOwnPropertyNames(t).join(), attempt(() => typeof t.__proto__), attempt(() => typeof t[k])].join(" "); }

// array turned inherits index
(() => {
  const t = [1, , 3];
  t[k] = { 1: "hole" };
  console.log("array-turned-inherits-index", t[1], attempt(() => { let s = ""; for (let i = 0; i < t.length; i++) s += t[i]; return s; }));
  console.log("array-turned-inherits-index", look(t));
})();

// array turned loses methods
(() => {
  const t = [1, 2, 3];
  t[k] = p;
  console.log("array-turned-loses-methods", attempt(() => t.push(4)), t.length, Array.isArray(t), attempt(() => { let s = 0; for (const x of t) s += x; return s; }));
  console.log("array-turned-loses-methods", look(t));
})();

// chain of two
(() => {
  const mid = { c2: "mid" };
  const t = { a: 1 };
  t[k] = mid; mid[k] = p;
  console.log("chain-of-two", t.c2);
  console.log("chain-of-two", look(t));
})();

// class accessor
(() => {
  class Q { get __proto__() { return p; } set __proto__(v) {} }
  const t = new Q(); t.__proto__ = null; t[k] = null;
  console.log("class-accessor", look(t));
})();

// class field computed
(() => {
  class Q { [k] = p; a = 1; }
  const t = new Q();
  console.log("class-field-computed", look(t));
})();

// class field
(() => {
  class Q { __proto__ = p; a = 1; }
  const t = new Q();
  console.log("class-field", look(t));
})();

// class method
(() => {
  class Q { __proto__() { return 1; } }
  const t = new Q();
  console.log("class-method", look(t));
})();

// class static field
(() => {
  class t { static __proto__ = p; }
  console.log("class-static-field", look(t));
})();

// define getter under key
(() => {
  const t = { a: 1 };
  t.__defineGetter__(k, () => p);
  console.log("define-getter-under-key", look(t));
})();

// destructuring default
(() => {
  const { [k]: got = "default" } = { a: 1 };
  const t = { a: typeof got };
  console.log("destructuring-default", got === Object.prototype);
  console.log("destructuring-default", look(t));
})();

// destructuring rest
(() => {
  const { a, ...t } = { a: 1, ["__proto__"]: p, b: 2 };
  console.log("destructuring-rest", look(t));
})();

// destructuring target
(() => {
  const t = { a: 1 };
  ({ x: t[k] } = { x: p });
  console.log("destructuring-target", look(t));
})();

// from entries
(() => {
  const t = Object.fromEntries([[k, p], ["a", 1]]);
  console.log("from-entries", look(t));
})();

// function turned
(() => {
  const t = function () { return 1; };
  t[k] = p;
  console.log("function-turned", attempt(() => t.call(null)), t(), typeof t.bind);
  console.log("function-turned", look(t));
})();

// instanceof after
(() => {
  class Q {}
  const t = new Q();
  console.log("instanceof-after", t instanceof Q);
  t[k] = p;
  console.log("instanceof-after", t instanceof Q, Q.prototype.isPrototypeOf(t));
  console.log("instanceof-after", look(t));
})();

// key concatenated
(() => {
  const t = { a: 1 };
  t["__pro" + key("to__")] = p;
  console.log("key-concatenated", look(t));
})();

// key is symbol or number
(() => {
  const t = { a: 1 };
  for (const n of [0, Symbol("s"), k]) t[n] = p;
  console.log("key-is-symbol-or-number", look(t));
})();

// key object converted
(() => {
  const t = { a: 1 };
  t[{ toString() { return "__proto__"; } }] = p;
  console.log("key-object-converted", look(t));
})();

// key template
(() => {
  const t = { a: 1 };
  t[`__${key("proto")}__`] = p;
  console.log("key-template", look(t));
})();

// literal colon then computed
(() => {
  const t = { __proto__: p, ["__proto__"]: 5 };
  console.log("literal-colon-then-computed", look(t));
})();

// literal colon
(() => {
  const t = { __proto__: p, a: 1 };
  console.log("literal-colon", look(t));
})();

// literal computed constant
(() => {
  const t = { ["__proto__"]: p, a: 1 };
  console.log("literal-computed-constant", look(t));
})();

// literal computed unknown
(() => {
  const t = { [k]: p, a: 1 };
  console.log("literal-computed-unknown", look(t));
})();

// literal getter
(() => {
  const t = { get __proto__() { return p; }, a: 1 };
  console.log("literal-getter", look(t));
})();

// literal method
(() => {
  const t = { __proto__() { return 1; }, a: 1 };
  console.log("literal-method", look(t));
})();

// literal null
(() => {
  const t = { __proto__: null, a: 1 };
  console.log("literal-null", look(t));
})();

// literal number
(() => {
  const t = { __proto__: 5, a: 1 };
  console.log("literal-number", look(t));
})();

// literal quoted
(() => {
  const t = { "__proto__": p, a: 1 };
  console.log("literal-quoted", look(t));
})();

// literal setter
(() => {
  let seen;
  const t = { set __proto__(v) { seen = v; }, a: 1 };
  t.__proto__ = p; t[k] = p;
  console.log("literal-setter", look(t));
})();

// literal spread own proto
(() => {
  const t = { ...{ ["__proto__"]: p }, a: 1 };
  console.log("literal-spread-own-proto", look(t));
})();

// literal spread parsed
(() => {
  const t = { ...JSON.parse('{"__proto__": {"c": "parsed"}}'), a: 1 };
  console.log("literal-spread-parsed", look(t));
})();

// literal unknown object value
(() => {
  const t = { __proto__: JSON.parse('{"c":"parsed"}'), a: 1 };
  console.log("literal-unknown-object-value", look(t));
})();

// literal unknown value
(() => {
  const t = { __proto__: JSON.parse("null"), a: 1 };
  console.log("literal-unknown-value", look(t));
})();

// loop over instances
(() => {
  class Q { constructor(n) { this.n = n; } m() { return "Q.m" + this.n; } }
  const list = [new Q(0), new Q(1), new Q(2)];
  list[1][k] = p;
  let s = ""; for (const o of list) s += o.m() + " ";
  console.log("loop-over-instances", s);
  const t = list[1];
  console.log("loop-over-instances", look(t));
})();

// null prototype own property
(() => {
  const t = Object.create(null);
  t[k] = p;
  console.log("null-prototype-own-property", Object.getPrototypeOf(t) === null, t[k] === p, k in t, Object.keys(t).join(), delete t[k], k in t);
  console.log("null-prototype-own-property", look(t));
})();

// parameter default
(() => {
  function f({ __proto__: got = "default" } = {}) { return got; }
  const t = { a: 1 };
  console.log("parameter-default", f() === Object.prototype, f({ ["__proto__"]: 5 }));
  console.log("parameter-default", look(t));
})();

// parsed reviver
(() => {
  const t = JSON.parse('{"__proto__": {"c": "parsed"}, "a": 1}', (n, v) => v);
  console.log("parsed-reviver", look(t));
})();

// parsed
(() => {
  const t = JSON.parse('{"__proto__": {"c": "parsed"}, "a": 1}');
  console.log("parsed", look(t));
})();

// primitive receiver
(() => {
  const t = { a: 1 };
  console.log("primitive-receiver", attempt(() => { "use strict"; const s = "str"; s[k] = p; return "stored"; }), (5)[k] === Number.prototype, "s"[k] === String.prototype);
  console.log("primitive-receiver", look(t));
})();

// private members stay
(() => {
  class Q { #x = 1; get() { return this.#x; } static has(o) { return #x in o; } }
  const t = new Q();
  const get = t.get;
  t[k] = p;
  console.log("private-members-stay", Q.has(t), get.call(t), attempt(() => t.get()));
  console.log("private-members-stay", look(t));
})();

// prototype of class turned
(() => {
  class Q { m() { return "Q.m"; } }
  const i = new Q();
  Q.prototype[k] = p;
  console.log("prototype-of-class-turned", i.m(), i.c, i instanceof Q);
  const t = Q.prototype;
  console.log("prototype-of-class-turned", look(t));
})();

// read only
(() => {
  const t = { a: 1 };
  console.log("read-only", t[k] === Object.prototype, k in t, Object.prototype.hasOwnProperty.call(t, k), delete t[k], t[k] === Object.prototype);
  console.log("read-only", look(t));
})();

// same site some turned
(() => {
  function make(n) { return { n, m() { return "own" + n; } }; }
  const list = [make(0), make(1)];
  list[0][k] = p;
  console.log("same-site-some-turned", list[0].c, list[1].c);
  const t = list[0];
  console.log("same-site-some-turned", look(t));
})();

// this in constructor computed
(() => {
  class Q { constructor() { this.a = 1; this[k] = p; this.b = 2; } m() { return "Q.m"; } }
  const t = new Q();
  console.log("this-in-constructor-computed", look(t));
})();

// this in constructor dot
(() => {
  class Q { constructor() { this.a = 1; this.__proto__ = p; this.b = 2; } m() { return "Q.m"; } }
  const t = new Q();
  console.log("this-in-constructor-dot", look(t));
})();

// this in derived constructor
(() => {
  class B0 { m() { return "B0.m"; } }
  class Q extends B0 { constructor() { super(); this[k] = p; } n() { return super.m(); } }
  const t = new Q();
  console.log("this-in-derived-constructor", attempt(() => t.n()));
  console.log("this-in-derived-constructor", look(t));
})();

// this in function constructor
(() => {
  function F() { this.a = 1; this[k] = p; }
  F.prototype.m = function () { return "F.m"; };
  const t = new F();
  console.log("this-in-function-constructor", look(t));
})();

// this in method
(() => {
  class Q { m() { return "Q.m"; } turn() { this[k] = p; return this.m(); } }
  const t = new Q();
  console.log("this-in-method", t.m(), t.turn());
  console.log("this-in-method", look(t));
})();

// turned back
(() => {
  class Q { m() { return "Q.m"; } }
  const t = new Q();
  t[k] = p; console.log("turned-back", t.m());
  t[k] = Q.prototype; console.log("turned-back", t.m(), t instanceof Q);
  console.log("turned-back", look(t));
})();

// with inlined getter
(() => {
  class Q { get g() { return "Q.g"; } }
  const t = new Q();
  console.log("with-inlined-getter", t.g);
  t[k] = { get g() { return "other.g"; }, m() { return "x"; } };
  console.log("with-inlined-getter", t.g);
  console.log("with-inlined-getter", look(t));
})();
