// Small graphs in which ES modules and CommonJS files need each other, in cycles too. Two to four files by default.
//
//   a file        .mjs, .ts with imports, .cjs, .cts
//   an ES module  takes the default, names, the namespace, both, or nothing; hands on a name, the default, all names (`export * from`) or the namespace (`export * as`);
//                 imports by `import()` behind an await at the top, without an await, or in a function that runs at the end; requires by `createRequire`, `import.meta.require` or `require`
//   a CommonJS    requires at the top, in a try, in a function that runs at the end, through `module.require` or `createRequire`; takes the whole or names out of it; imports by `import()`;
//   file          sets `exports.first`, replaces `module.exports` by an object, a function or a class, defines a getter, or marks itself `__esModule`
//   an edge       goes to any file: on (a tree), back (a cycle), to the file itself, to the entry point. In a CommonJS file it stands in front of the file's own exports, between two of them, or behind them
//   what is read  at once, while the files are still being evaluated: the kind of the value, its keys, a name; and again at the end, when all of them are through
//
// Every file exports `first`, `second` and a default, so no import names what the text of its target lacks. Every read stands in a try, and an error prints its name alone.
// Each line begins with the file that prints it.
function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const below = (n: number) => Math.floor(next() * n);
  return { below, pick: <T>(list: readonly T[]): T => list[below(list.length)], chance: (share: number) => next() < share };
}
type Random = ReturnType<typeof random>;

type Kind = "es" | "commonjs";
/** `atTheTop`: the target is evaluated, if it has not been, before the file that needs it is through. */
type Need = { to: number; way: string; atTheTop: boolean };
type File = { name: string; file: string; kind: Kind; typed: boolean; needs: Need[]; awaits?: boolean };

const waysOfESModules = ["default", "default", "names", "namespace", "both", "bare", "a name handed on", "the default handed on", "all handed on", "all handed on", "the namespace handed on", "awaited", "not awaited", "imported at the end", "createRequire", "import.meta.require", "require"];
const waysOfCommonJS = ["whole", "whole", "whole", "names", "in a try", "bare", "twice", "module.require", "createRequire", "required at the end", "not awaited", "imported at the end"];
const isLate = (way: string) => way.endsWith("at the end") || way === "not awaited";

const tools = (typed: boolean) => {
  const [unknown, text, read, list] = typed ? [": unknown", ": string", ": () => unknown", " as (() => unknown)[]"] : ["", "", "", ""];
  const world = typed ? "(globalThis as any)" : "globalThis";
  return `const show = (value${unknown})${text} =>
  value === null ? "null" : typeof value === "object" || typeof value === "function" ? typeof value + "{" + Reflect.ownKeys(value).filter(key => typeof key === "string" && !["length", "name", "prototype", "arguments", "caller", "__esModule"].includes(key)).join() + "}" : typeof value + ":" + String(value);
const tell = (label${text}, read${read}) => {
  let shown;
  try {
    shown = show(read());
  } catch (error) {
    shown = "throws " + (error${typed ? " as Error" : ""})?.name;
  }
  console.log(label, shown);
};
const atTheEnd = (${world}.atTheEnd ??= [])${list};
`;
};

