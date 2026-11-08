// An object serves as a table and is read, asked and written under keys that are put together while the program runs: two
// pieces joined, a slice of a longer string, a number turned into a string, a template, a function or an object used as a
// key. Some keys are there and some are not, some spell an index ("0", "10", "4294967294") or nearly one ("01", "1e3",
// "-1", "1.0"), and the table may also have elements, inherited names, names added after it was made, or getters.
import type { Random } from "./random";

/** Expressions that make the table. */
const tables = [
  '{ alpha: 1, beta: 2, "a-b": 3 }',
  '{ alpha: 1, 123: "index", "01": "nearly", beta: 2 }',
  '{ alpha: 1, 0: "zero", 10: "ten", "-1": "minus", "1e3": "power", "1.0": "dot" }',
  "Object.assign(new Row(), { late: 9 })",
  'Object.assign(new Row(), { 5: "five", late: 9 })',
  '{ __proto__: { inherited: 7, 3: "parent index" }, alpha: 1 }',
  "Object.create(null, { alpha: { value: 1, enumerable: true }, hidden: { value: 2 } })",
  '["x", "y", "z"]',
  'Object.assign(["x", "y"], { alpha: 1 })',
  '{ alpha: 1, get beta() {\n    return "got";\n  }, "[object Object]": "an object as a key" }',
  'Object.fromEntries(["alpha", "beta", "gamma", "10", "x10"].map((name, at) => [name, at]))',
  'JSON.parse(\'{"alpha":1,"beta":2,"7":"seven"}\')',
  "new Proxy({ alpha: 1 }, {})",
  '"text"',
];

/** Expressions that make a key out of `a`, `b` (strings nobody knows at build time) and `n` (a number). */
const keys = [
  "a + b",
  'a + b + ""',
  "`${a}${b}`",
  '(a + b + "tail").slice(0, -4)',
  '[a, b].join("")',
  "a.concat(b)",
  "String(n)",
  'n + ""',
  "`${n}`",
  '"0" + n',
  'n + "0"',
  "n.toFixed(1)",
  '"-" + n',
  "n",
  "n + 0.5",
  "-n",
  "(a + b).toUpperCase().toLowerCase()",
  "a[0] + (a + b).slice(1)",
  // A function of the program as a key would be its source text, which an executable and plain Bun print differently.
  "Object.assign(() => 1, { toString: () => a + b })",
  "Math.max",
  "{}",
  "[a + b]",
  "[n]",
  "Symbol.for(a + b)",
  "{ toString: () => a + b }",
  "null",
  "undefined",
];

/** Expressions about `table` and `key`. */
const questions = [
  "table[key]",
  "table[key] || table.alpha",
  "key in Object(table)",
  "Object.hasOwn(table, key)",
  "table[key] === undefined",
  "typeof table[key]",
  "table?.[key]",
  "Reflect.get(Object(table), key)",
  '((table[key] = "stored"), table[key])',
  "(delete table[key], table[key])",
  "Object.getOwnPropertyDescriptor(table, key)?.value",
  'table[key] ?? "none"',
];

const pieces = [["al", "pha"], ["be", "ta"], ["a", "-b"], ["la", "te"], ["inher", "ited"], ["mis", "sing"], ["1", "0"], ["0", "1"], ["", "0"], ["x", "10"], ["1", "e3"], ["leng", "th"], ["", ""], ["__pro", "to__"], ["42949672", "94"], ["42949672", "95"]]; // prettier-ignore

export function generate(random: Random): string {
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 7); scene < total; scene++) {
    const asked = random.sample(questions, random.between(1, 3));
    const chosen = random.sample(pieces, random.between(2, 5));
    const rounds = random.pick([1, 1, 100, 2000]);
    scenes.push(`function ask${scene}(table, a, b, n) {
  const key = ${random.pick(keys)};
  return [${asked.map(question => `told(() => ${question})`).join(", ")}].map(String).join(",");
}
{
  const answers = [];
  for (let round = 0; round < ${rounds}; round++) {
    const table = ${random.pick(tables)};
    ${chosen.map(([a, b], at) => `const answer${at} = ask${scene}(table, part(${JSON.stringify(a)}), part(${JSON.stringify(b)}), ${random.pick(["0", "1", "3", "5", "7", "10", "123", "4294967294", "4294967295", "-0", "1000"])});`).join("\n    ")}
    if (round === ${rounds - 1}) answers.push(${chosen.map((_, at) => `answer${at}`).join(", ")}, told(() => Reflect.ownKeys(Object(table)).map(String).join("+")));
  }
  console.log("scene ${scene}", answers.join(" | "));
}`);
  }
  return `class Row {
  alpha = 1;
  beta = 2;
}
const part = text => process.argv[9] ?? text;
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
