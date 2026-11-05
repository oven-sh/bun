// `Object.assign(V.prototype, { get() { .. } })`: a program puts methods on a prototype by copying them from a literal, and
// the compiler may call them as directly as methods of a class. Each scene picks the constructor, what is copied and how
// (one source or several, a shared mixin, a getter or a hidden member in the source, a spread, a loop over the keys), when
// (before any object exists, after many calls, twice) and what happens afterwards: the member is replaced, deleted, made an
// accessor, hidden by an own property, the source is changed, the prototype frozen or put below another object.
import type { Random } from "./random";

const constructors = [
  "function V(x) {\n    this.x = x;\n  }",
  "class V {\n    constructor(x) {\n      this.x = x;\n    }\n  }",
  'class V {\n    constructor(x) {\n      this.x = x;\n    }\n    get() {\n      return "of the class " + this.x;\n    }\n  }',
  "class V extends Base {\n    constructor(x) {\n      super();\n      this.x = x;\n    }\n  }",
  "const V = function (x) {\n    this.x = x;\n  };",
];

/** Statements that copy members onto `V.prototype`. They may use `mixin`. */
const copies = [
  "Object.assign(V.prototype, {\n    get() {\n      return this.x;\n    },\n    twice() {\n      return this.get() * 2;\n    },\n  });",
  "Object.assign(V.prototype, { get: function () {\n    return this.x;\n  } });",
  'Object.assign(V.prototype, { get: () => "arrow" });',
  "Object.assign(V.prototype, mixin);",
  "Object.assign(V.prototype, { ...mixin });",
  'Object.assign(V.prototype, mixin, { get() {\n    return "later source " + this.x;\n  } });',
  'Object.assign(V.prototype, { get() {\n    return "earlier source";\n  } }, mixin);',
  'Object.assign(V.prototype, {\n    get get() {\n      log.push("getter of the source");\n      return function () {\n        return "from a getter " + this.x;\n      };\n    },\n  });',
  'Object.assign(V.prototype, Object.defineProperty({ twice: () => 2 }, "get", { value: () => "hidden", enumerable: false }));',
  "Object.assign(V.prototype, null, undefined, 5, { get() {\n    return this.x;\n  } });",
  "Object.assign(V.prototype, made());",
  "for (const name in mixin) V.prototype[name] = mixin[name];",
  "Object.defineProperties(V.prototype, Object.getOwnPropertyDescriptors(mixin));",
  "Object.entries(mixin).forEach(([name, value]) => {\n    V.prototype[name] = value;\n  });",
  "Object.assign(V.prototype, { get: 5 });",
  "Object.assign(V.prototype, { get() {\n    return super.toString === Object.prototype.toString;\n  } });",
  "Object.assign(Object.getPrototypeOf(V.prototype) === Object.prototype ? V.prototype : Object.getPrototypeOf(V.prototype), mixin);",
];

/** Statements that run after the copy. `it` is an object that exists by then. */
const changes = [
  "",
  "",
  'V.prototype.get = function () {\n    return "replaced " + this.x;\n  };',
  "delete V.prototype.get;",
  'Object.defineProperty(V.prototype, "get", { get: () => () => "accessor", configurable: true });',
  'mixin.get = () => "source changed";',
  'Object.assign(V.prototype, { get() {\n    return "second copy " + this.x;\n  } });',
  'it.get = () => "own";',
  'Object.defineProperty(it, "get", { value: () => "own, hidden", enumerable: false });',
  'Object.freeze(V.prototype);\n  told(() => {\n    V.prototype.get = () => "after the freeze";\n  });',
  'Object.setPrototypeOf(it, { get: () => "another prototype" });',
  'Object.setPrototypeOf(V.prototype, { get: () => "above", above: () => "above" });\n  delete V.prototype.get;',
  'V.prototype = { get: () => "new prototype object" };',
  'V.prototype[key("get")] = () => "under a computed key";',
];

const looks = [
  "new V(i).get()",
  "new V(i).get()",
  "it.get()",
  "new V(i).twice?.()",
  "V.prototype.get.call({ x: 9 })",
  "typeof it.get",
  "Object.keys(V.prototype).join()",
  "it.get === V.prototype.get",
  "it.get === mixin.get",
  "it.get.name",
  '("get" in it) + "," + Object.hasOwn(it, "get")',
  "read(new V(i))",
  'Object.getOwnPropertyDescriptor(V.prototype, "get")?.enumerable',
];

export function generate(random: Random): string {
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(2, 4); scene < total; scene++) {
    const asked = random.sample(looks, random.between(2, 4));
    const turns = random.pick([1, 3, 300]);
    const isLate = random.chance(0.3);
    const copy = random.pick(copies);
    scenes.push(`{
  const mixin = {
    get() {
      return "mixin " + this.x;
    },
    twice() {
      return "twice " + this.get();
    },
  };
  ${random.pick(constructors)}
  const answers = [];
  const look = it => {
    let last = "";
    for (let i = 0; i < ${turns}; i++) last = noted([${asked.map(each => `told(() => ${each})`).join(", ")}].join(","));
    answers.push(last + " " + counted());
  };
  ${isLate ? "const it = new V(0);\n  look(it);" : ""}
  told(() => {
  ${copy}
  });
  ${isLate ? "" : "const it = new V(0);"}
  look(it);
  told(() => {
  ${random.pick(changes)}
  });
  look(it);
  look(new V(1));
  console.log("scene ${scene}", answers.join(" | "), log.splice(0).join());
}`);
  }
  return `// Every round should answer alike: how many different answers there were, and how long they are together.
const rounds = new Set();
function noted(answer) {
  rounds.add(answer);
  return answer;
}
function counted() {
  const said = rounds.size + ":" + [...rounds].join("").length;
  rounds.clear();
  return said;
}
const key = name => process.argv[9] ?? name;
const log = [];
class Base {
  get() {
    return "of the base " + this.x;
  }
}
const made = () => ({
  get() {
    return "made " + this.x;
  },
});
const read = it => it.get();
function told(ask) {
  try {
    return String(ask());
  } catch (error) {
    return "threw " + error.name;
  }
}
${scenes.join("\n")}
`;
}
