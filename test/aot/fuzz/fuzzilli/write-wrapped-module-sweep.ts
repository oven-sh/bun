// Modules as bundlers wrap them in one file: the wrapper, times the helpers, times what a module gives, times how another takes it, times what is called, times what is odd, times the entry, times where all of it stands.
//
//   bun write-wrapped-module-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<wrapper>--<helpers>--<gives>--<takes>--<called>--<odd>--<entry>--<place>.mjs, .cjs or .ts
//   bun write-wrapped-module-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// ONE and TWO are the bodies of two modules; GET1 and GET2 in them are what requires them.
const wrappers: [name: string, text: string, get: (n: number) => string][] = [
  [
    "common",
    "var require_one = __commonJS({\n  'one.js'(exports, module) {\nONE\n  },\n});\nvar require_two = __commonJS({\n  'two.js'(exports, module) {\nTWO\n  },\n});",
    n => `require_${["", "one", "two"][n]}()`,
  ],
  [
    "common-arrow",
    "var require_one = __commonJS((exports, module) => {\nONE\n});\nvar require_two = __commonJS((exports, module) => {\nTWO\n});",
    n => `require_${["", "one", "two"][n]}()`,
  ],
  [
    "common-strict",
    "var require_one = __commonJS({\n  'one.js': function (exports, module) {\n    'use strict';\nONE\n  },\n});\nvar require_two = __commonJS({\n  'two.js': function (exports, module) {\n    'use strict';\nTWO\n  },\n});",
    n => `require_${["", "one", "two"][n]}()`,
  ],
  [
    "called-in-place",
    "var one_exports = (function (module, exports) {\nONE\n  return module.exports;\n})({ exports: {} }, {});\nvar two_exports = (function () {\n  var module = { exports: {} };\n  var exports = module.exports;\nTWO\n  return module.exports;\n})();",
    n => `${["", "one", "two"][n]}_exports`,
  ],
  [
    "shared-in-place",
    "var one_module = { exports: {} };\n(function (module, exports) {\nONE\n})(one_module, one_module.exports);\nvar two_module = { exports: {} };\n(function (exports, module) {\nTWO\n}).call(two_module.exports, two_module.exports, two_module);",
    n => `${["", "one", "two"][n]}_module.exports`,
  ],
  [
    "lazy",
    "var one_cache;\nfunction get_one() {\n  if (one_cache) return one_cache;\n  var module = { exports: {} };\n  var exports = module.exports;\n  one_cache = exports;\nONE\n  return (one_cache = module.exports);\n}\nvar two_cache;\nfunction get_two() {\n  if (two_cache) return two_cache;\n  var module = { exports: {} };\n  var exports = (two_cache = module.exports);\nTWO\n  return (two_cache = module.exports);\n}",
    n => `get_${["", "one", "two"][n]}()`,
  ],
  [
    "once",
    "var init = {};\nvar run_once = (name, body) => {\n  if (!init[name]) {\n    init[name] = { exports: {} };\n    body(init[name], init[name].exports);\n  }\n  return init[name].exports;\n};\nvar body_one = (module, exports) => {\nONE\n};\nvar body_two = (module, exports) => {\nTWO\n};",
    n => `run_once('${["", "one", "two"][n]}', body_${["", "one", "two"][n]})`,
  ],
  [
    "umd",
    "var one_root = {};\n(function (root, factory) {\n  if (typeof define === 'function' && define.amd) define(['exports'], factory);\n  else factory((root.One = {}), { exports: {} });\n})(one_root, function (exports, module) {\nONE\n  Object.assign(exports, module.exports);\n});\nvar two_root = {};\n(function (root, factory) {\n  root.Two = {};\n  factory(root.Two, { exports: root.Two });\n})(two_root, function (exports, module) {\nTWO\n});",
    n => (n === 1 ? "one_root.One" : "two_root.Two"),
  ],
];
const helpers: [name: string, text: string][] = [
  [
    "as-written-by-one",
    "var __create = Object.create;\nvar __defProp = Object.defineProperty;\nvar __getOwnPropDesc = Object.getOwnPropertyDescriptor;\nvar __getOwnPropNames = Object.getOwnPropertyNames;\nvar __getProtoOf = Object.getPrototypeOf;\nvar __hasOwnProp = Object.prototype.hasOwnProperty;\nvar __commonJS = (cb, mod) => function __require() {\n  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;\n};\nvar __export = (target, all) => {\n  for (var name in all)\n    __defProp(target, name, { get: all[name], enumerable: true });\n};\nvar __copyProps = (to, from, except, desc) => {\n  if (from && typeof from === 'object' || typeof from === 'function') {\n    for (let key of __getOwnPropNames(from))\n      if (!__hasOwnProp.call(to, key) && key !== except)\n        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });\n  }\n  return to;\n};\nvar __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(\n  isNodeMode || !mod || !mod.__esModule ? __defProp(target, 'default', { value: mod, enumerable: true }) : target,\n  mod\n));\nvar __copy = (to, from) => __copyProps(to, from, 'default');",
  ],
  [
    "written",
    "var __commonJS = (cb, mod) => function () {\n  if (mod) return mod.exports;\n  var body = typeof cb === 'function' ? cb : cb[Object.getOwnPropertyNames(cb)[0]];\n  body.call((mod = { exports: {} }).exports, mod.exports, mod);\n  return mod.exports;\n};\nvar __export = (target, all) => {\n  for (var name in all) Object.defineProperty(target, name, { get: all[name], enumerable: true });\n};\nvar __toESM = mod => (mod && mod.__esModule ? mod : Object.assign({ default: mod }, mod));\nvar __copy = (to, from) => {\n  for (let key of Object.getOwnPropertyNames(from)) if (!Object.prototype.hasOwnProperty.call(to, key)) Object.defineProperty(to, key, { get: () => from[key], enumerable: true });\n  return to;\n};",
  ],
  [
    "short",
    "var __commonJS = (f, m) => () => (m || (typeof f === 'function' ? f : Object.values(f)[0])((m = { exports: {} }).exports, m), m.exports);\nvar __export = (t, a) => Object.keys(a).forEach(n => Object.defineProperty(t, n, { get: a[n], enumerable: true, configurable: true }));\nvar __toESM = m => (m.__esModule ? m : { ...m, default: m });\nvar __copy = (to, from) => Object.defineProperties(to, Object.getOwnPropertyDescriptors(from));",
  ],
  [
    "held",
    "var __defProp = Object.defineProperty;\nvar __names = Object.getOwnPropertyNames;\nvar __hasOwn = Object.prototype.hasOwnProperty;\nvar __commonJS = (cb, mod) => () => {\n  if (!mod) (typeof cb === 'function' ? cb : cb[__names(cb)[0]])((mod = { exports: {} }).exports, mod);\n  return mod.exports;\n};\nvar __export = (target, all) => {\n  for (var name of __names(all)) __defProp(target, name, { get: all[name], enumerable: true, configurable: true, set: value => (all[name] = () => value) });\n};\nvar __toESM = (mod, target = {}) => __copy(mod && mod.__esModule ? target : __defProp(target, 'default', { value: mod, enumerable: true }), mod);\nvar __copy = (to, from, except) => {\n  if ((from && typeof from === 'object') || typeof from === 'function') {\n    for (let key of __names(from)) if (!__hasOwn.call(to, key) && key !== except) __defProp(to, key, { get: () => from[key], enumerable: true });\n  }\n  return to;\n};",
  ],
];
// Module one gives value and add.
const gives: [name: string, text: string][] = [
  ["fields", "exports.value = 3;\nexports.add = (a, b) => a + b;"],
  ["replaced", "module.exports = { value: 3, add(a, b) {\n  return a + b;\n} };"],
  [
    "getters",
    "__export(exports, { value: () => value, add: () => add });\nvar value = 3;\nconst add = (a, b) => a + b;",
  ],
  [
    "own-getter",
    "const value = 3;\nconst add = (a, b) => a + b;\nObject.defineProperty(exports, 'value', { enumerable: true, get: () => value });\nObject.defineProperty(exports, 'add', { enumerable: true, get: function () {\n  return add;\n} });",
  ],
  [
    "literal-getter",
    "const add = (a, b) => a + b;\nconst value = 3;\nmodule.exports = {\n  get value() {\n    return value;\n  },\n  get add() {\n    return add;\n  },\n};",
  ],
  [
    "es-flag",
    "Object.defineProperty(exports, '__esModule', { value: true });\nexports.add = exports.value = exports.default = void 0;\nvar _default = (exports.default = 3);\nexports.value = _default;\nfunction add(a, b) {\n  return a + b;\n}\nexports.add = add;",
  ],
  [
    "class",
    "class Holder {\n  static value = 3;\n  static add(a, b) {\n    return a + b;\n  }\n}\nexports.Holder = Holder;\nexports.value = Holder.value;\nexports.add = Holder.add;",
  ],
  [
    "enum-like",
    "var Kind;\n(function (Kind) {\n  Kind[(Kind['A'] = 3)] = 'A';\n})(Kind || (exports.Kind = Kind = {}));\nexports.value = Kind.A;\nexports.add = (a, b) => a + b;",
  ],
  ["late", "exports.add = (a, b) => a + b;\nexports.set = value => {\n  exports.value = value;\n};\nexports.set(3);"],
  [
    "swc",
    "function _export(target, all) {\n  for (var name in all) Object.defineProperty(target, name, { enumerable: true, get: all[name] });\n}\n_export(exports, {\n  value: function () {\n    return value;\n  },\n  add: function () {\n    return add;\n  },\n});\nconst value = 3;\nconst add = (a, b) => a + b;",
  ],
  [
    "defined-first",
    "Object.defineProperty(exports, 'add', { enumerable: true, get: function () {\n  return add;\n} });\nObject.defineProperty(exports, 'value', { enumerable: true, get: () => value });\nconst value = 3;\nconst add = function (a, b) {\n  return a + b;\n};",
  ],
  ["counts", "let count = 0;\nexports.add = (a, b) => a + b + count++;\nexports.value = 3;"],
  ["throws", "exports.value = 3;\nif (tries++ < 1) throw new TypeError('first');\nexports.add = (a, b) => a + b;"],
];
const takes: [name: string, text: string][] = [
  ["kept", "const one = GET1;\nexports.run = n => one.add(n, one.value);"],
  ["destructured", "const { add, value } = GET1;\nexports.run = n => add(n, value);"],
  ["in-call", "exports.run = n => GET1.add(n, GET1.value);"],
  ["interop", "var one = __toESM(GET1);\nexports.run = n => (0, one.add)(n, one.value);"],
  ["default", "var one = __toESM(GET1);\nexports.run = n => (one.default.add ?? one.add)(n, one.value);"],
  ["passed-on", "__copy(exports, GET1);\nexports.run = n => exports.add(n, exports.value);"],
  [
    "whole",
    "module.exports = Object.assign({}, GET1);\nmodule.exports.run = n => module.exports.add(n, module.exports.value);",
  ],
  [
    "default-helper",
    "var __importDefault = mod => (mod && mod.__esModule ? mod : { default: mod });\nconst one_1 = __importDefault(GET1);\nexports.run = n => (one_1.default.add ?? GET1.add)(n, GET1.value);",
  ],
  [
    "star-helper",
    "var __exportStar = (m, target) => {\n  for (var p in m) if (p !== 'default' && !Object.prototype.hasOwnProperty.call(target, p)) target[p] = m[p];\n};\n__exportStar(GET1, exports);\nexports.run = n => exports.add(n, exports.value);",
  ],
  [
    "heir",
    "const one = GET1;\nclass Own extends (one.Holder ?? Object) {\n  run(n) {\n    return one.add(n, one.value);\n  }\n}\nexports.run = n => new Own().run(n);",
  ],
];
const called: [name: string, text: string][] = [
  ["once", "out.push(show(GET2.run(1)));"],
  ["looped", "for (let i = 0; i < 4; i++) out.push(show(GET2.run(i)));"],
  ["kept", "const two = GET2;\nout.push(show(two.run(1)), show(two.run(2)));"],
  ["keys", "out.push(Object.keys(GET1).join('/'), Object.keys(GET2).join('/'), show(GET2.run(5)));"],
  ["callback", "const { run } = GET2;\nout.push([1, 2, 3].map(n => show(run(n))).join());"],
  [
    "changed",
    "try {\n  GET1.value = 10;\n} catch (error) {\n  out.push(error.name);\n}\nout.push(show(GET2.run(1)), show(GET1.value));",
  ],
  ["same", "out.push(GET1 === GET1, show(GET2.run(2)));"],
  ["spread", "const all = { ...GET1, ...GET2 };\nout.push(show(all.run(3)), show(all.value));"],
  ["json", "out.push(JSON.stringify(GET1), show(GET2.run(0)));"],
  [
    "descriptor",
    "const d = Object.getOwnPropertyDescriptor(GET1, 'value');\nout.push(d ? ['get' in d && typeof d.get, d.writable, d.enumerable].join() : 'none', show(GET2.run(4)));",
  ],
];
const odd: [name: string, text: string][] = [["nothing", ""], ["replaced-later", "GET1.add = (a, b) => a * b;"], ["frozen", "Object.freeze(GET1);"], ["global", "globalThis.seen = (globalThis.seen ?? 0) + 1;"]]; // prettier-ignore
// WORK is the calls.
const entries: [name: string, text: string][] = [["plain", "WORK"], ["caught", "try {\n  WORK\n} catch (error) {\n  out.push(error.name);\n}"], ["twice", "for (let round = 0; round < 2; round++) {\n  try {\n    WORK\n  } catch (error) {\n    out.push(error.name);\n  }\n}"], ["function", "function main() {\n  WORK\n}\nmain();"]]; // prettier-ignore
const placing: [name: string, text: string][] = [["top", "ALL"], ["in-function", "(() => {\n  ALL\n})();"], ["in-strict-function", "(function () {\n  ALL\n}).call(undefined);"]]; // prettier-ignore
const total = wrappers.length * helpers.length * gives.length * takes.length * called.length * odd.length * entries.length * placing.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const give = pick(gives);
  const wrapper = pick(wrappers);
  const take = pick(takes);
  const use = pick(called);
  const help = pick(helpers);
  const entry = pick(entries);
  const strange = pick(odd);
  const where = pick(placing);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0 && wrapper[0] !== "common-strict" && strange[0] !== "frozen";
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const work = `${strange[1] ? `try {\n  ${strange[1]}\n} catch (error) {\n  out.push(error.name);\n}\n` : ""}${use[1]}`;
  const all = [
    help[1],
    wrapper[1].replace("ONE", () => indent(give[1], "    ")).replace("TWO", () => indent(take[1], "    ")),
    within(
      entry[0] === "plain" || entry[0] === "function"
        ? `try {\n${indent(entry[1], "  ")}\n} catch (error) {\n  out.push(error.message.slice(0, 24));\n}`
        : entry[1],
      "WORK",
      work,
    ),
  ]
    .join("\n")
    .replaceAll(/\bGET([12])\b/g, (_, n) => wrapper[2](Number(n)));
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    'const show = value => (Object.is(value, -0) ? "-0" : typeof value === "function" ? "f" : String(value).slice(0, 30));',
    "const out = [];",
    "let tries = 0;",
    "try {",
    indent(within(where[1], "ALL", all), "  "),
    "} catch (error) {",
    "  out.push('outer ' + error.name);",
    "}",
    'console.log(out.join(" ").slice(0, 1200));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${wrapper[0]}--${help[0]}--${give[0]}--${take[0]}--${use[0]}--${strange[0]}--${entry[0]}--${where[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
