// The least loops that store into a list what another list holds, so that the list may have to hold another kind: the list, times the other list, times what is stored, times what is read behind it, times what happens between, times the names, times the loop.
//
//   bun write-converted-store-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<list>--<other>--<stored>--<read>--<between>--<names>--<loop>.mjs, .cjs or .ts
//   bun write-converted-store-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `a` is stored into, `b` is read, `i` counts, t is given.
const lists: [name: string, text: string][] = [
  ["integers", "[3, 1, 2, 5, 4, 9, 7, 6]"],
  ["doubles", "[3.5, 1.5, 2.25, 5.5, 4.5, 9.5, 7.5, 6.5]"],
  ["whole-doubles", "[3, 1, 2.5, 5, 4, 9, 7, 6]"],
  ["boxed", "[3, 'b', 2, null, 4, true, 7, 6]"],
  ["hole", "[3, , 2, 5, 4, , 7, 6]"],
  ["double-hole", "[3.5, , 2.5, 5, 4, , 7, 6]"],
  ["texts", "['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']"],
  ["objects", "Array.from({ length: 8 }, (_, k) => ({ v: k }))"],
  ["words", "new Int32Array([3, 1, 2, 5, 4, 9, 7, 6])"],
  ["floats", "new Float64Array([3.5, 1, 2, 5, 4, 9, 7, 6])"],
  ["made", "new Array(8).fill(0)"],
  ["pushed", "pushed(8)"],
  ["many", "Array.from({ length: 40 }, (_, k) => k % 7)"],
  ["many-doubles", "Array.from({ length: 40 }, (_, k) => k / 2)"],
];
const others: [name: string, text: string][] = [
  ["integers", "[8, 7, 6, 5, 4, 3, 2, 1]"],
  ["doubles", "[8.5, 7.25, 6.5, 5.5, 4.5, 3.5, 2.5, 1.5]"],
  ["double-late", "[8, 7, 6, 5, 4, 3, 2, 0.5]"],
  ["double-first", "[0.5, 7, 6, 5, 4, 3, 2, 1]"],
  ["text-late", "[8, 7, 6, 5, 4, 3, 'x', 1]"],
  ["object-late", "[8, 7, 6, 5, 4, { v: 3 }, 2, 1]"],
  ["undefined-late", "[8, 7, 6, 5, undefined, 3, 2, 1]"],
  ["hole", "[8, , 6, 5, , 3, 2, 1]"],
  ["not-a-number", "[8, NaN, 6, 5, 4, 3, 2, 1]"],
  ["large", "[8, 2147483647, 6, 4294967296, 4, 3, 2, 1]"],
  ["big", "[8n, 7n, 6n, 5n, 4n, 3n, 2n, 1n]"],
  ["words", "new Int32Array([8, 7, 2147483647, 5, 4, 3, 2, 1])"],
  ["floats", "new Float64Array([8, 7, 6.5, 5, 4, 3, 2, 1])"],
  ["short", "[8, 7]"],
  ["many", "Array.from({ length: 40 }, (_, k) => (k === 30 ? 0.5 : k))"],
];
const stores: [name: string, text: string][] = [
  ["one-more", "a[i] = b[i] + 1;"],
  ["same", "a[i] = b[i];"],
  ["added", "a[i] += b[i];"],
  ["half", "a[i] = b[i] / 2;"],
  ["next", "a[i + 1] = b[i];"],
  ["previous", "if (i > 0) a[i - 1] = b[i];"],
  ["at-end", "a[a.length] = b[i];"],
  ["pushed", "a.push?.(b[i]);"],
  ["exchanged", "[a[i], b[i]] = [b[i], a[i]];"],
  ["sometimes", "if (i & 1) a[i] = b[i];"],
  ["choice", "a[i] = i > 4 ? b[i] : i;"],
  ["first", "a[0] = b[i];"],
  ["product", "a[i] = b[i] * 1.5;"],
  ["into-both", "a[i] = b[i] + 1;\nb[i] = a[i];"],
];
const reads: [name: string, text: string][] = [
  ["sum", "s += +a[i] || 1;"],
  ["plain-sum", "s += a[i];"],
  ["next", "s += +a[i + 1] || 1;"],
  ["first", "s += +a[0] || 1;"],
  ["last", "s += +a[a.length - 1] || 1;"],
  ["stored-again", "a[i] = a[i];"],
  ["second-store", "a[(i + 1) & 7] = i;"],
  ["compared", "if (a[i] > t) s++;"],
  ["nothing", ";"],
  ["kept", "kept = a[i];"],
  ["length", "s += a.length;"],
];
const betweens: [name: string, text: string][] = [
  ["nothing", ";"],
  ["continue", "if (b[i] > t) continue;"],
  ["break", "if (i === t) break;"],
  ["called", "note(a);"],
  ["read", "s += +b[i] || 1;"],
  ["try", "try {\n  s += +a[i] || 2;\n} catch {\n  s++;\n}"],
  ["test", "if (isPast(a[i], t)) s += 5;"],
];
const names: [name: string, b: string][] = [["two", "OTHER"], ["one", "a"], ["through-object", "box.b"], ["argument", "ARGUMENT"]]; // prettier-ignore
const loops: [name: string, text: string][] = [
  ["length", "for (let i = 0; i < a.length && i < 60; i++) {\n  IN\n}"],
  ["kept-length", "for (let i = 0, m = a.length; i < m; i++) {\n  IN\n}"],
  ["other-length", "for (let i = 0; i < b.length && i < 60; i++) {\n  IN\n}"],
  ["given", "for (let i = 0; i < n; i++) {\n  IN\n}"],
  ["nested", "for (let j = 0; j < 2; j++)\n  for (let i = 0; i < n; i++) {\n    IN\n  }"],
  ["down", "for (let i = n - 1; i >= 0; i--) {\n  IN\n}"],
  ["twice", "for (let i = 0; i < n; i++) {\n  IN\n}\nfor (let i = 0; i < n; i++) {\n  s += +a[i] || 1;\n}"],
];
const total =
  lists.length * others.length * stores.length * reads.length * betweens.length * names.length * loops.length;
