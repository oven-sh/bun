// Texts in order: the two texts, times how they are compared, times how they are made, times how the answer is used, times the loop.
//
//   bun write-text-order-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<text>--<other>--<comparison>--<made>--<use>.ts or .mjs
//   bun write-text-order-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

const texts: [name: string, text: string][] = [
  ["empty", '""'],
  ["a", '"a"'],
  ["capital", '"A"'],
  ["word", '"resume"'],
  ["accent", '"r\\u00e9sum\\u00e9"'],
  ["combining", '"re\\u0301sume"'],
  ["digits", '"10"'],
  ["digit", '"9"'],
  ["space", '" a"'],
  ["hyphen", '"co-op"'],
  ["no-hyphen", '"coop"'],
  ["underscore", '"_a"'],
  ["sharp", '"stra\\u00dfe"'],
  ["double-s", '"strasse"'],
  ["umlaut", '"\\u00e4"'],
  ["wide", '"\\u4e2d\\u6587"'],
  ["emoji", '"\\u{1f600}"'],
  ["lone", '"\\ud800"'],
  ["past-latin", '"\\u0100"'],
  ["control", '"\\u0001a"'],
  ["nothing-inside", '"a\\u0000b"'],
  ["ligature", '"\\ufb01"'],
  ["dotless", '"\\u0131"'],
  ["greek", '"\\u03b1\\u0392"'],
  ["long", '"abcdefghij".repeat(5)'],
  ["long-other-end", '"abcdefghij".repeat(5) + "k"'],
  ["long-wide", '"abcdefghij".repeat(5) + "\\u0151"'],
  ["punctuation", '"a.b"'],
  ["apostrophe", '"it\'s"'],
  ["mixed-case", '"aBc"'],
];
// `a` and `b` are the texts.
const comparisons: [name: string, text: string][] = [
  ["locale", "a.localeCompare(b)"],
  ["locale-behind", "b.localeCompare(a)"],
  ["locale-itself", "a.localeCompare(a)"],
  ["locale-english", 'a.localeCompare(b, "en")'],
  ["locale-german", 'a.localeCompare(b, "de")'],
  ["locale-swedish", 'a.localeCompare(b, "sv")'],
  ["locale-base", 'a.localeCompare(b, undefined, { sensitivity: "base" })'],
  ["locale-numeric", 'a.localeCompare(b, "en", { numeric: true })'],
  ["locale-upper", 'a.localeCompare(b, "en", { caseFirst: "upper" })'],
  ["collator", "new Intl.Collator().compare(a, b)"],
  ["collator-kept", "collator.compare(a, b)"],
  ["less", "a < b"],
  ["at-most", "a <= b"],
  ["greater", "a > b"],
  ["equal", "a === b"],
  ["loose", "a == b"],
  ["chosen", "a < b ? -1 : a > b ? 1 : 0"],
  ["starts", "a.startsWith(b)"],
  ["index", "a.indexOf(b)"],
  ["includes", "(a + b).includes(b)"],
  ["lower", "a.toLowerCase() === b.toLowerCase()"],
  ["normal", 'a.normalize("NFD") === b.normalize("NFD")'],
  ["sorted", "[a, b].sort()[0] === a"],
  ["sorted-locale", "[a, b].sort((p, q) => p.localeCompare(q))[0] === a"],
  ["code", "a.charCodeAt(0) - b.charCodeAt(0)"],
  ["point", "(a.codePointAt(0) ?? 0) - (b.codePointAt(0) ?? 0)"],
  ["object", "Object.is(a, b)"],
  ["nothing", "a.localeCompare(undefined as any)"],
];
// How the texts come to be.
const makings: [name: string, text: string][] = [
  ["as-written", "TEXT"],
  ["joined", "TEXT.slice(0, 1) + TEXT.slice(1)"],
  ["sliced", '("x" + TEXT + "y").slice(1, -1)'],
  ["from-a-list", '[TEXT, "z"].find(text => text !== "z") ?? ""'],
  ["parsed", "JSON.parse(JSON.stringify(TEXT))"],
  ["split", '("q,x," + TEXT).split(",").slice(2).join(",")'],
  ["object", "String(new String(TEXT))"],
];
const uses: [name: string, text: string][] = [
  ["kept", "notes.push(COMPARE);"],
  ["sign", "notes.push(Math.sign(Number(COMPARE)));"],
  ["condition", "if (COMPARE) count++;"],
  ["less-than-zero", "if (Number(COMPARE) < 0) count++;\nelse count += 10;"],
  ["sum", "sum += Number(COMPARE) || 0;"],
  ["or", "notes.push(COMPARE || a.length - b.length);"],
];
const loops: [name: string, text: string][] = [
  ["loop", "for (let turn = 0; turn < 3; turn++) {\n  USE\n}"],
  ["swapped", "for (let turn = 0; turn < 3; turn++) {\n  USE\n  [a, b] = [b, a];\n}"],
  ["growing", "for (let turn = 0; turn < 3; turn++) {\n  USE\n  a += b;\n}"],
  ["list", 'for (const b of [given, a, "m", ""]) {\n  USE\n}'],
];
const total = texts.length * texts.length * comparisons.length * makings.length * uses.length * loops.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const one = pick(texts);
  const other = pick(texts);
  const comparison = pick(comparisons);
  const making = pick(makings);
  const use = pick(uses);
  const loop = pick(loops);
  const isTyped = cell % 2 === 1;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const type = (text: string) => (isTyped ? text : "");
  const compare = isTyped ? comparison[1] : comparison[1].replace(" as any", "");
  const body = loop[1].replace("USE", () => use[1].replaceAll("COMPARE", () => `(${compare})`));
  const make = (text: string) =>
    making[1].replaceAll("TEXT", () => (/[ .+]/.test(text.replace(/"[^"]*"/g, "")) ? `(${text})` : text));
  const lines = [
    `const notes${type(": any[]")} = [];`,
    ...(/collator\./.test(compare) ? ['const collator = new Intl.Collator("en");'] : []),
    `function work(a${type(": string")}, given${type(": string")})${type(": any")} {`,
    ...(loop[0] === "list" ? [] : ["  let b = given;"]),
    "  let count = 0;",
    `  let sum${type(": any")} = 0;`,
    indent(body, "  "),
    "  return [count, sum].join();",
    "}",
    "for (let round = 0; round < 2; round++) {",
    "  try {",
    `    notes.push(work(${make(one[1])}, ${make(other[1])}));`,
    "  } catch (error) {",
    `    notes.push((error${type(" as any")}).name);`,
    "  }",
    "}",
    'console.log(notes.map(String).join(" "));',
    ...(isTyped ? ["export {};"] : []),
  ]; // prettier-ignore
  return {
    name: `${one[0]}--${other[0]}--${comparison[0]}--${making[0]}--${use[0]}.${isTyped ? "ts" : "mjs"}`,
    text: lines.join("\n") + "\n",
  };
}

const padNumber = (index: number) => String(index).padStart(7, "0");
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
