// A variable is meant to take a class, and the store never runs: something in front of it throws, its branch is not taken, or the class itself throws while it is
// defined. The variable still holds what it was born with, and the program goes on to use it as a class. A program is one scene, drawn from
//   a value        what the variable holds: undefined, null, a number, a string, an object, an arrow function, a bound function, a proxy of a class
//   a road         why the class never arrives
//   a declaration  what the variable is declared as: an instance type, the type of a class, a constructor type, an interface with a construct signature, any, unknown
//   a use          new, a call, super(..) below it, extends, Reflect.construct as the target or as new.target, a tagged template
//   a try block round the use, or none
//   a place        the top level, a function, an async function behind an await, a generator behind a yield
// One scene a program: what the compiler learns about one variable says nothing about another.
import type { Random } from "./random";

const head = `function pass<T>(value: T): T;
function pass(value: unknown): unknown {
  return value;
}
function fail(): void {
  throw new Error("stop");
}
function never(): boolean {
  return Date.now() < 0;
}
function classOf(error: unknown): string {
  return "THREW " + (error as Error).constructor.name;
}
function show(label: string, value: unknown): void {
  const text =
    typeof value === "object" && value !== null
      ? Object.getPrototypeOf(value)?.constructor?.name + " " + JSON.stringify(value)
      : String(value);
  console.log(label, typeof value, text);
}
interface Shape {}
class Real {
  tag = "real";
}
interface Maker {
  new (): Real;
  (): Real;
  (strings: TemplateStringsArray): Real;
}
`;

const values = [
  "undefined",
  "null",
  "7",
  '"text"',
  "{ a: 1 }",
  "() => ({ arrow: true })",
  "function () { return { bound: true }; }.bind(null)",
  'new Proxy(class { tag = "proxied"; }, {})',
];

const report = `catch (error) {\n  console.log("road:", classOf(error));\n}`;
const roads: ((held: string) => string)[] = [
  held => `try {\n  fail();\n  ${held} = Real as any;\n} ${report}`,
  held => `if (never()) ${held} = Real as any;`,
  held => `if (never()) ${held} = Int16Array as any;`,
  held =>
    `try {\n  const first = class extends (Int16Array as any) {\n    // @ts-ignore\n    [first];\n  };\n  ${held} = first as any;\n} ${report}`,
  held => `try {\n  class Broken {\n    static at = fail();\n  }\n  ${held} = Broken as any;\n} ${report}`,
];

const declarations = ["Real", "typeof Real", "new () => Real", "Maker", "any", "unknown", "Shape"];

type Use = {
  before?: string;
  guarded?: (held: string) => string;
  last: (held: string) => string;
  lastIsAlwaysGuarded?: boolean;
};
const uses: Use[] = [
  { last: held => `// @ts-ignore\nshow("made", new ${held}());` },
  { last: held => `// @ts-ignore\nshow("called", ${held}());` },
  {
    before: `class Above {}\nclass Below extends Above {\n  constructor() {\n    super();\n  }\n}`,
    last: held => `// @ts-ignore\nObject.setPrototypeOf(Below, ${held});\nshow("made", new Below());`,
  },
  {
    before: `let taken: Shape = pass<Shape>(undefined as any);`,
    guarded: held => `// @ts-ignore\nclass Below extends ${held} {}\ntaken = Below as any;\nconsole.log("defined");`,
    last: () => `// @ts-ignore\nshow("made", new taken());`,
    lastIsAlwaysGuarded: true,
  },
  { last: held => `// @ts-ignore\nclass Below extends ${held} {}\nshow("made", new Below());` },
  { last: held => `// @ts-ignore\nshow("made", Reflect.construct(${held}, []));` },
  { last: held => `// @ts-ignore\nshow("made", Reflect.construct(Real, [], ${held}));` },
  { last: held => `// @ts-ignore\nshow("tagged", ${held}\`text\`);` },
];

const guard = (text: string) => `try {\n${text}\n} catch (error) {\n  console.log("use:", classOf(error));\n}`;

const places: ((before: string, after: string) => string)[] = [
  (before, after) => `${before}\n${after}`,
  (before, after) => `function scene(): void {\n${before}\n${after}\n}\nscene();`,
  (before, after) => `async function scene(): Promise<void> {\n${before}\nawait null;\n${after}\n}\nawait scene();`,
  (before, after) =>
    `function* scene(): Generator<number> {\n${before}\nyield 1;\n${after}\n}\nfor (const step of scene()) console.log("step", step);`,
];

export function generate(random: Random): string {
  const declared = random.pick(declarations);
  const born = (name: string, value: string) => `let ${name}: ${declared} = pass<${declared}>((${value}) as any);`;
  let held = "held";
  let setup: string;
  let tail = "";
  switch (random.below(8)) {
    case 0:
      // The class above the class that would arrive is missing.
      setup = `${born("nothing", "undefined")}\n${random.pick(roads)("nothing")}\n${born("held", "undefined")}\ntry {\n  // @ts-ignore\n  class Broken extends nothing {}\n  held = Broken as any;\n} ${report}`;
      break;
    case 1:
      // The class is used above its declaration.
      setup = `const read = (): ${declared} => Later as any;`;
      held = "(read())";
      tail = `\nclass Later {\n  tag = "later";\n}`;
      break;
    default:
      setup = `${born("held", random.pick(values))}\n${random.pick(roads)("held")}`;
  }
  // Half of the programs extend the variable.
  const use = random.chance(0.5) ? uses[random.between(3, 4)] : random.pick(uses);
  const isGuarded = random.chance(0.7);
  const wrap = (text: string, always = false) => (isGuarded || always ? guard(text) : text);
  const after = [
    use.before,
    use.guarded && wrap(use.guarded(held)),
    wrap(use.last(held), use.lastIsAlwaysGuarded),
    `console.log("end");`,
  ]
    .filter(Boolean)
    .join("\n");
  return head + random.pick(places)(setup, after + tail) + "\n";
}
