// RUN: lower
// OPTIONS: builtin-modules

// Each scene has a proxy and a handler of its own, and does one thing to the proxy. The handler has every trap, and each trap writes its name and its key into the log of the scene.
const key = process.argv.length > 99 ? "b" : "a";
const lines = [];
async function scene(name, run) {
  const log = [];
  let answer;
  try {
    answer = await run(log);
  } catch (e) {
    answer = "threw " + e.constructor.name;
  }
  lines.push(
    name +
      ": " +
      (typeof answer === "object" && answer !== null ? "an object" : String(answer)) +
      " | " +
      log.join(" "),
  );
}
await scene("read by name", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return p.a;
});
await scene("read by a computed key", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return p[key];
});
await scene("read by a symbol", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return p[Symbol.iterator];
});
await scene("test by in", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return "a" in p;
});
await scene("test by in under a computed key", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return key in p;
});
await scene("store", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return (p.a = 2);
});
await scene("store under a computed key", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return (p[key] = 2);
});
await scene("delete", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return delete p.a;
});
await scene("call of a member", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return p.m();
});
await scene("optional call of a member", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return p.none?.();
});
await scene("keys", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return Object.keys(p).join();
});
await scene("own names", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return Object.getOwnPropertyNames(p).join();
});
await scene("entries", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return Object.entries(p).length;
});
await scene("for in", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return (() => {
    let s = "";
    for (const k in p) s += k;
    return s;
  })();
});
await scene("spread into a literal", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return Object.keys({ ...p }).join();
});
await scene("rest of a pattern", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return (() => {
    const { a, ...rest } = p;
    return a + Object.keys(rest).join();
  })();
});
await scene("pattern", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return (() => {
    const { a } = p;
    return a;
  })();
});
await scene("assign from", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return Object.assign({}, p).a;
});
await scene("assign to", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return Object.assign(p, { z: 1 }) === p;
});
await scene("instanceof on the left", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return p instanceof Array;
});
await scene("prototype asked", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return Object.getPrototypeOf(p) === Object.prototype;
});
await scene("prototype set", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return Object.setPrototypeOf(p, null) === p;
});
await scene("is extensible", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return Object.isExtensible(p);
});
await scene("prevent extensions", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return Object.preventExtensions(p) === p;
});
await scene("freeze", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return Object.isFrozen(p);
});
await scene("define", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return Object.defineProperty(p, "d", { value: 1, configurable: true }) === p;
});
await scene("describe", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return typeof Object.getOwnPropertyDescriptor(p, "a");
});
await scene("has own", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return Object.hasOwn(p, "a");
});
await scene("hasOwnProperty", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return Object.prototype.hasOwnProperty.call(p, "a");
});
await scene("JSON", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return JSON.stringify(p);
});
await scene("JSON of a holder", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return JSON.stringify({ inner: p });
});
await scene("JSON of a list", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return JSON.stringify([p]);
});
await scene("template", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return `${p}`;
});
await scene("concatenation", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return "" + p;
});
await scene("arithmetic", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return +p;
});
await scene("loose equality", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return p == 1;
});
await scene("strict equality", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return p === 1;
});
await scene("typeof", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return typeof p;
});
await scene("truth", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return !p;
});
await scene("String", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return String(p);
});
await scene("join of a list", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return [p].join();
});
await scene("below a literal", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return { __proto__: p }.a;
});
await scene("below what Object.create made", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return Object.create(p).a;
});
await scene("below by setPrototypeOf", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return Object.setPrototypeOf({}, p).a;
});
await scene("test below a literal", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return "a" in { __proto__: p };
});
await scene("store below a literal", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return ({ __proto__: p }.a = 3);
});
await scene("below the prototype object of a class", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return (() => {
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    return new C().a;
  })();
});
await scene("super read", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return {
    __proto__: p,
    f() {
      return super.a;
    },
  }.f();
});
await scene("Reflect.get", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return Reflect.get(p, "a");
});
await scene("Reflect.get for another receiver", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return Reflect.get(
    {
      get a() {
        return this.a2;
      },
    },
    "a",
    p,
  );
});
await scene("Reflect.has", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return Reflect.has(p, "a");
});
await scene("Reflect.set", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return Reflect.set(p, "a", 1);
});
await scene("Reflect.ownKeys", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return Reflect.ownKeys(p).join();
});
await scene("Reflect.set for another receiver", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return Reflect.set({}, "a", 1, p);
});
await scene("await", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return await p;
});
await scene("returned by an async function", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return await (async () => p)();
});
await scene("Promise.resolve", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return await Promise.resolve(p);
});
await scene("resolved by an executor", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return await new Promise(r => r(p));
});
await scene("then answers it", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return await Promise.resolve(1).then(() => p);
});
await scene("for of", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return (() => {
    try {
      for (const x of p) return x;
    } catch (e) {
      return e.constructor.name;
    }
  })();
});
await scene("spread into a list", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return (() => {
    try {
      return [...p].length;
    } catch (e) {
      return e.constructor.name;
    }
  })();
});
await scene("Array.from", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return Array.from(p).length;
});
await scene("concat", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return [].concat(p).length;
});
await scene("Array.isArray", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return Array.isArray(p);
});
await scene("list pattern", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return (() => {
    try {
      const [x] = p;
      return x;
    } catch (e) {
      return e.constructor.name;
    }
  })();
});
await scene("yield star", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return (() => {
    try {
      return [
        ...(function* () {
          yield* p;
        })(),
      ].length;
    } catch (e) {
      return e.constructor.name;
    }
  })();
});
await scene("key of a Map", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return new Map([[p, 1]]).get(p);
});
await scene("member of a Set", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return new Set([p]).has(p);
});
await scene("key of a WeakMap", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return new WeakMap([[p, 1]]).has(p);
});
await scene("handed to a function that reads", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return (q => q.a)(p);
});
await scene("handed to a function that stores", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return (q => (q.a = 1))(p);
});
await scene("handed to a function that keeps it", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return (q => typeof [q])(p);
});
await scene("kept in a field and read", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return { f: p }.f.a;
});
await scene("kept in a list and read", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return [p][0].a;
});
await scene("kept in a list and mapped", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return [p].map(q => q.a).join();
});
await scene("this of a call", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return function () {
    return this.a;
  }.call(p);
});
await scene("this of a bound function", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return function () {
    return this.a;
  }.bind(p)();
});
await scene("list of apply", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return Math.max.apply(null, p);
});
await scene("options of a built-in", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return new Intl.NumberFormat("en", p).format(1);
});
await scene("descriptor", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return Object.defineProperty({}, "x", p).x;
});
await scene("map of descriptors", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return Object.keys(Object.defineProperties({}, p)).length;
});
await scene("second operand of Object.create", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return Object.keys(Object.create(null, p)).length;
});
await scene("descriptor out of a getter", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return Object.defineProperties(
    {},
    {
      get x() {
        return p;
      },
    },
  ).x;
});
await scene("target of another proxy", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return new Proxy(p, {}).a;
});
await scene("handler of another proxy", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return new Proxy({}, p).a;
});
await scene("toString.call", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return Object.prototype.toString.call(p);
});
await scene("structuredClone", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return (() => {
    try {
      return typeof structuredClone(p);
    } catch (e) {
      return e.constructor.name;
    }
  })();
});
await scene("sorted", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return [p, p].sort().length;
});
await scene("includes", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return [p].includes(p);
});
await scene("thrown and caught", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return (() => {
    try {
      throw p;
    } catch (e) {
      return e.a;
    }
  })();
});
await scene("thrown and only compared", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return (() => {
    try {
      throw p;
    } catch (e) {
      return e === p;
    }
  })();
});
await scene("cause of an error", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return new Error("m", p).cause;
});
await scene("replacer", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return "a".replace("a", p);
});
await scene("separator", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return "a,b".split(p).length;
});
await scene("class above", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return (() => {
    try {
      class D extends p {}
      return typeof D;
    } catch (e) {
      return e.constructor.name;
    }
  })();
});
await scene("called", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return (() => {
    try {
      return p();
    } catch (e) {
      return e.constructor.name;
    }
  })();
});
await scene("constructed", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return (() => {
    try {
      return new p();
    } catch (e) {
      return e.constructor.name;
    }
  })();
});
await scene("instanceof on the right", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return (() => {
    try {
      return {} instanceof p;
    } catch (e) {
      return e.constructor.name;
    }
  })();
});
await scene("tag", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return (() => {
    try {
      return p``;
    } catch (e) {
      return e.constructor.name;
    }
  })();
});
await scene("on globalThis and read", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return ((globalThis.published = p), globalThis.published.a);
});
await scene("with a key that is the proxy", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return { x: 1 }[p];
});
await scene("in with a key that is the proxy", async log => {
  const p = new Proxy(
    {
      a: 1,
      m() {
        return 7;
      },
    },
    {
      get(t, k, r) {
        log.push("get:" + String(k));
        return Reflect.get(t, k);
      },
      has(t, k) {
        log.push("has:" + String(k));
        return Reflect.has(t, k);
      },
      set(t, k, v, r) {
        log.push("set:" + String(k));
        return Reflect.set(t, k, v);
      },
      deleteProperty(t, k) {
        log.push("delete:" + String(k));
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        log.push("ownKeys");
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        log.push("describe:" + String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        log.push("define:" + String(k));
        return Reflect.defineProperty(t, k, d);
      },
      getPrototypeOf(t) {
        log.push("getPrototypeOf");
        return Reflect.getPrototypeOf(t);
      },
      setPrototypeOf(t, o) {
        log.push("setPrototypeOf");
        return Reflect.setPrototypeOf(t, o);
      },
      isExtensible(t) {
        log.push("isExtensible");
        return Reflect.isExtensible(t);
      },
      preventExtensions(t) {
        log.push("preventExtensions");
        return Reflect.preventExtensions(t);
      },
      apply(t, s, l) {
        log.push("apply");
        return 1;
      },
      construct(t, l, n) {
        log.push("construct");
        return {};
      },
    },
  );
  return p in { x: 1 };
});
console.log(lines.join("\n"));

// GENERATED: scene f x C D
// CHECK-LABEL: function {{*}}name="scene"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=undefined|null|Promise flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Data data=[[d_1]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b5():
// CHECK-NEXT: v8 = Call v2, -, v5 calleeName="run"
// CHECK-NEXT: v9 = Await v8, v1, v2
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b5():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b6(v10)
// CHECK-NEXT: b5() role=CatchHandler:
// CHECK-NEXT: v11 = CatchValue
// CHECK-NEXT: v12 = String string="threw "
// CHECK-NEXT: v13 = PropGet v11 key="constructor"
// CHECK-NEXT: v14 = PropGet v13 key="name"
// CHECK-NEXT: v15 = Add v12, v14
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b6(v16)
// CHECK-NEXT: b6(v17):
// CHECK-NEXT: v18 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v19 = CheckInitialized v18 name="lines"
// CHECK-NEXT: v20 = PropGet v19 key="push"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v22 = String string=": "
// CHECK-NEXT: v23 = Add v1, v22
// CHECK-NEXT: v24 = TypeTest v17 testedType=function
// CHECK-NEXT: Branch v24 -> taken b7(| 0), notTaken b8(| 0)
// CHECK-NEXT: b7(v25):
// CHECK-NEXT: Jump -> next b15(v25)
// CHECK-NEXT: b8(v26):
// CHECK-NEXT: v27 = TypeTest v26 testedType=null|object
// CHECK-NEXT: Branch v27 -> taken b9(| 0), notTaken b14(| 0)
// CHECK-NEXT: b9(v28):
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v29 = TypeTest v28 testedType=null
// CHECK-NEXT: Branch v29 -> taken b11(| 0), notTaken b12(| 0)
// CHECK-NEXT: b11(v30):
// CHECK-NEXT: Jump -> next b15(v30)
// CHECK-NEXT: b12(v31):
// CHECK-NEXT: Jump -> next b13()
// CHECK-NEXT: b13():
// CHECK-NEXT: v32 = String string="an object"
// CHECK-NEXT: Jump -> next b16(v32)
// CHECK-NEXT: b14(v33):
// CHECK-NEXT: Jump -> next b15(v33)
// CHECK-NEXT: b15(v34):
// CHECK-NEXT: v35 = Builtin builtin=String
// CHECK-NEXT: v36 = Call v35, -, v34 calleeName="String"
// CHECK-NEXT: v37 = Convert v36 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b16(v37)
// CHECK-NEXT: b16(v38):
// CHECK-NEXT: v39 = Add v23, v38
// CHECK-NEXT: v40 = String string=" | "
// CHECK-NEXT: v41 = Add v39, v40
// CHECK-NEXT: v42 = PropGet v5 key="join"
// CHECK-NEXT: v43 = Convert v42 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v44 = String string=" "
// CHECK-NEXT: v45 = Call v43, v5, v44 calleeKey="join" calleeName="log.join"
// CHECK-NEXT: v46 = Convert v45 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v47 = Add v41, v46
// CHECK-NEXT: v48 = Call v21, v19, v47 calleeKey="push" calleeName="lines.push"
// CHECK-NEXT: v49 = Undefined
// CHECK-NEXT: Return v49
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="f"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] captures=[{type=object flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: object, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetSuperBase v0
// CHECK-NEXT: v3 = SuperGet v2, v1 key="a"
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="x"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] captures=[{type=undefined|null|[[L_6]] flags=[IsExpected]}] thisType={type=anything} results=[{type=undefined|null|[[L_6]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="C"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_7]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_7]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_7]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="D"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_8]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_8]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
