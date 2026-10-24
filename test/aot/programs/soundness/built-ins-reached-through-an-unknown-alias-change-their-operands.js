function key(s) { return JSON.parse('"' + s + '"'); }
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const C = structuredClone({}).constructor;

// array constructor prototype
{
  const t = [1, 2, 3];
  C([]).constructor.prototype.fill.bind(t)("s");
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("array-constructor-prototype", s);
}

// array instance computed
{
  const t = [1, 2, 3];
  C([])[key("fill")].bind(t)("s");
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("array-instance-computed", s);
}

// array instance push
{
  const t = [1, 2, 3];
  C([]).push.bind(t)("s");
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("array-instance-push", s);
}

// array prototype push
{
  const t = [1, 2, 3];
  C(Array.prototype).push.bind(t)("s");
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("array-prototype-push", s);
}

// atomics store
{
  const t = new Int32Array(2); t[0] = 1;
  C(Atomics).store(t, 0, 7);
  console.log("atomics-store", t[0] + 1);
}

// capture stack trace
{
  const t = { a: 1 };
  C(new Error("e")).constructor.captureStackTrace(t);
  console.log("capture-stack-trace", typeof t.stack, t.a + 1, Object.keys(t).join());
}

// class prototype define
{
  class Q { m() { return "Q.m"; } }
  C.defineProperty(Q.prototype, "m", { value: () => "patched" });
  console.log("class-prototype-define", new Q().m());
}

// class static define
{
  class Q { static s() { return "Q.s"; } }
  C.defineProperty(Q, "s", { value: () => "patched" });
  console.log("class-static-define", Q.s());
}

// closure property
{
  function f0() { return 1; }
  f0.tag = 1;
  C.assign(f0, { tag: "s" });
  console.log("closure-property", f0.tag + 1);
}

// create with descriptors
{
  const v = { a: 1 };
  C.create(null, { k: { value: v } }).k.a = "s";
  console.log("create-with-descriptors", v.a + 1);
}

// define getter legacy
{
  const t = { a: 1, b: 2 };
  C.prototype.__defineGetter__.bind(t)("a", () => "g");
  console.log("define-getter-legacy", t.a + t.b);
}

// from entries aliases
{
  const v = { a: 1 };
  C.fromEntries([["k", v]]).k.a = "s";
  console.log("from-entries-aliases", v.a + 1);
}

// function prototype replaced
{
  function F0() {}
  F0.prototype.m = function () { return "F0.m"; };
  C.defineProperty(F0, "prototype", { value: { m() { return "patched"; } } });
  console.log("function-prototype-replaced", new F0().m());
}

// group by aliases
{
  const v = { a: 1 };
  attempt(() => { C.groupBy([v], () => "k").k[0].a = "s"; });
  console.log("group-by-aliases", v.a + 1);
}

// lookup setter
{
  class Q { m() { return "Q.m"; } }
  const t = new Q();
  C.prototype.__lookupSetter__("__proto__").bind(t)({ m() { return "other.m"; } });
  console.log("lookup-setter", t.m());
}

// module namespace like
{
  const t = Object.freeze({ a: 1 });
  attempt(() => C.defineProperty(t, "a", { value: 2 }));
  console.log("module-namespace-like", t.a);
}

// nested array element
{
  const t = [{ a: 1 }];
  C.values(t)[0].a = "s";
  console.log("nested-array-element", t[0].a + 1);
}

// nested object
{
  const t = { inner: { a: 1 } };
  C.values(t)[0].a = "s";
  console.log("nested-object", t.inner.a + 1);
}

// nested through entries
{
  const t = { inner: { a: 1 } };
  C.entries(t)[0][1].a = "s";
  console.log("nested-through-entries", t.inner.a + 1);
}

// proto setter
{
  class Q { m() { return "Q.m"; } }
  const t = new Q();
  C.getOwnPropertyDescriptor(C.prototype, "__proto__").set.bind(t)({ m() { return "other.m"; } });
  console.log("proto-setter", t.m());
}

// reflect computed
{
  const t = { a: 1, b: 2 };
  C(Reflect)[key("set")](t, "a", "s");
  console.log("reflect-computed", t.a + t.b);
}

// reflect define
{
  const t = { a: 1, b: 2 };
  C(Reflect).defineProperty(t, "a", { value: "s" });
  console.log("reflect-define", t.a + t.b);
}

// reflect from global computed
{
  const t = { a: 1, b: 2 };
  C(globalThis)[key("Reflect")].set(t, "a", "s");
  console.log("reflect-from-global-computed", t.a + t.b);
}

// reflect from global
{
  const t = { a: 1, b: 2 };
  C(globalThis).Reflect.set(t, "a", "s");
  console.log("reflect-from-global", t.a + t.b);
}

// reflect prevent
{
  const t = { a: 1 };
  C(Reflect).preventExtensions(t);
  console.log("reflect-prevent", attempt(() => { t.z = 1; return t.z; }));
}

// reflect set prototype
{
  class Q { m() { return "Q.m"; } }
  const t = new Q();
  C(Reflect).setPrototypeOf(t, { m() { return "other.m"; } });
  console.log("reflect-set-prototype", t.m());
}

// reflect set
{
  const t = { a: 1, b: 2 };
  C(Reflect).set(t, "a", "s");
  console.log("reflect-set", t.a + t.b);
}
