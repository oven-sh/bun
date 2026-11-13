// Programs as bundlers write them, a table of functions and a function that requires them: the table, times the function that requires, times how a module gives what it exports, times how another takes it, times how it is required, times the helpers, times what is odd, times the entry.
//
//   bun write-bundled-module-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<table>--<require>--<gives>--<takes>--<required>--<helper>--<odd>--<entry>.mjs, .cjs or .ts
//   bun write-bundled-module-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// M1, M2 and M3 are the bodies of three modules, with module, exports and require; ID(1) is a name of one.
const tables: [name: string, text: string, id: (n: number) => string][] = [
  [
    "numbers",
    "var modules = {\n  1: (module, exports, require) => {\nM1\n  },\n  2: (module, exports, require) => {\nM2\n  },\n  3: function (module, exports, require) {\nM3\n  },\n};",
    n => `${n}`,
  ],
  [
    "list",
    "var modules = [\n  ,\n  function (module, exports, require) {\nM1\n  },\n  function (module, exports, require) {\nM2\n  },\n  function (module, exports, require) {\nM3\n  },\n];",
    n => `${n}`,
  ],
  [
    "paths",
    "var modules = {\n  './src/m1.js': (module, exports, require) => {\nM1\n  },\n  './src/m2.js': (module, exports, require) => {\nM2\n  },\n  './src/m3.js': (module, exports, require) => {\nM3\n  },\n};",
    n => `'./src/m${n}.js'`,
  ],
  [
    "methods",
    "var modules = {\n  m1(module, exports, require) {\nM1\n  },\n  m2(module, exports, require) {\nM2\n  },\n  m3(module, exports, require) {\nM3\n  },\n};",
    n => `'m${n}'`,
  ],
  [
    "pairs",
    "var modules = {\n  1: [function (require, module, exports) {\nM1\n  }, {}],\n  2: [function (require, module, exports) {\nM2\n  }, { './a': 1 }],\n  3: [function (require, module, exports) {\nM3\n  }, {}],\n};",
    n => `${n}`,
  ],
  [
    "assigned",
    "var modules = {};\nmodules[1] = (module, exports, require) => {\nM1\n};\nmodules[2] = (module, exports, require) => {\nM2\n};\nmodules[3] = (module, exports, require) => {\nM3\n};",
    n => `${n}`,
  ],
  [
    "hashes",
    "var modules = {\n  a1f: (module, exports, require) => {\nM1\n  },\n  '2b': (module, exports, require) => {\nM2\n  },\n  c: (module, exports, require) => {\nM3\n  },\n};",
    n => ["", "'a1f'", "'2b'", "'c'"][n],
  ],
];
// CALL calls the function of the table.
const requires: [name: string, text: string][] = [
  [
    "cached",
    "var cache = {};\nfunction load(id) {\n  var cached = cache[id];\n  if (cached !== undefined) return cached.exports;\n  var module = (cache[id] = { exports: {} });\n  CALL\n  return module.exports;\n}",
  ],
  [
    "full",
    "var cache = {};\nfunction load(id) {\n  if (cache[id]) return cache[id].exports;\n  var module = (cache[id] = { i: id, l: false, exports: {} });\n  CALL\n  module.l = true;\n  return module.exports;\n}",
  ],
  [
    "arrow",
    "const cache = new Map();\nconst load = id => {\n  if (cache.has(id)) return cache.get(id).exports;\n  const module = { exports: {} };\n  cache.set(id, module);\n  CALL\n  return module.exports;\n};",
  ],
  [
    "uncached",
    "function load(id) {\n  const module = { exports: {} };\n  if (depth++ > 20) throw new RangeError('deep');\n  CALL\n  return module.exports;\n}",
  ],
  [
    "fails-kept",
    "var cache = {};\nfunction load(id) {\n  var cached = cache[id];\n  if (cached !== undefined) {\n    if (cached.error !== undefined) throw cached.error;\n    return cached.exports;\n  }\n  var module = (cache[id] = { id, exports: {} });\n  try {\n    CALL\n  } catch (error) {\n    module.error = error;\n    throw error;\n  }\n  return module.exports;\n}",
  ],
  [
    "checked",
    "var cache = {};\nfunction load(id) {\n  if (!Object.prototype.hasOwnProperty.call(cache, id)) {\n    if (!modules[id]) throw new Error('Cannot find ' + id);\n    var module = (cache[id] = { exports: {} });\n    CALL\n  }\n  return cache[id].exports;\n}",
  ],
];
// What module 1 exports: value, add(a, b) and a class or not.
const gives: [name: string, text: string][] = [
  ["fields", "exports.value = 3;\nexports.add = (a, b) => a + b;"],
  ["replaced", "module.exports = { value: 3, add: (a, b) => a + b };"],
  [
    "function",
    "module.exports = function (a, b) {\n  return a + b;\n};\nmodule.exports.value = 3;\nmodule.exports.add = module.exports;",
  ],
  [
    "getters",
    "load.d(exports, { value: () => value, add: () => add });\nlet value = 3;\nfunction add(a, b) {\n  return a + b;\n}",
  ],
  [
    "getters-first",
    "load.r(exports);\nload.d(exports, { add: () => add, value: () => value, default: () => add });\nvar value = 3;\nconst add = (a, b) => a + b;",
  ],
  [
    "es-flag",
    "Object.defineProperty(exports, '__esModule', { value: true });\nexports.default = exports.add = void 0;\nconst add = (a, b) => a + b;\nexports.add = add;\nexports.value = 3;\nexports.default = add;",
  ],
  [
    "class",
    "class Holder {\n  static value = 3;\n  static add(a, b) {\n    return a + b;\n  }\n}\nmodule.exports = Holder;",
  ],
  ["assigned", "Object.assign(exports, { value: 3 }, { add: (a, b) => a + b });"],
  ["late", "exports.add = (a, b) => a + b;\nexports.set = value => {\n  exports.value = value;\n};\nexports.set(3);"],
  [
    "counts",
    "let count = 0;\nexports.add = (a, b) => a + b + count++;\nObject.defineProperty(exports, 'value', { get: () => 3 + count, enumerable: true });",
  ],
  ["cycle", "exports.value = 3;\nconst other = require(ID2);\nexports.add = (a, b) => a + b + (other.late ? 0 : 1);"],
  ["throws", "exports.value = 3;\nif (tries++ < 1) throw new TypeError('first');\nexports.add = (a, b) => a + b;"],
];
// How module 2 takes module 1.
const takes: [name: string, text: string][] = [
  ["kept", "const one = require(ID1);\nexports.run = n => one.add(n, one.value);"],
  ["destructured", "const { add, value } = require(ID1);\nexports.run = n => add(n, value);"],
  ["in-call", "exports.run = n => require(ID1).add(n, require(ID1).value);"],
  ["indirect", "var one = require(ID1);\nexports.run = n => (0, one.add)(n, one.value);"],
  [
    "default",
    "var one = load.n(require(ID1));\nexports.run = n => (typeof one() === 'function' ? one()(n, 3) : one.a.add ? one.a.add(n, 3) : 'none');",
  ],
  ["namespace", "var one = load.t(require(ID1));\nexports.run = n => one.add(n, one.value);"],
  [
    "passed-on",
    "const one = require(ID1);\nfor (const key of Object.keys(one)) exports[key] = one[key];\nexports.run = n => exports.add(n, exports.value);",
  ],
  ["whole", "module.exports = require(ID1);\nmodule.exports.run = n => module.exports.add(n, module.exports.value);"],
  ["bound", "const get = require.bind(null, ID1);\nexports.run = n => get().add(n, get().value);"],
  [
    "bound-to-itself",
    "const get = require.bind(require, ID1);\nexports.run = n => {\n  const { add } = get();\n  return add(n, get().value);\n};",
  ],
  ["later", "let one;\nexports.run = n => {\n  one ??= require(ID1);\n  return one.add(n, one.value);\n};"],
  [
    "maybe",
    "let one = null;\ntry {\n  one = require(ID1);\n} catch (error) {\n  out.push(error.name);\n}\nexports.run = n => (one && one.add ? one.add(n, one.value) : 'no');",
  ],
  ["late", "const one = require(ID1);\nexports.late = true;\nexports.run = n => one.add(n, one.value);"],
];
// What module 3 does with module 2.
const required: [name: string, text: string][] = [
  ["once", "const two = require(ID2);\nout.push(show(two.run(1)));"],
  ["looped", "const two = require(ID2);\nfor (let i = 0; i < 4; i++) out.push(show(two.run(i)));"],
  ["in-loop", "for (let i = 0; i < 3; i++) out.push(show(require(ID2).run(i)));"],
  [
    "both",
    "const one = require(ID1);\nconst two = require(ID2);\nout.push(show(two.run(one.value)), show(one.add(1, 2)));",
  ],
  ["keys", "const two = require(ID2);\nout.push(Object.keys(two).join('/'), show(two.run(5)));"],
  ["callback", "const { run } = require(ID2);\nout.push([1, 2, 3].map(n => show(run(n))).join());"],
  [
    "then",
    "Promise.resolve().then(require.bind(require, ID2)).then(two => console.log('then', show(two.run(2)))).catch(error => console.log('caught', error.name));",
  ],
  [
    "changed",
    "const one = require(ID1);\ntry {\n  one.value = 10;\n} catch (error) {\n  out.push(error.name);\n}\nout.push(show(require(ID2).run(1)));",
  ],
  ["same", "out.push(require(ID2) === require(ID2), require(ID1) === require(ID1), show(require(ID2).run(2)));"],
];
const helpers: [name: string, text: string][] = [
  [
    "written",
    "load.d = (exports, definition) => {\n  for (var key in definition) {\n    if (load.o(definition, key) && !load.o(exports, key)) Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });\n  }\n};\nload.o = (object, name) => Object.prototype.hasOwnProperty.call(object, name);\nload.r = exports => {\n  if (typeof Symbol !== 'undefined' && Symbol.toStringTag) Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });\n  Object.defineProperty(exports, '__esModule', { value: true });\n};\nload.n = module => {\n  var getter = module && module.__esModule ? () => module['default'] : () => module;\n  load.d(getter, { a: getter });\n  return getter;\n};\nload.t = value => {\n  if (value && value.__esModule) return value;\n  var space = Object.create(null);\n  load.r(space);\n  for (const key of Object.getOwnPropertyNames(value ?? {})) load.d(space, { [key]: () => value[key] });\n  return space;\n};",
  ],
  [
    "short",
    "load.o = (object, name) => ({}).hasOwnProperty.call(object, name);\nload.d = (exports, all) => Object.keys(all).forEach(name => Object.defineProperty(exports, name, { enumerable: true, get: all[name], configurable: true }));\nload.r = exports => Object.defineProperty(exports, '__esModule', { value: true });\nload.n = module => Object.assign(() => (module.__esModule ? module.default : module), { a: module });\nload.t = value => value;",
  ],
  [
    "in-loop",
    "for (const [name, helper] of Object.entries({\n  o: (object, name) => name in object,\n  d: (exports, all) => {\n    for (const name in all) Object.defineProperty(exports, name, { enumerable: true, get: all[name] });\n  },\n  r: exports => (exports.__esModule = true),\n  n: module => Object.assign(() => module.default ?? module, { a: module }),\n  t: value => ({ ...value }),\n})) load[name] = helper;",
  ],
];
const odd: [name: string, text: string][] = [
  ["nothing", ""],
  ["tables-in-load", "load.m = modules;\nload.c = typeof cache === 'undefined' ? null : cache;"],
  [
    "replaced-module",
    "const own = modules[ID1];\nmodules[ID1] = Array.isArray(own) ? own : function (...given) {\n  out.push('seen');\n  return own.apply(this, given);\n};",
  ],
  ["removed-from-cache", "load.forget = id => (cache instanceof Map ? cache.delete(id) : delete cache[id]);"],
  ["global", "globalThis.seen = (globalThis.seen ?? 0) + 1;"],
];
const entries: [name: string, text: string][] = [
  ["plain", "load(ID3);"],
  ["caught", "try {\n  load(ID3);\n} catch (error) {\n  out.push(error.name);\n}"],
  [
    "twice",
    "for (let round = 0; round < 2; round++) {\n  try {\n    load(ID3);\n  } catch (error) {\n    out.push(error.name);\n  }\n}",
  ],
  [
    "called-in-place",
    "(() => {\n  try {\n    load(load.s = ID3);\n  } catch (error) {\n    out.push(error.name);\n  }\n})();",
  ],
];
const total = tables.length * requires.length * gives.length * takes.length * required.length * helpers.length * odd.length * entries.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const take = pick(takes);
  const give = pick(gives);
  const table = pick(tables);
  const load = pick(requires);
  const last = pick(required);
  const entry = pick(entries);
  const helper = pick(helpers);
  const strange = pick(odd);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const call =
    table[0] === "pairs"
      ? "modules[id][0].call(module.exports, load, module, module.exports);"
      : "modules[id].call(module.exports, module, module.exports, load);";
  const body = [
    table[1]
      .replace("M1", () => indent(give[1], "    "))
      .replace("M2", () => indent(take[1], "    "))
      .replace("M3", () => indent(last[1], "    ")),
    load[1].replace(/^( *)CALL$/m, (_, by) => by + call),
    helper[1],
    ...(strange[1] ? [strange[1]] : []),
    entry[0] === "plain"
      ? "try {\n  load(ID3);\n} catch (error) {\n  out.push(error.message.slice(0, 20));\n}"
      : entry[1],
  ]
    .join("\n")
    .replaceAll(/\bID([123])\b/g, (_, n) => table[2](Number(n)));
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    'const show = value => (Object.is(value, -0) ? "-0" : typeof value === "function" ? "f" : String(value).slice(0, 30));',
    "const out = [];",
    "let depth = 0;",
    "let tries = 0;",
    ...(cell % 2 ? [`(() => {\n${indent(body, "  ")}\n})();`] : [body]),
    'console.log(out.join(" ").slice(0, 1200));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${table[0]}--${load[0]}--${give[0]}--${take[0]}--${last[0]}--${helper[0]}--${strange[0]}--${entry[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
