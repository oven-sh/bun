// `x?: number`: a field that some objects of a type have and others leave out. A read of a field that was left out answers
// undefined, unless something above the object answers under that name, and the compiler may find that out with one test of the
// object. Each scene declares a type with optional fields, makes objects that have them, leave them out, hold undefined, get
// them later or lose them, some below a prototype or a class that has the name, and reads them in a function, in a loop and
// beside one another. What is printed tells undefined from absent, and a number from whatever else arrived.
import type { Random } from "./random";

/** Types of the optional field and two values of that type. */
const kinds: [type: string, one: string, two: string][] = [
  ["number", "1", "2"],
  ["number", "0", "-1"],
  ["number", "0.5", "NaN"],
  ["number", "-0", "2147483648"],
  ["string", '"a"', '""'],
  ["boolean", "true", "false"],
  ["number | null", "null", "3"],
  ["{ n: number }", "{ n: 1 }", "{ n: 2 }"],
  ["number[]", "[1]", "[]"],
  ["() => number", "() => 1", "() => 2"],
  ["bigint", "1n", "0n"],
];

/** Expressions that make an instance of the scene's class. ONE and TWO are values of the optional field `x`. */
const instances = [
  "new Kind(i, false)",
  "new Kind(i, false)",
  "new Kind(i, true)",
  "new Kind(i, i % 2 === 0)",
  "new Kind(i, i % 3 === 0)",
  "later(new Kind(i, false))",
  "lost(new Kind(i, true))",
  "cleared(new Kind(i, true))",
  "new Below(i, i % 2 === 0)",
];

/** Literals of the scene's type. */
const literals = [
  "{ y: i }",
  "{ y: i }",
  "{ x: ONE, y: i }",
  "{ y: i, x: TWO }",
  "{ x: undefined, y: i }",
  "{ y: i, z: ONE }",
  "{ x: ONE, y: i, z: TWO }",
  "i % 2 ? { y: i } : { x: ONE, y: i }",
  "later({ y: i })",
  "lost({ x: ONE, y: i })",
];

/** What else may arrive where the type is written. */
const strangers = [
  "Object.assign({ y: i }, i % 2 ? { x: ONE } : {})",
  "{ ...{ y: i }, ...(i % 2 ? { x: TWO } : null) }",
  "new WithDefault(i)",
  "Object.create(above, { y: { value: i, enumerable: true, writable: true } })",
  "{ __proto__: above, y: i }",
  "pass({ y: i })",
  'pass({ x: "a stranger", y: i })',
  'JSON.parse(i % 2 ? \'{"y":1}\' : \'{"x":null,"y":1}\')',
  "Object.freeze({ y: i })",
  "Object.setPrototypeOf(new Kind(i, false), above)",
];

/** Expressions that read the optional fields of `it`. */
const reads = [
  "shown(it.x)",
  "shown(it.x)",
  'shown(it.x ?? "none")',
  "it.x === undefined",
  'it.x !== undefined ? "there" : "not there"',
  "typeof it.x",
  '"x" in it',
  'Object.hasOwn(it, "x")',
  "shown(it.x) + shown(it.z)",
  "shown(it.z) + shown(it.x) + it.y",
  "it.x ? 1 : 0",
  "it.x == null",
  "shown(it.x === it.z)",
  "Object.keys(it).join()",
  "shown((it.x as any) + 1)",
  'shown((({ x = "default" as any }) => x)(it))',
  "shown(it?.x)",
  "JSON.stringify(it)",
];

export function generate(random: Random): string {
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(2, 4); scene < total; scene++) {
    const [type, one, two] = random.pick(kinds);
    const filled = (text: string) => text.replaceAll("ONE", one).replaceAll("TWO", two);
    const asked = random.sample(reads, random.between(2, 4));
    // A scene is about the class or about the literals, so that the compiler knows what the function is given. In one scene of
    // three a stranger arrives as well.
    const isOfClass = random.chance(0.6);
    const made = [
      ...random.sample(isOfClass ? instances : literals, random.between(1, 3)),
      ...(random.chance(0.33) ? [`(${random.pick(strangers)}) as any`] : []),
    ].map(filled);
    const given = isOfClass ? "Kind" : "Shape";
    const text = `type Shape = { x?: ${type}; y: number; z?: ${type} };
class Kind {
  ${random.pick(["declare x?", "declare x?", "x?"])}: ${type};
  y: number;
  declare z?: ${type};
  constructor(y: number, full: boolean) {
    this.y = y;
    if (full) {
      this.x = ${one};
      this.z = ${two};
    }
  }
}
class Below extends Kind {}
class WithDefault {
  declare x?: ${type};
  declare z?: ${type};
  y: number;
  constructor(y: number) {
    this.y = y;
  }
}
(WithDefault.prototype as any).x = ${two};
const above = { x: ${two} };
function later(it: ${given}): ${given} {
  it.x = ${one};
  return it;
}
function lost(it: ${given}): ${given} {
  delete it.x;
  return it;
}
function cleared(it: ${given}): ${given} {
  it.x = undefined;
  return it;
}
function read(it: ${given}): string {
  return [${asked.join(", ")}].join();
}
function total(list: ${given}[]): number {
  let count = 0;
  for (let turn = 0; turn < ${random.pick([1, 30])}; turn++) for (const it of list) if (it.x !== undefined) count++;
  return count;
}
function scene(): string {
  const answers = new Set<string>();
  const list: ${given}[] = [];
  for (let i = 0; i < ${random.pick([2, 4, 60, 400])}; i++) {
    ${made.map((maker, at) => `const it${at}: ${given} = ${maker};\n    answers.add(read(it${at}).replaceAll(String(i), "i"));\n    if (i < 8) list.push(it${at});`).join("\n    ")}
  }
  return [...answers].sort().slice(0, 6).join(" / ") + " | " + total(list);
}
console.log("scene ${scene}", scene());`;
    scenes.push(
      text.replace(
        /\b(Shape|Kind|Below|WithDefault|above|later|lost|cleared|read|total|scene)\b(?! \d)/g,
        `$1${scene}`,
      ),
    );
  }
  return `const pass: any = Function("value", "return value");
function shown(value: unknown): string {
  if (Object.is(value, -0)) return "-0";
  if (typeof value === "function") return "function";
  if (typeof value === "bigint") return value + "n";
  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}
${scenes.join("\n")}
export {};
`;
}
