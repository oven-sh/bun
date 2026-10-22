// Object.keys and for-in run nothing of an ordinary object. Object.values, Object.entries, Object.assign, a spread, a rest pattern, structuredClone and JSON.stringify go on to read what the keys hold, and an own getter runs with the caller's object as `this`. for-in goes up the chain, where a Proxy answers.
function churn(depth) {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
const kept = [];
const log = [];
const report = () => (kept.splice(0).map(k => k.tag).join("+") || "nobody") + " " + log.splice(0).join();
const listers = {
  keys: thing => Object.keys(thing).join(),
  names: thing => Object.getOwnPropertyNames(thing).join(),
  ownKeys: thing => Reflect.ownKeys(thing).map(String).join(),
  forIn(thing) {
    let text = "";
    for (const key in thing) text += key + ",";
    return text;
  },
  forInAndRead(thing) {
    let text = "";
    for (const key in thing) text += key + "=" + thing[key] + ",";
    return text;
  },
  values: thing => Object.values(thing).join(),
  entries: thing => Object.entries(thing).join("|"),
  assign: thing => Object.keys(Object.assign({}, thing)).join(),
  spread: thing => Object.values({ ...thing }).join(),
  rest(thing) {
    const { tag, ...others } = thing;
    return Object.values(others).join();
  },
  json: thing => JSON.stringify(thing),
  descriptors: thing => Object.keys(Object.getOwnPropertyDescriptors(thing)).join(),
};
const trap = new Proxy(
  { inherited: 1 },
  {
    ownKeys(target) {
      log.push("ownKeys");
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, key) {
      log.push("describe " + String(key));
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    getPrototypeOf(target) {
      log.push("getPrototypeOf");
      return null;
    },
    get(target, key, receiver) {
      log.push("get " + String(key));
      kept.push(receiver);
      return target[key];
    },
  },
);
const makers = {
  plain: () => ({ tag: "plain", a: 1, b: 2 }),
  getter: () => ({
    tag: "getter",
    a: 1,
    get b() {
      kept.push(this);
      return "got";
    },
  }),
  hiddenGetter: () =>
    Object.defineProperty({ tag: "hiddenGetter", a: 1 }, "b", {
      get() {
        kept.push(this);
        return "hidden";
      },
      enumerable: false,
    }),
  lateGetter() {
    const thing = { tag: "lateGetter", a: 1, b: 2 };
    Object.defineProperty(thing, "a", {
      get() {
        kept.push(this);
        return "late";
      },
    });
    return thing;
  },
  symbolGetter: () => ({
    tag: "symbolGetter",
    get [Symbol.for("s")]() {
      kept.push(this);
      return "symbol";
    },
  }),
  belowTrap: () => ({ __proto__: trap, tag: "belowTrap", a: 1 }),
  instance() {
    class Thing {
      tag = "instance";
      a = 1;
      get b() {
        kept.push(this);
        return "of the class";
      }
    }
    return new Thing();
  },
  toJSON: () => ({
    tag: "toJSON",
    toJSON() {
      kept.push(this);
      return "as json";
    },
  }),
};
const lines = [];
for (const [lister, list] of Object.entries(listers)) {
  for (const [name, make] of Object.entries(makers)) {
    lines.push(lister + " " + name + " " + list(make()));
    churn(20);
    lines.push(report());
  }
}
console.log(lines.join("\n"));
