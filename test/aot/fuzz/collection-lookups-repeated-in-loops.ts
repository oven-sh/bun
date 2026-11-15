// `map.get(key)`, `map.has(key)` and `set.has(key)` with the same collection and key in every iteration of a loop. Where
// nothing in the loop writes to a collection the compiler may look once, before the loop. Each scene has such a loop, and in
// most of them something does write, in a few iterations and by a hidden path: an alias, a function called through a table, a
// getter, a callback, a generator, an await, a finally block, the loop's own condition. Or the collection, the key or the
// method is not what it seems: a subclass that overrides the method, an own property, a variable that is assigned in the
// loop, null, -0 and NaN, a loop that is never entered. Every distinct answer of the loop is printed in the order it came.
import type { Random } from "./random";

/** Declarations of `held`, the collection, and `key`. */
const collections = [
  'const held = new Map([["k", 1]]);\n  const key = "k";',
  'const held = new Map([["k", 1]]);\n  const key = "k";',
  'const held = new Map([["k", 1]]);\n  const key = word("k");',
  "const key = { id: 1 };\n  const held = new Map([[key, 1]]);",
  "const held = new Map([[1, 1]]);\n  const key = 1;",
  "const held = new Map([[0, 1]]);\n  const key = -0;",
  "const held = new Map([[NaN, 1]]);\n  const key = NaN;",
  'const held = new Map();\n  const key = "k";',
  'const held = new Set(["k"]);\n  const key = "k";',
  "const key = [1];\n  const held = new Set([key]);",
  'const held = new Counting([["k", 1]]);\n  const key = "k";',
  'const held = new Below([["k", 1]]);\n  const key = "k";',
  'const held = Object.assign(new Map([["k", 1]]), { get: () => "an own get", has: () => "an own has" });\n  const key = "k";',
  "const key = {};\n  const held = new WeakMap([[key, 1]]);",
  'const held = new Map([["k", { n: 1 }]]);\n  const key = "k";',
  'const held = new Map([["k" + "x".repeat(20), 1]]);\n  const key = word("k") + "x".repeat(20);',
];

/** Expressions that look into `held`. */
const lookups = [
  "held.get(key)",
  "held.get(key)",
  "held.has(key)",
  "held.has(key)",
  'held.get(key) ?? "none"',
  'held.has(key) ? held.get(key) : "none"',
  "held.get(key)?.n",
  'held.size + ":" + held.has(key)',
  "Map.prototype.get.call(held, key)",
  "Map.prototype.has.call(held, key)",
  "Set.prototype.has.call(held, key)",
  "lookUp(held, key)",
];

/** Statements that write, or may write, in the iteration where `isRare` holds. `alias` is the same collection. */
const writes = [
  "",
  "",
  "if (isRare) held.set?.(key, i);",
  "if (isRare) held.delete(key);",
  "if (isRare) held.clear?.();",
  'if (isRare) alias.set?.(key, "by alias");',
  "if (isRare) alias.delete(key);",
  "if (isRare) box.inside.delete(key);",
  "if (isRare) ways[i % ways.length](alias, key);",
  "if (isRare) unknown(alias, key);",
  "if (isRare) void trap.touched;",
  "if (isRare) [1].forEach(() => alias.delete(key));",
  "if (isRare) steps.next();",
  "if (isRare) other.set(key, i);",
  'if (isRare) held.add?.("another");',
  'if (isRare) held.set?.("another", i);',
  'try {\n      if (isRare) throw new Error("thrown");\n    } catch {\n      alias.delete(key);\n    }',
  "try {\n      if (isRare) continue;\n    } finally {\n      if (isRare) alias.delete(key);\n    }",
  "if (isRare) Reflect.apply(Map.prototype.delete, alias, [key]);",
  "if (isRare && held.get(key)?.n) held.get(key).n = 2;",
  'if (isRare) for (let n = 0; n < 100; n++) alias.set?.("fill" + n, n);',
  "if (isRare) Bun.gc(true);",
];

