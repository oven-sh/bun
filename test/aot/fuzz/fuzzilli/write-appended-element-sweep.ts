// Lists that grow: how the list is made, times how elements are appended, times what they are, times how the list is read, times where it grows, times what stands behind the append.
//
//   bun write-appended-element-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<list>--<append>--<value>--<read>--<place>--<behind>--<given>.mjs or .ts
//   bun write-appended-element-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `n` is a number.
const lists: [name: string, text: string][] = [
  ["empty", "[]"],
  ["new", "new Array()"],
  ["by-length", "new Array(n)"],
  ["by-constant-length", "new Array(4)"],
  ["by-length-filled", "new Array(n).fill(0)"],
  ["by-double-length", "new Array(n).fill(0.5)"],
  ["literal", "[1, 2]"],
  ["doubles", "[0.5]"],
  ["texts", '["a"]'],
  ["mixed", '[1, "a"]'],
  ["of", "Array.of(n)"],
  ["from", "Array.from({ length: n })"],
  ["split", '"a,b".split(",")'],
  ["sliced", "[1, 2, 3].slice(0, n)"],
  ["mapped", "[1, 2].map(item => item + n)"],
  ["spread", "[...[1, n]]"],
  ["holes", "[1, , 3]"],
  ["subclass", "new Items()"],
  ["shortened", "shortened([1, 2, 3, 4], 1)"],
  ["of-field", "holder.list"],
];
// `list` grows by `V`; `i` counts.
const appends: [name: string, text: string][] = [
  ["push", "list.push(V);"],
  ["at-length", "list[list.length] = V;"],
  ["at-counter", "list[i] = V;"],
  ["at-counter-and-length", "list[list.length + i] = V;"],
  ["push-two", "list.push(V, i);"],
  ["push-spread", "list.push(...[V, V]);"],
  ["unshift", "list.unshift(V);"],
  ["splice", "list.splice(list.length, 0, V);"],
  ["by-own-counter", "list[at++] = V;"],
  ["concat", "list = list.concat([V]);"],
  ["spread", "list = [...list, V];"],
  ["if-missing", "if (list[i] === undefined) list[i] = V;"],
  ["push-and-pop", "list.push(V);\nif (i & 1) list.pop();"],
  ["push-and-shift", "list.push(V);\nif (i > 1) list.shift();"],
  ["length-first", "const length = list.length;\nlist[length] = V;"],
  ["beyond", "list[list.length + 2] = V;"],
  ["nested", "(list[i] ??= []).push?.(V);"],
  ["helper", "append(list, V);"],
];
const values: [name: string, text: string][] = [
  ["counter", "i"],
  ["double", "i + 0.5"],
  ["integer-then-double", "i > 1 ? i + 0.25 : i"],
  ["integer-then-text", 'i > 1 ? "t" + i : i'],
  ["double-then-object", "i > 1 ? { v: i } : i * 0.5"],
  ["text", '"s" + i'],
  ["object", "{ v: i }"],
  ["list", "[i]"],
  ["nothing", "undefined"],
  ["not-a-number", "NaN"],
  ["negative-zero", "-0"],
  ["large", "2 ** 31 + i"],
  ["largest", "2 ** 53 - i"],
  ["product", "Math.imul(i, 70000)"],
  ["division", "i / 3"],
  ["sum", "(total = total + i)"],
  ["last", "list.length ? list[list.length - 1] : i"],
  ["truth", "i > 1"],
  ["big", "BigInt(i)"],
  ["given", "given[i]"],
  ["given-again", "given[i]"],
  ["given-kept", "x"],
  ["given-sum", "x + 1"],
];
// What stands in the same iteration behind the append; `given` is the list that the caller hands in, `side` another.
const behinds: [name: string, text: string][] = [
  ["nothing", ""],
  ["second-list", "second[second.length] = side.l[i];"],
  ["second-push", "second.push(given[i]);"],
  ["sum", "carried += given[i];"],
  ["side-sum", "carried += side.l[i];"],
  ["text", "words += given[i];"],
  ["comparison", "if (given[i] > 2) carried++;"],
  ["next", "carried = given[i + 1];"],
  ["of-itself", "carried += list[0];"],
  ["field", "carried += side.v;\nside.v = given[i];"],
  ["call", "carried += half(given[i]);"],
];
// What the caller hands in: the kind changes on the way.
const givens: [name: string, text: string][] = [
  ["integers-then-double", "[1, 2, 3, 0.5]"],
  ["integers-then-text", '[1, 2, "a", 4]'],
  ["doubles-then-integers", "[0.5, 1, 2, 3]"],
  ["integers", "[1, 2, 3, 4]"],
  ["holes", "[1, , 3, 4]"],
  ["objects", "[1, 2, { v: 1 }, 3]"],
  ["short", "[1]"],
  ["large", "[1, 2 ** 31, 2, 3]"],
];
// Reads into `out`.
const reads: [name: string, text: string][] = [
  ["whole", "out.push(show(list));"],
  ["sum", "let sum = 0;\nfor (let k = 0; k < list.length; k++) sum += list[k];\nout.push(show(sum));"],
  ["last", "out.push(show(list[list.length - 1]), list.length);"],
  ["index", "out.push(show(list[1]), show(list[2]));"],
  ["of", 'let text = "";\nfor (const item of list) text += show(item);\nout.push(text);'],
  ["joined", 'out.push(list.map(show).join("+"));'],
  ["sorted", "out.push(show([...list].sort()));"],
  [
    "product",
    "let product = 1;\nfor (let k = 0; k < list.length; k++) product = Math.imul(product, list[k]) | 1;\nout.push(product);",
  ],
  ["holes", "let holes = 0;\nfor (let k = 0; k < list.length; k++) if (!(k in list)) holes++;\nout.push(holes);"],
  ["keys", "out.push(Object.keys(list).length);"],
  ["written", "for (let k = 0; k < list.length; k++) list[k] = k;\nout.push(show(list));"],
  ["searched", "out.push(list.indexOf(1), list.includes(NaN));"],
];
// `GROW` and `READ`.
const places: [name: string, text: string][] = [
  ["loop", "for (let i = 0; i < n; i++) {\n  GROW\n}\nREAD"],
  ["read-in-it", "for (let i = 0; i < n; i++) {\n  GROW\n  {\n    READ\n  }\n}"],
  ["given-length", "for (let i = 0; i < given.length; i++) {\n  GROW\n}\nREAD"],
  ["given-length-again", "for (let i = 0; i < given.length; i++) {\n  GROW\n}\nREAD"],
  ["nested", "for (let k = 0; k < 2; k++)\n  for (let i = 0; i < n; i++) {\n    GROW\n  }\nREAD"],
  ["long", "for (let i = 0; i < 200; i++) {\n  GROW\n}\nout.push(list.length, show(list[list.length - 1]));"],
  ["while-short", "let i = 0;\nwhile (list.length < 12 && i < 20) {\n  GROW\n  i++;\n}\nREAD"],
  ["by-own-length", "for (let i = 0; i < list.length && i < 6; i++) {\n  GROW\n}\nREAD"],
  ["callback", "[0, 1, 2].forEach(i => {\n  GROW\n});\nREAD"],
  [
    "tried",
    'for (let i = 0; i < n; i++) {\n  try {\n    GROW\n    if (i === 2) throw new Error("g");\n  } catch {\n    out.push(list.length);\n  }\n}\nREAD',
  ],
  ["function", "const grow = i => {\n  GROW\n};\nfor (let i = 0; i < n; i++) grow(i);\nREAD"],
  ["breaks", "for (let i = 0; i < 9; i++) {\n  if (i === n) break;\n  GROW\n}\nREAD"],
  [
    "two-lists",
    "const other = [];\nfor (let i = 0; i < n; i++) {\n  GROW\n  other.push(list.length);\n}\nout.push(show(other));\nREAD",
  ],
];
const total =
  lists.length * appends.length * values.length * reads.length * places.length * behinds.length * givens.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const list = pick(lists);
  const append = pick(appends);
  const value = pick(values);
  const read = pick(reads);
  const place = pick(places);
  const behind = pick(behinds);
  const given = pick(givens);
  const isTyped = cell % 4 === 1;
  const isByName = cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const type = (text: string) => (isTyped ? text : "");
  const isKept = /\bx\b/.test(value[1]);
  const grow = [...(isKept ? ["const x = given[i];"] : []), append[1].replaceAll(/\bV\b/g, () => (isTyped ? `(${value[1]} as any)` : value[1])), ...(behind[1] ? [behind[1]] : [])].join("\n"); // prettier-ignore
  const typed = (text: string) => isTyped ? text.replaceAll("let sum = 0", "let sum: any = 0").replaceAll("let product = 1", "let product: any = 1").replaceAll("const other = []", "const other: any[] = []").replaceAll("i => {", "(i: number) => {").replaceAll("(list[i] ??= [])", "((list as any)[i] ??= [] as any)").replaceAll("at++", "at++") : text; // prettier-ignore
  // The names of the parts do not meet those of the loops around them.
  const body = typed(
    place[1]
      .replace("GROW", () => grow)
      .replaceAll("READ", () => (place[0] === "read-in-it" ? read[1] : `{\n${indent(read[1], "  ")}\n}`)),
  );
  const lines = [
    `const show = (value${type(": any")})${type(": string")} => (Array.isArray(value) ? "[" + Array.from({ length: value.length }, (_, at) => (at in value ? show(value[at]) : "hole")).join().slice(0, 120) + "]" : typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value));`,
    ...(/Items/.test(list[1]) ? [`class Items extends Array${type("<any>")} {}`] : []),
    ...(/shortened/.test(list[1]) ? [`const shortened = (list${type(": any[]")}, length${type(": number")}) => {\n  list.length = length;\n  return list;\n};`] : []),
    ...(/holder/.test(list[1]) ? [`const holder${type(": { list: any[] }")} = { list: [] };`] : []),
    ...(/append\(/.test(grow) ? [`const append = (list${type(": any[]")}, value${type(": any")}) => {\n  list[list.length] = value;\n};`] : []),
    `const out${type(": any[]")} = [];`,
    `const side${type(": any")} = { l: [1, 2, 3], v: 0 };`,
    ...(/half\(/.test(grow) ? [`const half = (value${type(": any")}) => value / 2;`] : []),
    `function work(n${type(": number")}, given${type(": any")}) {`,
    `  let carried${type(": any")} = 0;`,
    ...(/words/.test(grow) ? ['  let words = "";'] : []),
    ...(/second/.test(grow) ? [`  const second${type(": any[]")} = ${cell % 2 ? "[1]" : "[]"};`] : []),
    `  let list${type(": any")} = ${isTyped ? list[1].replace("item =>", "(item: number) =>") : list[1]};`,
    ...(/\bat\+\+/.test(grow) ? ["  let at = 0;"] : []),
    ...(/total =/.test(grow) ? ["  let total = 0;"] : []),
    indent(body, "  "),
    `  out.push(show(carried)${/words/.test(grow) ? ", words" : ""}${/second/.test(grow) ? ["", ", second.length", ", show(second)"][cell % 5 % 3] : ""});`,
    "}",
    // Every third program calls by a name of the run.
    ...(isByName ? [`const bodies${type(": any")} = { work };`] : []),
    "for (const n of [4, 0, 5]) {",
    `  side.l = n === 5 ? (["a", "b"]${type(" as any")}) : [1, 2, 3];`,
    "  try {",
    isByName ? `    for (const name in bodies) bodies[name](n, ${given[1]});` : `    work(n, ${given[1]});`,
    "  } catch (error) {",
    `    out.push((error${type(" as any")}).name);`,
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 900));',
    ...(isTyped ? ["export {};"] : []),
  ]; // prettier-ignore
  return {
    name: `${list[0]}--${append[0]}--${value[0]}--${read[0]}--${place[0]}--${behind[0]}--${given[0]}.${isTyped ? "ts" : "mjs"}`,
    text: lines.join("\n") + "\n",
  };
}

const padNumber = (index: number) => String(index).padStart(6, "0");
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
