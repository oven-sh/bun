// A variable that functions share holds an object which is read, replaced and read again: where the variable lives, times what is read first, times how the object is replaced, times what is read behind, times who does it, times who calls, times what happens on the way.
//
//   bun write-replaced-object-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<home>--<first>--<replaced>--<second>--<doer>--<caller>--<event>.mjs, .cjs or .ts
//   bun write-replaced-object-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// Where the object is: `DECLARED` stands in the maker, `state` is the place.
const homes: [name: string, declared: string, place: string][] = [
  ["captured", "let state = START;", "state"],
  ["typed-later", "let state = null;\nstate = START;", "state"],
  ["field", "const held = { state: START };", "held.state"],
  ["two", "let state = START;\nlet spare = new State(9);", "state"],
  ["list", "const held = [START];", "held[0]"],
  ["parameter", "", "state"],
  ["of-file", "", "fileState"],
  ["late", "", "state"],
];
const starts: [name: string, text: string][] = [
  ["instance", "new State(null)"],
  ["number", "new State(1)"],
  ["child", "new Wide(2)"],
  ["literal", "{ x: 1, n: 0, list: [1], clone: () => new State(7), size: () => 2 }"],
];
// Reads of `state` into `a` or `c`.
const firsts: [name: string, text: string][] = [
  ["field", "const a = state.x;"],
  ["two-fields", "const a = state.x + state.n;"],
  ["method", "const a = state.size();"],
  ["element", "const a = state.list[0];"],
  ["nothing", "const a = 0;"],
  ["destructured", "const { x: a } = state;"],
  ["object", "const a = state;"],
  ["tested", "const a = state.n > 0 ? state.x : -1;"],
  ["written", "state.n++;\nconst a = state.n;"],
];
const replaced: [name: string, text: string][] = [
  ["clone", "state = state.clone();"],
  ["new", "state = new State(i);"],
  ["copy", "state = Object.assign(new State(0), state);"],
  ["spread", "state = { ...state, clone: () => new State(3), size: () => 4, list: [i] };"],
  ["sometimes", "if (i & 1) state = state.clone();"],
  ["helper", "state = next(state);"],
  ["field-alone", "state.x = i;"],
  ["nullish", "state ??= new State(5);"],
  ["removed-and-made", "state = null;\nstate = new State(i);"],
  ["by-closure", "swap(i);"],
  ["child", "state = new Wide(i);"],
  ["tried", "try {\n  state = state.clone();\n  if (i === 2) throw 1;\n} catch {\n  state = new State(8);\n}"],
  ["kept", "const old = state;\nstate = state.clone();\nold.n = 40;"],
];
const seconds: [name: string, text: string][] = [
  ["field", "let c = 0;\nif (state.n > 2) c += 3;"],
  ["sum", "const c = state.x + state.n;"],
  ["method", "const c = state.size();"],
  ["list", "state.list.push(i);\nconst c = state.list.length;"],
  ["written", "state.n += 2;\nconst c = state.n;"],
  ["looped", "let c = 0;\nfor (let k = 0; k < 3; k++) c += state.n + k;"],
  ["compared", "const c = a === state.x;"],
  ["closure", "const read = () => state.n;\nconst c = read();"],
  ["optional", "const c = state?.x ?? 6;"],
  ["of-class", "const c = state instanceof Wide ? 1 : state instanceof State ? 2 : 3;"],
];
// `go(i)` does it; `BODY` ends with the answer.
const doers: [name: string, text: string][] = [
  ["method", "const doer = {\n  go(i) {\n    BODY\n  },\n};"],
  ["arrow", "const doer = {\n  go: i => {\n    BODY\n  },\n};"],
  ["class", "class Doer {\n  go(i) {\n    BODY\n  }\n}\nconst doer = new Doer();"],
  ["function", "function go(i) {\n  BODY\n}\nconst doer = { go };"],
  [
    "getter",
    "let turn = 0;\nconst doer = {\n  get next() {\n    const i = turn++;\n    BODY\n  },\n  go() {\n    return this.next;\n  },\n};",
  ],
];
const callers: [name: string, text: string][] = [
  ["pushed", "const all = [];\nfor (let i = 0; i < 5; i++) all.push(doer.go(i));\nout.push(all.map(show).join('|'));"],
  ["nested", "for (let j = 0; j < 2; j++) {\n  for (let i = 0; i < 3; i++) out.push(show(doer.go(i)));\n}"],
  ["callback", "out.push([0, 1, 2, 3].map(i => doer.go(i)).map(show).join('|'));"],
  ["while", "let i = 0;\nwhile (i < 5) {\n  const answer = doer.go(i);\n  out.push(show(answer));\n  i++;\n}"],
  ["once", "out.push(show(doer.go(1)));"],
  ["long", "let last;\nfor (let i = 0; i < 60; i++) last = doer.go(i);\nout.push(show(last));"],
];
const events: [name: string, text: string][] = [
  ["none", ""],
  ["prototype", "State.prototype.size = () => 30;"],
  ["accessor", "Object.defineProperty(State.prototype, 'n', { configurable: true, get: () => 50, set() {} });"],
  ["late-field", "fileState.late = 1;"],
];
const total = homes.length * starts.length * firsts.length * replaced.length * seconds.length * doers.length * callers.length * events.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const change = pick(replaced);
  const first = pick(firsts);
  const home = pick(homes);
  const second = pick(seconds);
  const caller = pick(callers);
  const start = pick(starts);
  const doer = pick(doers);
  const event = pick(events);
  // Nothing but its constructor writes the count of a plain object.
  const isPlain = (cell >> 3) % 2 === 1;
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const inPlace = (text: string) => text.replaceAll(/\bstate\b(?=[ .;)?,[]|$)/gm, home[2]);
  const body = inPlace(
    [first[1], change[1], second[1], "return [typeof a === 'object' && a ? a.n : a, c];"].join("\n"),
  );
  const isLate = home[0] === "late";
  const maker = [
    home[1].replace("START", start[1]),
    ...(/\bswap\(/.test(body) ? [inPlace("const swap = i => {\n  state = new State(i + 20);\n};")] : []),
    within(doer[1], "BODY", body),
    ...(isLate ? ["try {\n  if (early) doer.go(0);\n} catch (error) {\n  out.push(error.name);\n}", `let state = ${start[1]};`] : []), // prettier-ignore
    inPlace("const look = () => [state.x, state.n, state.list?.length];"),
    "return [doer, look];",
  ].join("\n");
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    'const show = value => (Array.isArray(value) ? "[" + value.map(show) + "]" : typeof value === "object" && value ? "o" : Object.is(value, -0) ? "-0" : String(value));',
    "const out = [];",
    `class State {\n  constructor(x) {\n    this.x = x;\n    this.n = 0;\n    this.list = [];\n  }\n  clone() {${isPlain ? "\n    return new State(this.x);" : "\n    const made = new State(this.x);\n    made.n = this.n + 1;\n    return made;"}\n  }\n  size() {\n    return this.n + this.list.length;\n  }\n}\nclass Wide extends State {\n  size() {\n    return super.size() + 10;\n  }\n}`, // prettier-ignore
    `let fileState = ${start[1]};`,
    "const next = given => (given.n > 2 ? new State(0) : given.clone());",
    `function make(${home[0] === "parameter" ? "early, state" : "early"}) {`,
    indent(maker, "  "),
    "}",
    "function run(early) {",
    `  const [doer, look] = make(${home[0] === "parameter" ? `early, ${start[1]}` : "early"});`,
    indent(caller[1], "  "),
    "  out.push(show(look()));",
    "}",
    "for (const early of [false, true, false]) {",
    "  try {",
    "    run(early);",
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    ...(event[1] ? [`  ${event[1]}`] : []),
    "}",
    'console.log(out.join(" ").slice(0, 1200));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${home[0]}-${start[0]}--${first[0]}--${change[0]}--${second[0]}--${doer[0]}--${caller[0]}--${event[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
