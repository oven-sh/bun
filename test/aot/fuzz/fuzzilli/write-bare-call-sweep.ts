// The least programs that have calls: what is called, times its parameters, times what it does, times what it is handed, times how the answer is used, times the loop, with nothing beside.
//
//   bun write-bare-call-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<callee>--<parameters>--<body>--<handed>--<used>--<loop>.mjs, .cjs or .ts
//   bun write-bare-call-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// P are the parameters, B the body; CALL(ARGS) calls.
const callees: [name: string, text: string, call: string][] = [
  ["function", "function f(P) {\n  B\n}", "f(ARGS)"],
  ["arrow", "const f = (P) => {\n  B\n};", "f(ARGS)"],
  ["method", "const o = {\n  f(P) {\n    B\n  },\n};", "o.f(ARGS)"],
  ["class-method", "class C {\n  f(P) {\n    B\n  }\n}\nconst o = new C();", "o.f(ARGS)"],
  ["static", "class C {\n  static f(P) {\n    B\n  }\n}", "C.f(ARGS)"],
  [
    "heir",
    "class A {\n  f(P) {\n    B\n  }\n}\nclass C extends A {\n  f(...all) {\n    return super.f(...all);\n  }\n}\nconst o = new C();",
    "o.f(ARGS)",
  ],
  ["constructor", "class C {\n  constructor(P) {\n    this.v = (() => {\n      B\n    })();\n  }\n}", "new C(ARGS).v"],
  ["closure", "const make = () => (P) => {\n  B\n};\nconst f = make();", "f(ARGS)"],
  ["bound", "const f = function (P) {\n  B\n}.bind(null);", "f(ARGS)"],
  ["called", "function f(P) {\n  B\n}", "f.call(null, ARGS)"],
  ["applied", "function f(P) {\n  B\n}", "f.apply(null, [ARGS])"],
  ["spread", "function f(P) {\n  B\n}", "f(...[ARGS])"],
  ["by-key", "const o = {\n  f(P) {\n    B\n  },\n};\nconst key = 'f';", "o[key](ARGS)"],
  ["optional", "const o = {\n  f(P) {\n    B\n  },\n};", "o?.f?.(ARGS)"],
  ["in-place", "", "((P) => {\n  B\n})(ARGS)"],
  ["getter", "const o = {\n  get f() {\n    return (P) => {\n      B\n    };\n  },\n};", "o.f(ARGS)"],
  ["from-list", "const all = [(P) => {\n  B\n}, () => 'other'];", "all[0](ARGS)"],
  ["reflected", "function f(P) {\n  B\n}", "Reflect.apply(f, null, [ARGS])"],
  ["generator", "function* g(P) {\n  yield (() => {\n    B\n  })();\n}", "g(ARGS).next().value"],
  ["passed", "function f(P) {\n  B\n}\nconst go = (call, ...all) => call(...all);", "go(f, ARGS)"],
  ["through", "function f(P) {\n  B\n}\nfunction through(x, y) {\n  return f(x, y);\n}", "through(ARGS)"],
  [
    "either",
    "const one = (P) => {\n  B\n};\nconst two = () => 'two';\nconst pick = n => (n > 90 ? two : one);",
    "pick(i)(ARGS)",
  ],
  [
    "private",
    "class C {\n  #f(P) {\n    B\n  }\n  go(...all) {\n    return this.#f(...all);\n  }\n}\nconst o = new C();",
    "o.go(ARGS)",
  ],
  [
    "function-of-prototype",
    "function C() {}\nC.prototype.f = function (P) {\n  B\n};\nconst o = new C();",
    "o.f(ARGS)",
  ],
];
const parameters: [name: string, text: string][] = [["two", "x, y"], ["default", "x, y = 5"], ["default-of-first", "x, y = x"], ["rest", "x, ...y"], ["pattern", "x, { v: y = 2 } = {}"], ["list-pattern", "x, [y = 3] = []"], ["one", "x"], ["three", "x, y, z"], ["typed", "x: number, y?: number"]]; // prettier-ignore
const bodies: [name: string, text: string][] = [
  ["sum", "return x + y;"],
  ["first", "return x;"],
  ["second", "return y;"],
  ["if", "if (x > 1) return x;\nreturn y;"],
  ["changed", "x = x + 1;\nreturn x;"],
  ["step", "return ++x;"],
  ["type", "return typeof x + typeof y;"],
  ["object", "return { x, y };"],
  ["list", "return [x, y];"],
  ["nullish", "return y ?? x;"],
  ["count", "return count++;"],
  ["sum-kept", "total += x;\nreturn total;"],
  ["throws", "if (x === 2) throw new RangeError('r');\nreturn x;"],
  ["closure", "const inner = () => x;\nx = y;\nreturn inner();"],
  ["loop", "let s = 0;\nfor (let k = 0; k < 3; k++) s += x;\nreturn s;"],
  ["product", "return x * 0.5;"],
  ["text", "return `${x}|${y}`;"],
  ["nothing", "seen.push(x);"],
  ["this", "return this === undefined ? 'none' : typeof this;"],
  ["arguments-length", "return [x, y].length + (y === undefined ? 0 : 1);"],
  ["swap", "[x, y] = [y, x];\nreturn x;"],
  ["compare", "return x < y;"],
  ["bits", "return (x | 0) ^ (y | 0);"],
];
const handed: [name: string, text: string][] = [["two", "i, 2"], ["one", "i"], ["none", ""], ["three", "i, 2, 3"], ["double", "i / 2, 0.5"], ["text", "'t' + i, i"], ["nothing", "undefined, i"], ["null", "null, null"], ["object", "{ v: i }, { v: 1 }"], ["list", "[i], [i + 1]"], ["element", "l[i & 3], l[0]"], ["effect", "(seen.push(i), i), seen.length"], ["negative", "-i, -0"], ["large", "i + 2147483646, 1"]]; // prettier-ignore
const used: [name: string, text: string][] = [["shown", "out.push(show(CALL));"], ["summed", "sum += CALL;"], ["kept", "const kept = CALL;\nout.push(show(kept));"], ["tested", "if (CALL) sum++;"], ["twice", "out.push(show(CALL), show(CALL));"], ["dropped", "CALL;"], ["nested", "out.push([CALL].length, show(CALL));"], ["caught", "try {\n  out.push(show(CALL));\n} catch (error) {\n  out.push(error.name);\n}"]]; // prettier-ignore
const loops: [name: string, text: string][] = [["four", "for (let i = 0; i < 4; i++) {\n  USE\n}"], ["once", "{\n  const i = 2;\n  USE\n}"], ["many", "for (let i = 0; i < 40; i++) {\n  USE\n}"], ["callback", "[0, 1, 2].forEach(i => {\n  USE\n});"], ["nested", "for (let k = 0; k < 2; k++) {\n  for (let i = 0; i < 3; i++) {\n    USE\n  }\n}"]]; // prettier-ignore
const total = callees.length * parameters.length * bodies.length * handed.length * used.length * loops.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const callee = pick(callees);
  const body = pick(bodies);
  const hand = pick(handed);
  const parameter = pick(parameters);
  const use = pick(used);
  const loop = pick(loops);
  const isTyped = parameter[0] === "typed" || cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0 && body[0] !== "this";
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const code = parameter[0] === "one" ? body[1].replaceAll(/\by\b/g, "count") : body[1];
  const fill = (text: string) => within(text, "B", code).replaceAll(/\(P\)/g, () => `(${parameter[1]})`);
  const call = fill(callee[2])
    .replaceAll("ARGS", () => hand[1])
    .replace("(null, )", "(null)")
    .replace("(f, )", "(f)");
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    'const show = value => (Object.is(value, -0) ? "-0" : typeof value === "object" && value ? JSON.stringify(value) : String(value));',
    "const out = [];",
    "const seen = [];",
    "let count = 0;",
    "let total = 0;",
    "let sum = 0;",
    ...(/\bl\b/.test(hand[1]) ? ["const l = [1, 2, 3, 4];"] : []),
    ...(callee[1] ? [fill(callee[1])] : []),
    "try {",
    indent(
      within(
        loop[1],
        "USE",
        use[1].replaceAll("CALL", () => call),
      ),
      "  ",
    ),
    "} catch (error) {",
    "  out.push(error.name);",
    "}",
    'console.log(out.join(" ").slice(0, 900), sum, count, total, seen.map(show).join().slice(0, 200));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${callee[0]}--${parameter[0]}--${body[0]}--${hand[0]}--${use[0]}--${loop[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
