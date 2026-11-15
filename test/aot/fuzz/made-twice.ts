// The same thing is made twice in one function, and between the two something that making it reads is changed:
// `const a = new Q(); Q.prototype = second; const b = new Q();`. Each must be what it was made as.
// Most scenes are called where they are declared: a function that is handed to a helper and called there is compiled otherwise.
import type { Random } from "./random";

const prelude = `const key = name => [name, "other"][Number(process.argv.length > 100)];
function zero() {
  return 0;
}
function chosen(name) {
  return [name, "other"][zero()];
}
const kept = [];
function touch(value) {
  return value;
}
function show(value) {
  if (typeof value === "function") return "function " + value.name + "/" + value.length;
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return Object.is(value, -0) ? "-0" : String(value);
}
function attempt(act) {
  try {
    return show(act());
  } catch (error) {
    return error.constructor.name;
  }
}
function told(label, runs, run) {
  const answers = [];
  for (let turn = 0; turn < runs; turn++) answers.push(attempt(() => run(turn)));
  say(label, answers);
}
function say(label, answers) {
  const runs = answers.length;
  const others = answers.filter(answer => answer !== answers[0]).length;
  console.log(label + ": " + answers.slice(0, 3).join(" ; ") + (runs > 3 ? " ; last " + answers[runs - 1] + " ; others " + others : ""));
}
`;

type Change = { name: string; change: string; undo: string };
type Kind = { name: string; declares: string[]; makes: string[]; changes: Change[]; looks: string[] };

const define = (by: string, on: string, name: string, to: (value: string) => string): Change => ({
  name: `${by}.defineProperty`,
  change: `${by}.defineProperty(${on}, "${name}", ${to("second")});`,
  undo: `${by}.defineProperty(${on}, "${name}", ${to("first")});`,
});
const world: Change = { name: "a variable is assigned", change: `world = "second";`, undo: `world = "first";` };

const twoPrototypes = `const first = Q.prototype;
  const real = function () { return "first"; };
  first.describe = real;
  const second = { describe() { return "second"; }, other: "second" };`;
const ofAnObject = ["X.describe()", "X.other", '"other" in X', "typeof X.other", "X.a", "X.b", "Object.keys(X).join()"];

