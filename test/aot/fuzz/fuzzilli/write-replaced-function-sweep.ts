// Functions that are replaced: where the function is kept, times what it is, times what replaces it, times when, times how it is called.
//
//   bun write-replaced-function-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<place>--<function>--<other>--<when>--<call>.mjs or .cjs
//   bun write-replaced-function-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `GET` reaches the function, `SET(x)` replaces it; `FIRST` is the function.
const places: [name: string, before: string, get: string, set: string][] = [
  ["variable", "let held = FIRST;", "held", "held = X"],
  ["var", "var held = FIRST;", "held", "held = X"],
  ["declaration", "function held(a, b) {\n  return (FIRST)(a, b);\n}", "held", "held = X"],
  ["field", "const holder = { held: FIRST };", "holder.held", "holder.held = X"],
  [
    "method",
    "class Holder {\n  held(a, b) {\n    return (FIRST)(a, b);\n  }\n}\nconst holder = new Holder();",
    "holder.held",
    "Holder.prototype.held = X",
  ],
  [
    "own-method",
    "class Holder {\n  held(a, b) {\n    return (FIRST)(a, b);\n  }\n}\nconst holder = new Holder();",
    "holder.held",
    "holder.held = X",
  ],
  ["static", "class Holder {\n  static held = FIRST;\n}", "Holder.held", "Holder.held = X"],
  ["element", "const list = [FIRST];", "list[0]", "list[0] = X"],
  ["map", 'const map = new Map([["h", FIRST]]);', 'map.get("h")', 'map.set("h", X)'],
  [
    "prototype",
    "function Holder() {}\nHolder.prototype.held = FIRST;\nconst holder = new Holder();",
    "holder.held",
    "Holder.prototype.held = X",
  ],
  [
    "getter",
    "let kept = FIRST;\nconst holder = {\n  get held() {\n    return kept;\n  },\n};",
    "holder.held",
    "kept = X",
  ],
  [
    "parameter",
    "const box = { f: FIRST };\nconst ask = (f, a, b) => f(a, b);",
    "((a, b) => ask(box.f, a, b))",
    "box.f = X",
  ],
  [
    "captured",
    "const [get, set] = (() => {\n  let held = FIRST;\n  return [() => held, value => (held = value)];\n})();",
    "get()",
    "set(X)",
  ],
  ["default", "let held = FIRST;\nconst call = (a, b, f = held) => f(a, b);", "call", "held = X"],
];
// `base` and `add()` are what some of them close over.
const functions: [name: string, text: string][] = [
  ["arrow", "(a, b) => a + b"],
  ["function", "function (a, b) {\n  return a - b;\n}"],
  ["closes", "(a, b) => a + b + base"],
  ["writes", "(a, b) => {\n  base += a;\n  return base + b;\n}"],
  ["text", '(a, b) => a + "/" + b'],
  ["one", "a => a * 2"],
  ["none", "() => 5"],
  ["bound", "((x, a, b) => x + a + b).bind(null, 3)"],
  ["built-in", "Math.max"],
  ["async", "async (a, b) => a + b"],
  ["generator", "function* (a, b) {\n  yield a;\n  yield b;\n}"],
  ["throws", '(a, b) => {\n  if (a === 2) throw new RangeError("f");\n  return b;\n}'],
  ["calls-other", "(a, b) => add(a) + b"],
  ["rest", "(...all) => all.length"],
  ["recursive", "function again(a, b) {\n  return a > 0 ? again(a - 1, b) + 1 : b;\n}"],
];
const others: [name: string, text: string][] = [
  ...functions,
  ["nothing", "undefined"],
  ["number", "7"],
  ["class", "class {\n  constructor(a) {\n    this.a = a;\n  }\n}"],
  ["old-wrapped", "(old => (a, b) => [old(a, b)])(GET)"],
];
const whens: [name: string, text: string][] = [
  ["in-the-middle", "if (i === 2) SET;"],
  ["by-itself", "if (i === 1) replace();"],
  ["never", "if (i === 50) SET;"],
  ["at-once", "if (i === 0) SET;"],
  ["every-turn", "SET;"],
  ["and-back", "if (i === 1) SET;\nif (i === 3) back();"],
  ["in-a-callback", "[i].forEach(k => {\n  if (k === 2) SET;\n});"],
];
const calls: [name: string, text: string][] = [
  ["direct", "note(GET(i, 2));"],
  ["twice", "note(GET(i, 2));\nnote(GET(2, i));"],
  ["summed", "sum += Number(GET(i, 1)) || 0;"],
  ["kept-first", "const f = GET;\nnote(f(i, 2));"],
  ["optional", "note(GET?.(i, 2));"],
  ["call", "note(GET.call(null, i, 2));"],
  ["apply", "note(GET.apply(null, [i, 2]));"],
  ["passed", "note([i].map(GET)[0]);"],
  ["tried", "try {\n  note(GET(i, 3));\n} catch (error) {\n  note(error.name);\n}"],
  ["spread", "note(GET(...[i, 4]));"],
  ["compared", "note(GET === first);\nnote(typeof GET);"],
];
const total = places.length * functions.length * others.length * whens.length * calls.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const place = pick(places);
  const first = pick(functions);
  const other = pick(others);
  const when = pick(whens);
  const call = pick(calls);
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const replaced = `(${other[1].replaceAll("GET", () => place[2])})`;
  const set = (value: string) => place[3].replace("X", () => value);
  const body = [when[1].replace("SET", () => set(replaced)).replace("back()", () => set("first")), call[1].replaceAll("GET", () => place[2])].join("\n"); // prettier-ignore
  const lines = [
    "const notes = [];",
    'const show = value => (typeof value === "function" ? "function" : Array.isArray(value) ? "[" + value.map(show).join() + "]" : typeof value === "object" && value ? Object.prototype.toString.call(value) : String(value));',
    "const note = value => void notes.push(show(value));",
    "let base = 10;",
    "const add = a => a + base;",
    `const first = ${first[1]};`,
    place[1].replaceAll("FIRST", "first"),
    ...(/replace\(\)/.test(when[1]) ? [`const replace = () => void (${set(replaced)});`] : []),
    "function work(n) {",
    "  let sum = 0;",
    "  for (let i = 0; i < n; i++) {",
    indent(body, "    "),
    "  }",
    "  return sum;",
    "}",
    "for (const n of [5, 1, 4]) {",
    "  try {",
    "    note(work(n));",
    "  } catch (error) {",
    "    note(error.name);",
    "  }",
    "}",
    'console.log(notes.join(" "), base);',
  ]; // prettier-ignore
  return {
    name: `${place[0]}--${first[0]}--${other[0]}--${when[0]}--${call[0]}.${cell % 3 ? "mjs" : "cjs"}`,
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
