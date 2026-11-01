// `[1, 2, 3]`: a list literal of constants. All the lists that one literal makes may share one storage until one of them is
// written to, and then that one alone must change. Each scene makes lists out of a few literals in a hot loop, keeps them in
// a ring or a variable and reads them back there. About half of the scenes stop at that. The others write to one list: in the
// loop, in the caller, in a function that gets the list through text made at run time, or by a builtin. Each scene prints the
// changed list, its neighbors out of the same literals, and what a second run of the loop makes.
import type { Random } from "./random";

interface Kind {
  type: string;
  literals: string[];
  /** A value to look for. */
  sought: string;
  /** A value of the same type to store. */
  stored: string;
  /** Numbers read out of `old`, besides those every kind has. */
  reads: string[];
}

const kinds: Kind[] = [
  {
    type: "string",
    literals: ['["a", "bb"]', '["ccc", "d"]', '["x", "y", "z"]', '[""]', '["long text that is no key", "b"]', "[]"],
    sought: '"d"',
    stored: '"stored"',
    reads: ["old[i % 3]?.length ?? 100", '(old[0] ?? "").length', 'old.join("").length'],
  },
  {
    type: "number",
    literals: [
      "[1, 2, 3]",
      "[4, 5, 6]",
      "[7]",
      "[0, -1, 2147483647]",
      "[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]",
      "[]",
    ],
    sought: "5",
    stored: "9",
    reads: ["old[i & 3] ?? 100", "(old[1] ?? 0) * 2", "old[old.length - 1] ?? -1"],
  },
  {
    type: "number",
    literals: ["[1.5, 2.5]", "[3.5, -0]", "[NaN, 0.25, 1e300]", "[0.5]", "[1, 2.5, 3]", "[2147483648, 1]"],
    sought: "2.5",
    stored: "0.125",
    reads: ["old[i % 3] ?? 100", "Object.is(old[1], -0) ? 1 : 0", "(old[0] ?? 0) + 0.5"],
  },
  {
    type: "boolean",
    literals: ["[true, false]", "[false]", "[true, true, true]"],
    sought: "false",
    stored: "true",
    reads: ["old[i % 3] ? 1 : 0", "old[0] === undefined ? 2 : 3"],
  },
  {
    type: "string | number | null",
    literals: ['[1, "b", null]', '[null, "x"]', '["only text"]', "[3, 4]"],
    sought: "null",
    stored: '"stored"',
    reads: ['typeof old[i % 3] === "string" ? 1 : 0', "old[0] === null ? 1 : 0"],
  },
  {
    type: "number | undefined",
    literals: ["[1, , 3]", "[, 2]", "[undefined, 5]", "[6, 7]"],
    sought: "undefined",
    stored: "9",
    reads: ["old[i % 3] ?? 100", "1 in old ? 1 : 0"],
  },
  {
    type: "bigint",
    literals: ["[10n, 20n]", "[30n]"],
    sought: "20n",
    stored: "9n",
    reads: ["Number(old[i % 2] ?? 0n)"],
  },
  {
    type: "number[]",
    literals: ["[[1, 2], [3]]", "[[4]]", "[[], [5, 6]]"],
    sought: "old[0]!",
    stored: "[9]",
    reads: ["old[i % 2]?.[0] ?? 100", "old[0]?.length ?? -1"],
  },
];

const readsOfEveryKind = [
  "old.length",
  "old.length",
  "old.indexOf(SOUGHT)",
  "old.includes(SOUGHT) ? 1 : 0",
  "old.lastIndexOf(SOUGHT)",
  "old.at(-1) === SOUGHT ? 1 : 0",
  "i % 3 in old ? 1 : 0",
  "old.slice(1).length",
  "[...old].length",
  "Array.isArray(old) ? 1 : 0",
  "old.join().length",
  "(([first, ...rest]) => rest.length + (first === SOUGHT ? 1 : 0))(old)",
  "(([first, ...rest]) => rest.length + (first === SOUGHT ? 1 : 0))(old)",
  "(([, second]) => (second === SOUGHT ? 1 : 0))(old)",
  "[...old, ...old].length",
];

/** Statements of the loop that do more than read `old`. */
const writesInTheLoop = [
  "old[0] = STORED;",
  "old[0] = STORED;",
  "old[i & 3] = STORED;",
  "old.push(STORED);",
  "old.length = 1;",
  "old.pop();",
  "old.shift();",
  "old.unshift(STORED);",
  "old.reverse();",
  "old.fill(STORED);",
  "old.sort();",
  "old.splice(0, 1);",
  "old.copyWithin(0, 1);",
  "[old[0]] = [STORED];",
  "delete old[0];",
  "CHANGE(old);",
  "pass(old)[0] = STORED;",
  "Object.freeze(old);",
];

