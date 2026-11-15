// The least programs that use a text as a key which the compiler may work out by itself: how the text comes about, times what is asked under it, times the object, times the loop, times where the text is made, times how often the function is called.
//
//   bun write-folded-key-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<text>--<deed>--<object>--<loop>--<place>--<calls>.mjs, .cjs or .ts
//   bun write-folded-key-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `given` is what is handed over.
const texts: [name: string, given: string, text: string][] = [
  ["slice", "'xa'", "given.slice(1)"],
  ["slice-two", "'xab'", "given.slice(1, 2)"],
  ["substring", "'xa'", "given.substring(1)"],
  ["substr", "'xa'", "given.substr(1, 1)"],
  ["character", "'xa'", "given[1]"],
  ["char-at", "'xa'", "given.charAt(1)"],
  ["at", "'xa'", "given.at(-1)"],
  ["joined", "'a'", "given + ''"],
  ["prefixed", "'b'", "'a' + given"],
  ["template", "'b'", "`a${given}`"],
  ["concat", "'a'", "given.concat('b', 1)"],
  ["lower", "'A'", "given.toLowerCase()"],
  ["upper", "'a'", "given.toUpperCase()"],
  ["trimmed", "' a '", "given.trim()"],
  ["padded", "'a'", "given.padStart(3, '0')"],
  ["repeated", "'a'", "given.repeat(2)"],
  ["replaced", "'xa'", "given.replace('x', '')"],
  ["split", "'a,b'", "given.split(',')[0]"],
  ["list-joined", "['a', 'b']", "given.join('')"],
  ["code", "97", "String.fromCharCode(given)"],
  ["number", "7", "String(given)"],
  ["number-text", "255", "given.toString(16)"],
  ["fixed", "1.5", "given.toFixed(1)"],
  ["kind", "'a'", "typeof given"],
  ["field", "{ k: 'a' }", "given.k"],
  ["element", "['a', 'b']", "given[0]"],
  ["choice", "'a'", "n > 2 ? given : 'b'"],
  ["or", "'a'", "given || 'b'"],
  ["itself", "'a'", "given"],
  ["parsed", "'[1]'", "String(JSON.parse(given)[0])"],
  ["name", "class Named {}", "given.name"],
  ["wide", "'x\\u00e9'", "given.slice(1)"],
  ["empty", "'x'", "given.slice(1)"],
  ["index", "'x1'", "given.slice(1)"],
  ["prototype-name", "'xtoString'", "given.slice(1)"],
  ["proto", "'x__proto__'", "given.slice(1)"],
  ["length-name", "'xlength'", "given.slice(1)"],
  ["long", "'xa_long_name_of_a_field'", "given.slice(1)"],
  ["symbol-text", "Symbol('a')", "given.description"],
  ["uri", "'a%20b'", "decodeURIComponent(given)"],
];
// `to` is the object, K the text.
const deeds: [name: string, text: string][] = [
  ["store", "to[K] = 1;"],
  ["store-counter", "to[K] = i;"],
  ["read", "say(to[K]);"],
  ["added", "to[K] = (to[K] ?? 0) + 1;"],
  ["stepped", "to[K]++;"],
  ["compound", "to[K] += 2;"],
  ["has", "say(K in to);"],
  ["own", "say(Object.hasOwn(to, K));"],
  ["removed", "say(delete to[K]);"],
  ["optional", "say(to?.[K]?.length);"],
  ["called", "say(to[K]?.(1));"],
  ["if-missing", "if (!(K in to)) to[K] = i;"],
  ["nullish", "to[K] ??= i;"],
  ["pattern", "const { [K]: got = 'none' } = to;\nsay(got);"],
  ["literal", "say(JSON.stringify({ [K]: i }));"],
  ["defined", "Object.defineProperty(to, K, { value: i, configurable: true, enumerable: true, writable: true });"],
  ["switch", "switch (K) {\n  case 'a':\n    say('sa');\n    break;\n  default:\n    say('so');\n}"],
  ["compared", "if (K === 'a') say('same');\nelse say('other');"],
  ["map", "m.set(K, (m.get(K) ?? 0) + 1);\nsay(m.get(K));"],
  ["set", "q.add(K);\nsay(q.size);"],
  ["both", "to[K] = i;\nsay(to.a);\nsay(to[K]);"],
  ["tested", "if (!Number.isInteger(K)) to[K] = 1;"],
];
const objects: [name: string, text: string][] = [
  ["empty", "{}"],
  ["literal", "{ a: 5, b: 6 }"],
  ["instance", "new C()"],
  ["without-prototype", "Object.create(null)"],
  ["list", "[1, 2]"],
  ["function", "function () {}"],
  ["class", "class {\n  static a = 3;\n}"],
  ["handed", "handed"],
  ["of-file", "kept"],
  ["frozen", "Object.freeze({ a: 5 })"],
  ["heir", "Object.create({ a: 5 })"],
  ["view", "new Uint8Array(3)"],
  ["text", "'abc'"],
];
const loops: [name: string, text: string][] = [
  ["given", "for (let i = 0; i < n; i++) {\n  IN\n}"],
  ["three", "for (let i = 0; i < 3; i++) {\n  IN\n}"],
  ["unknown", "for (let i = 0; i < three; i++) {\n  IN\n}"],
  ["while", "let i = 0;\nwhile (i < three) {\n  IN\n  i++;\n}"],
  ["of", "for (const i of [1, 2]) {\n  IN\n}"],
  ["nested", "for (let j = 0; j < 2; j++)\n  for (let i = 0; i < three; i++) {\n    IN\n  }"],
  ["once", "{\n  const i = 1;\n  IN\n}"],
  ["each", "[1, 2].forEach(i => {\n  IN\n});"],
  ["try", "for (let i = 0; i < three; i++) {\n  try {\n    IN\n  } catch (e) {\n    say(e.name);\n  }\n}"],
];
const places: [name: string, front: string, key: string][] = [
  ["in-front", "const x = TEXT;", "x"],
  ["in-place", "", "TEXT"],
  ["variable", "let x = TEXT;", "x"],
  ["late", "let x = 'b';\nx = TEXT;", "x"],
  ["closure", "const f = () => TEXT;", "f()"],
  ["callee", "const x = keyOf(given, n);", "x"],
];
const calls: [name: string, text: string][] = [
  ["once", "go(G, 3, { a: 1 });"],
  ["twice", "go(G, 3, { a: 1 });\ngo(G, 1, { b: 2 });"],
  ["loop", "for (let k = 1; k < 4; k++) go(G, k, { a: k });"],
];
const total = texts.length * deeds.length * objects.length * loops.length * places.length * calls.length;
// Neighbors differ in everything, so that any part of the numbers has all of it.
const leap = 1_158_301;