function esModule(random: Random, own: File, files: File[]): string {
  const { name, typed } = own;
  const any = (what: string) => (typed ? `(${what} as any)` : what);
  const head: string[] = [];
  const body: string[] = [`console.log("${name} begins");`];
  const tail: string[] = [];
  if (own.needs.some(need => need.way === "createRequire")) head.push(`import { createRequire } from "node:module";`);
  own.needs.forEach(({ to, way }, at) => {
    const target = files[to];
    const from = `"./${target.file}"`;
    const local = `${target.name}_${at}`;
    const wanted = random.pick(["first", "second"]);
    // TypeScript does not see what a CommonJS file exports the way the loader does.
    if (typed && target.kind === "commonjs" && !isLate(way) && way !== "awaited") head.push("// @ts-ignore");
    const reads = (what: string, label: string) => {
      body.push(`tell("${name} early ${label}", () => ${what});`);
      tail.push(`atTheEnd.push(() => tell("${name} late ${label}", () => ${what}));`);
    };
    const readsWhole = (label: string) => (reads(local, label), reads(`${any(local)}.${wanted}`, `${label}.${wanted}`), reads(`${any(local)}.default`, `${label}.default`));
    const imported = (label: string, indent: string) => `${indent}const ${local} = await import(${from});\n${indent}tell("${name} ${label} ${target.name}", () => ${local});\n${indent}tell("${name} ${label} ${target.name}.${wanted}", () => ${any(local)}.${wanted});\n${indent}tell("${name} ${label} ${target.name}.default", () => ${any(local)}.default);`;
    const guarded = (label: string, indent: string) => `${indent}try {\n${imported(label, indent + "  ")}\n${indent}} catch (error) {\n${indent}  console.log("${name} ${label} ${target.name} throws", ${typed ? "(error as Error)" : "error"}?.name);\n${indent}}`;
    if (way === "default") (head.push(`import ${local} from ${from};`), reads(local, `${target.name} default`), reads(`${any(local)}.${wanted}`, `${target.name} default.${wanted}`));
    else if (way === "names") (head.push(`import { ${wanted} as ${local} } from ${from};`), reads(local, `${target.name} ${wanted}`));
    else if (way === "namespace") (head.push(`import * as ${local} from ${from};`), readsWhole(`${target.name} *`));
    else if (way === "both") (head.push(`import ${local}, { ${wanted} as ${local}_named } from ${from};`), reads(local, `${target.name} default`), reads(`${local}_named`, `${target.name} ${wanted}`));
    else if (way === "bare") head.push(`import ${from};`);
    else if (way === "a name handed on") head.push(`export { ${wanted} as ${wanted}Of${target.name}_${at} } from ${from};`);
    else if (way === "the default handed on") head.push(`export { default as defaultOf${target.name}_${at} } from ${from};`);
    else if (way === "all handed on") head.push(`export * from ${from};`);
    else if (way === "the namespace handed on") head.push(`export * as allOf${target.name}_${at} from ${from};`);
    else if (way === "awaited") body.push(guarded("awaited", ""));
    else if (way === "not awaited") body.push(`{\n  const begun = (async () => {\n${guarded("not awaited", "    ")}\n  })();\n  atTheEnd.unshift(() => begun);\n}`);
    else if (way === "imported at the end") tail.push(`atTheEnd.push(async () => {\n${guarded("late import", "  ")}\n});`);
    else {
      const loader = way === "createRequire" ? "createRequire(import.meta.url)" : way;
      body.push(`let ${local}${typed ? ": any" : ""};\ntry {\n  ${local} = ${loader}(${from});\n} catch (error) {\n  console.log("${name} requires ${target.name} throws", ${typed ? "(error as Error)" : "error"}?.name);\n}`);
      readsWhole(`${target.name} required`);
    }
  });
  const exported = [
    random.pick([`export const first = "${name}.first";`, `export let first = "${name}.first";`, `export function first() {\n  return "${name}.first";\n}`, `export var first = "${name}.first";`]),
    random.pick([`export const second = { of: "${name}" };`, `export class second {\n  static of = "${name}";\n}`, `export let second = 2;`]),
    random.pick([`export default { of: "${name}", first: "default.first", second: "default.second" };`, `export default function () {\n  return "${name}";\n}`, `export default class {\n  static first = "${name}";\n}`, `export default "${name}";`]),
  ];
  if (own.awaits) body.push(`await null;\nconsole.log("${name} goes on");`);
  // What a module exports stands in front of what it reads, behind it, or around it.
  const cut = random.below(exported.length + 1);
  return [...head, tools(typed), ...exported.slice(0, cut), ...body, ...exported.slice(cut), ...tail, `console.log("${name} ends");`, ""].join("\n");
}

