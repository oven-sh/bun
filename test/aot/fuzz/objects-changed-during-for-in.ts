// A for-in loop lists the keys an object had when the loop began, skips a key that was deleted before its turn and does not
// list keys that were added meanwhile. Each scene walks an object (a literal, an instance, one with elements, one with
// inherited keys, a list, a copy) in a loop that runs often, and the body changes the object, its prototype or another
// object of the same shape: directly, through a helper, through a getter that the body reads, or only in one late round.
import type { Random } from "./random";

/** Expressions that make the object. */
const makers = [
  "{ a: 1, b: 2, c: 3, d: 4 }",
  '{ a: 1, b: 2, c: 3, d: 4, 1: "one", 0: "zero" }',
  "new Four()",
  "Object.assign(new Four(), { e: 5 })",
  'Object.create({ inherited: 1, b: "hidden" }, Object.getOwnPropertyDescriptors({ a: 1, b: 2, c: 3 }))',
  "{ __proto__: { x: 1, y: 2 }, a: 1, b: 2 }",
  "{ ...{ a: 1, b: 2 }, c: 3, d: 4 }",
  "[10, 20, 30, 40]",
  "Object.assign([10, 20], { a: 1, b: 2 })",
  'Object.fromEntries([["a", 1], ["b", 2], ["c", 3], ["d", 4]])',
  "{ a: 1, get b() {\n      touch(this);\n      return 2;\n    }, c: 3, d: 4 }",
  'JSON.parse(\'{"a":1,"b":2,"c":3,"d":4}\')',
];

/** Statements in the body. `it` is the object, `name` the key of this turn, `turn` counts the turns of this walk. */
const bodies = [
  "",
  "if (turn === 0) delete it.c;",
  "if (turn === 1) delete it.a;",
  "if (turn === 0) delete it[Object.keys(it).at(-1)];",
  "if (turn === 0) it.added = 1;",
  'it["more" + turn] = turn;',
  'if (turn === 0) {\n      delete it.c;\n      it.c = "again";\n    }',
  'if (turn === 0) Object.defineProperty(it, "c", { enumerable: false });',
  "if (turn === 0) Object.setPrototypeOf(it, { late: 1 });",
  // An executable refuses a write to a built-in prototype.
  "if (turn === 0 && !builtIn.includes(Object.getPrototypeOf(it))) Object.getPrototypeOf(it).lateOnParent = 1;",
  "if (turn === 0) change(it);",
  'if (turn === 1) it[5] = "five";',
  "if (turn === 0) it.length = 1;",
  "if (turn === 0) Object.freeze(it);",
  "it[name] = 0;",
  "if (turn === 0) delete sibling.c;",
  "delete it[name];",
  "if (turn === 0) for (const inner in it) delete it[inner];",
];

export function generate(random: Random): string {
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(2, 5); scene < total; scene++) {
    const maker = random.pick(makers);
    const body = random.pick(bodies);
    const rounds = random.pick([1, 3, 300, 3000]);
    const isOnlyLate = random.chance(0.4) && rounds > 1 && body !== "";
    scenes.push(`function walk${scene}(round) {
  const it = ${maker};
  const sibling = ${maker};
  let seen = "";
  let turn = 0;
  for (const name in it) {
    seen += name + ",";
    ${isOnlyLate ? `if (round === ${rounds - 1}) {\n      ${body}\n    }` : body}
    ${random.pick(["", "", 'seen += typeof it[name] + ";";', 'seen += (name in it) + ";";'])}
    turn++;
    if (turn > 20) break;
  }
  let after = "";
  for (const name in it) after += name + ",";
  let beside = "";
  for (const name in sibling) beside += name + ",";
  return seen + " then " + after + " beside " + beside;
}
{
  const answers = new Set();
  let last;
  for (let round = 0; round < ${rounds}; round++) answers.add((last = told(() => walk${scene}(round))));
  console.log("scene ${scene}", answers.size, [...answers].slice(0, 2).join(" | "), "| last", last);
}`);
  }
  return `const builtIn = [Object.prototype, Array.prototype];
class Four {
  a = 1;
  b = 2;
  c = 3;
  d = 4;
}
function change(it) {
  delete it.b;
  it.z = 26;
}
function touch(it) {
  delete it.d;
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
