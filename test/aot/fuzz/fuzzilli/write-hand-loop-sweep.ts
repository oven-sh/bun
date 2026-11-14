// A loop that steps an iterator by hand: what is stepped, times how the loop is written, times what its body does, times what is asked behind it. Each is asked over 0, 1, 2, 3 and 9 values, twice.
//
//   bun write-hand-loop-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<iterator>--<loop>--<body>--<behind>.mjs or .ts
//   bun write-hand-loop-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// Lines of the file and the iterator over `n` values.
const iterators: [name: string, ofFile: string, made: string][] = [
  ["generator", "function* g(n) {\n  for (let i = 0; i < n; i++) yield i;\n}", "g(n)"],
  ["generator-that-returns", "function* g(n) {\n  for (let i = 0; i < n; i++) yield i * 0.5;\n  return n;\n}", "g(n)"],
  ["generator-that-is-told", "function* g(n) {\n  let sum = 0;\n  for (let i = 0; i < n; i++) sum += (yield sum) ?? 1;\n}", "g(n)"],
  ["generator-with-finally", 'function* g(n) {\n  try {\n    for (let i = 0; i < n; i++) yield i;\n  } finally {\n    notes.push("closed");\n  }\n}', "g(n)"],
  ["generator-that-throws", 'function* g(n) {\n  for (let i = 0; i < n; i++) {\n    if (i === 5) throw new Error("five");\n    yield i;\n  }\n}', "g(n)"],
  ["delegating", "function* h(n) {\n  for (let i = 0; i < n; i++) yield i;\n}\nfunction* g(n) {\n  yield* h(n);\n}", "g(n)"],
  ["delegating-to-a-list", "function* g(n) {\n  yield* [3, 4, 5, 6].slice(0, n);\n}", "g(n)"],
  ["method", "class K {\n  *each(n) {\n    for (let i = 0; i < n; i++) yield i;\n  }\n}\nconst k = new K();", "k.each(n)"],
  ["replaced-method", "class K {\n  *each(n) {\n    for (let i = 0; i < n; i++) yield i;\n  }\n}\nconst k = new K();\nlet asked = 0;\nfunction each(n) {\n  if (asked++ === 6) k.each = n => [9, 8, 7].slice(0, n).values();\n  return k.each(n);\n}", "each(n)"],
  ["counting-class", "class Counting {\n  constructor(n) {\n    this.n = n;\n    this.at = 0;\n  }\n  next() {\n    return this.at < this.n ? { value: this.at++, done: false } : { value: undefined, done: true };\n  }\n  [Symbol.iterator]() {\n    return this;\n  }\n}", "new Counting(n)"],
  ["counting-object", "function counting(n) {\n  let at = 0;\n  return {\n    next: () => ({ value: at, done: at++ >= n }),\n    [Symbol.iterator]() {\n      return this;\n    },\n  };\n}", "counting(n)"],
  ["values-of-a-list", "", "[1, 2.5, 3, 4, 5, 6, 7, 8, 9].slice(0, n).values()"],
  ["entries-of-a-map", "", "new Map([[0, 1], [1, 2], [2, 3], [3, 4]].slice(0, n)).entries()"],
  ["values-of-a-set", "", "new Set([1, 2, 3, 4, 5].slice(0, n)).values()"],
  ["entries-of-a-set", "", "new Set([1, 2.5, 3, 4].slice(0, n)).entries()"],
  ["keys-of-a-map", "", 'new Map([["a", 1], ["b", 2], ["c", 3]].slice(0, n)).keys()'],
  ["characters", "", '"abcdefghi".slice(0, n)[Symbol.iterator]()'],
  ["handed-over", "function* g(n) {\n  for (let i = 0; i < n; i++) yield i;\n}\nconst roads = [g, n => [5, 6, 7].slice(0, n).values()];\nlet turns = 0;", "roads[turns++ & 1](n)"],
]; // prettier-ignore
// `BODY` is what is done with `r`.
const loops: [name: string, text: string][] = [
  ["while", "r = it.next();\nwhile (!r.done) {\nBODY\n  r = it.next();\n}"],
  ["for", "for (r = it.next(); !r.done; r = it.next()) {\nBODY\n}"],
  ["test-that-steps", "while (!(r = it.next()).done) {\nBODY\n}"],
  ["endless", "for (;;) {\n  r = it.next();\n  if (r.done) break;\nBODY\n}"],
  ["front-first", "for (;;) {\n  x = c * 3;\n  r = it.next();\n  if (r.done) break;\nBODY\n}"],
  ["do", "do {\n  r = it.next();\nBODY\n} while (!r.done);"],
  ["do-left-early", "do {\n  r = it.next();\n  if (c > 2) return \"early\" + c;\nBODY\n} while (!r.done);"],
  ["destructured", "while (true) {\n  const { value, done } = it.next();\n  r = { value, done };\n  if (done) break;\nBODY\n}"],
  ["bounded", "for (let i = 0; i < 3; i++) {\n  r = it.next();\nBODY\n}"],
  ["bounded-and-asked", "for (let i = 0; i < 4 && !(r = it.next()).done; i++) {\nBODY\n}"],
  ["inner", "for (let i = 0; i < 2; i++) {\n  while (!(r = it.next()).done) {\nBODY\n    if (c % 2) break;\n  }\n}"],
  ["around-an-inner", "for (;;) {\n  r = it.next();\n  if (r.done) break;\n  for (let j = 0; j < 2; j++) x += j;\nBODY\n}"],
  ["guarded", "try {\n  for (;;) {\n    r = it.next();\n    if (r.done) break;\nBODY\n  }\n} catch (error) {\n  notes.push(String(error && error.message));\n}"],
  ["two-at-once", "const other = [10, 20, 30].values();\nfor (;;) {\n  r = it.next();\n  const s = other.next();\n  if (r.done || s.done) break;\n  x += s.value;\nBODY\n}"],
  ["fresh-inside", "for (let k = 0; k < 2; k++) {\n  const own = AGAIN;\n  while (!(r = own.next()).done) {\nBODY\n  }\n}"],
  ["stepped-inside", "for (let k = 0; k < 4; k++) {\n  if (k & 1) continue;\n  r = it.next();\n  for (let j = 0; j < 2; j++) {\nBODY\n  }\n}"],
  ["runs-of-one-value", "r = it.next();\nouter: while (!r.done && x++ < 9) {\n  const run = r.value;\n  let same = 0;\n  while (!r.done && same < 9) {\n    if (r.value !== run) continue outer;\n    same++;\nBODY\n    r = it.next();\n  }\n  out.push(String(same));\n}"],
  ["taken", "const taken = [];\nr = it.next();\nwhile (!r.done && taken.length < 3) {\n  taken.push(r.value);\nBODY\n  r = it.next();\n}\nx = taken.length;"],
  ["first-aside", "const aside = it.next();\nx = aside.done ? -1 : 1;\nwhile (!(r = it.next()).done) {\nBODY\n}"],
  ["rest-by-for-of", "r = it.next();\nfor (const value of it) {\n  r = { value, done: false };\nBODY\n}"],
]; // prettier-ignore
const bodies: [name: string, text: string][] = [
  ["counts", "c++;"],
  ["sums", "sum += Number(r.value) || 0;\nc++;"],
  ["notes", "out.push(String(r.value));\nc++;"],
  ["keeps", "last = r;\nc++;"],
  ["asks", "if (r.value === 2) x += 100;\nc++;"],
  ["leaves", "if (++c > 2) break;"],
  ["goes-on", "c++;\nif (c === 2) continue;\nsum += c;"],
  ["steps-again", "c++;\nif (c === 1) it.next();"],
  ["calls-back", "c = act(c);"],
  ["keeps-value", "last = { value: r.value, done: r.done };\nsum += c++;"],
  ["tells", "c++;\nif (c < 3) r = it.next(c);\nif (r.done) break;"],
  ["closes", "if (++c === 2) it.return?.(7);"],
  ["compares", "if (first === undefined) first = r.value;\nif (r.value === first) x++;\nc++;"],
  ["compares-results", "if (r === last) x++;\nlast = r;\nc++;"],
];
const behind: [name: string, text: string][] = [
  ["count", "return c;"],
  ["front", "return [x, c].join();"],
  ["last-result", "return [r?.done, String(r?.value), c].join();"],
  ["kept", "return [last?.done, String(last?.value)].join();"],
  ["sum", "return [sum, x].join();"],
  ["list", 'return out.join("+") + c;'],
  ["next", "const after = it.next();\nreturn [after.done, String(after.value), c].join();"],
  ["rest", "return [...it].map(String).join() + c;"],
];
const total = iterators.length * loops.length * bodies.length * behind.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const iterator = pick(iterators);
  const loop = pick(loops);
  const body = pick(bodies);
  const asked = pick(behind);
  const isTyped = cell % 6 === 4;
  const any = isTyped ? ": any" : "";
  const typed = (text: string) =>
    isTyped
      ? text
          .replaceAll(/function(\*?) (\w+)\(n\)/g, "function$1 $2(n: number): any")
          .replaceAll("*each(n)", "*each(n: number): any")
          .replaceAll("constructor(n)", "constructor(n: number)")
          .replaceAll("const k = ", "const k: any = ")
          .replaceAll("class Counting {", "class Counting {\n  [key: string]: any;")
          .replaceAll("  next()", "  next(): any")
          .replaceAll("[Symbol.iterator]() {", "[Symbol.iterator](): any {")
          .replaceAll("k.each = n =>", "k.each = (n: number) =>")
          .replaceAll("g, n =>", "g, (n: number) =>")
          .replaceAll("const roads = ", "const roads: any[] = ")
          .replaceAll("(yield sum)", "((yield sum) as any)")
          .replaceAll("catch (error)", "catch (error: any)")
          .replaceAll("const taken = []", "const taken: any[] = []")
          .replaceAll('new Map([["a", 1], ["b", 2], ["c", 3]].slice(0, n))', 'new Map([["a", 1], ["b", 2], ["c", 3]].slice(0, n) as any)')
          .replaceAll("new Map([[0, 1], [1, 2], [2, 3], [3, 4]].slice(0, n))", "new Map([[0, 1], [1, 2], [2, 3], [3, 4]].slice(0, n) as any)")
      : text; // prettier-ignore
  const steps = body[1].split("\n").map(line => "  " + line).join("\n"); // prettier-ignore
  const inside = [
    ...typed(loop[1]).replace("AGAIN", () => typed(iterator[2])).replace("BODY", () => steps).split("\n").map(line => "  " + line), // prettier-ignore
    ...asked[1].split("\n").map((line, at) => "  " + (isTyped && at === 0 ? line.replace("const after =", "const after: any =") : line)), // prettier-ignore
  ];
  // A result that nothing outside of the turn asks for is a constant of the turn.
  const isOfTheTurn = ["endless", "front-first", "around-an-inner", "bounded"].includes(loop[0]) && !/\br\b/.test(asked[1]) && body[0] !== "tells"; // prettier-ignore
  const written = isOfTheTurn ? inside.map(line => line.replace(/^( +)r = it\.next\(\);$/, `$1const r${any} = it.next();`)) : inside; // prettier-ignore
  const uses = (name: string) => new RegExp(`\\b${name}\\b`).test(written.join("\n"));
  const work = [
    `function f(n${isTyped ? ": number" : ""})${any} {`,
    `  const it${any} = ${typed(iterator[2])};`,
    ...["c", "x", "sum"].filter(uses).map(name => `  let ${name} = 0;`),
    ...(uses("r") && !isOfTheTurn ? [`  let r${any};`] : []),
    ...(uses("first") ? [`  let first${any};`] : []),
    ...(uses("last") ? [`  let last${any};`] : []),
    ...(uses("out") ? [`  const out${isTyped ? ": string[]" : ""} = [];`] : []),
    ...written,
    "}",
  ];
  const lines = [
    `const notes${isTyped ? ": string[]" : ""} = [];`,
    `const act = (n${isTyped ? ": number" : ""}) => {\n  notes.push("a");\n  return n + 1;\n};`,
    ...(iterator[1] ? typed(iterator[1]).split("\n") : []),
    ...work,
    "for (let turn = 0; turn < 2; turn++)",
    `  for (const n of ${cell % 3 === 1 ? 'JSON.parse("[0, 1, 2, 3, 9]")' : "[0, 1, 2, 3, 9]"}${isTyped && cell % 3 === 1 ? " as number[]" : ""}) {`,
    "    try {",
    '      console.log(n, f(n), notes.splice(0).join("+"));',
    "    } catch (error) {",
    `      console.log(n, "threw", ${isTyped ? "(error as any)" : "error"}?.message, notes.splice(0).length);`,
    "    }",
    "  }",
    ...(isTyped ? ["export {};"] : []),
  ];
  return { name: `${iterator[0]}--${loop[0]}--${body[0]}--${asked[0]}${isTyped ? ".ts" : ".mjs"}`, text: lines.join("\n") + "\n" }; // prettier-ignore
}

const padNumber = (index: number) => String(index).padStart(5, "0");
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