function commonJSFile(random: Random, own: File, files: File[]): string {
  const { name, typed } = own;
  const any = (what: string) => (typed ? `(${what} as any)` : what);
  const sets = random.pick([
    () => [random.pick([`exports.first = "${name}.first";`, `exports.first = function first() {\n  return "${name}";\n};`]), random.pick([`exports.second = { of: "${name}" };`, `module.exports.second = 2;`])],
    () => [`exports.first = "${name}.first";`, `exports.second = 2;`],
    () => [`Object.defineProperty(exports, "first", { enumerable: true, get: () => "${name}.first by a getter" });`, `exports.second = 2;`],
    () => [`Object.defineProperty(exports, "__esModule", { value: true });\nexports.default = { of: "${name}" };`, `exports.first = "${name}.first";`, `exports.second = 2;`],
    () => [`exports.__esModule = true;\nexports.first = "${name}.first";`, `exports.second = 2;`],
    () => [`exports.first = "${name}.first left behind";`, `module.exports = { first: "${name}.first", second: 2 };`],
    () => [`module.exports = { first: "${name}.first", second: 2 };`, `module.exports.third = 3;`],
    () => [`module.exports = function ${name}() {\n  return "${name}";\n};`, `module.exports.first = "${name}.first of a function";`, `module.exports.second = 2;`],
    () => [`module.exports = class {\n  static first = "${name}.first of a class";\n  static second = 2;\n};`],
  ])();
  const needs = own.needs.map(({ to, way }, at) => {
    const target = files[to];
    const from = `"./${target.file}"`;
    const local = `${target.name}_${at}`;
    const wanted = random.pick(["first", "second"]);
    const late = (what: string, label: string) => `atTheEnd.push(() => tell("${name} late ${label}", () => ${what}));`;
    const whole = (loader: string) => `const ${local} = ${loader}(${from});\ntell("${name} early ${target.name}", () => ${local});\ntell("${name} early ${target.name}.${wanted}", () => ${local}.${wanted});\n${late(local, target.name)}\n${late(`${local}.${wanted}`, `${target.name}.${wanted}`)}\n${late(`${local}.default`, `${target.name}.default`)}`;
    const imported = (label: string, indent: string) => `${indent}try {\n${indent}  const ${local} = await import(${from});\n${indent}  tell("${name} ${label} ${target.name}", () => ${local});\n${indent}  tell("${name} ${label} ${target.name}.${wanted}", () => ${any(local)}.${wanted});\n${indent}  tell("${name} ${label} ${target.name}.default", () => ${any(local)}.default);\n${indent}} catch (error) {\n${indent}  console.log("${name} ${label} ${target.name} throws", ${typed ? "(error as Error)" : "error"}?.name);\n${indent}}`;
    if (way === "whole") return whole("require");
    if (way === "module.require") return whole("module.require");
    if (way === "createRequire") return whole(`require("node:module").createRequire(__filename)`);
    if (way === "names") return `const { ${wanted}: ${local} } = require(${from});\ntell("${name} early ${target.name} ${wanted}", () => ${local});\n${late(local, `${target.name} ${wanted}`)}`;
    if (way === "in a try") return `let ${local}${typed ? ": any" : ""};\ntry {\n  ${local} = require(${from});\n  tell("${name} early ${target.name}", () => ${local});\n} catch (error) {\n  console.log("${name} requires ${target.name} throws", ${typed ? "(error as Error)" : "error"}?.name);\n}\n${late(local, target.name)}`;
    if (way === "bare") return `require(${from});`;
    if (way === "twice") return `tell("${name} early ${target.name} twice", () => require(${from}) === require(${from}));`;
    if (way === "required at the end") return `atTheEnd.push(() => tell("${name} late require ${target.name}", () => require(${from})));\natTheEnd.push(() => tell("${name} late require ${target.name}.${wanted}", () => require(${from}).${wanted}));`;
    if (way === "not awaited") return `{\n  const begun = (async () => {\n${imported("not awaited", "    ")}\n  })();\n  atTheEnd.unshift(() => begun);\n}`;
    return `atTheEnd.push(async () => {\n${imported("late import", "  ")}\n});`;
  });
  const parts = [...sets];
  for (const need of needs) parts.splice(random.below(parts.length + 1), 0, need);
  return [tools(typed), `console.log("${name} begins");`, ...parts, `console.log("${name} ends");`, ""].join("\n");
}

/** A CommonJS file that is imported requires, while it runs, an ES module that leads back to that import. */
function hasRequireBackIntoImporters(files: File[]) {
  const reaches = (from: number, to: number, seen = new Set<number>()): boolean => from === to || (!seen.has(from) && (seen.add(from), files[from].needs.some(need => need.atTheTop && reaches(need.to, to, seen))));
  return files.some((importer, from) => importer.kind === "es" && importer.needs.some(need => files[need.to].kind === "commonjs" && reaches(need.to, from)));
}