/** Statements of the caller that write to `one`, a list that the loop kept. */
const writesInTheCaller = [
  "one[0] = STORED;",
  "one[0] = STORED;",
  'one[1] = "of another kind";',
  "one[0] = 0.25;",
  "one.push(STORED);",
  "one.pop();",
  "one.shift();",
  "one.unshift(STORED);",
  "one.reverse();",
  "one.sort(() => 1);",
  "one.fill(STORED);",
  "one.length = 1;",
  "one.length = 0;",
  "one.splice(1, 1);",
  "one.copyWithin(0, 1);",
  "one[10] = STORED;",
  "delete one[0];",
  "[one[0]] = [STORED];",
  "CHANGE(one);",
  "CHANGE(one);",
  "byText(one, STORED);",
  "byText(one, STORED);",
  'Reflect.set(one, "0", STORED);',
  "Object.assign(one, [STORED]);",
  "Array.prototype.push.call(one, STORED);",
  'Object.defineProperty(one, "0", { value: STORED });',
  'Object.defineProperty(one, "0", { get: () => STORED });',
  "Object.freeze(one);",
  "one.extra = 1;",
  "Object.setPrototypeOf(one, null);",
  "for (const key in one) one[key] = STORED;",
  "if (Array.isArray(one[0])) one[0][0] = 9;",
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 6); scene < total; scene++) {
    const kind = random.pick(kinds);
    const list = kind.type.includes(" ") ? `(${kind.type})[]` : `${kind.type}[]`;
    const fill = (text: string) => {
      const filled = text
        .replaceAll("SOUGHT", kind.sought)
        .replaceAll("STORED", kind.stored)
        .replaceAll("CHANGE", `change${scene}`);
      return typed ? filled : filled.replaceAll("]!", "]");
    };
    const makers: string[] = [];
    const made = () => {
      // Now and then a list that is no constant stands beside the constants.
      const literal = random.chance(0.15) ? `[${kind.stored}, pass(${kind.stored})]` : random.pick(kind.literals);
      if (random.chance(0.6)) return literal;
      makers.push(`function make${scene}x${makers.length}()${as(list)} {\n  return ${literal};\n}`);
      return `make${scene}x${makers.length - 1}()`;
    };
    const read = () => fill(random.pick(random.chance(0.5) ? kind.reads : readsOfEveryKind));
    const isPlain = random.chance(0.45);
    const inTheLoop =
      !isPlain && random.chance(0.4)
        ? `if (i % ${random.pick([5, 7, 11])} === 0) ${fill(random.pick(writesInTheLoop))}`
        : "";
    const next = random.chance(0.7) ? `i & 1 ? ${made()} : ${made()}` : made();
    const size = random.pick([4, 8]);
    const loop = random.chance(0.7)
      ? `const kept${as(`${list}[]`)} = [];
  for (let k = 0; k < ${size}; k++) kept.push(${made()});
  for (let i = 0; i < rounds; i++) {
    kept[i & ${size - 1}] = ${next};
    const old = kept[(i + 3) & ${size - 1}]${typed ? "!" : ""};
    sum${scene} += ${read()};
    ${random.chance(0.4) ? `sum${scene} += ${read()};` : ""}
    ${inTheLoop}
  }`
      : `const kept${as(`${list}[]`)} = [];
  let last${as(list)} = ${made()};
  for (let i = 0; i < rounds; i++) {
    const old = last;
    last = ${next};
    sum${scene} += ${read()};
    ${inTheLoop}
    if (i > rounds - 5) kept.push(old);
  }`;
    const route = random.pick(["kept[1]", "pass(kept[1])", "pass(kept[1])", "pass(kept)[1]"]);
    const inTheCaller = isPlain && random.chance(0.6) ? "" : fill(random.pick(writesInTheCaller));
    scenes.push(`let sum${scene} = 0;
${makers.join("\n")}
function change${scene}(list${as(list)}) {
  list[0] = ${kind.stored};
}
function loop${scene}(rounds${as("number")})${as(`${list}[]`)} {
  ${loop}
  return kept;
}
function print${scene}(lists${as(`${list}[]`)})${as("string")} {
  let text = "";
  for (const list of lists) {
    text += list.length + "[";
    for (let at = 0; at < list.length && at < 5; at++) {
      text += at in list ? (Object.is(list[at], -0) ? "-0" : typeof list[at] + ":" + String(list[at])) + "," : "hole,";
    }
    text += "]";
  }
  return text;
}
function scene${scene}()${as("string")} {
  const kept = loop${scene}(${random.pick([8, 40, 200, 200])});
  const before = print${scene}(kept);
  const one${as("any")} = ${route};
  let thrown = "";
  try {
    ${inTheCaller}
  } catch (error) {
    thrown = ${typed ? "(error as Error)" : "error"}.name;
  }
  return [sum${scene}, before, thrown, print${scene}(kept), kept[0] === kept[2], Object.keys(one).length, print${scene}(loop${scene}(9))].join(" | ");
}
console.log("scene ${scene}", scene${scene}());
console.log("scene ${scene} again", scene${scene}());`);
  }
  return `const pass${as("any")} = Function("value", "return value");
const byText${as("any")} = Function("list", "value", "list[0] = value; list.push(value);");
${scenes.join("\n")}
${typed ? "export {};\n" : ""}`;
}
