// Programs of three to seven files in which ES modules and CommonJS modules need each other, in cycles too. Each is run by plain Bun and as an executable, and both have to print the same.
//
//   bun modules-of-both-kinds-that-need-each-other.ts --bun <bun> --work <folder> --out <folder> [--seconds 300] [--jobs 8] [--seed 1] [--flags "<flags of the build>"] [--node <node>] [--print <seed>]
//
//   a module      .mjs, .cjs, .js that is read as one or the other by what it holds, .ts with imports (not type-checked: what it reads of the others has no declared type)
//   an ES module  takes the default, names, the namespace, or nothing; hands names on (`export { a } from`, `export * from`); imports by `import()` at the top or in a function that runs at the end
//   a CommonJS    requires at the top, between two of its own exports, in a try, in a function that runs at the end; takes the whole or names out of it; sets `exports.a`, replaces `module.exports` by an object,
//   module        a function or a class, defines a getter, marks itself `__esModule`, or throws half-way
//   an edge       goes to any module: on (a tree), back (a cycle), to the module itself, to the entry point
//   what is read  at once, while the modules are still being evaluated: the kind of the value, its keys, a name; and again at the end, when all of them are through
//
// Every read stands in a try, and an error prints its name alone: the words of an error are not compared.
//
// Where the two part and --node is given, Node is asked: an executable that prints what Node prints is counted and is no finding.
//
// A finding: a command that ends by a signal or runs out of its clock, a build that is refused, an executable that prints something else. One folder a finding in --out, at most three of one kind and first difference.
import { spawn } from "bun";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { Random } from "./random";

const argument = (name: string, otherwise?: string) => {
  const at = process.argv.indexOf("--" + name);
  if (at > 0) return process.argv[at + 1];
  if (otherwise === undefined) throw new Error(`--${name} is missing`);
  return otherwise;
};

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

export function program(seed: number): { entry: string; files: Record<string, string>; notes: string } {
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
  // No module awaits at its top: whether such a module may be required is another question than who sees what of whom.
  files[entry.file] += `setTimeout(async () => {\n  for (const late of globalThis.atTheEnd.splice(0)) await late();\n  say("the end");\n}, 1);\n`;
  return { entry: entry.file, files, notes: modules.map(each => `${each.file} > ${each.needs.map(to => modules[to].name).join(" ") || "-"}`).join(" . ") };
}

const ownNames = ["first", "second", "count"];

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

