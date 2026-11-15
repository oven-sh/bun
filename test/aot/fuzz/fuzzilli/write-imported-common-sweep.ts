// CommonJS modules that modules import: how the module gives its exports, times how another stands between, times how they are imported, times what is done with them, times what changes them, times the flag of compiled modules, times where it is used.
//
//   bun write-imported-common-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<gives>--<between>--<import>--<used>--<changed>--<flag>--<place>.mjs or .ts
//   bun write-imported-common-sweep.ts count
//
// A program is several files: the first file's text, and behind each line `// @filename: ./<path>` the text of another.
import { mkdirSync, writeFileSync } from "node:fs";

// one.cjs gives value, add and Kind.
const gives: [name: string, text: string][] = [
  [
    "fields",
    "exports.value = 3;\nexports.add = (a, b) => a + b;\nexports.Kind = class Kind {\n  go() {\n    return 'k';\n  }\n};",
  ],
  [
    "replaced",
    "module.exports = { value: 3, add: (a, b) => a + b, Kind: class Kind {\n  go() {\n    return 'k';\n  }\n} };",
  ],
  [
    "own-getters",
    "const add = (a, b) => a + b;\nconst value = 3;\nclass Kind {\n  go() {\n    return 'k';\n  }\n}\nObject.defineProperty(exports, 'add', { enumerable: true, get: () => add });\nObject.defineProperty(exports, 'value', { enumerable: true, get() {\n  return value;\n} });\nObject.defineProperty(exports, 'Kind', { enumerable: true, get: function () {\n  return Kind;\n} });",
  ],
  [
    "literal-getters",
    "const add = (a, b) => a + b;\nclass Kind {\n  go() {\n    return 'k';\n  }\n}\nmodule.exports = {\n  get add() {\n    return add;\n  },\n  get value() {\n    return 3;\n  },\n  get Kind() {\n    return Kind;\n  },\n};",
  ],
  [
    "export-helper",
    "var __defProp = Object.defineProperty;\nvar __export = (target, all) => {\n  for (var name in all) __defProp(target, name, { get: all[name], enumerable: true });\n};\nvar source = {};\n__export(source, { add: () => add, value: () => value, Kind: () => Kind });\nmodule.exports = ((mod, copy = __defProp({}, '__esModule', { value: true })) => {\n  for (let key of Object.getOwnPropertyNames(mod)) __defProp(copy, key, { get: () => mod[key], enumerable: true });\n  return copy;\n})(source);\nconst add = (a, b) => a + b;\nvar value = 3;\nclass Kind {\n  go() {\n    return 'k';\n  }\n}",
  ],
  [
    "functions",
    "exports.value = 3;\nexports.add = add;\nexports.Kind = Kind;\nfunction add(a, b) {\n  return a + b;\n}\nfunction Kind() {}\nKind.prototype.go = function () {\n  return 'k';\n};",
  ],
  [
    "void-first",
    "exports.Kind = exports.add = exports.value = void 0;\nconst value = (exports.value = 3);\nconst add = (a, b) => a + b;\nexports.add = add;\nclass Kind {\n  go() {\n    return 'k' + (value - 3 || '');\n  }\n}\nexports.Kind = Kind;",
  ],
  [
    "function-with-fields",
    "module.exports = function add(a, b) {\n  return a + b;\n};\nmodule.exports.add = module.exports;\nmodule.exports.value = 3;\nmodule.exports.Kind = class {\n  go() {\n    return 'k';\n  }\n};",
  ],
  [
    "swc",
    "function _export(target, all) {\n  for (var name in all) Object.defineProperty(target, name, { enumerable: true, get: all[name] });\n}\n_export(exports, {\n  value: function () {\n    return value;\n  },\n  add: function () {\n    return add;\n  },\n  Kind: function () {\n    return Kind;\n  },\n});\nconst value = 3;\nconst add = (a, b) => a + b;\nclass Kind {\n  go() {\n    return 'k';\n  }\n}",
  ],
  [
    "defined-first",
    "Object.defineProperty(exports, 'add', { enumerable: true, get: function () {\n  return add;\n} });\nObject.defineProperty(exports, 'value', { enumerable: true, get: () => value });\nObject.defineProperty(exports, 'Kind', { enumerable: true, get: () => Kind });\nconst value = 3;\nconst add = function (a, b) {\n  return a + b;\n};\nclass Kind {\n  go() {\n    return 'k';\n  }\n}",
  ],
  ["this", "this.value = 3;\nthis.add = (a, b) => a + b;\nthis.Kind = class {\n  go() {\n    return 'k';\n  }\n};"],
  [
    "assigned",
    "Object.assign(exports, { value: 3, add: (a, b) => a + b });\nexports.Kind = class {\n  go() {\n    return 'k';\n  }\n};",
  ],
  [
    "late",
    "exports.add = (a, b) => a + b;\nexports.set = value => {\n  exports.value = value;\n};\nexports.set(3);\nexports.Kind = class {\n  go() {\n    return 'k';\n  }\n};",
  ],
  [
    "loop",
    "for (const [name, what] of Object.entries({ value: 3, add: (a, b) => a + b, Kind: class {\n  go() {\n    return 'k';\n  }\n} })) exports[name] = what;",
  ],
  [
    "in-place",
    "(function (root, factory) {\n  if (typeof module === 'object' && module.exports) factory(module.exports);\n  else factory((root.One = {}));\n})(this, function (exports) {\n  exports.value = 3;\n  exports.add = (a, b) => a + b;\n  exports.Kind = class {\n    go() {\n      return 'k';\n    }\n  };\n});",
  ],
  [
    "instance",
    "class Api {\n  constructor() {\n    this.value = 3;\n    this.add = (a, b) => a + b;\n    this.Kind = class {\n      go() {\n        return 'k';\n      }\n    };\n  }\n  other() {\n    return 1;\n  }\n}\nmodule.exports = new Api();",
  ],
  [
    "alias",
    "const api = (module.exports = {});\napi.value = 3;\napi.add = (a, b) => a + b;\napi.Kind = class {\n  go() {\n    return 'k';\n  }\n};",
  ],
  [
    "counts",
    "let count = 0;\nexports.add = (a, b) => a + b + count++;\nObject.defineProperty(exports, 'value', { enumerable: true, get: () => 3 + count });\nexports.Kind = class {\n  go() {\n    return 'k' + count;\n  }\n};",
  ],
];
// What index.cjs does with it; the main file imports index.cjs.
const between: [name: string, text: string | null][] = [
  ["none", null],
  ["passed-on", "module.exports = require('./one.cjs');"],
  ["spread", "module.exports = { ...require('./one.cjs'), extra: 1 };"],
  [
    "star",
    "for (const p in require('./one.cjs')) if (p !== 'default' && !Object.prototype.hasOwnProperty.call(exports, p)) exports[p] = require('./one.cjs')[p];",
  ],
  [
    "bindings",
    "var __createBinding = (o, m, k) => Object.defineProperty(o, k, { enumerable: true, get: function () {\n  return m[k];\n} });\nconst m = require('./one.cjs');\nfor (var p in m) if (p !== 'default') __createBinding(exports, m, p);",
  ],
  ["by-name", "const { add, value, Kind } = require('./one.cjs');\nmodule.exports = { add, value, Kind };"],
  [
    "getter",
    "Object.defineProperty(exports, 'add', { enumerable: true, get: function () {\n  return require('./one.cjs').add;\n} });\nexports.value = require('./one.cjs').value;\nexports.Kind = require('./one.cjs').Kind;",
  ],
  [
    "heir",
    "const one = require('./one.cjs');\nexports.add = one.add;\nexports.value = one.value;\nexports.Kind = class extends one.Kind {\n  go() {\n    return super.go() + '!';\n  }\n};",
  ],
];
// FROM is the path; afterwards `one` has value, add and Kind.
const imports: [name: string, text: string][] = [
  ["namespace", "import * as one from 'FROM';"],
  ["default", "import api from 'FROM';\nconst one = api;"],
  ["named", "import { add, value, Kind } from 'FROM';\nconst one = { add, value, Kind };"],
  [
    "renamed",
    "import { add as sum, value as amount, Kind as Type } from 'FROM';\nconst one = { add: sum, value: amount, Kind: Type };",
  ],
  ["created", "import { createRequire } from 'node:module';\nconst one = createRequire(import.meta.url)('FROM');"],
  ["awaited", "const one = await import('FROM');"],
  ["awaited-default", "const { default: one } = await import('FROM');"],
  ["both", "import api, * as all from 'FROM';\nconst one = all.add ? all : api;"],
  ["through", "import { one } from './through.mjs';"],
];
const used: [name: string, text: string][] = [
  ["once", "out.push(show(one.add(1, one.value)));"],
  ["looped", "for (let i = 0; i < 4; i++) out.push(show(one.add(i, one.value)));"],
  ["made", "out.push(show(new one.Kind().go()), show(one.value));"],
  ["callback", "out.push([1, 2, 3].map(n => show(one.add(n, 1))).join());"],
  ["destructured", "const { add: plus, value: amount } = one;\nout.push(show(plus(amount, 2)));"],
  ["keys", "out.push(Object.keys(one).filter(key => key !== 'default' && key !== 'module.exports').sort().join('/'));"],
  ["type", "out.push(typeof one, typeof one.add, typeof one.Kind);"],
  [
    "heir",
    "class Own extends one.Kind {\n  go() {\n    return super.go() + 'o';\n  }\n}\nout.push(show(new Own().go()));",
  ],
  ["default", "out.push(typeof one.default, show(one.default?.value));"],
  ["asked", "out.push('add' in one, show(one.missing), show(one.value ?? 'none'));"],
  ["instance", "out.push(new one.Kind() instanceof one.Kind, one.Kind.name.length > -1);"],
];
const changed: [name: string, text: string][] = [["nothing", ""], ["by-itself", "one.set?.(9);"], ["stored", "try {\n  store(one);\n} catch (error) {\n  out.push(error.name);\n}"], ["required", "{\n  const { createRequire: make } = await import('node:module');\n  const again = make(import.meta.url)('FROM');\n  out.push(show(again.value), again.add === one.add);\n}"]]; // prettier-ignore
const flags: [name: string, text: string][] = [["none", ""], ["defined", "Object.defineProperty(exports, '__esModule', { value: true });"], ["strict", "'use strict';"], ["stored-with-default", "exports.__esModule = true;\nexports.default = { value: 4, add: (a, b) => a - b, Kind: class {} };"]]; // prettier-ignore
const places: [name: string, text: string][] = [["top", "WORK"], ["function", "function run() {\n  WORK\n}\nrun();"], ["twice", "for (let round = 0; round < 2; round++) {\n  WORK\n}"]]; // prettier-ignore
const total = gives.length * between.length * imports.length * used.length * changed.length * flags.length * places.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const give = pick(gives);
  const load = pick(imports);
  const use = pick(used);
  const pass = pick(between);
  const flag = pick(flags);
  const change = pick(changed);
  const place = pick(places);
  const isTyped = cell % 4 === 1;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const from = pass[1] === null ? "./one.cjs" : "./index.cjs";
  const work = `try {\n${indent(use[1], "  ")}\n} catch (error) {\n  out.push(error.name);\n}`;
  const through = load[0] === "through";
  const main = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    load[1].replaceAll("FROM", from),
    'const show = value => (Object.is(value, -0) ? "-0" : typeof value === "function" ? "f" : String(value).slice(0, 30));',
    "const out = [];",
    ...(/store\(/.test(change[1]) ? ["const store = o => {\n  o.value = 10;\n};"] : []),
    within(place[1], "WORK", work),
    ...(change[1] ? [change[1].replaceAll("FROM", from), place[0] === "function" ? "run();" : work] : []),
    'console.log(out.join(" ").slice(0, 900));',
    ...(isTyped ? ["export {};"] : []),
  ].join("\n");
  const files: [string, string][] = [
    ["one.cjs", [flag[1], give[1]].filter(Boolean).join("\n")],
    ...(pass[1] === null ? [] : ([["index.cjs", pass[1]]] as [string, string][])),
    ...(through ? ([["through.mjs", `import * as one from '${from}';\nexport { one };`]] as [string, string][]) : []),
  ];
  return {
    name: `${give[0]}--${pass[0]}--${load[0]}--${use[0]}--${change[0]}--${flag[0]}--${place[0]}.${isTyped ? "ts" : "mjs"}`,
    text: main + "\n" + files.map(([path, held]) => `// @filename: ./${path}\n${held}\n`).join(""),
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
