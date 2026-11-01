// A variable is supposed to receive a class, but the assignment never runs: something before it throws, its branch is
// not taken, or the class definition itself throws. The variable keeps its initial value, and the program goes on to
// construct, call and extend it.
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
      // The superclass of the class that would be assigned is missing.
      setup = `${born("nothing", "undefined")}\n${random.pick(roads)("nothing")}\n${born("held", "undefined")}\ntry {\n  // @ts-ignore\n  class Broken extends nothing {}\n  held = Broken as any;\n} ${report}`;
      break;
    case 1:
      // The class is used before its declaration.
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
