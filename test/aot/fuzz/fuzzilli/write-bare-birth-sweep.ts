// The least programs that make objects in loops: how an object is made, times what its maker does besides, times what is asked of it, times the outer loop, times the inner loop, times what becomes of it, with nothing beside.
//
//   bun write-bare-birth-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<maker>--<deed>--<asked>--<outer>--<inner>--<kept>.mjs, .cjs or .ts
//   bun write-bare-birth-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// D is the deed, with F for the function and `x` for what is handed over; NEW makes an object.
const makers: [name: string, text: string, make: string][] = [
  ["function", "function F(x) {\n  this.a = x;\n  D\n}", "new F(i)"],
  ["function-deed-first", "function F(x) {\n  D\n  this.a = x;\n}", "new F(i)"],
  ["class", "class F {\n  constructor(x) {\n    this.a = x;\n    D\n  }\n}", "new F(i)"],
  ["class-field", "class F {\n  a = 1;\n  constructor(x) {\n    D\n  }\n}", "new F(i)"],
  [
    "heir",
    "class A {\n  constructor(x) {\n    this.a = x;\n  }\n}\nclass F extends A {\n  constructor(x) {\n    super(x);\n    D\n  }\n}",
    "new F(i)",
  ],
  ["deed-above", "class A {\n  constructor(x) {\n    this.a = x;\n    D\n  }\n}\nclass F extends A {}", "new F(i)"],
  [
    "below-array",
    "class F extends Array {\n  constructor(x) {\n    super();\n    this.a = x;\n    D\n  }\n}",
    "new F(i)",
  ],
  ["held", "const o = {\n  F: function (x) {\n    this.a = x;\n    D\n  },\n};\nconst { F } = o;", "new o.F(i)"],
  ["reflected", "function F(x) {\n  this.a = x;\n  D\n}", "Reflect.construct(F, [i])"],
  ["through", "function F(x) {\n  this.a = x;\n  D\n}\nconst make = x => new F(x);", "make(i)"],
  ["without-new", "function F(x) {\n  if (!(this instanceof F)) return new F(x);\n  this.a = x;\n  D\n}", "F(i)"],
  ["literal", "function F(x) {\n  const made = { a: x };\n  D\n  return made;\n}", "F(i)"],
  [
    "created",
    "const above = { b: 7 };\nfunction F(x) {\n  const made = Object.create(above);\n  made.a = x;\n  D\n  return made;\n}",
    "F(i)",
  ],
  ["assigned-prototype", "function F(x) {\n  this.a = x;\n  D\n}\nF.prototype = { b: 7 };", "new F(i)"],
];
const deeds: [name: string, text: string][] = [
  ["nothing", ";"],
  ["prototype-replaced", "F.prototype = { b: x };"],
  ["prototype-field", "F.prototype.b = x;"],
  ["prototype-method", "F.prototype.go = function () {\n  return x;\n};"],
  ["prototype-once", "if (x === 1) F.prototype = { b: 'one' };"],
  ["static", "F.count = (F.count ?? 0) + 1;"],
  ["more-fields", "if (x & 1) this.b = x;"],
  ["removed", "this.b = 2;\ndelete this.a;"],
  ["returns-object", "if (x === 1) return { a: 'other' };"],
  ["returns-number", "return 5;"],
  ["throws", "if (x === 1) throw new TypeError('t');"],
  ["parent-changed", "if (x === 1) Object.setPrototypeOf(F.prototype, { c: 9 });"],
  ["own-parent-changed", "if (x === 1) Object.setPrototypeOf(this, { c: 9 });"],
  ["accessor", "Object.defineProperty(this, 'b', { get: () => x, configurable: true });"],
  [
    "accessor-above",
    "if (x === 0) Object.defineProperty(F.prototype, 'b', { get: () => 'above', set() {}, configurable: true });\nthis.b = x;",
  ],
  ["frozen", "if (x === 1) Object.freeze(this);"],
  ["closure", "this.b = () => x;"],
  ["itself", "this.b = this;"],
  ["kind-changed", "this.a = x & 1 ? 't' : 0.5;"],
  ["another", "this.b = x > 0 ? new F(x - 1) : null;"],
  ["loop", "for (let k = 0; k < 3; k++) this['k' + k] = k;"],
  ["pushed", "born.push(this);"],
  ["setter-in-new-prototype", "F.prototype = {\n  set b(v) {\n    born.push(v);\n  },\n};\nthis.b = x;"],
  [
    "setter-in-new-prototype-once",
    "if (x === 1)\n  F.prototype = {\n    set b(v) {\n      born.push(v);\n    },\n    get b() {\n      return 'g';\n    },\n  };\nthis.b = x;",
  ],
  [
    "setter-laid-first",
    "Object.defineProperty(F.prototype, 'b', {\n  set(v) {\n    born.push(v);\n  },\n  configurable: true,\n});\nthis.b = x;",
  ],
  [
    "read-only-laid-first",
    "Object.defineProperty(F.prototype, 'b', { value: 'fixed', writable: false, configurable: true });\ntry {\n  this.b = x;\n} catch {}",
  ],
  [
    "proxy-above",
    "if (x === 1)\n  Object.setPrototypeOf(\n    F.prototype,\n    new Proxy({}, {\n      set(t, k, v) {\n        born.push(String(k));\n        return true;\n      },\n    }),\n  );\nthis.b = x;",
  ],
  ["laid-by-call", "lay(F, x);\nthis.b = x;"],
];
const asked: [name: string, text: string][] = [["a", "O.a"], ["b", "O.b"], ["prototype", "Object.getPrototypeOf(O) === F.prototype"], ["instance", "O instanceof F"], ["keys", "Object.keys(O).join()"], ["above", "Object.keys(Object.getPrototypeOf(O)).join()"], ["parent-field", "O.c"], ["method", "O.go?.()"], ["has", "'b' in O"], ["constructor", "O.constructor === F"], ["sum", "O.a + 1"], ["json", "Object.entries(O).map(([key, value]) => key + typeof value).join()"]]; // prettier-ignore
const outers: [name: string, text: string][] = [["three", "for (let i = 0; i < 3; i++) {\n  IN\n}"], ["given", "for (let i = 0; i < n; i++) {\n  IN\n}"], ["once", "{\n  const i = 1;\n  IN\n}"], ["many", "for (let i = 0; i < 30; i++) {\n  IN\n}"], ["of", "for (const i of [1, 0, 2]) {\n  IN\n}"], ["while", "let i = 0;\nwhile (i < 3) {\n  IN\n  i++;\n}"]]; // prettier-ignore
const inners: [name: string, text: string][] = [["none", "MAKE"], ["two", "for (let q = 0; q < 2; q++) {\n  MAKE\n}"], ["to-outer", "for (let q = 0; q <= i; q++) {\n  MAKE\n}"], ["if", "if (i !== 2) {\n  MAKE\n}"], ["twice", "{\n  MAKE\n}\n{\n  MAKE\n}"], ["caught", "try {\n  MAKE\n} catch (error) {\n  out.push(error.name);\n}"]]; // prettier-ignore
// O is the object.
const kept: [name: string, text: string][] = [["asked-at-once", "const o2 = NEW;\nout.push(String(ASK));"], ["kept", "last = NEW;"], ["listed", "all.push(NEW);"], ["asked-without-name", "out.push(String(ASKNEW));"], ["dropped", "NEW;\nout.push('made');"], ["field", "box.o = NEW;\nout.push(String(ASKBOX));"]]; // prettier-ignore
const total = makers.length * deeds.length * asked.length * outers.length * inners.length * kept.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const deed = pick(deeds);
  const maker = pick(makers);
  const ask = pick(asked);
  const inner = pick(inners);
  const keep = pick(kept);
  const outer = pick(outers);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0 && !/freeze|accessor|writable|Proxy/.test(deed[1]);
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const isMade = maker[0] === "literal" || maker[0] === "created";
  const done = isMade ? deed[1].replaceAll("this", "made") : deed[1];
  const question = (o: string) => ask[1].replaceAll(/\bO\b/g, o);
  const make = keep[1].replaceAll("ASKNEW", () => question(`(${maker[2]})`)).replaceAll("ASKBOX", () => question("box.o")).replaceAll("ASK", () => question("o2")).replaceAll("NEW", maker[2]); // prettier-ignore
  const uses = (word: RegExp) => word.test(make + done);
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    "const out = [];",
    ...(uses(/\bborn\b/) ? ["const born = [];"] : []),
    ...(uses(/\ball\.push/) ? ["const all = [];"] : []),
    ...(uses(/\bbox\b/) ? ["const box = { o: null };"] : []),
    ...(uses(/\blast\b/) ? ["let last = { a: 0 };"] : []),
    ...(uses(/\blay\(/)
      ? [
          "const lay = (f, x) => {\n  if (x === 1) Object.defineProperty(f.prototype, 'b', { set(v) {\n    out.push('set' + v);\n  }, get: () => 'got', configurable: true });\n};",
        ]
      : []),
    within(maker[1], "D", done),
    `function run(n) {\n${indent(within(outer[1], "IN", within(inner[1], "MAKE", make)), "  ")}\n}`,
    "for (const n of [2, 4]) {",
    "  try {",
    "    run(n);",
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    ...(uses(/\blast\b/) ? [`  out.push(String(${question("last")}));`] : []),
    "}",
    ...(uses(/\ball\.push/) ? [`out.push(all.map(o => String(${question("o")})).join('/'));`] : []),
    ...(uses(/\bborn\b/) ? ["out.push(born.length);"] : []),
    'console.log(out.join(" ").slice(0, 900));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${maker[0]}--${deed[0]}--${ask[0]}--${outer[0]}--${inner[0]}--${keep[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
