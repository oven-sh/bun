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
await scene("read by name, below the proxy stands an instance of a function whose prototype it is", async log => {
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
  function F() {}
  F.prototype = p;
  const o = new F();
  return o.a;
});
await scene(
  "read of a name nobody has, below the proxy stands an instance of a function whose prototype it is",
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
    function F() {}
    F.prototype = p;
    const o = new F();
    return o.none;
  },
);
await scene(
  "read by a computed key, below the proxy stands an instance of a function whose prototype it is",
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
    function F() {}
    F.prototype = p;
    const o = new F();
    return o[key];
  },
);
await scene("read by a symbol, below the proxy stands an instance of a function whose prototype it is", async log => {
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
  function F() {}
  F.prototype = p;
  const o = new F();
  return o[Symbol.iterator];
});
await scene("test by in, below the proxy stands an instance of a function whose prototype it is", async log => {
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
  function F() {}
  F.prototype = p;
  const o = new F();
  return "a" in o;
});
await scene(
  "test by in under a computed key, below the proxy stands an instance of a function whose prototype it is",
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
    function F() {}
    F.prototype = p;
    const o = new F();
    return key in o;
  },
);
await scene("store, below the proxy stands an instance of a function whose prototype it is", async log => {
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
  function F() {}
  F.prototype = p;
  const o = new F();
  return (o.a = 2);
});
await scene(
  "store of a new name, below the proxy stands an instance of a function whose prototype it is",
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
    function F() {}
    F.prototype = p;
    const o = new F();
    return (o.fresh = 2);
  },
);
await scene(
  "store under a computed key, below the proxy stands an instance of a function whose prototype it is",
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
    function F() {}
    F.prototype = p;
    const o = new F();
    return (o[key] = 2);
  },
);
await scene("delete, below the proxy stands an instance of a function whose prototype it is", async log => {
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
  function F() {}
  F.prototype = p;
  const o = new F();
  return delete o.a;
});
await scene("call of a member, below the proxy stands an instance of a function whose prototype it is", async log => {
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
  function F() {}
  F.prototype = p;
  const o = new F();
  return o.m();
});
await scene(
  "optional call of a member, below the proxy stands an instance of a function whose prototype it is",
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
    function F() {}
    F.prototype = p;
    const o = new F();
    return o.none?.();
  },
);
await scene("keys, below the proxy stands an instance of a function whose prototype it is", async log => {
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
  function F() {}
  F.prototype = p;
  const o = new F();
  return Object.keys(o).join();
});
await scene("for in, below the proxy stands an instance of a function whose prototype it is", async log => {
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
  function F() {}
  F.prototype = p;
  const o = new F();
  return (() => {
    let s = "";
    for (const k in o) s += k;
    return s;
  })();
});
await scene(
  "spread into a literal, below the proxy stands an instance of a function whose prototype it is",
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
    function F() {}
    F.prototype = p;
    const o = new F();
    return Object.keys({ ...o }).join();
  },
);
await scene("pattern, below the proxy stands an instance of a function whose prototype it is", async log => {
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
  function F() {}
  F.prototype = p;
  const o = new F();
  return (() => {
    const { a } = o;
    return a;
  })();
});
await scene("assign from, below the proxy stands an instance of a function whose prototype it is", async log => {
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
  function F() {}
  F.prototype = p;
  const o = new F();
  return Object.assign({}, o).a;
});
await scene(
  "instanceof on the left, below the proxy stands an instance of a function whose prototype it is",
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
    function F() {}
    F.prototype = p;
    const o = new F();
    return o instanceof Array;
  },
);
await scene(
  "instanceof a class of the program, below the proxy stands an instance of a function whose prototype it is",
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
    function F() {}
    F.prototype = p;
    const o = new F();
    return o instanceof Named;
  },
);
await scene("isPrototypeOf, below the proxy stands an instance of a function whose prototype it is", async log => {
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
  function F() {}
  F.prototype = p;
  const o = new F();
  return Array.prototype.isPrototypeOf(o);
});
await scene(
  "prototype asked twice, below the proxy stands an instance of a function whose prototype it is",
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
    function F() {}
    F.prototype = p;
    const o = new F();
    return Object.getPrototypeOf(Object.getPrototypeOf(o)) === Object.prototype;
  },
);
await scene("has own, below the proxy stands an instance of a function whose prototype it is", async log => {
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
  function F() {}
  F.prototype = p;
  const o = new F();
  return Object.hasOwn(o, "a");
});
await scene("JSON, below the proxy stands an instance of a function whose prototype it is", async log => {
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
  function F() {}
  F.prototype = p;
  const o = new F();
  return JSON.stringify(o);
});
await scene("template, below the proxy stands an instance of a function whose prototype it is", async log => {
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
  function F() {}
  F.prototype = p;
  const o = new F();
  return `${o}`;
});
await scene("concatenation, below the proxy stands an instance of a function whose prototype it is", async log => {
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
  function F() {}
  F.prototype = p;
  const o = new F();
  return "" + o;
});
await scene("arithmetic, below the proxy stands an instance of a function whose prototype it is", async log => {
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
  function F() {}
  F.prototype = p;
  const o = new F();
  return +o;
});
await scene("loose equality, below the proxy stands an instance of a function whose prototype it is", async log => {
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
  function F() {}
  F.prototype = p;
  const o = new F();
  return o == 1;
});
await scene("String, below the proxy stands an instance of a function whose prototype it is", async log => {
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
  function F() {}
  F.prototype = p;
  const o = new F();
  return String(o);
});
await scene("join of a list, below the proxy stands an instance of a function whose prototype it is", async log => {
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
  function F() {}
  F.prototype = p;
  const o = new F();
  return [o].join();
});
await scene("super read, below the proxy stands an instance of a function whose prototype it is", async log => {
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
  function F() {}
  F.prototype = p;
  const o = new F();
  return {
    __proto__: o,
    f() {
      return super.a;
    },
  }.f();
});
await scene("Reflect.get, below the proxy stands an instance of a function whose prototype it is", async log => {
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
  function F() {}
  F.prototype = p;
  const o = new F();
  return Reflect.get(o, "a");
});
await scene("Reflect.has, below the proxy stands an instance of a function whose prototype it is", async log => {
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
  function F() {}
  F.prototype = p;
  const o = new F();
  return Reflect.has(o, "a");
});
await scene("Reflect.set, below the proxy stands an instance of a function whose prototype it is", async log => {
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
  function F() {}
  F.prototype = p;
  const o = new F();
  return Reflect.set(o, "a", 1);
});
await scene("await, below the proxy stands an instance of a function whose prototype it is", async log => {
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
  function F() {}
  F.prototype = p;
  const o = new F();
  return typeof (await o);
});
await scene(
  "returned by an async function, below the proxy stands an instance of a function whose prototype it is",
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
    function F() {}
    F.prototype = p;
    const o = new F();
    return typeof (await (async () => o)());
  },
);
await scene("Promise.resolve, below the proxy stands an instance of a function whose prototype it is", async log => {
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
  function F() {}
  F.prototype = p;
  const o = new F();
  return typeof (await Promise.resolve(o));
});
await scene("for of, below the proxy stands an instance of a function whose prototype it is", async log => {
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
  function F() {}
  F.prototype = p;
  const o = new F();
  return (() => {
    try {
      for (const x of o) return x;
    } catch (e) {
      return e.constructor.name;
    }
  })();
});
await scene("Array.from, below the proxy stands an instance of a function whose prototype it is", async log => {
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
  function F() {}
  F.prototype = p;
  const o = new F();
  return Array.from(o).length;
});
await scene("concat, below the proxy stands an instance of a function whose prototype it is", async log => {
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
  function F() {}
  F.prototype = p;
  const o = new F();
  return [].concat(o).length;
});
await scene(
  "handed to a function that reads, below the proxy stands an instance of a function whose prototype it is",
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
    function F() {}
    F.prototype = p;
    const o = new F();
    return (q => q.a)(o);
  },
);
await scene("this of a call, below the proxy stands an instance of a function whose prototype it is", async log => {
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
  function F() {}
  F.prototype = p;
  const o = new F();
  return function () {
    return this.a;
  }.call(o);
});
await scene("descriptor, below the proxy stands an instance of a function whose prototype it is", async log => {
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
  function F() {}
  F.prototype = p;
  const o = new F();
  return Object.defineProperty({}, "x", o).x;
});
await scene(
  "options of a built-in, below the proxy stands an instance of a function whose prototype it is",
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
    function F() {}
    F.prototype = p;
    const o = new F();
    return new Intl.NumberFormat("en", o).format(1);
  },
);
await scene("toString.call, below the proxy stands an instance of a function whose prototype it is", async log => {
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
  function F() {}
  F.prototype = p;
  const o = new F();
  return Object.prototype.toString.call(o);
});
await scene("cause of an error, below the proxy stands an instance of a function whose prototype it is", async log => {
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
  function F() {}
  F.prototype = p;
  const o = new F();
  return new Error("m", o).cause;
});
await scene("one more below, below the proxy stands an instance of a function whose prototype it is", async log => {
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
  function F() {}
  F.prototype = p;
  const o = new F();
  return Object.create(o).a;
});
console.log(lines.join("\n"));

