// Alone: what it prints depends on what else the executable holds: which modules and members were compiled in, and whether anything evaluates text
// Nobody stores under the symbol that the printer asks for: a get trap answers for it. No scene names node:util.
const isAsked = key => typeof key === "symbol" && key.description === "nodejs.util.inspect.custom";
const inspector = label =>
  function (depth, options, inspect) {
    return label + ":" + typeof depth + ":" + typeof inspect + ":" + Object.keys(options).sort().join() + ":" + options.stylize("s", "string");
  };
const trap = label => (target, key, receiver) => (isAsked(key) ? inspector(label) : Reflect.get(target, key, receiver));
const handler = label => ({ get: trap(label) });

const places = {
  below: label => Object.create(new Proxy({}, handler(label))),
  twoUp: label => Object.create(Object.create(new Proxy({}, handler(label)))),
  setLater: label => Object.setPrototypeOf({ own: 1 }, new Proxy({}, handler(label))),
  revocable: label => Object.create(Proxy.revocable({}, handler(label)).proxy),
  belowAClass: label => {
    function Base() {}
    Base.prototype = new Proxy({}, handler(label));
    class Heir extends Base {}
    return new Heir();
  },
  trapComesLate: label => {
    const late = {};
    const object = Object.create(new Proxy({}, late));
    late.get = trap(label);
    return object;
  },
  trapIsInherited: label => {
    class Traps {
      get(target, key, receiver) {
        return trap(label)(target, key, receiver);
      }
    }
    return Object.create(new Proxy({}, new Traps()));
  },
  trapIsBound: label => Object.create(new Proxy({}, { get: function (target, key) { return isAsked(key) ? this.answer : undefined; }.bind({ answer: inspector(label) }) })),
  trapReadsAMap: label => {
    const table = new Map([[Symbol.for("nodejs.util.inspect.custom"), inspector(label)]]);
    return Object.create(new Proxy({}, { get: (target, key) => table.get(key) }));
  },
  handlerIsAProxy: label => Object.create(new Proxy({}, new Proxy({}, { get: (target, name) => (name === "get" ? trap(label) : undefined) }))),
  handlerIsCopied: label => Object.create(new Proxy({}, Object.assign(JSON.parse("{}"), handler(label)))),
  proxyOfAProxy: label => Object.create(new Proxy(new Proxy({}, handler(label)), {})),
  hasAndGet: label => Object.create(new Proxy({}, { has: (target, key) => isAsked(key) || Reflect.has(target, key), get: trap(label) })),
};

for (const [name, make] of Object.entries(places)) {
  console.log(make(name + " printed"));
  console.log([make(name + " in a list")], { inner: make(name + " in an object") }, new Map([[1, make(name + " in a map")]]));
  console.log("%o", make(name + " formatted"));
  console.log(Bun.inspect(make(name + " by Bun.inspect")));
  console.log(await make(name + " awaited"));
  console.log(new Error("x", { cause: make(name + " as a cause") }).cause);
}
