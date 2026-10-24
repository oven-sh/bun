// Every typed program that a source of this folder draws, published as a package and installed: `bun compile --library` writes `index.js`, `index.d.ts`, `index.full.ts` and `package.json`; the folder is laid into
// `node_modules` of a program that imports it; `bun compile` builds that program from the package's full types. The executable prints what plain Bun prints for the program itself.
//
//   bun programs-published-as-packages.ts --bun <bun> --work <folder> --out <folder> [--seconds 300] [--jobs 8] [--seed 1] [--sources a,b,c]
//
//   the package   the program as its one entry point; or with a second module that the first imports; with functions and a class that the importer uses: records, instances and callbacks cross the border, those that the
//                 package declares and those that it does not, once and three hundred times
//   its options   no tsconfig.json; strict; strict with noUncheckedIndexedAccess or exactOptionalPropertyTypes; strict off
//   laid          as `bun compile --library` wrote it; without "compilerOptions", with them in another place or with an error in them; with the conditions of "exports" in another order: the types stay;
//                 with index.js changed; without index.full.ts, with it cut off in the middle or behind `// @ts-nocheck`; with the "full-types" condition behind "default", deleted, misspelled, at the top level of
//                 package.json or pointing at index.d.ts; without "exports": these may cost the types and never the build
//   --always-says-so   for builds that always say whether the full types of a package are used: the note or a warning that names the package, one of the two
//
// A finding: a command that ends by a signal or runs out of its clock, a library that is refused although the program compiles by itself, an executable that prints something else. One folder a finding in --out.
// What is counted and printed at the end: how many packages were compiled from their full types, and the words of every warning that took the types away from a package laid as it was written.
import { spawn } from "bun";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { Random } from "./random";

const argument = (name: string, otherwise?: string) => {
  const at = process.argv.indexOf("--" + name);
  if (at > 0) return process.argv[at + 1];
  if (otherwise === undefined) throw new Error(`--${name} is missing`);
  return otherwise;
};
const bun = argument("bun");
const work = argument("work");
const out = argument("out");
const until = Date.now() + Number(argument("seconds", "300")) * 1000;
const firstSeed = Number(argument("seed", "1"));
const names = argument("sources", "closures-read-through-array-methods,objects-that-live-for-one-turn-of-a-loop,one-key-asked-in-every-way,objects-read-where-they-are-made,lists-read-where-they-are-made,typed-instances-changed-through-built-ins,several-changes-behind-a-declared-type,two-names-where-ways-meet,one-name-for-many-kinds-of-things").split(",");
const generators = await Promise.all(names.map(async name => (await import(`./${name}.ts`)).generate as (random: Random, typed?: boolean) => string));

