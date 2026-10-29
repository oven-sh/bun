// Programs of three to seven files in which ES modules and CommonJS modules need each other, in cycles too. sources/modules-of-both-kinds-that-need-each-other.ts draws them.
//
//   a module      .mjs, .cjs, .js that is read as one or the other by what it holds, .ts with imports (not type-checked: what it reads of the others has no declared type)
//   an ES module  takes the default, names, the namespace, or nothing; hands names on (`export { a } from`, `export * from`); imports by `import()` at the top or in a function that runs at the end
//   a CommonJS    requires at the top, between two of its own exports, in a try, in a function that runs at the end; takes the whole or names out of it; sets `exports.a`, replaces `module.exports` by an object,
//   module        a function or a class, defines a getter, marks itself `__esModule`, or throws half-way
//   an edge       goes to any module: on (a tree), back (a cycle), to the module itself, to the entry point
//   what is read  at once, while the modules are still being evaluated: the kind of the value, its keys, a name; and again at the end, when all of them are through
//
//   with awaits   half of the ES modules await at their top, one to three times: a value, a settled promise, a thenable, a microtask, a tick, a timer, `for await`, an await that is never reached.
//                 A CommonJS module that requires such a module gets it or an error, as in plain Bun. A program with `import()` at the top of a module is passed over: how soon a file
//                 is loaded is not specified, and beside an await it shows.
//
// Every read stands in a try, and an error prints its name alone: the words of an error are not compared.
//
// A program in which plain Bun runs a CommonJS module a second time, because it threw the first time, is counted and is no finding where the two part: an executable runs a module once.
// So is one in which the two part where a module that threw is asked for again, by itself or through a module that needs it, and the executable throws: plain Bun answers with the namespace object there if an ES module imported the file while it ran.
// Where nobody got the error, an executable answers with that object too.
//
// Plain Bun reads files on several threads, and the order in which the texts arrive can show in what a program prints: the reference reads on one thread, and an executable
// that prints what plain Bun prints on several, in one of forty runs, is as right.
import { Random } from "./random";

type Kind = "es" | "commonjs";
interface Module {
  name: string;
  file: string;
  kind: Kind;
  needs: number[];
}

const show = `globalThis.say ??= (...words) => console.log(words.join(" "));
globalThis.tell ??= (label, read) => {
  let text;
  try {
    const value = read();
    text = value === null ? "null" : typeof value === "object" || typeof value === "function" ? typeof value + "{" + Reflect.ownKeys(value).filter(key => typeof key === "string" && !["length", "name", "prototype", "arguments", "caller", "__esModule"].includes(key)).sort().join() + "}" : typeof value + ":" + String(value);
  } catch (error) {
    text = "throws " + (error && error.name);
  }
  console.log(label, text);
};
globalThis.atTheEnd ??= [];
`;

export function program(seed: number, awaits = false): { entry: string; files: Record<string, string>; notes: string } {
  const random = new Random(seed);
  const count = random.between(3, 7);
  const modules: Module[] = [];
  for (let index = 0; index < count; index++) {
    const kind: Kind = index === 0 ? random.pick<Kind>(["es", "es", "commonjs"]) : random.pick<Kind>(["es", "commonjs"]);
    const extension = kind === "es" ? random.pick(["mjs", "mjs", "js", "ts"]) : random.pick(["cjs", "cjs", "js"]);
    modules.push({ name: `m${index}`, file: `m${index}.${extension}`, kind, needs: [] });
  }
  // All are reached from the first; then edges to anywhere.
  for (let index = 1; index < count; index++) modules[random.below(index)].needs.push(index);
  for (let more = random.between(1, count); more > 0; more--) modules[random.below(count)].needs.push(random.below(count));
  // Of two kinds at least, and one way back at least: that is what this source is for.
  if (modules.every(each => each.kind === modules[0].kind)) {
    const other = modules[count - 1];
    other.kind = other.kind === "es" ? "commonjs" : "es";
    other.file = `${other.name}.${other.kind === "es" ? "mjs" : "cjs"}`;
  }
  const last = modules[count - 1];
  if (!last.needs.length) last.needs.push(random.below(count - 1));

  const files: Record<string, string> = { "show.cjs": show };
  for (const module of modules) files[module.file] = module.kind === "es" ? esModule(random, module, modules) : commonJSModule(random, module, modules);
  const entry = modules[0];
  // Without --awaits no module awaits at its top: whether such a module may be required is another question than who sees what of whom.
  if (awaits) {
    const other = new Random(seed + 77);
    for (const module of modules) if (module.kind === "es" && other.chance(0.5)) files[module.file] = withAwaits(other, module.name, files[module.file]);
  }
  files[entry.file] += `setTimeout(async () => {\n  for (const late of globalThis.atTheEnd.splice(0)) await late();\n  say("the end");\n}, 1);\n`;
  return { entry: entry.file, files, notes: modules.map(each => `${each.file} > ${each.needs.map(to => modules[to].name).join(" ") || "-"}`).join(" . ") };
}