/** Loop heads. BODY stands inside. */
const loops = [
  "for (let i = 0; i < turns; i++) {",
  "for (let i = 0; i < turns; i++) {",
  "let i = -1;\n  while (++i < turns) {",
  "for (let i = 0; i < turns && held.size !== 77; i++) {",
  "for (const i of counted(turns)) {",
  "for (let i = turns - 1; i >= 0; i--) {",
  "for (let i = 0; i < turns; i++)\n  for (let inner = 0; inner < 2; inner++) {",
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 6); scene < total; scene++) {
    const turns = random.pick([0, 1, 3, 300, 3000]);
    const when = random.pick(["i === 1", "i === turns - 2", "i % 97 === 5", "i === turns >> 1", "i === 0", "false"]);
    const isAsync = random.chance(0.15);
    const isReassigned = random.chance(0.1);
    const collection = random.pick(collections);
    const declared = (isReassigned ? collection.replace("const held", "let held") : collection).replace(/(const|let) held =/, `$1 held${as("any")} =`).replace("const key =", `const key${as("any")} =`); // prettier-ignore
    scenes.push(`${isAsync ? "async " : ""}function scene${scene}(turns${as("number")})${as(isAsync ? "Promise<string>" : "string")} {
  ${declared}
  const alias = held;
  const box = { inside: held };
  const other = new Map${typed ? "<any, any>" : ""}();
  const trap = {
    get touched() {
      return alias.delete(key);
    },
  };
  const steps = (function* () {
    for (;;) yield alias.delete(key);
  })();
  const answers${as("string[]")} = [];
  ${isAsync ? "later.push(() => alias.delete(key));" : ""}
  ${random.pick(loops)}
    const isRare = ${when};
    ${random.pick(writes)}
    ${isReassigned ? 'if (isRare) held = new Map([[key, "another collection"]]);' : ""}
    ${isAsync ? "if (isRare) await turn();" : ""}
    const answer = String(${random.pick(lookups)});
    if (answers[answers.length - 1] !== answer) answers.push(answer);
  }
  return answers.slice(0, 8).join(" > ") + " | " + told(() => held.size);
}
console.log("scene ${scene}", ${isAsync ? "await toldLater" : "told"}(() => scene${scene}(${turns})), log.splice(0).length);`);
  }
  return `const log${as("string[]")} = [];
const later${as("(() => unknown)[]")} = [];
const word = (text${as("string")})${as("string")} => process.argv[9] ?? text;
class Counting extends Map${typed ? "<any, any>" : ""} {
  get(key${as("any")}) {
    log.push("get");
    return super.get(key) + log.length;
  }
  has(key${as("any")}) {
    log.push("has");
    return log.length % 2 === 0;
  }
}
class Below extends Map${typed ? "<any, any>" : ""} {}
const ways${as("((held: any, key: any) => unknown)[]")} = [(held, key) => held.delete(key), (held, key) => held.set?.(key, "by a table"), () => 0];
const unknown${as("(held: any, key: any) => unknown")} = process.argv[9] ? () => 0 : (held, key) => held.delete(key);
const lookUp = (held${as("any")}, key${as("any")}) => held.get?.(key);
// Whatever waits runs while the loop is suspended.
const turn = async () => {
  await null;
  for (const run of later.splice(0)) run();
};
function* counted(turns${as("number")}) {
  for (let i = 0; i < turns; i++) yield i;
}
function told(ask${as("() => unknown")})${as("unknown")} {
  try {
    return ask();
  } catch (error) {
    return "threw " + ${typed ? "(error as Error)" : "error"}.name;
  }
}
async function toldLater(ask${as("() => unknown")})${as("Promise<unknown>")} {
  try {
    return await ask();
  } catch (error) {
    return "threw " + ${typed ? "(error as Error)" : "error"}.name;
  }
}
${scenes.join("\n")}
${typed ? "export {};\n" : ""}`;
}