type Ended = { text: string; out: string; code: number | null; signal: string | number | null; late: boolean };
async function run(command: string[], cwd: string, seconds = 150): Promise<Ended> {
  const child = spawn(command, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1" } });
  let late = false;
  const timer = setTimeout(() => ((late = true), child.kill(9)), seconds * 1000);
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  clearTimeout(timer);
  return { text: stdout + stderr, out: stdout, code, signal: child.signalCode, late };
}

const options: [string, string | undefined][] = [
  ["no tsconfig.json", undefined],
  ["strict", `{ "compilerOptions": { "strict": true, "target": "esnext", "module": "preserve", "moduleResolution": "bundler", "types": [] } }`],
  ["strict", `{ "compilerOptions": { "strict": true, "target": "esnext", "module": "preserve", "moduleResolution": "bundler", "types": [] } }`],
  ["exactOptionalPropertyTypes", `{ "compilerOptions": { "strict": true, "exactOptionalPropertyTypes": true, "target": "esnext", "module": "preserve", "moduleResolution": "bundler", "types": [] } }`],
  ["strict off", `{ "compilerOptions": { "strict": false, "target": "esnext", "module": "preserve", "moduleResolution": "bundler", "types": [] } }`],
];
const layings = [
  "as written",
  "as written",
  "as written",
  "as written",
  "as written",
  "as written",
  "without compilerOptions",
  "conditions in another order",
  "index.js changed",
  "without index.full.ts",
  "full types cut off",
  "full-types behind default",
  "the condition deleted",
  "no exports",
  "the condition misspelled",
  "full-types at the top level",
  "full-types points at index.d.ts",
  "ts-nocheck in front",
  "compilerOptions in another place",
  "compilerOptions with an error",
] as const;
/** Where the package keeps its types; everywhere else it may lose them and never the build. */
const keepsItsTypes = new Set<string>(["as written", "without compilerOptions", "conditions in another order", "compilerOptions in another place", "compilerOptions with an error"]);
/** Builds of newer trees always say whether the full types of a package are used. */
const alwaysSaysSo = process.argv.includes("--always-says-so");

const counts = new Map<string, number>();
const count = (what: string) => counts.set(what, (counts.get(what) ?? 0) + 1);
const shapeOf = (text: string) => text.replace(/\d+/g, "N").replace(/"[^"]*"/g, '"…"').slice(0, 160);
let findings = 0;
function finding(kind: string, folder: string, seed: number, notes: string, said: string) {
  findings++;
  count("FINDING " + kind);
  const to = join(out, `${kind.replaceAll(" ", "-")}-${seed}`);
  mkdirSync(to, { recursive: true });
  for (const part of ["library/src", "library/package.json", "library/tsconfig.json", "library/dist", "app/main.ts", "app/package.json"]) if (existsSync(join(folder, part))) cpSync(join(folder, part), join(to, part), { recursive: true });
  writeFileSync(join(to, "finding.txt"), `${kind}\nseed ${seed}\n${notes}\n\n${said.slice(0, 6000)}\n`);
  console.log(`${new Date().toISOString()} ${kind} | seed ${seed} | ${notes} | ${said.slice(0, 200).replaceAll("\n", " ")}`);
}

async function one(seed: number, job: number) {
  const random = new Random(seed);
  const at = random.below(generators.length);
  const program = generators[at](new Random(seed), true);
  const [optionsName, tsconfig] = random.pick(options);
  const laying = random.pick(layings);
  const form = random.pick(["one module", "one module", "a function is called", "two modules"]);
  const notes = `${names[at]} | ${optionsName} | ${laying} | ${form}`;
  const folder = join(work, "job-" + job);
  rmSync(folder, { recursive: true, force: true });
  for (const part of ["alone", "library/src", "app/node_modules"]) mkdirSync(join(folder, part), { recursive: true });

  // What the program prints by itself, plain, is what everything else is held against; a program that does not compile by itself says nothing about packages.
  writeFileSync(join(folder, "alone/main.ts"), program);
  const plain = await run([bun, "--no-install", "main.ts"], join(folder, "alone"));
  if (plain.late || plain.signal) return count("skipped: the program itself ends badly in plain Bun");

  const border = `\nexport function handedOver<T>(value: T, times: number): T[] {\n  const all: T[] = [];\n  for (let i = 0; i < times; i++) all.push(value);\n  return all;\n}
export interface AskedOfThePackage {\n  n: number;\n  t?: string;\n  list: number[];\n}
export class KeptByThePackage {\n  constructor(public n: number) {}\n  twice(): number {\n    return this.n * 2;\n  }\n}
export function toldByThePackage(asked: AskedOfThePackage, kept: KeptByThePackage, each: (n: number) => number): string {\n  let sum = 0;\n  for (const n of asked.list) sum += each(n);\n  return asked.n + ":" + (asked.t ?? "-") + ":" + sum + ":" + kept.twice();\n}\n`;
  // What the importer hands over: what the package declares, and what it does not.
  const asked = ['{ n: 1, list: [1, 2] }', '{ n: 1.5, t: "x", list: [] }', '{ n: "1", list: ["a", 2.5] } as any', '{ list: [1], n: 2, more: true } as any', '{ n: 1, t: 7, list: new Float64Array([1, 2]) } as any', '{ n: 1 } as any', 'null as any', 'Object.create({ n: 3, list: [4] })', '{ get n() { return 9; }, list: [1, , 3] } as any'];
  const kept = ["new KeptByThePackage(2)", "new KeptByThePackage(0.5)", 'new KeptByThePackage("2" as any)', '{ n: 1, twice: () => "x" } as any', "new (class extends KeptByThePackage { twice() { return -1; } })(1)", "Object.create(KeptByThePackage.prototype)", "undefined as any"];
  const each = ["n => n + 1", "n => n / 2", '((n: any) => n + "!") as any', "Math.sqrt", "(() => undefined) as any", '"no function" as any'];
  const calls = Array.from({ length: random.between(3, 8) }, () => `tell(() => toldByThePackage(${random.pick(asked)}, ${random.pick(kept)}, ${random.pick(each)}));`).join("\n");
  const text = program.replace(/\nexport \{\};\n?$/, "\n");
  if (form === "two modules") {
    writeFileSync(join(folder, "library/src/second.ts"), `export interface PairOfThePackage {\n  first: number;\n  second?: string;\n}\nexport const pairOfThePackage = (first: number, second?: string): PairOfThePackage => (second === undefined ? { first } : { first, second });\n`);
    writeFileSync(join(folder, "library/src/index.ts"), `import { pairOfThePackage, type PairOfThePackage } from "./second";\n${text}\nexport const keptByThePackage: PairOfThePackage = pairOfThePackage(1, "x");\nexport type { PairOfThePackage };\n${border}`);
  } else writeFileSync(join(folder, "library/src/index.ts"), text + border);
  writeFileSync(join(folder, "library/package.json"), JSON.stringify({ name: "published", version: "1.0.0", license: "MIT" }, null, 2));
  if (tsconfig) writeFileSync(join(folder, "library/tsconfig.json"), tsconfig);
  const library = await run([bun, "compile", "--library"], join(folder, "library"));
  if (library.signal || library.late) return finding(library.late ? "the library build hangs" : "the library build ends by a signal", folder, seed, notes, library.text);
  if (library.code !== 0) {
    // Other options than the program was written for may bring type errors: said in words, that is an answer.
    if (/error: |TS\d+/.test(library.text)) return count(`the library is refused in words (${optionsName}): ${shapeOf(library.text.match(/(?:error|TS\d+)[^\n]*/)?.[0] ?? "")}`);
    return finding("the library build fails without a word", folder, seed, notes, library.text);
  }
  const dist = join(folder, "library/dist");
  const hasFullTypes = existsSync(join(dist, "index.full.ts"));
  count(hasFullTypes ? "libraries with full types" : "libraries WITHOUT full types: " + shapeOf(library.text.match(/warn[^\n]*/)?.[0] ?? "no warning"));

  const installed = join(folder, "app/node_modules/published");
  cpSync(dist, installed, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  if (laying === "without compilerOptions") delete manifest.compilerOptions;
  if (laying === "conditions in another order" && manifest.exports)
    for (const [key, entry] of Object.entries(manifest.exports)) if (entry && typeof entry === "object") manifest.exports[key] = Object.fromEntries(random.shuffled(Object.entries(entry).filter(([name]) => name !== "default")).concat(Object.entries(entry).filter(([name]) => name === "default")));
  const entries = () => Object.entries((manifest.exports ?? {}) as Record<string, unknown>).filter((each): each is [string, Record<string, unknown>] => !!each[1] && typeof each[1] === "object");
  if (laying === "full-types behind default") for (const [key, { "full-types": full, ...rest }] of entries()) manifest.exports[key] = { ...rest, "full-types": full };
  if (laying === "the condition deleted" || laying === "full-types at the top level") for (const [, entry] of entries()) delete entry["full-types"];
  if (laying === "full-types at the top level") manifest["full-types"] = "./index.full.ts";
  if (laying === "no exports") {
    delete manifest.exports;
    Object.assign(manifest, { main: "./index.js", types: "./index.d.ts", type: "module" });
  }
  if (laying === "the condition misspelled") {
    const spelled = random.pick(["full-type", "fullTypes", "Full-Types"]);
    for (const [key, entry] of entries()) manifest.exports[key] = Object.fromEntries(Object.entries(entry).map(([name, value]) => [name === "full-types" ? spelled : name, value]));
  }
  if (laying === "full-types points at index.d.ts") for (const [, entry] of entries()) if ("full-types" in entry) entry["full-types"] = "./index.d.ts";
  if (laying === "compilerOptions in another place" && manifest.compilerOptions) {
    const { compilerOptions, ...rest } = manifest;
    for (const name of Object.keys(manifest)) delete manifest[name];
    Object.assign(manifest, rest, random.chance(0.5) ? { publishConfig: { compilerOptions } } : { compileroptions: compilerOptions });
  }
  if (laying === "compilerOptions with an error") manifest.compilerOptions = { ...manifest.compilerOptions, ...random.pick<object>([{ stricter: true }, { strict: "yes" }, { noImplicitAny: 1 }, { lib: "esnext" }]) };
  if (laying === "ts-nocheck in front" && hasFullTypes) writeFileSync(join(installed, "index.full.ts"), "// @ts-nocheck\n" + readFileSync(join(installed, "index.full.ts"), "utf8"));
  writeFileSync(join(installed, "package.json"), JSON.stringify(manifest, null, 2));
  if (laying === "index.js changed") writeFileSync(join(installed, "index.js"), readFileSync(join(installed, "index.js"), "utf8") + "\n;0;\n");
  if (laying === "without index.full.ts") rmSync(join(installed, "index.full.ts"), { force: true });
  if (laying === "full types cut off" && hasFullTypes) {
    const full = readFileSync(join(installed, "index.full.ts"), "utf8");
    writeFileSync(join(installed, "index.full.ts"), full.slice(0, random.between(1, full.length - 1)));
  }
  writeFileSync(join(folder, "app/package.json"), JSON.stringify({ name: "app", dependencies: { published: "1.0.0" } }));
  writeFileSync(
    join(folder, "app/main.ts"),
    form === "one module"
      ? `import "published";\n`
      : `import { handedOver, KeptByThePackage, toldByThePackage } from "published";\nlet quiet = false;\nfunction tell(run: () => unknown) {\n  let text: string;\n  try {\n    text = String(run());\n  } catch (error) {\n    text = (error as Error).name;\n  }\n  if (!quiet) console.log(text);\n}\nconsole.log(JSON.stringify(handedOver({ n: 1, t: "x" }, 2)), handedOver("a", 3).join(""), handedOver(1.5, 0).length, handedOver(1, "2" as any).length);\nfor (let turn = 0; turn < ${random.pick([1, 1, 300])}; turn++) {\n  quiet = turn > 1;\n${calls}\n}\n`,
  );

  // The package in plain Bun: index.js has to behave as the sources do.
  const installedPlain = await run([bun, "--no-install", "main.ts"], join(folder, "app"));
  if (installedPlain.signal || installedPlain.late) return finding("plain Bun ends badly on the package", folder, seed, notes, installedPlain.text);
  // A program may print behind its last statement, and then the importer's lines stand in between.
  if (!holdsInOrder(installedPlain.out, plain.out)) return finding("index.js prints something else than the sources", folder, seed, notes, firstDifference(plain.out, installedPlain.out));
  const expected = installedPlain.out;

  const build = await run([bun, "compile", "./main.ts", "--outfile", "app"], join(folder, "app"), 300);
  if (build.signal || build.late) return finding(build.late ? "the build hangs" : "the build ends by a signal", folder, seed, notes, build.text);
  if (build.code !== 0) return finding("the build is refused", folder, seed, notes, build.text);
  const isFromFullTypes = /is compiled from its full types/.test(build.text);
  count(`${laying}: ${isFromFullTypes ? "compiled from its full types" : "compiled without types"}`);
  // One or the other, never both and never neither.
  const isWarnedOf = /^warn: .*"published"|TS100009.*published/m.test(build.text);
  if (alwaysSaysSo && hasFullTypes && isFromFullTypes === isWarnedOf && !(isFromFullTypes && keepsItsTypes.has(laying))) return finding(isFromFullTypes ? "the build says both that the types are used and that they are not" : "the build does not say that the types are not used", folder, seed, notes, build.text);
  if (isFromFullTypes && !keepsItsTypes.has(laying) && hasFullTypes) count(`TYPES ARE USED WHERE THE LAYING SHOULD COST THEM: ${laying}`);
  if (!isFromFullTypes && hasFullTypes && laying === "as written") count("THE TYPES ARE LOST OF A PACKAGE LAID AS IT WAS WRITTEN: " + shapeOf(build.text.match(/warn[^\n]*/)?.[0] ?? "no warning"));
  const compiled = await run(["./app"], join(folder, "app"));
  if (compiled.signal || compiled.late) return finding(compiled.late ? "the executable hangs" : "the executable ends by a signal", folder, seed, notes, compiled.text);
  if (compiled.out !== expected || compiled.code !== installedPlain.code) return finding("the executable prints something else", folder, seed, notes, firstDifference(expected, compiled.out));
  count("as plain");
}

function holdsInOrder(all: string, some: string): boolean {
  const lines = all.split("\n");
  let at = 0;
  for (const line of some.split("\n")) {
    at = lines.indexOf(line, at) + 1;
    if (!at) return false;
  }
  return true;
}

function firstDifference(expected: string, got: string): string {
  const a = expected.split("\n");
  const b = got.split("\n");
  const at = a.findIndex((line, index) => line !== b[index]);
  return `line ${at + 1}\nexpected: ${a[at]?.slice(0, 400)}\ngot:      ${b[at]?.slice(0, 400)}`;
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
