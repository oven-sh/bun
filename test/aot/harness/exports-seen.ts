// Every form of export seen through every form of import: the value, a function's name, whether a binding is live, and all that a
// program can ask of a namespace object. A cell is a folder: the module that exports, what it hands on, and the module that looks.
import type { Cell } from "./cells";

type Exporter = {
  file: string;
  text: string;
  names: string[];
  hasDefault?: boolean;
  bumps?: boolean;
  more?: Record<string, string>;
};
const deep = { "deep.mjs": `export const x = tag(1), y = tag(2);\nexport default tag(3);\n` };

const exporters: Record<string, Exporter> = {
  const: { file: "dep.mjs", text: `export const x = tag(1);`, names: ["x"] },
  let: { file: "dep.mjs", text: `export let x = 1;\nexport function bump() { x++; }`, names: ["x"], bumps: true },
  var: { file: "dep.mjs", text: `export function bump() { x += 1; }\nexport var x = 1;`, names: ["x"], bumps: true },
  function: { file: "dep.mjs", text: `export function x() { return 1; }`, names: ["x"] },
  class: { file: "dep.mjs", text: `export class x { static v = 1; }`, names: ["x"] },
  "default value": { file: "dep.mjs", text: `export default tag(1);`, names: [], hasDefault: true },
  "default function": {
    file: "dep.mjs",
    text: `export default function named() { return 1; }`,
    names: [],
    hasDefault: true,
  },
  "default nameless function": {
    file: "dep.mjs",
    text: `export default function () { return 1; }`,
    names: [],
    hasDefault: true,
  },
  "default nameless class": {
    file: "dep.mjs",
    text: `export default class { static v = 1; }`,
    names: [],
    hasDefault: true,
  },
  "default arrow": { file: "dep.mjs", text: `export default () => 1;`, names: [], hasDefault: true },
  renamed: { file: "dep.mjs", text: `const inner = tag(1);\nexport { inner as x };`, names: ["x"] },
  "a variable as default": {
    file: "dep.mjs",
    text: `let inner = 1;\nexport { inner as default };\nexport function bump() { inner++; }`,
    names: [],
    hasDefault: true,
    bumps: true,
  },
  "the value of a variable as default": {
    file: "dep.mjs",
    text: `let inner = 1;\nexport default inner;\nexport function bump() { inner++; }`,
    names: [],
    hasDefault: true,
    bumps: true,
  },
  star: { file: "dep.mjs", text: `export * from "./deep.mjs";`, names: ["x"], more: deep },
  "star as": { file: "dep.mjs", text: `export * as x from "./deep.mjs";`, names: ["x"], more: deep },
  "name from": { file: "dep.mjs", text: `export { x } from "./deep.mjs";`, names: ["x"], more: deep },
  "default from": {
    file: "dep.mjs",
    text: `export { default } from "./deep.mjs";`,
    names: [],
    hasDefault: true,
    more: deep,
  },
  "default as a name from": {
    file: "dep.mjs",
    text: `export { default as x } from "./deep.mjs";`,
    names: ["x"],
    more: deep,
  },
  "a name as default from": {
    file: "dep.mjs",
    text: `export { y as default } from "./deep.mjs";`,
    names: [],
    hasDefault: true,
    more: deep,
  },
  "two stars that collide": {
    file: "dep.mjs",
    text: `export * from "./deep.mjs";\nexport * from "./other.mjs";`,
    names: [],
    more: { ...deep, "other.mjs": `export const x = tag(7), z = tag(8);\n` },
  },
  "a star and its own": {
    file: "dep.mjs",
    text: `export * from "./deep.mjs";\nexport const x = tag(9);`,
    names: ["x"],
    more: deep,
  },
  "many names": {
    file: "dep.mjs",
    text: `export const b = 1, a = 2, C = 3, _ = 4, $ = 5, x = 6;\nexport default 0;`,
    names: ["x"],
    hasDefault: true,
  },
  "exports.x": { file: "dep.cjs", text: `exports.x = tag(1);`, names: ["x"], hasDefault: true },
  "module.exports object": { file: "dep.cjs", text: `module.exports = { x: tag(1) };`, names: ["x"], hasDefault: true },
  "module.exports function": {
    file: "dep.cjs",
    text: `module.exports = function named() { return 1; };\nmodule.exports.x = tag(2);`,
    names: ["x"],
    hasDefault: true,
  },
  __esModule: {
    file: "dep.cjs",
    text: `Object.defineProperty(exports, "__esModule", { value: true });\nexports.default = tag(1);\nexports.x = tag(2);`,
    names: ["x"],
    hasDefault: true,
  },
  "module.exports number": { file: "dep.cjs", text: `module.exports = 5;`, names: [], hasDefault: true },
  "exports that change": {
    file: "dep.cjs",
    text: `exports.x = 1;\nexports.bump = () => { exports.x++; };`,
    names: ["x"],
    hasDefault: true,
    bumps: true,
  },
  "exports with a getter": {
    file: "dep.cjs",
    text: `Object.defineProperty(exports, "x", { enumerable: true, get() { log("got"); return 1; } });`,
    names: ["x"],
    hasDefault: true,
  },
  "module.exports instance": {
    file: "dep.cjs",
    text: `module.exports = new (class Made { x = 1; get y() { return 2; } })();`,
    names: ["x"],
    hasDefault: true,
  },
  json: { file: "dep.json", text: `{ "x": 1, "default": 2, "b": 3, "a": 4 }`, names: ["x"], hasDefault: true },
};

