// `f(...list)`, with the spread as the only argument. The call may take the elements straight out of the list, without a copy,
// as long as nobody can tell. A callee that gathers them in a rest parameter or in `arguments` gets a list of its own: what it
// stores there, pushes, sorts or keeps must not show in the caller's list, and what the caller does to its list later must not
// show in what the callee kept. Each scene picks the list, the callee, how it is found and what both sides do afterwards, and
// prints both lists. Lists with holes, of other kinds, that change while the call is made, and things that are no lists come by.
import type { Random } from "./random";

/** Expressions for the list. */
const lists = [
  "[1, 2, 3]",
  "[1, 2, 3]",
  "[i, i + 1]",
  "[]",
  "[1.5, 2.5]",
  '["a", "b", "c"]',
  "[{ n: 1 }, { n: 2 }]",
  "[1, , 3]",
  "[, ,]",
  "new Array(3)",
  "Array.from({ length: 5 }, (_, at) => at)",
  "shared",
  "Object.freeze([1, 2])",
  "new Below(1, 2, 3)",
  'word("text")',
  "new Set([1, 2])",
  "new Map([[1, 2]])",
  "counting()",
  "new Uint8Array([1, 2])",
  "walked",
  "[1, 2, 3].slice(1)",
  "word([7, 8])",
  "Array.from({ length: 300 }, (_, at) => at)",
  "word(null)",
  "word(5)",
];

/** Bodies of the callee. `all` is its rest parameter. */
const bodies = [
  "return all.length;",
  'return all.length + ":" + all[0];',
  'all[0] = "stored";\n  return all.join();',
  'all.push("pushed");\n  return all.length;',
  "all.length = 0;\n  return all.length;",
  "all.sort().reverse();\n  return all.join();",
  "kept.push(all);\n  return all.length;",
  "all.shift();\n  return all.join();",
  "shared.push(9);\n  return all.join();",
  "shared.length = 0;\n  return all.join();",
  "return all === shared;",
  'return Array.isArray(all) + "," + (all instanceof Below) + "," + Object.isFrozen(all);',
  'return (0 in all) + "," + (1 in all) + "," + Object.keys(all).join();',
  "return again(...all);",
  "return all.map(each => typeof each).join();",
  'delete all[0];\n  return all.length + "," + (0 in all);',
];

/** Callees that do not gather: named parameters and `arguments`. */
const others = [
  "function callee(a, b, c) {\n  return [a, b, c].join();\n}",
  'function callee(a, b = "default") {\n  return a + "," + b + "," + arguments.length;\n}',
  'function callee() {\n  arguments[0] = "stored";\n  return arguments.length + "," + Array.prototype.join.call(arguments);\n}',
  'function callee(a) {\n  a = "stored";\n  return arguments[0] + "," + arguments.length;\n}',
  "function callee(first, ...rest) {\n  rest.push(first);\n  kept.push(rest);\n  return rest.join();\n}",
  'const callee = (a, b) => a + "," + b;',
  "function callee() {\n  kept.push(arguments);\n  return arguments.length;\n}",
];

/** Expressions that make the call. */
const calls = [
  "callee(...list)",
  "callee(...list)",
  "callee(...list)",
  "holder.callee(...list)",
  "table[i % table.length](...list)",
  "(0, callee)(...list)",
  "callee.call(null, ...list)",
  "callee.apply(null, list)",
  "Reflect.apply(callee, null, list)",
  "callee.bind(null)(...list)",
  "new Made(...list).said",
  "callee?.(...list)",
  "callee(...list, ...[])",
  "Math.max(...list)",
  "String.fromCharCode(...list)",
  "[].concat(...list).length",
  "callee(...(isRare ? shared : list))",
];

export function generate(random: Random): string {
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 6); scene < total; scene++) {
    const callee = random.chance(0.65) ? `function callee(...all) {\n  ${random.pick(bodies)}\n}` : random.pick(others);
    const after = random.pick(["", "", "", 'if (Array.isArray(list) && !Object.isFrozen(list)) list[0] = "later";', "if (Array.isArray(list) && !Object.isFrozen(list)) list.length = 0;", "if (Array.isArray(list) && !Object.isFrozen(list)) list.push(\"later\");"]); // prettier-ignore
    const text = `${callee}
function again(...all) {
  all.push("again");
  return all.length;
}
class Made {
  constructor(...all) {
    this.said = callee(...all);
  }
}
const holder = { callee };
const table = [callee, callee];
function scene() {
  const answers = new Set();
  for (let i = 0; i < ${random.pick([1, 3, 60, 400])}; i++) {
    const isRare = ${random.pick(["i === 1", "i % 37 === 5", "false"])};
    shared.length = 0;
    shared.push(4, 5, 6);
    let line = "";
    try {
      const list = ${random.pick(lists)};
      line += ${random.pick(calls)};
      line += " | " + shown(list);
      ${after}
      line += " | " + kept.splice(0).map(shown).join(";") + " | " + shown(shared);
    } catch (error) {
      kept.length = 0;
      line += " threw " + error.name;
    }
    // The iteration's number is taken out, so that the usual iterations give one answer.
    answers.add(line.replaceAll(String(i), "i"));
  }
  return [...answers].slice(0, 5).join(" / ");
}
console.log("scene ${scene}", scene());`;
    scenes.push(text.replace(/\b(callee|again|Made|holder|table|scene)\b(?! \d)/g, `$1${scene}`).replaceAll(`holder${scene}.callee${scene}`, `holder${scene}.callee`).replaceAll(`{ callee${scene} }`, `{ callee: callee${scene} }`)); // prettier-ignore
  }
  return `const kept = [];
const shared = [4, 5, 6];
const word = value => (process.argv[9] ? [] : value);
class Below extends Array {}
function* counting() {
  yield 1;
  shared.push("while it was walked");
  yield 2;
}
// A list whose own iterator answers something else.
const walked = Object.assign([1, 2], {
  *[Symbol.iterator]() {
    yield "own";
    yield "iterator";
  },
});
function shown(it) {
  if (it === null || typeof it !== "object") return String(it);
  let text = "";
  const length = typeof it.length === "number" ? Math.min(it.length, 6) : 0;
  for (let at = 0; at < length; at++) text += (at in it ? (typeof it[at] === "object" ? "object" : String(it[at])) : "hole") + ",";
  return (it.length ?? it.size ?? "none") + "[" + text + "]";
}
${scenes.join("\n")}
`;
}