const kinds: readonly (readonly [number, Kind])[] = [
  [
    8,
    {
      name: "an instance of a constructor function",
      declares: [
        `function Q() {}\n  ${twoPrototypes}`,
        `function Q() { this.a = 1; }\n  ${twoPrototypes}`,
        `function Q() { this.from = world; }\n  let world = "first";\n  ${twoPrototypes}`,
      ],
      makes: ["new Q()"],
      changes: [
        { name: "the prototype is assigned", change: "Q.prototype = second;", undo: "Q.prototype = first;" },
        define("Object", "Q", "prototype", value => `{ value: ${value} }`),
        define("Reflect", "Q", "prototype", value => `{ value: ${value} }`),
        {
          name: "a member of the prototype is assigned",
          change: `first.describe = function () { return "second"; };`,
          undo: "first.describe = real;",
        },
        {
          name: "a getter is laid on the prototype",
          change: `Object.defineProperty(first, "describe", { get() { return () => "second"; }, configurable: true });`,
          undo: `Object.defineProperty(first, "describe", { value: real, writable: true, configurable: true });`,
        },
        {
          name: "the prototype gets another parent",
          change: "Object.setPrototypeOf(first, second);",
          undo: "Object.setPrototypeOf(first, Object.prototype);",
        },
      ],
      looks: [...ofAnObject, "Object.getPrototypeOf(X) === first", "X instanceof Q", "X.constructor === Q"],
    },
  ],
  [
    3,
    {
      name: "an instance of a class",
      declares: [
        `class Base { constructor() { this.from = "first"; } describe() { return "first"; } }
  class Other { constructor() { this.from = "second"; } describe() { return "second"; } get other() { return "second"; } }
  class Q extends Base {}`,
        `class Base { constructor() { this.from = "first"; } describe() { return "first"; } }
  class Other { constructor() { this.from = "second"; } describe() { return "second"; } get other() { return "second"; } }
  class Q extends Base { a = 1; constructor() { super(); } }`,
      ],
      makes: ["new Q()"],
      changes: [
        {
          name: "the prototype gets another parent",
          change: "Object.setPrototypeOf(Q.prototype, Other.prototype);",
          undo: "Object.setPrototypeOf(Q.prototype, Base.prototype);",
        },
        {
          name: "the class gets another parent",
          change: "Object.setPrototypeOf(Q, Other);",
          undo: "Object.setPrototypeOf(Q, Base);",
        },
        {
          name: "a member is laid on the prototype",
          change: `Q.prototype.describe = function () { return "second"; };`,
          undo: "delete Q.prototype.describe;",
        },
      ],
      looks: [...ofAnObject, "X.from", "X instanceof Base", "X instanceof Other"],
    },
  ],
  [
    3,
    {
      name: "an object over a parent in a variable",
      declares: [
        `const first = { describe() { return "first"; } };
  const second = { describe() { return "second"; }, other: "second" };
  let parent = first;
  let world = "first";`,
      ],
      makes: [
        "{ __proto__: parent, from: world }",
        "Object.create(parent)",
        "Object.setPrototypeOf({ from: world }, parent)",
      ],
      changes: [
        { name: "the parent is assigned", change: "parent = second;", undo: "parent = first;" },
        world,
        {
          name: "both are assigned",
          change: `parent = second; world = "second";`,
          undo: `parent = first; world = "first";`,
        },
      ],
      looks: [...ofAnObject, "X.from", "Object.getPrototypeOf(X) === first"],
    },
  ],
  [
    2,
    {
      name: "a closure",
      declares: [
        `let world = "first";
  const makeFirst = tag => () => tag + " " + world;
  const makeSecond = tag => function second() { return "second " + tag + " " + world; };
  let make = makeFirst;`,
      ],
      makes: ["make(world)", "(() => world)", "(tag => () => tag + world)(world)"],
      changes: [world, { name: "the maker is assigned", change: "make = makeSecond;", undo: "make = makeFirst;" }],
      looks: ["X()", "X.name", "X.length", "X.b", "typeof X.prototype"],
    },
  ],
  [
    2,
    {
      name: "a bound function",
      declares: [
        `let world = "first";
  const first = { name: "first" };
  const second = { name: "second" };
  let receiver = first;
  const targetFirst = function (given) { return this.name + " " + given + " " + world; };
  const targetSecond = function other(given, more) { return "second " + this.name + " " + given; };
  let target = targetFirst;`,
      ],
      makes: ["target.bind(receiver, world)", "target.bind(receiver)"],
      changes: [
        world,
        { name: "the receiver is assigned", change: "receiver = second;", undo: "receiver = first;" },
        { name: "the target is assigned", change: "target = targetSecond;", undo: "target = targetFirst;" },
        { name: "the receiver's member is assigned", change: `first.name = "second";`, undo: `first.name = "first";` },
      ],
      looks: ["X()", "X.name", "X.length", "X.b"],
    },
  ],
  [
    2,
    {
      name: "a list",
      declares: [
        `let world = "first";
  class Base extends Array { describe() { return "first"; } }
  class Other extends Array { describe() { return "second"; } get other() { return "second"; } }
  class Q extends Base {}`,
      ],
      makes: ["[world, 1, 2]", "Array.of(world, 1)", "new Q(3)", "Q.of(world)", "Q.from([world])"],
      changes: [
        world,
        {
          name: "the prototype gets another parent",
          change: "Object.setPrototypeOf(Q.prototype, Other.prototype);",
          undo: "Object.setPrototypeOf(Q.prototype, Base.prototype);",
        },
        {
          name: "a member is laid on the prototype",
          change: `Q.prototype.describe = function () { return "second"; };`,
          undo: "delete Q.prototype.describe;",
        },
      ],
      looks: ["X[0]", "X.length", "X.describe?.()", "X.other", "X.b", "Array.isArray(X)", "X instanceof Q"],
    },
  ],
  [
    2,
    {
      name: "a table",
      declares: [
        `let world = "first";
  class Q extends Map { get(name) { return "first " + super.get(name); } }
  const real = Q.prototype.get;`,
      ],
      makes: ["new Map([[world, 1]])", "new Q([[world, 1]])", "new Set([world])"],
      changes: [
        world,
        {
          name: "a member of the prototype is assigned",
          change: `Q.prototype.get = function (name) { return "second " + this.has(name); };`,
          undo: "Q.prototype.get = real;",
        },
      ],
      looks: ['X.has("first")', 'X.has("second")', 'X.get?.("first")', "X.size", "X.b"],
    },
  ],
  [
    2,
    {
      name: "a class",
      declares: [
        `let world = "first";
  class First { describe() { return "first"; } }
  class Second { describe() { return "second"; } get other() { return "second"; } }
  let Parent = First;`,
      ],
      makes: [
        "class extends Parent { static from = world; }",
        "class { static from = world; describe() { return world; } }",
      ],
      changes: [world, { name: "the parent is assigned", change: "Parent = Second;", undo: "Parent = First;" }],
      looks: ["X.from", "new X().describe()", "new X().other", "Object.getPrototypeOf(X) === First", "X.b"],
    },
  ],
];