function write(cell: number): { name: string; text: string } {
  let rest = (cell * leap) % total;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const deed = pick(deeds);
  const text = pick(texts);
  const object = pick(objects);
  const loop = pick(loops);
  const place = pick(places);
  const call = pick(calls);
  const isTyped = cell % 4 === 1;
  const isCommon =
    !isTyped && cell % 3 === 0 && !/frozen|text|view/.test(object[0]) && !/removed|defined/.test(deed[0]);
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const key = place[2].replaceAll("TEXT", () => `(${text[2]})`);
  const turn = deed[1].replaceAll(/\bK\b/g, () => key);
  const body = [place[1].replaceAll("TEXT", () => text[2]), `const to = ${object[1]};`, within(loop[1], "IN", turn)].filter(Boolean).join("\n"); // prettier-ignore
  const has = (word: RegExp) => word.test(body);
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    "const said = [];",
    'const say = v => void said.push(typeof v === "function" ? "function" : typeof v === "object" && v ? "object" : String(v));',
    ...(has(/\bthree\b/) ? ['const three = Number("3");'] : []),
    ...(has(/\bC\(/) ? ["class C {\n  a = 1;\n  b() {}\n}"] : []),
    ...(has(/\bkept\b/) ? ["const kept = { a: 1 };"] : []),
    ...(has(/\bkeyOf\(/) ? [`function keyOf(given, n) {\n  return ${text[2]};\n}`] : []),
    ...(has(/\bm\.set/) ? ["const m = new Map();"] : []),
    ...(has(/\bq\.add/) ? ["const q = new Set();"] : []),
    `function go(given, n, handed) {\n${indent(body, "  ")}\n  say(Object.keys(to).slice(0, 9).join());\n}`,
    "try {",
    indent(
      call[1].replaceAll(/\bG\b/g, () => text[1]),
      "  ",
    ),
    "} catch (error) {",
    "  say(error.name);",
    "}",
    'console.log(said.join(" ").slice(0, 900));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${text[0]}--${deed[0]}--${object[0]}--${loop[0]}--${place[0]}--${call[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
    text: lines.join("\n") + "\n",
  };
}

const padNumber = (index: number) => String(index).padStart(8, "0");
if (process.argv[2] === "count") console.log(total);
else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? total), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, total); step++) {
    const index = (from + step * stride) % total;
    const program = write(index);
    writeFileSync(`${folder}/${padNumber(index)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, total));
}