// Neighbors differ in everything, so that any part of the numbers has all of it.
const leap = 3_961_651;

function write(cell: number): { name: string; text: string } {
  let rest = (cell * leap) % total;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const store = pick(stores);
  const list = pick(lists);
  const other = pick(others);
  const read = pick(reads);
  const loop = pick(loops);
  const between = pick(betweens);
  const name = pick(names);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const turn = [store[1], between[1], read[1]].filter(text => text !== ";").join("\n");
  const body = within(loop[1], "IN", turn);
  const has = (word: RegExp) => word.test(body);
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    ...(/\bpushed\(/.test(list[1])
      ? ["function pushed(n) {\n  const made = [];\n  for (let k = 0; k < n; k++) made.push(k * 3);\n  return made;\n}"]
      : []),
    ...(has(/\bnote\(/) ? ["let noted = 0;\nfunction note(x) {\n  noted += x.length;\n}"] : []),
    ...(has(/\bisPast\(/) ? ["function isPast(x, t) {\n  return x > t;\n}"] : []),
    ...(has(/\bkept\b/) ? ["let kept;"] : []),
    `function run(a, ${name[0] === "through-object" ? "box" : "b"}, n, t) {`,
    ...(name[0] === "through-object" ? ["  const { b } = box;"] : []),
    "  let s = 0;",
    indent(body, "  "),
    "  return s;",
    "}",
    'const show = x => (typeof x === "object" && x ? "o" + x.v : Object.is(x, -0) ? "-0" : String(x));',
    "const out = [];",
    "for (const [n, t] of [[3, 2], [8, 4], [7, 8]]) {",
    `  const a = ${list[1]};`,
    ...(name[0] === "one" ? [] : [`  const b = ${other[1]};`]),
    "  try {",
    `    out.push(show(run(a, ${name[0] === "one" ? "a" : name[0] === "through-object" ? "{ b }" : "b"}, n, t)));`,
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "  out.push(Array.from(a, show).join(), Object.keys(a).length);",
    ...(name[0] === "one" ? [] : ["  out.push(Array.from(b, show).join());"]),
    "}",
    ...(has(/\bnote\(/) ? ["out.push(noted);"] : []),
    ...(has(/\bkept\b/) ? ["out.push(show(kept));"] : []),
    'console.log(out.join(" ").slice(0, 1200));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${list[0]}--${other[0]}--${store[0]}--${read[0]}--${between[0]}--${name[0]}--${loop[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
