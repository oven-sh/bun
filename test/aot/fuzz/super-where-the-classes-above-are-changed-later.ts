// Classes that use `super`, while the program changes what stands above them: `super.name` asks the prototype of the home object at that moment, and `super(..)` calls the prototype of the class at that moment.
//
//   uses        `super.m()`, `super.x`, `super[key]`, `super.x = v`, `super.x += v`, `super.x++`, `delete super.x`, `super.m?.()`, `typeof super.x`, a tag, a spread; in methods, getters, setters, static
//               methods, static blocks, values of fields, arrows, arrows that outlive the call, async methods behind an `await`, generators, methods taken off and called on other objects
//   super(..)   first, behind other statements, in an arrow, in a condition, in `try` with `finally`, twice, never, behind a use of `this`; with a spread, with `arguments`; left to the constructor
//               that the language writes; in a constructor that returns an object, a number or nothing
//   above       a class, a function, a bound function, a proxy, `null`, a class that returns another object, what an expression with effects answers with
//   changed     the prototype of the class, the prototype of its `prototype`, a method above replaced, deleted, turned into a getter, added; ahead of the first instance and between two
//   made by     `new`, `Reflect.construct` with another `new.target`, a class below
import type { Random } from "./random";

const head = `const lines = [];
function show(value, depth = 0) {
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return String(value);
  if (value === null || typeof value !== "object") return String(value);
  if (depth > 2) return "..";
  if (Array.isArray(value)) return "[" + value.map(each => show(each, depth + 1)).join(",") + "]";
  return (value.constructor && value.constructor !== Object ? value.constructor.name : "") + "{" + Object.keys(value).map(key => key + ":" + show(value[key], depth + 1)).join(",") + "}";
}
function note(...parts) {
  lines.push(parts.map(part => (typeof part === "string" ? part : show(part))).join(" "));
}
function tell(label, value) {
  note("runs", label);
  return value;
}
function attempt(label, run) {
  try {
    note(label, "=", run());
  } catch (error) {
    note(label, "THROWS", error.constructor.name);
  }
}
async function wait(label, run) {
  try {
    note(label, "=", await run());
  } catch (error) {
    note(label, "REJECTS", error.constructor.name);
  }
}
`;