/** Something requires an ES module that awaits at the top, or that imports one that does. */
function hasRequireOfWhatAwaits(files: File[]) {
  const isImport = (way: string) => !isLate(way) && way !== "awaited" && !way.toLowerCase().includes("require");
  const awaits = (at: number, seen = new Set<number>()): boolean =>
    files[at].kind === "es" && !seen.has(at) && (seen.add(at), !!files[at].awaits || files[at].needs.some(need => need.way === "awaited" || (isImport(need.way) && awaits(need.to, seen))));
  return files.some(each => each.needs.some(need => (each.kind === "commonjs" ? !need.way.includes("import") && need.way !== "not awaited" : need.way.toLowerCase().includes("require")) && awaits(need.to)));
}

export type Graph = {
  file: string;
  text: string;
  files: Record<string, string>;
  /** Who needs whom, and how. */
  notes: string;
  requiresBackIntoImporters: boolean;
  requiresWhatAwaits: boolean;
  /** An `import()` that nobody awaits: the turn in which its target runs is not part of the language. */
  importsBesideTheRest: boolean;
};

export function program(seed: number, most = 4): Graph {
  const draw = random(seed);
  const count = 2 + draw.below(most - 1);
  const files: File[] = [];
  for (let index = 0; index < count; index++) {
    const kind: Kind = index === 0 ? draw.pick<Kind>(["es", "es", "commonjs"]) : draw.pick<Kind>(["es", "commonjs"]);
    files.push({ name: `m${index}`, file: "", kind, typed: false, needs: [] });
  }
  // Of both kinds: that is what these graphs are for.
  if (files.every(each => each.kind === files[0].kind)) files[count - 1].kind = files[0].kind === "es" ? "commonjs" : "es";
  for (const each of files) {
    const extension = each.kind === "es" ? draw.pick(["mjs", "mjs", "ts"]) : draw.pick(["cjs", "cjs", "cjs", "cts"]);
    each.typed = extension.endsWith("ts");
    each.file = `${each.name}.${extension}`;
  }
  // How many turns of the job queue an `import()` takes is not part of the language: at most one thing in a graph goes on beside the rest.
  let goesOnBesideTheRest = false;
  const need = (from: number, to: number) => {
    let way = draw.pick(files[from].kind === "es" ? waysOfESModules : waysOfCommonJS);
    if (way === "not awaited" || way === "awaited") {
      if (goesOnBesideTheRest) way = "imported at the end";
      goesOnBesideTheRest = true;
    }
    // A module does not hand on its own names.
    if (from === to && way.endsWith("handed on")) return;
    files[from].needs.push({ to, way, atTheTop: !isLate(way) });
  };
  // All are reached from the first; then edges to anywhere, and one way back at least.
  for (let index = 1; index < count; index++) need(draw.below(index), index);
  for (let index = 1; index < count; index++) if (!files.some(each => each.needs.some(({ to }) => to === index))) files[0].needs.push({ to: index, way: files[0].kind === "es" ? "namespace" : "whole", atTheTop: true });
  for (let more = 1 + draw.below(count); more > 0; more--) need(draw.below(count), draw.below(count));
  if (!files[count - 1].needs.length) need(count - 1, draw.below(count - 1));

  if (!goesOnBesideTheRest && draw.chance(0.15)) draw.pick(files).awaits = true;
  const texts = Object.fromEntries(files.map(each => [each.file, each.kind === "es" ? esModule(draw, each, files) : commonJSFile(draw, each, files)]));
  const entry = files[0];
  // In a job of its own, so that the entry point waits for nothing.
  const text = texts[entry.file] + `setTimeout(async () => {\n  while (atTheEnd.length) await atTheEnd.shift()${entry.typed ? "!" : ""}();\n  console.log("the end");\n}, 0);\n`;
  delete texts[entry.file];
  const notes = files.map(each => `${each.file} > ${each.needs.map(({ to, way }) => `${files[to].name} (${way})`).join(", ") || "-"}`).join(" . ");
  const importsBesideTheRest = files.some(each => each.needs.some(({ way }) => way === "not awaited"));
  return { file: entry.file, text, files: texts, notes, requiresBackIntoImporters: hasRequireBackIntoImporters(files), requiresWhatAwaits: hasRequireOfWhatAwaits(files), importsBesideTheRest };
}
