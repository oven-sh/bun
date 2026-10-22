function key(s) { return JSON.parse('"' + s + '"'); }
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const C = structuredClone({}).constructor;

// array from operand
{
  const v = { a: 1 };
  const list = [v];
  const u = C([]).constructor.from(list); u[0].a = "s";
  console.log("array-from-operand", v.a + 1);
}

// array of operand
{
  const v = { a: 1 };
  const u = new (C([]).constructor)(v, v); u[1].a = "s";
  console.log("array-of-operand", v.a + 1);
}

// bound constructor
{
  class Q { constructor(a, b) { this.a = a; this.b = b; } sum() { return this.a + this.b; } }
  const B = Q.bind(null, 1);
  const u = new (C(B))("s");
  console.log("bound-constructor", u.sum(), new B(2).sum());
}

// buffer resize
{
  const b = new ArrayBuffer(4, { maxByteLength: 8 });
  const t = new Uint8Array(b); t[0] = 1;
  C(b).resize(1);
  console.log("buffer-resize", t.length, t[3]);
}

// buffer transfer detaches
{
  const t = new Uint8Array(4); t[0] = 1;
  attempt(() => C(t.buffer).transfer());
  console.log("buffer-transfer-detaches", t.length, t[0], t.byteLength);
}

// compiled class no arguments
{
  class Q { constructor(a) { this.a = a; } get() { return this.a + 1; } }
  const q = new Q(1);
  const u = new (C(q).constructor)();
  console.log("compiled-class-no-arguments", u.get(), q.get());
}

// compiled class static state
{
  class Q { static made = 0; constructor() { Q.made++; } }
  const q = new Q();
  new (C(q).constructor)();
  console.log("compiled-class-static-state", Q.made);
}

// compiled class
{
  class Q { constructor(a) { this.a = a; } get() { return this.a + 1; } }
  const q = new Q(1);
  const u = new (C(q).constructor)("s");
  console.log("compiled-class", u.get(), q.get(), u instanceof Q);
}

// compiled function constructor
{
  function F0(a) { this.a = a; }
  F0.prototype.get = function () { return this.a + 1; };
  const f = new F0(1);
  const u = new (C(f).constructor)("s");
  console.log("compiled-function-constructor", u.get(), f.get());
}

// compiled subclass new target
{
  class Q { constructor() { this.kind = new.target.name; } }
  class R extends Q {}
  const r = new R();
  const u = new (C(r).constructor)();
  console.log("compiled-subclass-new-target", u.kind, u instanceof R);
}

// data view over buffer
{
  const t = new Uint8Array(4); t[0] = 1;
  const u = new (C(new DataView(new ArrayBuffer(1))).constructor)(t.buffer); u.setUint8(0, 7);
  console.log("data-view-over-buffer", t[0] + 1);
}

// date converts operand
{
  let n = 1;
  const v = { valueOf() { n = "s"; return 0; } };
  new (C(new Date(0)).constructor)(v);
  console.log("date-converts-operand", n + 1);
}

// error cause
{
  const v = { a: 1 };
  const u = new (C(new Error()).constructor)("m", { cause: v }); u.cause.a = "s";
  console.log("error-cause", v.a + 1);
}

// float over int buffer
{
  const t = new Int32Array(2); t[0] = 1; t[1] = 1;
  const u = new Float64Array(t.buffer); u[0] = 1.5;
  console.log("float-over-int-buffer", t[0] + 1, t[1] + 1);
}

// known proxy as prototype
{
  const t = { a: 1, b: 2 };
  const u = Object.create(new Proxy({}, { set(o, k, v, r) { t.a = v; return true; } })); u.zzz = "s";
  console.log("known-proxy-as-prototype", t.a + t.b);
}

// known proxy computed store
{
  const t = { a: 1, b: 2 };
  const u = new Proxy(t, {}); u[key("a")] = "s";
  console.log("known-proxy-computed-store", t.a + t.b);
}

// known proxy reflect in trap
{
  const t = { a: 1, b: 2 };
  const u = new Proxy({}, { set(o, k, v) { t[k] = v; return true; } }); u.a = "s";
  console.log("known-proxy-reflect-in-trap", t.a + t.b);
}

// known proxy store
{
  const t = { a: 1, b: 2 };
  const u = new Proxy(t, {}); u.a = "s";
  console.log("known-proxy-store", t.a + t.b);
}

