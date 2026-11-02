// A Map or Set whose table changes form as it grows: a compiler's run time may scan a few entries and index the rest, with sizes in
// a byte. Each scene takes a table across 8, 254 or 255 entries and varies what could leave the index behind: many deletes followed
// by new keys, a clear, an iterator alive across growth and clear, a string key in another cell with the same text, 16-bit text,
// -0 and NaN, and tables made from a written list that later change.
import type { Random } from "./random";

const sizes = [3, 7, 8, 9, 16, 17, 253, 254, 255, 256, 257, 300, 520];

/** Text of a key from its number `at`. */
const keyMakers = [
  "at",
  "at * 0.5",
  "-at",
  "at === 0 ? -0 : at",
  "at % 50 === 49 ? NaN : at",
  '"k" + at',
  '"k" + at',
  'word("k" + at)',
  '"é" + at',
  '"😀" + at',
  '"中文" + at',
  '["k", at].join("")',
  '("kk" + at).slice(1)',
  "String.fromCharCode(0x4e00 + (at & 255))",
  "String.fromCharCode(65 + (at & 63))",
  "objects[at & 63]",
  "at % 2 ? at : String(at)",
  "at % 3 ? BigInt(at) : at",
  "at % 5 === 4 ? null : at",
  "at % 7 === 6 ? undefined : at",
];

const changes = [
  "for (let at = 0; at < size; at += 2) table.delete(key(at));",
  "for (let at = 0; at < size; at++) table.delete(key(at));",
  "for (let at = 0; at < size - 1; at++) table.delete(key(at));",
  "for (let at = 0; at < size; at += 2) table.delete(key(at));\n  for (let at = 0; at < size; at += 2) add(table, key(at + size));",
  "for (let at = 0; at < size; at++) table.delete(key(at));\n  for (let at = 0; at < size; at++) add(table, key(at + size));",
  "for (let round = 0; round < 40; round++) {\n    add(table, key(size + round));\n    table.delete(key(size + round));\n  }",
  "for (let round = 0; round < 300; round++) {\n    add(table, key(round + size));\n    table.delete(key(round));\n  }",
  "table.clear();",
  "table.clear();\n  for (let at = 0; at < 9; at++) add(table, key(at));",
  "for (let at = 0; at < 300; at++) add(table, key(at));",
  "add(table, key(1));",
];

const walks = [
  "for (const each of table) { said += shown(each); if (++seen > 12) break; }",
  "table.forEach((value: ANY, key: ANY) => { if (++seen < 12) said += shown(key); });",
  "const live = table.keys(); said += shown(live.next().value); CHANGE; said += shown(live.next().value); said += table.size;",
  "const live = table.entries(); for (let at = 0; at < 9; at++) live.next(); CHANGE; said += shown(live.next().value); said += table.size;",
  "const live = table.values(); CHANGE; said += JSON.stringify(shown([...live].slice(0, 12)));",
  "for (const each of table.keys()) { if (++seen === 3) { CHANGE; } if (seen < 16) said += shown(each); if (seen > 900) break; }",
  "table.forEach((value: ANY, key: ANY) => { if (++seen === 3) { CHANGE; } if (seen < 16) said += shown(key); });",
];

const asks = [
  "table.size",
  "table.has(key(0))",
  "table.has(key(size - 1))",
  "table.has(key(size))",
  "table.has(key(8))",
  "table.has(key(254))",
  "isMap ? shown(table.get(key(0))) : 0",
  "isMap ? shown(table.get(key(size >> 1))) : 0",
  "table.delete(key(size >> 1))",
  'table.has("k" + 3)',
  'table.has(word("k3"))',
  "table.has(NaN)",
  "table.has(0)",
  "table.has(-0)",
  "shown([...table][0])",
  "shown([...table].at(-1))",
  "[...table.keys()].length",
];

const written = [
  '["a", "b", "c"]',
  '["a", "b", "c", "d", "e", "f", "g", "h"]',
  '["a", "b", "c", "d", "e", "f", "g", "h", "i"]',
  '["é", "中", "😀"]',
  "[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]",
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 6); scene < total; scene++) {
    const isMap = random.chance(0.6);
    const isPlain = random.chance(0.35);
    const size = random.pick(sizes);
    const maker = isPlain ? random.pick(['"k" + at', "at"]) : random.pick(keyMakers);
    const change = isPlain ? "" : random.pick(changes).replace(/\btable\b/g, "table");
    const walk =
      isPlain || random.chance(0.5)
        ? ""
        : random
            .pick(walks)
            .replace(/CHANGE/g, change || "table.clear()")
            .replace(/: ANY/g, typed ? ": any" : "");
    const isWritten = !isPlain && random.chance(0.3);
    const list = random.pick(written);
    const made = isWritten
      ? isMap
        ? `new Map${typed ? "<any, any>" : ""}(${list}.map((each${as("any")}, at${as("number")}) => [each, at]))`
        : `new Set${typed ? "<any>" : ""}(${list})`
      : isMap
        ? `new Map${typed ? "<any, any>" : ""}()`
        : `new Set${typed ? "<any>" : ""}()`;
    const picked = random.sample(asks, random.between(2, 5));
    const turns = random.pick([1, 3, 20]);
    scenes.push(`function run${scene}(turn${as("number")}) {
  const size = ${size};
  const isMap = ${isMap};
  const key = (at${as("number")})${as("any")} => ${maker};
  const table${as("any")} = ${made};
  let said = "";
  let seen = 0;
  for (let at = 0; at < size; at++) add(table, key(at));
  said += table.size + ";";
  ${walk && random.chance(0.5) ? `{ ${walk} }` : ""}
  ${change}
  ${walk ? `{ ${walk} }` : ""}
  said += [${picked.map(ask => `String(${ask})`).join(", ")}].join(" ");
  return said + " " + turn;
}
{
  let hash = 0;
  let last = "";
  for (let turn = 0; turn < ${turns}; turn++) {
    try {
      last = run${scene}(turn);
    } catch (error) {
      last = "threw " + ${typed ? "(error as Error).name" : "error.name"};
    }
    for (let at = 0; at < last.length; at++) hash = (hash * 31 + last.charCodeAt(at)) | 0;
  }
  console.log("scene ${scene}", hash, last.slice(0, 300));
}`);
  }
  return `const word${as("(text: string) => string")} = Function("text", "return text")${
    typed ? " as (text: string) => string" : ""
  };
const objects = Array.from({ length: 64 }, (_, at) => ({ at }));
function add(table${as("any")}, key${as("any")}) {
  if (table instanceof Map) table.set(key, typeof key === "bigint" ? 0 : key);
  else table.add(key);
}
function shown(value${as("any")})${as("string")} {
  return typeof value === "bigint" ? value + "n" : Object.is(value, -0) ? "-0" : JSON.stringify(value, (_, each) => (typeof each === "bigint" ? each + "n" : each)) + "";
}
${scenes.join("\n")}
${typed ? "export {};\n" : ""}`;
}