const touches: readonly (readonly [number, (name: string) => string])[] = [
  [5, name => `${name}[chosen("b")] = 1;`],
  [1, name => `${name}[key("b")] = 1;`],
  [4, name => `${name}.b = 1;`],
  [2, () => ""],
  [1, name => `touch(${name});`],
  [1, name => `kept.push(${name});`],
  [1, name => `const box${name} = { ${name} }; box${name}.${name}.b = 1;`],
];

function scene(random: Random): string {
  const kind = random.weighted(kinds);
  const makes = random.pick(kind.makes);
  const { name, change, undo } = random.pick(kind.changes);
  const isInLine = random.chance(0.65);
  const when = random.weighted([[3, "before the looks"], [2, "behind the looks"], [1, "never"]] as const); // prettier-ignore
  const warmth = random.weighted([[3, 1], [2, 0], [1, 40]] as const); // prettier-ignore
  const runs = random.weighted([[3, 3], [1, 1], [2, 300]] as const); // prettier-ignore
  const absent = kind.looks.filter(look => look === "X.a" && random.chance(0.6));
  const others = kind.looks.slice(1).filter(look => look !== "X.a");
  const looks = [kind.looks[0], ...absent, ...random.sample(others, random.between(0, 2))];
  const looked = (at: string) => looks.map(look => `String(${look.replaceAll("X", at)})`).join(` + " " + `);
  const label = `${kind.name}, ${makes} | ${name} ${isInLine ? "in line" : "in a function"}, undone ${when} | warmed ${warmth}`;
  return `{
  ${random.chance(0.5) ? kind.declares[0] : random.pick(kind.declares)}
  function there() { ${change} return 1; }
  function back() { ${undo} return 1; }${
    warmth
      ? `
  function warm() { const w = ${makes}; return JSON.stringify(w) + Object.keys(w).length; }
  for (let i = 0; i < ${warmth}; i++) warm();`
      : ""
  }
  function run(turn) {
    const a = ${makes};
    ${isInLine ? change : "there();"}
    ${random.weighted(touches)("a")}
    const b = ${makes};
    ${when === "before the looks" ? (isInLine ? undo : "back();") : ""}
    ${random.weighted(touches)("b")}
    const answer = ${looked("a")} + " | " + ${looked("b")};
    ${when === "behind the looks" ? "back();" : ""}
    return answer;
  }
  ${
    random.chance(0.75)
      ? `const answers = [];
  for (let turn = 0; turn < ${runs}; turn++) {
    try {
      answers.push(String(run(turn)));
    } catch (error) {
      answers.push(error.constructor.name);
    }
  }
  say(${JSON.stringify(label)}, answers);`
      : `told(${JSON.stringify(label)}, ${runs}, run);`
  }
}
`;
}

export function generate(random: Random): string {
  const scenes = random.pick([1, 4, 10]);
  return prelude + Array.from({ length: scenes }, () => scene(random)).join("");
}