// GENERATED: scene Named f
// CHECK-LABEL: function {{*}}name="scene"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] length=2 syntax=[HasWrittenAwait] thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string, v2: undefined|null|function):
// CHECK-NEXT: v3 = Data data=[[d_1]]
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v6 = Call v2, -, v3 calleeName="run"
// CHECK-NEXT: v7 = Await v6, v1, v2
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b3(v8)
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v9 = CatchValue
// CHECK-NEXT: v10 = String string="threw "
// CHECK-NEXT: v11 = PropGet v9 key="constructor"
// CHECK-NEXT: v12 = PropGet v11 key="name"
// CHECK-NEXT: v13 = Add v10, v12
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b3(v14)
// CHECK-NEXT: b3(v15):
// CHECK-NEXT: v16 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v17 = CheckInitialized v16 name="lines"
// CHECK-NEXT: v18 = PropGet v17 key="push"
// CHECK-NEXT: v19 = String string=": "
// CHECK-NEXT: v20 = Add v1, v19
// CHECK-NEXT: v21 = TypeTest v15 testedType=function
// CHECK-NEXT: Branch v21 -> taken b7(), notTaken b4(| 0)
// CHECK-NEXT: b4(v22):
// CHECK-NEXT: v23 = TypeTest v22 testedType=null|object
// CHECK-NEXT: Branch v23 -> taken b5(| 0), notTaken b7()
// CHECK-NEXT: b5(v24):
// CHECK-NEXT: v25 = TypeTest v15 testedType=null
// CHECK-NEXT: Branch v25 -> taken b7(), notTaken b6(| 0)
// CHECK-NEXT: b6(v26):
// CHECK-NEXT: v27 = String string="an object"
// CHECK-NEXT: Jump -> next b8(v27)
// CHECK-NEXT: b7():
// CHECK-NEXT: v28 = Builtin builtin=String
// CHECK-NEXT: v29 = Call v28, -, v15 calleeName="String"
// CHECK-NEXT: Jump -> next b8(v29)
// CHECK-NEXT: b8(v30):
// CHECK-NEXT: v31 = Add v20, v30
// CHECK-NEXT: v32 = String string=" | "
// CHECK-NEXT: v33 = Add v31, v32
// CHECK-NEXT: v34 = PropGet v3 key="join"
// CHECK-NEXT: v35 = String string=" "
// CHECK-NEXT: v36 = Call v34, v3, v35 calleeKey="join" calleeName="log.join"
// CHECK-NEXT: v37 = Add v33, v36
// CHECK-NEXT: v38 = Call v18, v17, v37 calleeKey="push" calleeName="lines.push"
// CHECK-NEXT: v39 = Undefined
// CHECK-NEXT: Return v39
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Named"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_3]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_3]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="f"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] captures=[{type=object flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: object, v1: anything):
// CHECK-NEXT: v2 = GetSuperBase v0
// CHECK-NEXT: v3 = SuperGet v2, v1 key="a"
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
