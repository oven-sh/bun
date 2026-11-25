// The least programs of a parent that changes: each way to make an heir, times each change of a parent, times when, times each question.
//
//   bun write-changed-parent-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<heir>--<change>--<when>--<question>--<base>--<place>.mjs, .cjs or .ts
//   bun write-changed-parent-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

const heirs: string[] = [
  "H.prototype = Object.create(A.prototype);",
  "H.prototype = Object.create(A.prototype, { constructor: { value: H } });",
  "H.prototype = new A(0);",
  "H.prototype = new A(0);\nH.prototype.constructor = H;",
  "function Link() {}\nLink.prototype = A.prototype;\nH.prototype = new Link();",
  "function Link() {\n  this.constructor = H;\n}\nLink.prototype = A.prototype;\nH.prototype = new Link();",
  "Object.setPrototypeOf(H.prototype, A.prototype);",
  "H.prototype.__proto__ = A.prototype;",
  "H.prototype = { __proto__: A.prototype, q: 4 };",
  "inherits(H, A);",
  "extend(H, A);",
  "H.prototype = Object.assign(Object.create(A.prototype), { q() {\n  return 'q' + this.v;\n} });",
  "Object.setPrototypeOf(H, A);\nObject.setPrototypeOf(H.prototype, A.prototype);",
  "H.prototype = A.prototype;",
  "for (const k in A.prototype) H.prototype[k] = A.prototype[k];",
  "H = class extends A {};",
  "H = function (v) {\n  return Reflect.construct(A, [v], H);\n};\nH.prototype = Object.create(A.prototype);",
  "Reflect.setPrototypeOf(H.prototype, A.prototype);",
  "H.prototype = Object.setPrototypeOf({ q: 1 }, A.prototype);",
  "A.prototype.heir = H;\nH.prototype = Object.create(A.prototype);",
  "",
];
const changes: string[] = [
  "",
  "Object.setPrototypeOf(H.prototype, B.prototype);",
  "H.prototype.__proto__ = B.prototype;",
  "H.prototype = Object.create(B.prototype);",
  "H.prototype = B.prototype;",
  "inherits(H, B);",
  "extend(H, B);",
  "A.prototype.m = function () {\n  return 'new' + this.v;\n};",
  "delete A.prototype.m;",
  "A.prototype = B.prototype;",
  "Object.setPrototypeOf(A.prototype, B.prototype);",
  "H.prototype.m = () => 'own';",
  "Object.setPrototypeOf(H.prototype, null);",
  "Object.setPrototypeOf(early, B.prototype);",
  "early.__proto__ = null;",
  "A.prototype.late = 7;",
  "B.prototype.m = A.prototype.m;",
  "Object.defineProperty(A.prototype, 'm', { get: () => () => 'got' });",
  "H.prototype.constructor = B;",
  "function Link2() {}\nLink2.prototype = B.prototype;\nH.prototype = new Link2();",
  "Object.freeze(A.prototype);",
  "A.prototype.v = 'shared';",
];
const whens: string[] = [
  "MAKE\nINSTANCE\nASK\nCHANGE\nASK",
  "MAKE\nCHANGE\nINSTANCE\nASK",
  "INSTANCE\nMAKE\nASK\nCHANGE\nASK",
  "MAKE\nINSTANCE\nCHANGE\nASK\nASK",
  "MAKE\nCHANGE\nMAKE\nINSTANCE\nASK",
  "MAKE\nINSTANCE\nfor (let i = 0; i < 3; i++) {\n  ASK\n  if (i === 1) {\n    CHANGE\n  }\n}",
];
const asks: string[] = [
  "say(early.m?.());",
  "say(early instanceof A, early instanceof B, early instanceof H);",
  "say(early.constructor === H, early.constructor === A, early.constructor === B);",
  "say(typeof early.late, typeof early.n);",
  "say(Object.getPrototypeOf(early) === H.prototype);",
  "say(new H(5).m?.(), early.v);",
  "say('m' in early, Object.hasOwn(early, 'm'));",
  "let keys = '';\nfor (const k in early) keys += k;\nsay(keys);",
  "say(A.prototype.isPrototypeOf(early), B.prototype.isPrototypeOf(early));",
  "say(early.v, early.n?.());",
  "say(early.q?.call?.(early) ?? early.q);",
  "say(new H(1) instanceof A, new H(2) instanceof B);",
  "for (const o of [early, new H(3), new A(4)]) say(o.m?.());",
  "say(Object.keys(Object.getPrototypeOf(early) ?? {}).length);",
  "say(early.toString === Object.prototype.toString);",
  "say(H.prototype.m === A.prototype.m, H.prototype.m === B.prototype.m);",
];
const bases: string[] = [
  "function A(v) {\n  this.v = v;\n}\nA.prototype.m = function () {\n  return 'a' + this.v;\n};",
  "class A {\n  constructor(v) {\n    this.v = v;\n  }\n  m() {\n    return 'a' + this.v;\n  }\n}",
  "function A(v) {\n  this.v = v;\n}\nA.prototype = {\n  m() {\n    return 'a' + this.v;\n  },\n};",
];
const places = ["of-file", "function", "twice", "loop"];
const total = heirs.length * changes.length * whens.length * asks.length * bases.length * places.length;
// Neighbors differ in everything, so that any part of the numbers has all of it.
const leap = 332_641;