// map from iterable
{
  const v = { a: 1 };
  const pairs = [["k", v]];
  const u = new (C(new Map()).constructor)(pairs); u.get("k").a = "s";
  console.log("map-from-iterable", v.a + 1, pairs.length);
}

// object called returns operand
{
  const t = [1, 2, 3];
  const u = C(t); u[0] = "s";
  console.log("object-called-returns-operand", t[0] + 1);
}

// object returns operand
{
  const t = { a: 1, b: 2 };
  const u = new C(t); u.a = "s";
  console.log("object-returns-operand", t.a + t.b, u === t);
}

// promise executor
{
  let n = 1;
  new (C(Promise.resolve()).constructor)(() => { n = "s"; });
  console.log("promise-executor", n + 1);
}

// proxy array push
{
  const t = [1, 2, 3];
  const u = new (C(Proxy))(t, {}); u.push("s");
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("proxy-array-push", s);
}

// proxy define
{
  const t = { a: 1, b: 2 };
  const u = new (C(Proxy))(t, {}); Object.defineProperty(u, "a", { get() { return "g"; } });
  console.log("proxy-define", t.a + t.b);
}

// proxy delete
{
  const t = { a: 1, b: 2 };
  const u = new (C(Proxy))(t, {}); delete u.a;
  console.log("proxy-delete", t.a + t.b, "a" in t);
}

// proxy freeze
{
  const t = { a: 1 };
  const u = new (C(Proxy))(t, {}); Object.freeze(u);
  console.log("proxy-freeze", attempt(() => { t.a = 7; return t.a; }));
}

// proxy set prototype
{
  class Q { m() { return "Q.m"; } }
  const t = new Q();
  const u = new (C(Proxy))(t, {}); Object.setPrototypeOf(u, { m() { return "other.m"; } });
  console.log("proxy-set-prototype", t.m());
}

// proxy store
{
  const t = { a: 1, b: 2 };
  const u = new (C(Proxy))(t, {}); u.a = "s";
  console.log("proxy-store", t.a + t.b);
}

// reflect construct unknown new target
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  class Z { m() { return "Z.m"; } }
  const u = Reflect.construct(Q, [], C(Z));
  console.log("reflect-construct-unknown-new-target", u.m(), u.a, u instanceof Q, new Q().m());
}

// reflect construct unknown target
{
  class Q { constructor(a) { this.a = a; } get() { return this.a + 1; } }
  const u = Reflect.construct(C(Q), ["s"]);
  console.log("reflect-construct-unknown-target", u.get(), new Q(1).get());
}

// regexp reads operand
{
  let n = 1;
  const v = { toString() { n = "s"; return "a"; } };
  new (C(/a/).constructor)(v);
  console.log("regexp-reads-operand", n + 1);
}

// revocable proxy
{
  const t = { a: 1, b: 2 };
  const u = C(Proxy).revocable(t, {}).proxy; u.a = "s";
  console.log("revocable-proxy", t.a + t.b);
}

// set from iterable
{
  const v = { a: 1 };
  const u = new (C(new Set()).constructor)([v]); for (const e of u) e.a = "s";
  console.log("set-from-iterable", v.a + 1);
}

// species of unknown
{
  class L extends Array { static get [Symbol.species]() { return C(Array); } }
  const t = L.from([1, 2, 3]);
  const u = t.slice(0, 2);
  console.log("species-of-unknown", u.length, u instanceof L, u[0] + 1);
}

// string converts operand
{
  let n = 1;
  const v = { toString() { n = "s"; return "a"; } };
  new (C(String))(v);
  console.log("string-converts-operand", n + 1);
}

// subarray aliases
{
  const t = new Uint8Array(4); t[0] = 1;
  const u = C(t).subarray(0, 2); u[0] = 7;
  console.log("subarray-aliases", t[0] + 1);
}

// typed array known over buffer
{
  const t = new Uint8Array(4); t[0] = 1;
  const u = new Uint8Array(t.buffer); u[0] = 7;
  console.log("typed-array-known-over-buffer", t[0] + 1);
}

// typed array over buffer
{
  const t = new Uint8Array(4); t[0] = 1;
  const u = new (C(new Uint8Array(1)).constructor)(t.buffer); u[0] = 7;
  console.log("typed-array-over-buffer", t[0] + 1);
}

// weak ref
{
  const v = { a: 1 };
  const u = new (C(new WeakRef({})).constructor)(v); u.deref().a = "s";
  console.log("weak-ref", v.a + 1);
}