export function generate(random: Random): string {
  const rows: string[] = [];
  for (let id = 0, scenes = random.between(3, 6); id < scenes; id++) {
    const above = (name: string) =>
      `class ${name} {\nconstructor(...given) {\nnote("in ${name}", given.length, new.target?.name);\nthis.from = "${name}";\n}\nm(...given) {\nreturn "${name}.m on " + (this?.from ?? typeof this) + "/" + given.length;\n}\nget x() {\nreturn "${name}.x of " + this?.from;\n}\nset x(given) {\nnote("${name}.x is set on", this?.from, given);\n}\nstatic s() {\nreturn "${name}.s on " + this?.name;\n}\nstatic fixed = "${name}.fixed";\n}\n${name}.prototype.plain = "${name}.plain";`;
    const use = () =>
      random.pick([
        "super.m()",
        "super.m(1, 2)",
        "super.x",
        'super["m"]()',
        'super[tell("key", "x")]',
        "(super.x = 5)",
        '(super.x += "!")',
        "(super.plain = 6)",
        "super.plain",
        "(super.count = (super.count ?? 0) + 1)",
        "super.absent",
        "super.absent?.()",
        "super.m?.()",
        "typeof super.m",
        "super.m`text`",
        "super.m(...[1, 2, 3])",
        "(() => super.m())()",
        'super.m.call({ from: "a stranger" })',
        "[super.plain, this.plain]",
        "Object.keys(this).join()",
      ]);
    const members = random.sample(
      [
        `m(...given) {\nreturn ["Below.m", ${use()}];\n}`,
        `other() {\nreturn ${use()};\n}`,
        `get g() {\nreturn ${use()};\n}`,
        `set g(given) {\nnote("the setter", ${use()});\n}`,
        `field = ${use()};`,
        `late() {\nreturn () => ${use()};\n}`,
        `async waits() {\nconst first = ${use()};\nawait null;\nreturn [first, ${use()}];\n}`,
        `*steps() {\nyield ${use()};\nyield ${use()};\n}`,
        `removes() {\nreturn delete super.x;\n}`,
        `static s() {\nreturn ["Below.s", super.s(), super.fixed, super.absent];\n}`,
        `static held = super.fixed;`,
        `static {\nnote("static block", super.s(), super.fixed);\n}`,
        `static late() {\nreturn () => super.s();\n}`,
      ],
      random.between(3, 8),
    );
    const constructor = random.weighted([
      [3, ""],
      [3, `constructor(...given) {\nsuper(...given);\nnote("behind super", this.from);\n}`],
      [1, `constructor() {\nnote("ahead of super");\nsuper(tell("an argument", 1));\n}`],
      [1, `constructor() {\nconst call = () => super(1);\ncall();\nnote("behind the arrow", this.from);\n}`],
      [1, `constructor(given) {\nif (given) super(1);\nelse super();\n}`],
      [1, `constructor() {\ntry {\nsuper();\n} finally {\nnote("finally", typeof this);\n}\n}`],
      [1, `constructor() {\nsuper();\nattempt("super twice", () => super());\n}`],
      [1, `constructor() {\nattempt("this ahead of super", () => this.from);\nsuper();\n}`],
      [1, `constructor(given) {\nif (given) super();\n}`],
      [
        1,
        `constructor() {\nsuper(...arguments);\nreturn ${random.pick(["{ returned: true }", "1", "undefined", "null", "this"])};\n}`,
      ],
      [1, `constructor() {\nreturn { returned: "without super" };\n}`],
      [1, `constructor() {\nsuper();\nthis.viaSuper = super.m();\nsuper.stored = 1;\n}`],
    ]);
    const heritage = random.weighted([
      [6, `First${id}`],
      [1, `tell("heritage", First${id})`],
      [1, `(function Old${id}() {\nthis.from = "Old";\n})`],
      [1, `First${id}.bind(null, "bound")`],
      // Plain Bun throws for `super.name` in the constructor of a class below a proxy.
      [constructor.includes("super.") ? 0 : 1, `new Proxy(First${id}, {})`],
      [
        1,
        `(class extends First${id} {\nconstructor(...given) {\nsuper(...given);\nreturn { from: "another object" };\n}\n})`,
      ],
      [0.5, "null"],
      [0.5, "Object"],
      [0.5, "Array"],
    ]);
    const change = () => `attempt("a change", () => {\n${drawChange()}\n});`;
    const drawChange = () =>
      random.pick([
        `Object.setPrototypeOf(Below${id}, Second${id});`,
        `Object.setPrototypeOf(Below${id}.prototype, Second${id}.prototype);`,
        `Object.setPrototypeOf(Below${id}, Second${id});\nObject.setPrototypeOf(Below${id}.prototype, Second${id}.prototype);`,
        `First${id}.prototype.m = function replaced() {\nreturn "a replaced m on " + this?.from;\n};`,
        `delete First${id}.prototype.m;`,
        `Object.defineProperty(First${id}.prototype, "m", { get() {\nnote("m is a getter now");\nreturn () => "from the getter";\n}, configurable: true });`,
        `First${id}.prototype.absent = () => "no longer absent";`,
        `Object.defineProperty(First${id}.prototype, "plain", { set(given) {\nnote("plain has a setter now", given);\n}, configurable: true });`,
        `Object.setPrototypeOf(Below${id}.prototype, null);`,
        `Object.setPrototypeOf(Below${id}, Function.prototype);`,
        `Object.setPrototypeOf(Below${id}, function Plain${id}() {\nthis.from = "Plain";\n});`,
        `First${id}.s = () => "a replaced s";\nFirst${id}.fixed = "replaced";`,
        `Object.setPrototypeOf(First${id}.prototype, Second${id}.prototype);\ndelete First${id}.prototype.x;`,
      ]);
    const asks = `attempt("made", () => {\nconst made = ${random.pick([`new Below${id}(1)`, `new Below${id}()`, `Reflect.construct(Below${id}, [1], Second${id})`, `new (class Lower${id} extends Below${id} {})(1, 2)`])};\nnote("is", made, made instanceof First${id}, made instanceof Second${id});\nfor (const name of ["m", "other", "removes"]) if (typeof made[name] === "function") attempt(name, () => made[name](1));\nif ("g" in made) {\nattempt("get g", () => made.g);\nattempt("set g", () => (made.g = 1));\n}\nif (made.late) kept.push(made.late());\nif (made.steps) attempt("steps", () => [...made.steps()]);\nif (made.other) attempt("taken off", () => made.other.call({ from: "another receiver" }));\nlast = made;\nreturn Object.keys(made).join();\n});\nif (last?.waits) await wait("waits", () => last.waits());\nfor (const name of ["s", "late"]) if (Object.hasOwn(Below${id}, name)) attempt("static " + name, () => (name === "late" ? Below${id}.late()() : Below${id}.s()));\nfor (const each of kept) attempt("an arrow that outlived its call", each);`;
    rows.push(
      `await (async function scene${id}() {\nnote("scene ${id}");\nconst kept = [];\nlet last;\n${above(`First${id}`)}\n${above(`Second${id}`)}\nlet Below${id};\nattempt("defined", () => {\nBelow${id} = class Below${id} extends ${heritage} {\n${constructor}\n${members.join("\n")}\n};\nreturn typeof Below${id};\n});\nif (!Below${id}) return;\n${random.chance(0.3) ? `${change()}\nnote("changed ahead of the first");\n` : ""}${asks}\n${change()}\nnote("changed");\n${asks}\n${random.chance(0.5) ? `${change()}\nnote("changed again");\n${asks}` : ""}\n})();`,
    );
  }
  return `${head}${rows.join("\n")}\nconsole.log(lines.join("\\n"));\n`;
}