if (import.meta.main) {
  if (process.argv.includes("--print")) {
    const drawn = program(Number(argument("print")));
    console.log(`// ${drawn.notes}\n// entry: ${drawn.entry}`);
    for (const [file, text] of Object.entries(drawn.files)) if (file !== "show.cjs") console.log(`// ---- ${file}\n${text}`);
    process.exit(0);
  }
  const bun = argument("bun");
  const work = argument("work");
  const out = argument("out");
  const until = Date.now() + Number(argument("seconds", "300")) * 1000;
  const firstSeed = Number(argument("seed", "1"));
  const flags = argument("flags", "").split(/\s+/).filter(Boolean);
  const node = argument("node", "");

  type Ended = { text: string; out: string; code: number | null; signal: string | number | null; late: boolean };
  const run = async (command: string[], cwd: string, seconds: number, environment: Record<string, string> = {}): Promise<Ended> => {
    const limited = ["/bin/sh", "-c", `prlimit --pid $$ --core=1:1 2> /dev/null || ulimit -c 0; exec "$@"`, "--", ...command];
    const child = spawn(limited, { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1", ...environment } });
    let late = false;
    const timer = setTimeout(() => ((late = true), child.kill(9)), seconds * 1000);
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    clearTimeout(timer);
    return { text: stdout + stderr, out: stdout, code, signal: late ? null : child.signalCode, late };
  };

  const counts = new Map<string, number>();
  const count = (what: string) => counts.set(what, (counts.get(what) ?? 0) + 1);
  let findings = 0;
  const shapeOf = (text: string) => text.replace(/\bm\d+(_\d+)?\b/g, "m").replace(/\d+/g, "N").replace(/[^\w{}:.]+/g, "-").slice(0, 90);
  function finding(kind: string, folder: string, seed: number, notes: string, said: string, shape = "") {
    findings++;
    const group = `${kind}${shape ? " " + shapeOf(shape) : ""}`.replace(/[^\w{}:.-]+/g, "-");
    count(`FINDING ${group}`);
    if (readdirSync(out).filter(name => name.startsWith(group + "-seed-")).length >= 3) return;
    const target = join(out, `${group}-seed-${seed}`);
    rmSync(join(folder, "app"), { force: true });
    cpSync(folder, target, { recursive: true });
    writeFileSync(join(target, "finding.txt"), `${kind}\nseed ${seed}\nflags ${flags.join(" ")}\n${notes}\n\n${said.slice(0, 6000)}\n`);
  }

  async function one(seed: number, job: number) {
    const folder = join(work, "job-" + job);
    rmSync(folder, { recursive: true, force: true });
    mkdirSync(folder, { recursive: true });
    const { entry, files, notes } = program(seed);
    for (const [file, text] of Object.entries(files)) writeFileSync(join(folder, file), text);
    // The reference transpiles on one thread: the texts are read in the order in which they are asked for.
    const plain = await run([bun, "--no-install", entry], folder, 30, { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" });
    if (plain.signal) return finding("plain Bun ends by a signal", folder, seed, notes, plain.text);
    if (plain.late) return void count("plain Bun is not through in its time");
    const build = await run([bun, "build", "--compile", "--aot", "--aot-threads=1", ...flags, `./${entry}`, "--outfile", "app"], folder, 200);
    if (build.late) return finding("the build hangs", folder, seed, notes, build.text);
    if (build.signal || /\bpanic(ked)?\b|ASSERTION FAILED|internal compiler error/.test(build.text)) return finding("the build ends badly", folder, seed, notes, build.text, /^.*(panic|ASSERTION FAILED|internal compiler error).*$/m.exec(build.text)?.[0] ?? String(build.signal));
    if (build.code !== 0 || !existsSync(join(folder, "app"))) {
      // What plain Bun refuses as well is no program.
      if (plain.code !== 0 && !plain.out.includes("begins")) return void count("refused by both");
      return finding("the build is refused", folder, seed, notes, build.text, /^.*error.*$/im.exec(build.text)?.[0] ?? "");
    }
    let compiled = await run(["./app"], folder, 30);
    // A machine under load makes a short run long: what is not through in its time gets five times as long, once.
    if (compiled.late) compiled = await run(["./app"], folder, 200);
    if (compiled.signal) return finding("the executable ends by a signal", folder, seed, notes, `${compiled.signal}\n${compiled.text}`, String(compiled.signal));
    if (compiled.late) return finding("the executable hangs", folder, seed, notes, compiled.text);
    if (compiled.out === plain.out && compiled.code === plain.code) return void count("as plain");
    if (node && !Object.keys(files).some(file => file.endsWith(".ts")) && (await run([node, entry], folder, 30)).out === compiled.out) return void count("plain Bun is by itself: the executable prints what Node prints");
    const [expected, got] = [plain.out.split("\n"), compiled.out.split("\n")];
    const at = expected.findIndex((line, index) => line !== got[index]);
    finding("the executable prints something else", folder, seed, notes, `exit codes ${plain.code} ${compiled.code}\nline ${at + 1}\nplain:    ${expected[at]}\ncompiled: ${got[at]}\n\n== plain\n${plain.text}\n== compiled\n${compiled.text}`, `${expected[at] ?? "the end"} | ${got[at] ?? "the end"}`);
  }

  mkdirSync(out, { recursive: true });
  let next = firstSeed;
  await Promise.all(
    Array.from({ length: Number(argument("jobs", "8")) }, async (_, job) => {
      while (Date.now() < until) await one(next++, job);
      rmSync(join(work, "job-" + job), { recursive: true, force: true });
    }),
  );
  console.log(`programs ${next - firstSeed} | findings ${findings}`);
  for (const [what, times] of [...counts].sort((a, b) => b[1] - a[1])) console.log(String(times).padStart(6), what);
  process.exit(0);
}