const ownNames = ["first", "second", "count"];

// Puts one to three awaits between the statements of an ES module, behind its imports.
function withAwaits(random: Random, name: string, text: string): string {
  const lines = text.split("\n");
  // A statement begins where a line is not indented and does not close something.
  const begins = lines.map((line, at) => (/^[a-zA-Z]/.test(line) && !/^(import|export) .* from |^import "/.test(line) ? at : -1)).filter(at => at > 0);
  const first = lines.findIndex(line => line.startsWith(`say("${name} begins")`) || line.startsWith("export "));
  const places = begins.filter(at => at >= first);
  for (let more = random.between(1, 3), n = 0; more > 0 && places.length; more--, n++) {
    const at = random.pick(places);
    lines[at] =
      random.pick([
        `await 0;`,
        `await undefined;`,
        `await null;\nawait null;`,
        `await Promise.resolve("${name}");`,
        `say("${name} awaited", await Promise.resolve(${n}));`,
        `say("${name} awaited", await ${n});`,
        `await { then(done) { done(3); } };`,
        `await new Promise(done => queueMicrotask(done));`,
        `await new Promise(done => process.nextTick(done));`,
        `await new Promise(done => setTimeout(done, 0));`,
        `for await (const each of [1, Promise.resolve(2)]) say("${name} each", each);`,
        `if (globalThis.neverSet) await 0;`,
        `try {\n  await Promise.reject(new Error("no"));\n} catch (error) {\n  say("${name} caught", error.message);\n}`,
        `export const late${n} = await Promise.resolve("${name}.late${n}");`,
        `export const late${n} = await "${name}.late${n}";`,
      ]) +
      "\n" +
      lines[at];
  }
  return lines.join("\n");
}

function esModule(random: Random, module: Module, modules: Module[]): string {
  const { name } = module;
  const head: string[] = [`import "./show.cjs";`];
  const body: string[] = [`say("${name} begins");`];
  const tail: string[] = [];
  module.needs.forEach((to, at) => {
    const target = modules[to];
    const from = `"./${target.file}"`;
    const local = `${target.name}_${at}`;
    const wanted = random.pick(ownNames);
    const way = random.pick(["default", "default", "names", "namespace", "both", "bare", "handed on", "all handed on", "then", "at the end"]);
    const reads = (what: string, label: string) => {
      body.push(`tell("${name} early ${label}", () => ${what});`);
      tail.push(`globalThis.atTheEnd.push(() => tell("${name} late ${label}", () => ${what}));`);
    };
    if (way === "default") (head.push(`import ${local} from ${from};`), reads(local, `${target.name} default`), reads(`${local}.${wanted}`, `${target.name} default.${wanted}`));
    else if (way === "names") (head.push(`import { ${wanted} as ${local} } from ${from};`), reads(local, `${target.name} ${wanted}`));
    else if (way === "namespace") (head.push(`import * as ${local} from ${from};`), reads(local, `${target.name} *`), reads(`${local}.${wanted}`, `${target.name} *.${wanted}`), reads(`${local}.default`, `${target.name} *.default`));
    else if (way === "both") (head.push(`import ${local}, { ${wanted} as ${local}_named } from ${from};`), reads(local, `${target.name} default`), reads(`${local}_named`, `${target.name} ${wanted}`));
    else if (way === "bare") head.push(`import ${from};`);
    else if (way === "handed on") head.push(`export { ${wanted} as ${wanted}Of${target.name}_${at} } from ${from};`);
    else if (way === "all handed on" && to !== modules.indexOf(module)) head.push(`export * from ${from};`);
    else if (way === "then") body.push(`import(${from}).then(\n  ${local} => (tell("${name} then ${target.name}", () => ${local}), tell("${name} then ${target.name}.${wanted}", () => ${local}.${wanted})),\n  error => say("${name} then ${target.name} throws", error && error.name),\n);`);
    else tail.push(`globalThis.atTheEnd.push(async () => {\n  try {\n    const ${local} = await import(${from});\n    tell("${name} late import ${target.name}", () => ${local});\n    tell("${name} late import ${target.name}.default", () => ${local}.default);\n  } catch (error) {\n    say("${name} late import ${target.name} throws", error && error.name);\n  }\n});`);
  });
  const typed = module.file.endsWith(".ts");
  if (typed) head.unshift(`// @ts-nocheck`);
  const exported = [
    random.pick([`export const first = "${name}.first";`, `export let first = "${name}.first";`, `export function first() {\n  return "${name}.first";\n}`, `export var first = "${name}.first";`]),
    random.pick([`export const second = { of: "${name}" };`, `export class second {\n  static of = "${name}";\n}`, `export let second${typed ? ": number | string" : ""} = 2;`]),
    random.pick([`export let count = 0;\nexport const more = () => ++count;`, `export const count = ${random.below(9)};`]),
    random.pick([`export default { of: "${name}", first: "default.first" };`, `export default function () {\n  return "${name}";\n}`, `export default class {\n  static first = "${name}";\n}`, `export default "${name}";`]),
  ];
  // What a module exports stands in front of what it reads, behind it, or around it.
  const cut = random.below(exported.length + 1);
  return [...head, ...exported.slice(0, cut), ...body, ...exported.slice(cut), ...tail, `say("${name} ends");`, ""].filter((line, at, all) => line !== "" || at === all.length - 1).join("\n");
}

function commonJSModule(random: Random, module: Module, modules: Module[]): string {
  const { name } = module;
  const lines: string[] = [`require("./show.cjs");`, `say("${name} begins");`];
  const sets = [
    random.pick([`exports.first = "${name}.first";`, `exports.first = function first() {\n  return "${name}";\n};`, `Object.defineProperty(exports, "first", { enumerable: true, get: () => "${name}.first by a getter" });`]),
    random.pick([`exports.second = { of: "${name}" };`, `module.exports.second = 2;`, `exports.second = class {\n  static of = "${name}";\n};`]),
    random.pick([`exports.count = ${random.below(9)};`, `exports.default = "${name}.default";`, `Object.defineProperty(exports, "__esModule", { value: true });\nexports.default = { of: "${name}" };`, `exports.__esModule = true;`, ``]),
  ];
  const whole = random.pick([
    ``,
    ``,
    ``,
    `module.exports = { first: "${name}.first replaced", count: 1 };`,
    `module.exports = function ${name}() {\n  return "${name}";\n};\nmodule.exports.first = "${name}.first of a function";`,
    `module.exports = class {\n  static first = "${name}.first of a class";\n};`,
    `module.exports = "${name} as a text";`,
  ]);
  const needs = module.needs.map((to, at) => {
    const target = modules[to];
    const from = `"./${target.file}"`;
    const local = `${target.name}_${at}`;
    const wanted = random.pick(ownNames);
    const late = (what: string, label: string) => `globalThis.atTheEnd.push(() => tell("${name} late ${label}", () => ${what}));`;
    return random.pick([
      () => `const ${local} = require(${from});\ntell("${name} early ${target.name}", () => ${local});\ntell("${name} early ${target.name}.${wanted}", () => ${local}.${wanted});\n${late(local, target.name)}\n${late(`${local}.${wanted}`, `${target.name}.${wanted}`)}\n${late(`${local}.default`, `${target.name}.default`)}`,
      () => `const { ${wanted}: ${local} } = require(${from});\ntell("${name} early ${target.name} ${wanted}", () => ${local});\n${late(local, `${target.name} ${wanted}`)}`,
      () => `let ${local};\ntry {\n  ${local} = require(${from});\n  tell("${name} early ${target.name}", () => ${local});\n} catch (error) {\n  say("${name} requires ${target.name} throws", error && error.name);\n}\n${late(local, target.name)}`,
      () => `globalThis.atTheEnd.push(() => tell("${name} late require ${target.name}", () => require(${from})));\nglobalThis.atTheEnd.push(() => tell("${name} late require ${target.name}.${wanted}", () => require(${from}).${wanted}));`,
      () => `globalThis.atTheEnd.push(async () => {\n  try {\n    const ${local} = await import(${from});\n    tell("${name} late import ${target.name}", () => ${local});\n    tell("${name} late import ${target.name}.default", () => ${local}.default);\n  } catch (error) {\n    say("${name} late import ${target.name} throws", error && error.name);\n  }\n});`,
      () => `require(${from});`,
      () => `tell("${name} early ${target.name} twice", () => require(${from}) === require(${from}));`,
    ])();
  });
  // A require stands in front of the module's own exports, between two of them, or behind them all.
  const parts = [...sets.filter(Boolean)];
  if (whole) parts.splice(random.below(parts.length + 1), 0, whole);
  for (const need of needs) parts.splice(random.below(parts.length + 1), 0, need);
  if (name !== "m0" && random.chance(0.08)) parts.splice(random.below(parts.length + 1), 0, `if (!globalThis.thrownBy${name}) {\n  globalThis.thrownBy${name} = true;\n  throw new RangeError("${name} half-way");\n}`);
  return [...lines, ...parts, `say("${name} ends");`, ""].join("\n");
}

// The next require() of a CommonJS module that threw runs it again under plain Bun, and throws the same error in an executable: docs/compiler/compatibility.mdx, "The module cache".
export const runsModuleAgain = (out: string) => {
  const begun = out.split("\n").filter(line => /^m\d+ begins$/.test(line));
  return new Set(begun).size < begun.length;
};

// Where an ES module imported the file while it ran, plain Bun runs nothing again: the next request gets the namespace object of that import. An executable does the same where nobody got the error. Where somebody did it throws the same error,
// also where the request is for a module that needs the file. Where nobody catches the error, the module that goes on under plain Bun never ends in the executable.
export const throwsForModuleThatThrew = (plain: string, compiled: string, notes: string) => {
  const [expected, got] = [plain.split("\n"), compiled.split("\n")];
  const at = expected.findIndex((line, index) => line !== got[index]);
  const begun = expected.slice(0, at).flatMap(line => /^(m\d+) begins$/.exec(line)?.[1] ?? []);
  const threw = new Set(begun.filter(name => !expected.includes(`${name} ends`)));
  const needs = new Map(notes.split(" . ").map(each => [each.split(".")[0], each.split(" > ")[1].split(" ")]));
  const reaches = (from: string, seen = new Set<string>()): boolean => threw.has(from) || (!seen.has(from) && (seen.add(from), (needs.get(from) ?? []).some(to => reaches(to, seen))));
  const caught = /^m\d+ (?:early|late|late require|requires|then|late import) (m\d+)\b.* throws \w+$/.exec(got[at] ?? "")?.[1];
  const goesOn = /^(m\d+) /.exec(expected[at] ?? "")?.[1];
  const asked = caught ?? (goesOn !== undefined && !got.includes(`${goesOn} ends`) ? goesOn : undefined);
  return asked !== undefined && reaches(asked);
};
