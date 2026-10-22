// super(..) constructs the parent that the class had before the arguments ran: host constructors, closures, bound functions, proxies and values without [[Construct]].
class Plain {
  constructor() {
    this.plain = true;
  }
}
class DerivedPlain extends Plain {
  constructor() {
    super();
    this.derived = true;
  }
}

const probes = [
  ["Map", value => Map.prototype.get.call(value, 0)],
  ["Set", value => Set.prototype.has.call(value, 0)],
  ["Date", value => Date.prototype.getTime.call(value)],
];
function kindOf(value) {
  if (ArrayBuffer.isView(value)) return "Uint8Array";
  if (Array.isArray(value)) return "Array";
  for (const [kind, probe] of probes) {
    try {
      probe(value);
      return kind;
    } catch {}
  }
  if ("derived" in value) return "DerivedPlain";
  return "plain" in value ? "Plain" : "Object";
}
function attempt(run) {
  try {
    return kindOf(run());
  } catch (error) {
    return error.constructor.name;
  }
}

function reparent(derived, parent) {
  Object.setPrototypeOf(derived, parent);
}
function* reparentWhenIterated(derived, parent) {
  Object.setPrototypeOf(derived, parent);
}
const extend = Base =>
  class Derived extends Base {
    constructor(parent) {
      super(reparent(Derived, parent));
    }
  };

const forms = [
  [
    "argument",
    class Derived extends Map {
      constructor(parent) {
        super(reparent(Derived, parent));
      }
    },
  ],
  [
    "array spread",
    class Derived extends Map {
      constructor(parent) {
        super(...[reparent(Derived, parent)]);
      }
    },
  ],
  [
    "iterable spread",
    class Derived extends Map {
      constructor(parent) {
        super(...reparentWhenIterated(Derived, parent));
      }
    },
  ],
  ["argument of a mixin", extend(Map)],
];
const parents = [
  ["Map", Map],
  ["Set", Set],
  ["Date", Date],
  ["Uint8Array", Uint8Array],
  ["Array", Array],
  ["Object", Object],
  ["Plain", Plain],
  ["DerivedPlain", DerivedPlain],
  ["bound Set", Set.bind(null)],
  ["proxy of Set", new Proxy(Set, {})],
  ["Math.max", Math.max],
  ["arrow function", () => {}],
  ["null", null],
];

function constructTwice(Derived, parentBefore, parentAfter) {
  Object.setPrototypeOf(Derived, parentBefore);
  const first = attempt(() => new Derived(parentAfter));
  if (Object.getPrototypeOf(Derived) !== parentAfter) throw new Error("the arguments did not run");
  return `${first}>${attempt(() => new Derived(parentAfter))}`;
}

for (const [form, Derived] of forms) {
  for (const [before, parentBefore] of parents) {
    const kinds = parents.map(([, parentAfter]) => {
      const expected = constructTwice(Derived, parentBefore, parentAfter);
      for (let round = 0; round < 5; round++) {
        if (constructTwice(Derived, parentBefore, parentAfter) !== expected) throw new Error("the result changed");
      }
      return expected;
    });
    console.log(`${form}, ${before}:`, kinds.join(" "));
  }
}
