// RUN: lower
// OPTIONS: builtin-modules

// Whatever walks a chain of prototypes enters the traps of a proxy that it meets on the way. Each scene has a proxy and a handler of its own and an object that stands below the proxy,
// and does one thing to THE OBJECT. The handler has every trap, and each trap writes its name and its key into the log of the scene.
const key = process.argv.length > 99 ? "b" : "a";
class Named {}
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
await scene(
  "read by name, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return o.a;
  },
);
await scene(
  "read of a name nobody has, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return o.none;
  },
);
await scene(
  "read by a computed key, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return o[key];
  },
);
await scene(
  "read by a symbol, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return o[Symbol.iterator];
  },
);
await scene(
  "test by in, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return "a" in o;
  },
);
await scene(
  "test by in under a computed key, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return key in o;
  },
);
await scene(
  "store, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return (o.a = 2);
  },
);
await scene(
  "store of a new name, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return (o.fresh = 2);
  },
);
await scene(
  "store under a computed key, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return (o[key] = 2);
  },
);
await scene(
  "delete, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return delete o.a;
  },
);
await scene(
  "call of a member, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return o.m();
  },
);
await scene(
  "optional call of a member, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return o.none?.();
  },
);
await scene("keys, below the proxy stands an instance of a class whose prototype object stands below it", async log => {
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
    },
  );
  class C {}
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  return Object.keys(o).join();
});
await scene(
  "for in, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return (() => {
      let s = "";
      for (const k in o) s += k;
      return s;
    })();
  },
);
await scene(
  "spread into a literal, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return Object.keys({ ...o }).join();
  },
);
await scene(
  "pattern, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return (() => {
      const { a } = o;
      return a;
    })();
  },
);
await scene(
  "assign from, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return Object.assign({}, o).a;
  },
);
await scene(
  "instanceof on the left, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return o instanceof Array;
  },
);
await scene(
  "instanceof a class of the program, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return o instanceof Named;
  },
);
await scene(
  "isPrototypeOf, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return Array.prototype.isPrototypeOf(o);
  },
);
await scene(
  "prototype asked twice, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return Object.getPrototypeOf(Object.getPrototypeOf(o)) === Object.prototype;
  },
);
await scene(
  "has own, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return Object.hasOwn(o, "a");
  },
);
await scene("JSON, below the proxy stands an instance of a class whose prototype object stands below it", async log => {
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
    },
  );
  class C {}
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  return JSON.stringify(o);
});
await scene(
  "template, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return `${o}`;
  },
);
await scene(
  "concatenation, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return "" + o;
  },
);
await scene(
  "arithmetic, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return +o;
  },
);
await scene(
  "loose equality, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return o == 1;
  },
);
await scene(
  "String, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return String(o);
  },
);
await scene(
  "join of a list, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return [o].join();
  },
);
await scene(
  "super read, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return {
      __proto__: o,
      f() {
        return super.a;
      },
    }.f();
  },
);
await scene(
  "Reflect.get, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return Reflect.get(o, "a");
  },
);
await scene(
  "Reflect.has, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return Reflect.has(o, "a");
  },
);
await scene(
  "Reflect.set, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return Reflect.set(o, "a", 1);
  },
);
await scene(
  "await, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return typeof (await o);
  },
);
await scene(
  "returned by an async function, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return typeof (await (async () => o)());
  },
);
await scene(
  "Promise.resolve, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return typeof (await Promise.resolve(o));
  },
);
await scene(
  "for of, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return (() => {
      try {
        for (const x of o) return x;
      } catch (e) {
        return e.constructor.name;
      }
    })();
  },
);
await scene(
  "Array.from, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return Array.from(o).length;
  },
);
await scene(
  "concat, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return [].concat(o).length;
  },
);
await scene(
  "handed to a function that reads, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return (q => q.a)(o);
  },
);
await scene(
  "this of a call, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return function () {
      return this.a;
    }.call(o);
  },
);
await scene(
  "descriptor, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return Object.defineProperty({}, "x", o).x;
  },
);
await scene(
  "options of a built-in, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return new Intl.NumberFormat("en", o).format(1);
  },
);
await scene(
  "toString.call, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return Object.prototype.toString.call(o);
  },
);
await scene(
  "cause of an error, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return new Error("m", o).cause;
  },
);
await scene(
  "one more below, below the proxy stands an instance of a class whose prototype object stands below it",
  async log => {
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
      },
    );
    class C {}
    Object.setPrototypeOf(C.prototype, p);
    const o = new C();
    return Object.create(o).a;
  },
);
console.log(lines.join("\n"));

// GENERATED: scene Named f
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
// CHECK-LABEL: function {{*}}name="Named"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_5]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_5]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="f"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] captures=[{type=object flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: object, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetSuperBase v0
// CHECK-NEXT: v3 = SuperGet v2, v1 key="a"
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