function write(cell: number): { name: string; text: string } {
  let rest = (cell * leap) % total;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const heir = pick(heirs);
  const change = pick(changes);
  const when = pick(whens);
  const ask = pick(asks);
  const base = pick(bases);
  const place = pick(places);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const guarded = (text: string) =>
    text ? `try {\n${indent(text, "  ")}\n} catch (e) {\n  say(e.name);\n}` : "say('-');";
  const steps = ["MAKE", "INSTANCE", "CHANGE", "ASK"].reduce(
    (text, hole, at) => within(text, hole, [guarded(heir), "early = new H(2);", guarded(change), guarded(ask)][at]),
    when,
  );
  const inner = [
    base,
    "class B {\n  n() {\n    return 'b' + this.v;\n  }\n}",
    /^H = /m.test(heir) ? "let H = function (v) {\n  this.v = v;\n};" : "function H(v) {\n  this.v = v;\n}",
    "let early;",
    steps,
  ].join("\n");
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    ...(isCommon && cell % 2 ? ["'use strict';"] : []),
    "const said = [];",
    'const tell = v => (typeof v === "function" ? "function" : Array.isArray(v) ? "list" + v.length : typeof v === "object" && v ? "object" : String(v));',
    'const say = (...values) => void said.push(values.map(tell).join(":"));',
    ...(/inherits\(/.test(inner)
      ? [
          "function inherits(heir, parent) {\n  heir.super_ = parent;\n  Object.setPrototypeOf(heir.prototype, parent.prototype);\n}",
        ]
      : []),
    ...(/extend\(/.test(inner)
      ? [
          "function extend(heir, parent) {\n  function Link() {\n    this.constructor = heir;\n  }\n  Link.prototype = parent.prototype;\n  heir.prototype = new Link();\n}",
        ]
      : []),
    ...(place === "of-file" ? [inner] : [`function run() {\n${indent(inner, "  ")}\n}`]),
    "function said0(of) {\n  try {\n    of();\n  } catch (error) {\n    say(error.name);\n  }\n}",
    ...(place === "of-file"
      ? []
      : place === "function"
        ? ["said0(run);"]
        : place === "twice"
          ? ["said0(run);", "said0(run);"]
          : ["for (let i = 0; i < 3; i++) said0(run);"]),
    'console.log(said.join(" ").slice(0, 1400));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${heirs.indexOf(heir)}--${changes.indexOf(change)}--${whens.indexOf(when)}--${asks.indexOf(ask)}--${bases.indexOf(base)}--${place}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
