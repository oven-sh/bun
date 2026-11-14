// Instances of a class that are born again and again, while something their birth rests on changes between two births: the class, times what changes, times when, times how an instance is born, times how it is filled, times the kind of value, times the function around.
//
//   bun write-repeated-birth-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<class>--<change>--<when>--<birth>--<fill>--<value>--<function>.mjs, .cjs or .ts
//   bun write-repeated-birth-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `C` is the class of the instances; `n` and `v` are given.
const classes: [name: string, text: string][] = [
  ["list", "class C extends Array {\n  constructor(n, v) {\n    super(n);\n  }\n}"],
  [
    "list-with-fields",
    "class C extends Array {\n  constructor(n, v) {\n    super(n);\n    this.held = v;\n    this.rows = 2;\n  }\n}",
  ],
  ["implicit-list", "class C extends Array {}"],
  [
    "list-filled",
    "class C extends Array {\n  constructor(n, v) {\n    super();\n    for (let i = 0; i < n; i++) this.push(v);\n  }\n}",
  ],
  [
    "list-below",
    "class Above extends Array {\n  first() {\n    return this[0];\n  }\n}\nclass C extends Above {\n  held = 1;\n}",
  ],
  ["map", "class C extends Map {\n  constructor(n, v) {\n    super([[0, v]]);\n    this.held = v;\n  }\n}"],
  ["set", "class C extends Set {\n  held = 1;\n  constructor(n, v) {\n    super([v]);\n  }\n}"],
  ["error", "class C extends Error {\n  constructor(n, v) {\n    super('e');\n    this.held = v;\n  }\n}"],
  ["bytes", "class C extends Uint8Array {\n  constructor(n, v) {\n    super(4);\n    this.held = v;\n  }\n}"],
  ["plain", "class C {\n  constructor(n, v) {\n    this.held = v;\n    this.rows = n;\n  }\n}"],
  ["fields", "class C {\n  held = 1;\n  rows;\n  constructor(n, v) {\n    this.held = v;\n  }\n}"],
  [
    "heir",
    "class Above {\n  constructor(v) {\n    this.held = v;\n  }\n}\nclass C extends Above {\n  constructor(n, v) {\n    super(v);\n    this.rows = n;\n  }\n}",
  ],
  [
    "heir-of-heir",
    "class Top {\n  top = 1;\n}\nclass Above extends Top {\n  held = 2;\n}\nclass C extends Above {\n  rows = 3;\n}",
  ],
  ["function", "function C(n, v) {\n  this.held = v;\n  this.rows = n;\n}"],
  [
    "function-list",
    "function C(n, v) {\n  this.held = v;\n}\nC.prototype = Object.create(Array.prototype);\nC.prototype.constructor = C;",
  ],
  [
    "mixin",
    "const mixin = S =>\n  class extends S {\n    get cells() {\n      return 4;\n    }\n  };\nclass C extends mixin(Array) {\n  constructor(n, v) {\n    super(n);\n    this.held = v;\n  }\n}",
  ],
  ["returns-other", "class C {\n  constructor(n, v) {\n    this.held = v;\n    if (n === 7) return [v];\n  }\n}"],
  [
    "private",
    "class C {\n  #own = 1;\n  constructor(n, v) {\n    this.held = v;\n    this.#own = n;\n  }\n  own() {\n    return this.#own;\n  }\n}",
  ],
  [
    "accessor-in-body",
    "class C extends Array {\n  set 3(v) {\n    out.push('body ' + v);\n  }\n  get 3() {\n    return 'b';\n  }\n}",
  ],
  [
    "bound-above",
    "class Above extends Array {\n  static make(n, v) {\n    return new this(n, v);\n  }\n}\nclass C extends Above {}",
  ],
];
// What is done once. `P` is the prototype of C and `A` the prototype above it.
const changes: [name: string, text: string][] = [
  ["accessor-at-index", "Object.defineProperty(P, 2, accessor('own'));"],
  ["accessor-above", "Object.setPrototypeOf(P, Object.create(A, { 1: accessor('above') }));"],
  ["read-only-at-index", "Object.defineProperty(P, 1, { value: 'fixed', writable: false, configurable: true });"],
  ["element", "P[2] = 'proto';"],
  ["frozen", "P[0] = 'zero';\nObject.freeze(P);"],
  [
    "proxy-above",
    "Object.setPrototypeOf(P, new Proxy(A, { set(target, key, value, receiver) { out.push('trap ' + String(key)); return Reflect.set(target, key, value, receiver); } }));",
  ],
  ["accessor-of-field", "Object.defineProperty(P, 'held', accessor('held'));"],
  ["read-only-field", "Object.defineProperty(P, 'rows', { value: 9, writable: false, configurable: true });"],
  [
    "accessor-of-field-above",
    "Object.defineProperty([Object, Array, Map, Set, Error, Uint8Array].some(other => other.prototype === A) ? P : A, 'rows', accessor('rows'));",
  ],
  [
    "other-class-above",
    "class Other {\n  constructor() {\n    out.push('other');\n  }\n}\nif (typeof C === 'function') Object.setPrototypeOf(C, Other);",
  ],
  ["prototype-replaced", "C.prototype = { replaced: 1, get 1() { return 'r'; } };"],
  [
    "prototype-of-function",
    "try {\n  Object.defineProperty(C, 'prototype', { value: Object.create(A, { held: accessor('new') }) });\n} catch (error) {\n  out.push(error.name);\n}",
  ],
  ["species", "Object.defineProperty(C, Symbol.species, { get() { return Array; }, configurable: true });"],
  ["constructor-field", "P.constructor = Array;"],
  ["sealed", "Object.preventExtensions(P);\nP.extra = 1;"],
  ["method", "P.push = function (value) {\n  this[this.length] = value + 1;\n  return this.length;\n};"],
  ["iterator", "P[Symbol.iterator] = function* () {\n  yield 'mine';\n};"],
  ["to-text", "P.toString = () => 'changed';"],
  ["field-late", "P.late = 5;\nP.held = 6;"],
  ["tag", "P[Symbol.toStringTag] = 'Tag';"],
  ["null-above", "Object.setPrototypeOf(P, null);"],
  ["nothing", "out.push('n');"],
];
// `CHANGE` is the change and `TURN` a birth with all that follows; `k` counts.
const moments: [name: string, text: string][] = [
  ["first", "CHANGE\nfor (let k = 0; k < 4; k++) {\n  TURN\n}"],
  ["after-one", "for (let k = 0; k < 4; k++) {\n  TURN\n  if (k === 0) {\n    CHANGE\n  }\n}"],
  ["after-some", "for (let k = 0; k < 12; k++) {\n  if (k === 9) {\n    CHANGE\n  }\n  TURN\n}"],
  ["after-many", "for (let k = 0; k < 120; k++) {\n  if (k === 100) {\n    CHANGE\n  }\n  TURN\n}"],
  ["between", "for (let k = 0; k < 8; k++) {\n  TURN\n}\nCHANGE\nfor (let k = 0; k < 3; k++) {\n  TURN\n}"],
  [
    "in-a-call",
    "const change = () => {\n  CHANGE\n};\nfor (let k = 0; k < 9; k++) {\n  if (k === 6) change();\n  TURN\n}",
  ],
  [
    "in-a-getter",
    "const trap = {\n  get v() {\n    CHANGE\n    return 1;\n  },\n};\nfor (let k = 0; k < 9; k++) {\n  if (k === 5) v = trap.v;\n  TURN\n}",
  ],
  [
    "twice",
    "for (let k = 0; k < 10; k++) {\n  if (k === 3 || k === 6) {\n    try {\n      CHANGE\n    } catch (error) {\n      out.push(error.name);\n    }\n  }\n  TURN\n}",
  ],
  [
    "nested",
    "for (let round = 0; round < 3; round++) {\n  for (let k = 0; k < 4; k++) {\n    TURN\n  }\n  if (round === 1) {\n    CHANGE\n  }\n}",
  ],
];
const births: [name: string, text: string][] = [
  ["new", "new C(n, v)"],
  ["reflected", "Reflect.construct(C, [n, v])"],
  ["of-heir", "new D(n, v)"],
  ["for-heir", "Reflect.construct(C, [n, v], D)"],
  ["of-list", "Reflect.construct(Array, [n], C)"],
  ["spread", "new C(...[n, v])"],
  ["through", "make(n, v)"],
  ["held", "new ({ C }).C(n, v)"],
  ["from", "Array.from.call(C, [v, v, v])"],
  ["of", "Array.of.call(C, v, v)"],
  ["created", "Object.create(C.prototype)"],
  ["of-either", "new (k & 1 ? C : D)(n, v)"],
  ["bound", "new (C.bind(null, n))(v)"],
];
// `a` is the instance.
const fills: [name: string, text: string][] = [
  ["elements", "for (let i = 0; i < 4; i++) a[i] = v;"],
  ["strict-elements", "put(a, v);"],
  ["pushed", "if (a.push) a.push(v, v);"],
  ["fields", "a.held = v;\na.rows = 2;"],
  ["assigned", "Object.assign(a, { held: v, 1: 'x' });"],
  ["pair", "[a[0], a[2]] = [v, 'y'];"],
  ["late", "a.late = v;\na[5] = 1;"],
  ["defined", "Object.defineProperty(a, 2, { value: v, writable: true, enumerable: true, configurable: true });"],
  ["filled", "Array.prototype.fill.call(a, v, 0, 3);"],
  ["counted", "a[1] = (a[1] ?? 0) + 1;\na.held += 1;"],
  ["nothing", ""],
  ["mapped", "if (a.map) a = a.map(x => x);"],
  ["emptied", "a.length = 2;\na[2] = v;"],
];
const values: [name: string, text: string][] = [
  ["integer", "3"],
  ["double", "1.5"],
  ["text", "'t'"],
  ["object", "{ toString: () => 'o' }"],
  ["nothing", "undefined"],
];
// `BODY` is what is done with `n` and `v`.
const functions: [name: string, text: string][] = [
  ["function", "function run(n, v) {\n  BODY\n}"],
  ["arrow", "const run = (n, v) => {\n  BODY\n};"],
  ["class-inside", "function run(n, v) {\n  BODY\n}"],
  ["method", "const runner = {\n  run(n, v) {\n    BODY\n  },\n};\nconst run = (n, v) => runner.run(n, v);"],
];
const total = classes.length * changes.length * moments.length * births.length * fills.length * values.length * functions.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const kind = pick(classes);
  const change = pick(changes);
  const fill = pick(fills);
  const birth = pick(births);
  const moment = pick(moments);
  const value = pick(values);
  const form = pick(functions);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0 && fill[0] !== "strict-elements";
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const turn = [
    `let a = ${birth[1]};`,
    "try {",
    indent(fill[1] || "a = a;", "  "),
    "} catch (error) {",
    "  out.push(error.name);",
    "}",
    "if (k < 2 || k === 9 || k > 99) out.push(show(a));",
  ].join("\n");
  const declared = [
    kind[1],
    "class D extends C {\n  constructor(n, v) {\n    super(n, v);\n  }\n}",
    ...(/make\(/.test(birth[1]) ? ["const make = (n, v) => new C(n, v);"] : []),
    "const P = C.prototype;\nconst A = Object.getPrototypeOf(P);",
  ].join("\n");
  const body = within(within(moment[1], "TURN", turn), "CHANGE", change[1]);
  const isInside = form[0] === "class-inside";
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    "const out = [];",
    "const one = value => (Object.is(value, -0) ? '-0' : typeof value === 'function' ? 'f' : typeof value === 'object' && value ? 'o' : String(value).slice(0, 9));",
    "const show = a => {\n  let text = '';\n  for (let i = 0; i < 6; i++) text += (Object.hasOwn(a, i) ? '' : '!') + one(a[i]) + ',';\n  return text + one(a.held) + one(a.rows) + one(a.length) + Reflect.ownKeys(a).filter(key => key !== 'stack' && key !== 'line' && key !== 'column' && key !== 'sourceURL').map(String).join('/') + (a instanceof Array ? 'L' : '');\n};",
    ...(/accessor\(/.test(change[1])
      ? [
          "const accessor = name => ({ get() { return name; }, set(value) { out.push(name + one(value)); }, configurable: true });",
        ]
      : []),
    ...(/put\(/.test(fill[1])
      ? ["function put(a, v) {\n  'use strict';\n  for (let i = 0; i < 4; i++) a[i] = v;\n}"]
      : []),
    ...(isInside ? [] : [declared]),
    within(form[1], "BODY", isInside ? declared + "\n" + body : body),
    `for (const n of [4, 7]) {`,
    "  try {",
    `    run(n, ${value[1]});`,
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 1800));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${kind[0]}--${change[0]}--${moment[0]}--${birth[0]}--${fill[0]}--${value[0]}--${form[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
