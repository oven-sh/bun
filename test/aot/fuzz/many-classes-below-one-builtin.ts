// Many classes and functions stand below one built-in class and are constructed in turns, so the built-in's constructor is
// asked for objects of many different new.targets: one, two, sixteen, seventeen or forty. Some are class expressions
// evaluated in a loop, some are plain functions passed to Reflect.construct, and some get another prototype object between
// two rounds. Every object must have the prototype, the methods and the fields of the one it was constructed for.
import type { Random } from "./random";

const bases: Record<string, { args: string; check: string }> = {
  Map: { args: "", check: "made.size" },
  Set: { args: "", check: "made.size" },
  WeakMap: { args: "", check: "made.has(made)" },
  Array: { args: "", check: "made.length" },
  Error: { args: '"e"', check: "made.message" },
  TypeError: { args: '"e"', check: "made.name" },
  RangeError: { args: '"e"', check: "made.message" },
  // A class without a constructor of its own passes no argument on, and then the date is the time of the run.
  Date: { args: "0", check: "typeof made.getTime()" },
  RegExp: { args: '"a"', check: "made.source" },
  Promise: { args: "() => {}", check: "typeof made.then" },
  Uint8Array: { args: "2", check: "made.length" },
  ArrayBuffer: { args: "8", check: "made.byteLength" },
  Object: { args: "", check: "typeof made" },
};

/** Expressions for the k-th thing to construct below BASE. Each object answers `which()` with k. */
const kinds = [
  "class extends BASE {\n    constructor() {\n      super(ARGS);\n    }\n    which() {\n      return k;\n    }\n  }",
  "class extends BASE {\n    field = k;\n    which() {\n      return this.field;\n    }\n  }",
  "class extends BASE {\n    #secret = k;\n    which() {\n      return this.#secret;\n    }\n  }",
  "class extends BASE {\n    constructor() {\n      super(ARGS);\n      this.stored = k;\n    }\n    which() {\n      return this.stored;\n    }\n  }",
];

/** Statements that run between two rounds. `targets` is the list of what is constructed. */
const between = [
  "",
  "",
  "Bun.gc(true);",
  "targets.reverse();",
  "targets[1 % targets.length].prototype.which = () => -1;",
  "Object.setPrototypeOf(targets[0].prototype, { __proto__: BASE.prototype, more: true });",
  "functions[0].prototype = { __proto__: BASE.prototype, which: () => -2 };",
  "functions[0].prototype = null;",
  "functions.reverse();",
];

export function generate(random: Random): string {
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(1, 2); scene < total; scene++) {
    const baseName = random.pick(Object.keys(bases));
    const base = bases[baseName];
    const filled = (text: string) => text.replaceAll("BASE", baseName).replaceAll("ARGS", base.args);
    const count = random.pick([1, 2, 3, 16, 17, 20, 40]);
    const rounds = random.pick([1, 2, 3, 50]);
    const used = random.sample(kinds, random.between(1, kinds.length)).map(filled);
    const steps = random.sample(between, 2).map(filled);
    scenes.push(`{
  const targets = [];
  const functions = [];
  for (let k = 0; k < ${count}; k++) {
    ${used.map((kind, at) => `${at ? "else " : ""}${at === used.length - 1 ? "" : `if (k % ${used.length} === ${at}) `}targets.push(${kind.replaceAll("\n", "\n  ")});`).join("\n    ")}
    const plain = function () {};
    plain.prototype = { __proto__: ${baseName}.prototype, which: () => 100 + k };
    functions.push(plain);
  }
  const seen = [];
  const look = (made, target) =>
    told(() => made.which()) + ":" + (Object.getPrototypeOf(made) === target.prototype) + ":" + (made instanceof ${baseName}) + ":" + told(() => ${base.check}) + ":" + Object.keys(made).join("+");
  const round = () => {
    const answers = [];
    for (const target of targets) answers.push(told(() => look(new target(), target)));
    for (const target of functions) answers.push(told(() => look(Reflect.construct(${baseName}, [${base.args}], target), target)));
    ${random.chance(0.5) ? `for (const target of functions) answers.push(told(() => look(Reflect.construct(targets[0], [], target), target)));` : ""}
    return answers.join(" ");
  };
  for (let turn = 0; turn < ${rounds}; turn++) seen.push(round());
  console.log("scene ${scene}", new Set(seen).size, seen.at(-1));
  told(() => {
    ${steps[0]}
  });
  console.log("scene ${scene} then", round());
  told(() => {
    ${steps[1]}
  });
  console.log("scene ${scene} last", round());
}`);
  }
  return `function told(ask) {
  try {
    return ask();
  } catch (error) {
    return "threw " + error.name;
  }
}
${scenes.join("\n")}
`;
}
