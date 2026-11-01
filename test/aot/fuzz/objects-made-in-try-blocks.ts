// An object is made and filled inside a try block, and something between the stores may throw. The compiler may build the
// object later than the program says, or only on the path that needs it. What the catch block, the finally block and the
// code after them see must still be the object as it was at the throw: which stores had run, whether it is the same object
// as the one that was kept, and whether a closure over it sees the later stores.
import type { Random } from "./random";

/** Expressions that make the object. `n` is the scene's argument and `small` an object of the module. */
const makers = [
  "{ a: 1, b: n }",
  "{ ...small, d: n }",
  "{ a: 1, inner: { b: n } }",
  "[1, n]",
  "[...list, n]",
  "new Point(1, n)",
  "Object.assign({ a: 1 }, { b: n })",
  "{ a: 1, read: () => n }",
  "{ a: 1, b: n, get c() {\n      return this.a + this.b;\n    } }",
];

/** Statements inside the try block, after `made` is assigned. Some throw for some `n`. */
const steps = [
  "made.a = risky(n);",
  "made.a = 2;\n    risky(n);\n    made.a = 3;",
  "made.late = risky(n);",
  "made.late = 1;\n    risky(n);",
  "risky(n);",
  "if (n & 1) kept.push(made);",
  "if (n & 1) kept.push(made);\n    risky(n);",
  "kept.push(made);\n    made.a = risky(n);",
  "const reader = () => made.a;\n    readers.push(reader);\n    made.a = risky(n);",
  "made.self = made;\n    risky(n);",
  "made.a = nothing(n).a;",
  "made.a = [n][0] > 1 ? risky(n) : 5;",
  "for (let i = 0; i < 3; i++) {\n      made.a = i;\n      if (i === n) risky(1);\n    }",
  "made = { ...made, more: risky(n) };",
  "other = made;\n    made = { a: risky(n) };",
  "delete made.a;\n    risky(n);",
  "Object.freeze(made);\n    made.a = 9;",
];

/** Statements for the catch block. */
const catches = [
  'log.push("caught " + shown(made));',
  'log.push("caught " + shown(made));\n    kept.push(made);',
  'log.push("caught " + error.name);',
  'log.push("caught " + shown(made) + " " + (kept.at(-1) === made));',
  "made = undefined;",
  'if (made) made.a = "from catch";',
  "",
];

const finals = ["", "", 'log.push("finally " + shown(made));', "if (made) made.done = true;", "kept.push(made);"];

/** How the try statement stands in the function. TRY is the statement. */
const frames = [
  "TRY",
  "TRY",
  "for (let round = 0; round < 2; round++) {\n  TRY\n}",
  "for (let round = 0; round < 3; round++) {\n  if (round === 1) continue;\n  TRY\n}",
  'try {\n  TRY\n} finally {\n  log.push("outer " + shown(made));\n}',
  "if (n >= 0) {\n  TRY\n}",
];

export function generate(random: Random): string {
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(2, 5); scene < total; scene++) {
    const inTry = [`made = ${random.pick(makers)};`, ...random.sample(steps, random.between(1, 3))].join("\n    ");
    const final = random.pick(finals);
    const statement = `try {
    ${inTry}
  } catch (error) {
    ${random.pick(catches)}
  }${final ? ` finally {\n    ${final}\n  }` : ""}`;
    const times = random.pick([4, 4, 300]);
    scenes.push(`function scene${scene}(n) {
  const log = [];
  let made;
  let other;
  ${random.pick(frames).replace("TRY", statement)}
  log.push("after " + shown(made) + " " + shown(other));
  return log.join(" ; ");
}
{
  const answers = [];
  for (let n = 0; n < ${times}; n++) {
    const answer = told(() => scene${scene}(n % 4));
    if (n < 4) answers.push(answer);
  }
  console.log("scene ${scene}", answers.join(" || "));
  console.log("scene ${scene} kept", kept.length, kept.slice(0, 4).map(shown).join(" | "), readers.slice(0, 4).map(reader => told(reader)).join());
  kept.length = 0;
  readers.length = 0;
}`);
  }
  return `const small = { a: 1, b: 2, c: 3 };
const list = [7, 8];
const kept = [];
const readers = [];
class Point {
  constructor(a, b) {
    this.a = a;
    this.b = b;
  }
}
// Throws for 1 and 3.
function risky(n) {
  if (n & 1) throw new Error("risky " + n);
  return n + 10;
}
function nothing(n) {
  return n === 2 ? null : { a: n };
}
function shown(value, depth = 0) {
  if (typeof value === "function") return "function " + value();
  if (value === null || typeof value !== "object") return String(value);
  if (depth > 1) return "deep";
  const parts = Reflect.ownKeys(value).map(name => String(name) + "=" + (value[name] === value ? "itself" : shown(value[name], depth + 1)));
  return (Array.isArray(value) ? "list " : value.constructor.name + " ") + parts.join(",");
}
function told(ask) {
  try {
    return ask();
  } catch (error) {
    return "threw " + error.name;
  }
}
${scenes.join("\n")}
`;
}
