// A field holds fractions, so the compiler may keep it as a raw double inside the object, and a store by name into an object
// nobody could follow may convert a number and write it in place. Each scene stores into such a field through a function
// that does not know its receiver. Most values are numbers. Some are not, and some receivers do not take the store as a
// plain field would: frozen, the field read-only, replaced by an accessor, deleted, hidden behind a setter of the prototype,
// an object of another shape, a proxy. The field is read back in several ways, and so are its neighbors.
import type { Random } from "./random";

/** Expressions that make the receiver. */
const receivers = [
  "new Point(0.5, 1.5)",
  "new Point(0.5, 1.5)",
  "new Point(0.5, 1.5)",
  "new Point(1, 2)",
  "{ x: 0.5, y: 1.5 }",
  "new Below(0.5, 1.5)",
  "Object.freeze(new Point(0.5, 1.5))",
  "Object.seal(new Point(0.5, 1.5))",
  "Object.preventExtensions(new Point(0.5, 1.5))",
  'Object.defineProperty(new Point(0.5, 1.5), "x", { writable: false })',
  'Object.defineProperty(new Point(0.5, 1.5), "x", { get: () => "getter", set(value) {\n      log.push("setter " + String(value));\n    } })',
  'Object.defineProperty(new Point(0.5, 1.5), "x", { get: () => "getter only" })',
  "without(new Point(0.5, 1.5))",
  "Object.create(new Point(0.5, 1.5))",
  "Object.create(watched)",
  "new Proxy(new Point(0.5, 1.5), {})",
  "new Proxy(new Point(0.5, 1.5), { set: () => true })",
  "{ y: 1.5 }",
  '{ x: "text", y: 1.5 }',
  "[0.5, 1.5]",
];

const values = ["2.5", "2.5", "3", "-0", "NaN", "Infinity", "2147483648", "-2147483649", "1e308 * 10", "0.1 + 0.2", '"text"', "undefined", "null", "true", "10n", "{ valueOf: () => 4 }", "[5]", 'Symbol.for("s")', "i", "i + 0.5"]; // prettier-ignore

/** Statements that store VALUE into the field `x` of `it`. */
const stores = [
  "it.x = VALUE;",
  "it.x = VALUE;",
  "it.x = VALUE;\n  it.y = VALUE;",
  "it.x += VALUE;",
  "it.x++;",
  "it.x *= 2;",
  "it.x ??= VALUE;",
  "it.x ||= VALUE;",
  "({ x: it.x } = { x: VALUE });",
  "[it.x, it.y] = [it.y, VALUE];",
  'it[key("x")] = VALUE;',
  "Object.assign(it, { x: VALUE });",
  'Reflect.set(it, "x", VALUE);',
  "it.y = it.x = VALUE;",
];

const looks = [
  "shown(it.x)",
  "shown(it.x) + shown(it.y)",
  "shown(it.x + 1)",
  "JSON.stringify(it)",
  "Object.keys(it).join()",
  'shown(Object.getOwnPropertyDescriptor(it, "x")?.value)',
  "shown(it.norm?.())",
  "shown({ ...it }.x)",
  "Object.values(it).map(shown).join()",
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 6); scene < total; scene++) {
    const usual = random.pick(receivers.slice(0, 5));
    const odd = random.pick(receivers);
    const value = random.pick(values);
    const store = random.pick(stores);
    const asked = random.sample(looks, random.between(1, 3)).join(', ";", ');
    const written = (given: string) => store.replaceAll("VALUE", typed ? `(${given}) as any` : `(${given})`);
    scenes.push(`function usual${scene}(it${as("any")}, i${as("number")})${as("void")} {
  ${written(random.pick(["2.5", "i + 0.5", "i"]))}
}
function odd${scene}(it${as("any")}, i${as("number")})${as("void")} {
  ${written(value)}
}
function look${scene}(it${as("any")})${as("string")} {
  return [${asked}].join("");
}
{
  let last = "";
  for (let i = 0; i < ${random.pick([1, 3, 300])}; i++) {
    const it${as("any")} = ${usual};
    const stored = told(() => usual${scene}(it, i));
    last = noted(stored + look${scene}(it));
  }
  const answers${as("string[]")} = [];
  for (const [store, it] of [
    [odd${scene}, ${usual}],
    [usual${scene}, ${odd}],
    [odd${scene}, ${odd}],
    [usual${scene}, ${usual}],
  ]${typed ? " as [(it: any, i: number) => void, any][]" : ""}) {
    answers.push(told(() => store(it, 7)) + told(() => look${scene}(it)));
  }
  console.log("scene ${scene}", last, counted(), answers.join(" | "), log.splice(0).join());
}`);
  }
  return `// Every round should answer alike: how many different answers there were, and how long they are together.
const rounds = new Set${typed ? "<string>" : ""}();
function noted(answer${as("string")})${as("string")} {
  rounds.add(answer);
  return answer;
}
function counted()${as("string")} {
  const said = rounds.size + ":" + [...rounds].join("").length;
  rounds.clear();
  return said;
}
const key = (name${as("string")})${as("string")} => process.argv[9] ?? name;
const log${as("string[]")} = [];
class Point {
  x${as("number")};
  y${as("number")};
  constructor(x${as("number")}, y${as("number")}) {
    this.x = x;
    this.y = y;
  }
  norm()${as("number")} {
    return this.x + this.y;
  }
}
class Below extends Point {
  z = 2.5;
}
const watched = {
  set x(value${as("unknown")}) {
    log.push("inherited setter " + String(value));
  },
  get x()${as("unknown")} {
    return "inherited getter";
  },
};
function without(it${as("any")})${as("any")} {
  delete it.x;
  return it;
}
function shown(value${as("unknown")})${as("string")} {
  return Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value + " " + String(value) + ",";
}
function told(ask${as("() => unknown")})${as("string")} {
  try {
    const answer = ask();
    return answer === undefined ? "" : String(answer);
  } catch (error) {
    return "threw " + ${typed ? "(error as Error)" : "error"}.name + " ";
  }
}
${scenes.join("\n")}
`;
}
