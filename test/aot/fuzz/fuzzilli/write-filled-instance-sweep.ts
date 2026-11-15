// Classes that stand at a path and instances that are filled from outside of them: how the class is made, times who fills an instance, times with what, times how instances are made, times what is read, times what happens on the way.
//
//   bun write-filled-instance-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<class>--<filler>--<value>--<making>--<read>--<event>--<place>.mjs, .cjs or .ts
//   bun write-filled-instance-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// The class is at `PATH`; its instances have `x`, `y` behind the filler.
const classes: [name: string, text: string, path: string][] = [
  ["function", "function Point() {\n  this.x = 0;\n}", "Point"],
  ["class", "class Point {\n  x = 0;\n}", "Point"],
  ["path-function", "var N = {};\nN.Point = function () {\n  this.x = 0;\n};", "N.Point"],
  ["path-class", "const N = {};\nN.Point = class {\n  x = 0;\n};", "N.Point"],
  ["long-path", "const N = { Common: { Math: {} } };\nN.Common.Math.Point = function () {\n  this.x = 0;\n};", "N.Common.Math.Point"], // prettier-ignore
  ["literal-path", "const N = {\n  Point: class {\n    x = 0;\n  },\n};", "N.Point"],
  ["alias", "const N = {};\nN.Inner = class {\n  x = 0;\n};\nconst Point = N.Inner;", "Point"],
  ["named-later", "const N = {};\n(() => {\n  function Point() {\n    this.x = 0;\n  }\n  N.Point = Point;\n})();", "N.Point"], // prettier-ignore
  ["by-apply", "function Point() {\n  Point.start.apply(this, arguments);\n  if (this.constructor === Point) this.begin.apply(this, arguments);\n}\nPoint.start = function () {\n  this.x = 0;\n};\nPoint.prototype.begin = function (x) {\n  this.x = x;\n};", "Point"], // prettier-ignore
  ["inherits", "function inherit(child, parent) {\n  const between = function () {};\n  between.prototype = parent.prototype;\n  child.prototype = new between();\n  child.prototype.constructor = child;\n}\nconst N = {};\nN.Base = function () {\n  this.b = 1;\n};\nN.Point = function () {\n  N.Base.call(this);\n  this.x = 0;\n};\ninherit(N.Point, N.Base);", "N.Point"], // prettier-ignore
  ["extends-path", "const N = {};\nN.Base = class {\n  b = 1;\n};\nN.Point = class extends N.Base {\n  x = 0;\n};", "N.Point"], // prettier-ignore
  ["empty", "const N = {};\nN.Point = function () {};", "N.Point"],
  ["returns", "const N = {};\nN.Point = function (x) {\n  if (x === 2) return { x: 9 };\n  this.x = 0;\n};", "N.Point"],
  ["branch", "const N = {};\nN.Point = function (x) {\n  if (x > 1) this.y = 1;\n  this.x = 0;\n};", "N.Point"],
  ["or", "var N = N || {};\nN.Point =\n  N.Point ||\n  function () {\n    this.x = 0;\n  };", "N.Point"],
  [
    "static-block",
    "class Point {\n  x = 0;\n  static made = 0;\n  static {\n    this.zero = new this();\n  }\n}",
    "Point",
  ],
];
// `FILL` runs with `p` the instance and V, W the values.
const fillers: [name: string, declared: string, text: string][] = [
  ["static-method", "PATH.fill = function (p, x, y) {\n  p.x = x;\n  p.y = y;\n  return p;\n};", "PATH.fill(p, V, W);"],
  ["static-maker", "PATH.make = function (x, y) {\n  const p = new PATH();\n  p.x = x;\n  p.y = y;\n  return p;\n};", "p = PATH.make(V, W);"], // prettier-ignore
  [
    "method",
    "PATH.prototype.set = function (x, y) {\n  this.x = x;\n  this.y = y;\n  return this;\n};",
    "p.set(V, W);",
  ],
  ["chained", "PATH.prototype.setX = function (x) {\n  this.x = x;\n  return this;\n};\nPATH.prototype.setY = function (y) {\n  this.y = y;\n  return this;\n};", "p.setX(V).setY(W);"], // prettier-ignore
  ["function", "function fill(p, x, y) {\n  p.x = x;\n  p.y = y;\n}", "fill(p, V, W);"],
  ["closure", "const filler = x => p => {\n  p.x = x;\n  p.y = x;\n};", "filler(V)(p);"],
  ["direct", "", "p.x = V;\np.y = W;"],
  ["other-order", "", "p.y = W;\np.x = V;"],
  ["only-one", "", "if (i & 1) p.y = W;\np.x = V;"],
  ["assign", "", "Object.assign(p, { x: V, y: W });"],
  ["by-key", 'const keys = ["x", "y"];', "for (const key of keys) p[key] = key === 'x' ? V : W;"],
  ["defined", "", "Object.defineProperty(p, 'y', { value: W, writable: true, enumerable: true, configurable: true });\np.x = V;"], // prettier-ignore
  ["through-static-call", "PATH.fill = function (p, x, y) {\n  PATH.part(p, x);\n  p.y = y;\n};\nPATH.part = function (p, x) {\n  p.x = x;\n};", "PATH.fill(p, V, W);"], // prettier-ignore
  ["this-static", "PATH.part = function (p, x) {\n  p.x = x;\n};\nPATH.fill = function (p, x, y) {\n  this.part(p, x);\n  p.y = y;\n};", "PATH.fill(p, V, W);"], // prettier-ignore
  ["in-list", "", "list.push(p);\nlist[list.length - 1].x = V;\nlist[list.length - 1].y = W;"],
  [
    "of-other",
    "PATH.copy = function (from, to) {\n  to.x = from.x;\n  to.y = from.y;\n};",
    "PATH.copy({ x: V, y: W }, p);",
  ],
  ["pool", "PATH.pool = [];\nPATH.take = function () {\n  return PATH.pool.pop() || new PATH();\n};", "p = PATH.take();\np.x = V;\np.y = W;\nPATH.pool.push(p);"], // prettier-ignore
];
const values: [name: string, first: string, second: string][] = [
  ["integers", "i", "i + 1"],
  ["doubles", "i + 0.5", "i / 4"],
  ["integer-then-double", "i > 1 ? i + 0.5 : i", "i"],
  ["integer-then-text", "i > 1 ? 't' + i : i", "i"],
  ["objects", "{ v: i }", "[i]"],
  ["nothing", "null", "undefined"],
  ["integer-then-nothing", "i > 1 ? undefined : i", "null"],
  ["itself", "p", "p.x"],
  ["texts", "'s' + i", "'t'"],
  ["large", "2 ** 31 - i", "-(2 ** 31) - i"],
  ["negative-zero", "-0 * i", "0"],
  ["functions", "() => i", "i"],
  ["kept", "kept", "kept"],
];
const makings: [name: string, text: string][] = [
  ["new", "new PATH()"],
  ["argument", "new PATH(i)"],
  ["local", "new Local()"],
  ["element", "points[i % 2]"],
  ["shared", "shared"],
  ["reflect", "Reflect.construct(PATH, [i])"],
  ["created", "Object.create(PATH.prototype)"],
  ["child", "new Child()"],
  ["literal", "i % 3 ? new PATH() : { x: 5 }"],
  ["constructor", "new shared.constructor()"],
  ["by-name", 'new holder["Point"]()'],
  ["bound", "new (PATH.bind(null))()"],
];
// What is read of `p`.
const reads: [name: string, text: string][] = [
  ["sum", "sum += +(typeof p.x === 'number' ? p.x : 1) + (p.y === undefined ? 100 : +p.y || 0);"],
  ["typed", "if (typeof p.y === 'number') sum += p.y * 2;\nelse sum--;"],
  ["shown", "out.push(show(p.x), show(p.y));"],
  ["json", "out.push(Object.keys(p).join());"],
  ["keys", "let keys = '';\nfor (const key in p) keys += key;\nout.push(keys);"],
  ["spread", "out.push(Object.keys({ ...p, z: 1 }).length);"],
  ["destructured", "const { x, y = 7, b } = p;\nout.push(show(x), show(y), show(b));"],
  ["in", "out.push('y' in p, Object.hasOwn(p, 'x'), p.b === undefined);"],
  ["written", "p.x = p.y;\nout.push(show(p.x));"],
  ["compared", "if (p.x > p.y) sum++;\nif (p.x === p.y) sum += 10;"],
  ["class", "out.push(p instanceof PATH, p.constructor === PATH);"],
  ["last", "last = p;"],
];
const events: [name: string, text: string][] = [
  ["none", ""],
  ["class-replaced", "if (i === 2) holder.Point = class { x = 40; };"],
  ["prototype-field", "if (i === 2) PATH.prototype.y = 50;"],
  [
    "accessor",
    "if (i === 2) Object.defineProperty(PATH.prototype, 'y', { configurable: true, get() { return 60; }, set(value) { this.kept = value; } });",
  ],
  ["frozen", "if (i === 2) Object.freeze(p);"],
  ["deleted", "if (i === 2) delete p.x;"],
  ["first", "if (i === 2) Object.defineProperty(p, 'x', { get: () => 70, configurable: true });"],
  ["more", "p.more = i;"],
  ["moved", "if (i === 2) Object.setPrototypeOf(p, { b: 80 });"],
];
const places: [name: string, text: string][] = [
  ["loop", "for (let i = 0; i < 5; i++) {\n  STEP\n}"],
  ["long", "for (let i = 0; i < 80; i++) {\n  STEP\n}"],
  ["nested", "for (let k = 0; k < 2; k++)\n  for (let i = 0; i < 4; i++) {\n    STEP\n  }"],
  ["callback", "[0, 1, 2, 3].forEach(i => {\n  STEP\n});"],
  ["function", "const step = i => {\n  STEP\n};\nfor (let i = 0; i < 4; i++) step(i);"],
  ["tried", "for (let i = 0; i < 5; i++) {\n  try {\n    STEP\n  } catch (error) {\n    out.push(error.name);\n  }\n}"],
];
const total = classes.length * fillers.length * values.length * makings.length * reads.length * events.length * places.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const filler = pick(fillers);
  const form = pick(classes);
  const event = pick(events);
  const value = pick(values);
  const making = pick(makings);
  const read = pick(reads);
  const place = pick(places);
  const isTyped = cell % 5 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const filled = filler[2].replaceAll(/\b[VW]\b/g, letter => (letter === "V" ? value[1] : value[2]));
  const isKept = /\bkept\b/.test(filled) && value[0] === "kept";
  const step = [`let p = ${making[1]};`, ...(event[0] === "frozen" || event[0] === "moved" || event[0] === "first" ? [filled, event[1]] : [event[1], filled]), read[1]].filter(Boolean).join("\n"); // prettier-ignore
  const body = within(place[1], "STEP", step);
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    ...(isCommon && cell % 2 ? ['"use strict";'] : []),
    'const show = value => (Array.isArray(value) ? "[" + value.map(show) + "]" : typeof value === "function" ? "f" : typeof value === "object" && value ? "{" + Object.keys(value) + "}" : Object.is(value, -0) ? "-0" : String(value));',
    "const out = [];",
    form[1],
    ...(filler[1] ? [filler[1]] : []),
    ...(/\bLocal\b/.test(step) ? ["const Local = PATH;"] : []),
    ...(/\bChild\b/.test(step) ? ["class Child extends PATH {\n  c = 1;\n}"] : []),
    ...(/\bholder\b/.test(step) ? [/^N\.Point$/.test(form[2]) ? "const holder = N;" : "const holder = { Point: PATH };"] : []), // prettier-ignore
    ...(/\bshared\b/.test(step) ? ["const shared = new PATH();"] : []),
    ...(/\bpoints\b/.test(step) ? ["const points = [new PATH(), new PATH()];"] : []),
    ...(isKept ? ["const kept = JSON.parse('[1, 0.5]')[1];"] : []),
    "function work() {",
    "  let sum = 0;",
    ...(/\blist\b/.test(step) ? ["  const list = [];"] : []),
    ...(/\blast\b/.test(step) ? ["  let last;"] : []),
    indent(body, "  "),
    `  out.push(show(sum)${/\blast\b/.test(step) ? ", show(last), show(last.x), show(last.y)" : ""});`,
    "}",
    "for (let round = 0; round < 2; round++) {",
    "  try {",
    "    work();",
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 900));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${form[0]}--${filler[0]}--${value[0]}--${making[0]}--${read[0]}--${event[0]}--${place[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
    text: lines.join("\n").replaceAll("PATH", form[2]) + "\n",
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