const bump = (from: string, again: string) => `${from}.bump(); ${again}`;
const importers: Record<string, (e: Exporter) => [file: string, text: string] | undefined> = {
  name: e =>
    e.names.includes("x")
      ? [
          "user.mjs",
          `import { x${e.bumps ? ", bump" : ""} } from "./${e.file}";\nlook(x);${e.bumps ? "\nbump(); look(x);" : ""}`,
        ]
      : undefined,
  default: e =>
    e.hasDefault
      ? [
          "user.mjs",
          `import d${e.bumps && e.file.endsWith(".mjs") ? ", { bump }" : ""} from "./${e.file}";\nlook(d);${e.bumps && e.file.endsWith(".mjs") ? "\nbump(); look(d);" : ""}`,
        ]
      : undefined,
  namespace: e => [
    "user.mjs",
    `import * as ns from "./${e.file}";\nlookAtAll(ns);${e.bumps ? "\n" + bump("ns", "lookAtAll(ns);") : ""}`,
  ],
  "default and namespace": e =>
    e.hasDefault
      ? ["user.mjs", `import d, * as ns from "./${e.file}";\nlook(d); lookAtAll(ns); log(d === ns.default);`]
      : undefined,
  call: e => [
    "user.mjs",
    `const ns = await import("./${e.file}");\nlookAtAll(ns);${e.bumps ? "\n" + bump("ns", "lookAtAll(ns);") : ""}`,
  ],
  require: e => [
    "user.cjs",
    `const all = require("./${e.file}");\nlookAtAll(all);${e.bumps ? "\n" + bump("all", "lookAtAll(all);") : ""}`,
  ],
  "through a star": e => ["user.mjs", `import * as ns from "./middle.mjs";\nlookAtAll(ns);`],
  "written to": e => [
    "user.mjs",
    `import * as ns from "./${e.file}";\nconst it = tag(ns);\nfor (const deed of [() => { it.x = 5; }, () => { it.fresh = 5; }, () => delete it.x, () => delete it.fresh, () => Object.defineProperty(it, "x", { value: 5 }), () => Object.setPrototypeOf(it, {}), () => Object.freeze(it), () => Object.preventExtensions(it)]) try { log(String(deed())); } catch (e) { log("!" + e.name); }\nlookAtAll(ns);`,
  ],
};

export const helpers = `globalThis.log = log;
globalThis.tag = v => v;
globalThis.look = v => log(typeof v === "function" ? "function " + v.name + " " + v.length + " " + (/^class/.test(Function.prototype.toString.call(v)) ? "class " + v.v : v()) : typeof v === "object" && v !== null ? Object.prototype.toString.call(v) + Object.keys(v) : typeof v + " " + String(v));
globalThis.lookAtAll = all => {
  if ((typeof all !== "object" && typeof all !== "function") || all === null) return look(all);
  log(Object.prototype.toString.call(all) + " " + Object.isFrozen(all) + Object.isSealed(all) + Object.isExtensible(all));
  for (const key of Reflect.ownKeys(all)) {
    if (key === "module.exports" || key === "__esModule" || key === "prototype" || key === "length" || key === "name") continue;
    const d = Object.getOwnPropertyDescriptor(all, key);
    log(String(key) + (d.get ? "G" : "") + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : ""));
    look(all[key]);
  }
  log("x" in all); log(Object.keys(all).filter(key => key !== "module.exports" && key !== "__esModule").join());
};
`;
export const call = `try { await run(); } catch (e) { log("threw " + e.name); }`;

export function cells(): Cell[] {
  const all: Cell[] = [];
  for (const [exported, exporter] of Object.entries(exporters))
    for (const [imported, importer] of Object.entries(importers)) {
      const user = importer(exporter);
      if (!user) continue;
      const id = "e" + (all.length + 1);
      all.push({
        id,
        what: `${exported} | ${imported}`,
        text: `const ${id} = () => import("./${id}/${user[0]}");`,
        files: {
          [exporter.file]: exporter.text + "\n",
          ...exporter.more,
          [user[0]]: user[1] + "\n",
          ...(imported === "through a star" ? { "middle.mjs": `export * from "./${exporter.file}";\n` } : {}),
        },
      });
    }
  return all;
}
