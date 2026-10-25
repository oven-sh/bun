// Publishes every typed program that a source of this folder draws as a package, installs it and compiles a program that imports it. `bun compile --library` writes `index.js`, `index.d.ts`, `index.aot.ts` and
// `package.json`, whose `exports` name `index.aot.ts` under the "aot" condition. `bun compile` compiles that file. The executable must print what plain Bun prints for the same files (`bun --conditions=aot`).
//
//   bun programs-published-as-packages.ts --bun <bun> --work <folder> --out <folder> [--seconds 300] [--jobs 8] [--seed 1] [--sources a,b,c] [--flags "<flags of the build of the program>"]
//
//   the package   the program as its one entry point; or with a second module that the first imports; with functions and a class that the importer uses: records, instances and callbacks cross the border, those that the
//                 package declares and those that it does not, once and three hundred times
//   its options   no tsconfig.json; strict; strict with exactOptionalPropertyTypes; strict off
//   installed     as `bun compile --library` wrote it; without "compilerOptions", with them in another place or with an error in them; with the conditions in another order; with index.js changed; behind
//                 `// @ts-nocheck`: index.aot.ts is compiled.
//                 With the condition behind "default", deleted, misspelled or at the top level of package.json; without "exports": index.js is compiled.
//                 Without index.aot.ts, with it cut off in the middle, with the condition pointing at index.d.ts: the build may stop with an error where plain Bun fails too.
//
// A finding: a command that ends by a signal or runs out of time, a library or a build that is refused without a reason, index.aot.ts that prints something else than index.js, the wrong one of the two compiled,
// an executable that prints something else. Each finding gets a folder in --out.
// The counts printed at the end: which file each kind of install was compiled from, and the words of every warning that took the types away from a package installed as it was written.
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
const flags = argument("flags", "").split(/\s+/).filter(Boolean);
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
  "without index.aot.ts",
  "index.aot.ts cut off",
  "the condition behind default",
  "the condition deleted",
  "no exports",
  "the condition misspelled",
  "the condition at the top level",
  "the condition points at index.d.ts",
  "ts-nocheck in front",
  "compilerOptions in another place",
  "compilerOptions with an error",
] as const;
/** `exports` name index.aot.ts as it was written, so it is compiled and behaves as index.js does. */
const compilesAotFile = new Set<string>(["as written", "without compilerOptions", "conditions in another order", "index.js changed", "ts-nocheck in front", "compilerOptions in another place", "compilerOptions with an error"]);
/** Nothing names index.aot.ts, so index.js is compiled. */
const compilesJavaScript = new Set<string>(["the condition behind default", "the condition deleted", "no exports", "the condition misspelled", "the condition at the top level"]);
/** The condition names a file that is missing, broken or empty. The build may stop with an error where plain Bun fails on the same files. */
const mayStopTheBuild = new Set<string>(["without index.aot.ts", "index.aot.ts cut off", "the condition points at index.d.ts"]);

const counts = new Map<string, number>();
const count = (what: string) => counts.set(what, (counts.get(what) ?? 0) + 1);
const shapeOf = (text: string) => text.replace(/\d+/g, "N").replace(/"[^"]*"/g, '"…"').slice(0, 160);
let findings = 0;
function finding(kind: string, folder: string, seed: number, notes: string, said: string) {
  findings++;
  count("FINDING " + kind);
  const to = join(out, `${kind.replaceAll(" ", "-")}-${seed}`);
  mkdirSync(to, { recursive: true });
  for (const part of ["library/src", "library/package.json", "library/tsconfig.json", "library/dist", "app/main.ts", "app/package.json", "app/node_modules/published"]) if (existsSync(join(folder, part))) cpSync(join(folder, part), join(to, part), { recursive: true });
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
  const hasAotFile = existsSync(join(dist, "index.aot.ts"));
  count(hasAotFile ? "libraries with index.aot.ts" : "libraries WITHOUT index.aot.ts: " + shapeOf(library.text.match(/warn[^\n]*/)?.[0] ?? "no warning"));

  const installed = join(folder, "app/node_modules/published");
  cpSync(dist, installed, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  if (laying === "without compilerOptions") delete manifest.compilerOptions;
  if (laying === "conditions in another order" && manifest.exports)
    for (const [key, entry] of Object.entries(manifest.exports)) if (entry && typeof entry === "object") manifest.exports[key] = Object.fromEntries(random.shuffled(Object.entries(entry).filter(([name]) => name !== "default")).concat(Object.entries(entry).filter(([name]) => name === "default")));
  const entries = () => Object.entries((manifest.exports ?? {}) as Record<string, unknown>).filter((each): each is [string, Record<string, unknown>] => !!each[1] && typeof each[1] === "object");
  if (laying === "the condition behind default") for (const [key, { aot, ...rest }] of entries()) manifest.exports[key] = { ...rest, aot };
  if (laying === "the condition deleted" || laying === "the condition at the top level") for (const [, entry] of entries()) delete entry["aot"];
  if (laying === "the condition at the top level") manifest["aot"] = "./index.aot.ts";
  if (laying === "no exports") {
    delete manifest.exports;
    Object.assign(manifest, { main: "./index.js", types: "./index.d.ts", type: "module" });
  }
  if (laying === "the condition misspelled") {
    const spelled = random.pick(["AOT", "Aot", "aot-types"]);
    for (const [key, entry] of entries()) manifest.exports[key] = Object.fromEntries(Object.entries(entry).map(([name, value]) => [name === "aot" ? spelled : name, value]));
  }
  if (laying === "the condition points at index.d.ts") for (const [, entry] of entries()) if ("aot" in entry) entry["aot"] = "./index.d.ts";
  if (laying === "compilerOptions in another place" && manifest.compilerOptions) {
    const { compilerOptions, ...rest } = manifest;
    for (const name of Object.keys(manifest)) delete manifest[name];
    Object.assign(manifest, rest, random.chance(0.5) ? { publishConfig: { compilerOptions } } : { compileroptions: compilerOptions });
  }
  if (laying === "compilerOptions with an error") manifest.compilerOptions = { ...manifest.compilerOptions, ...random.pick<object>([{ stricter: true }, { strict: "yes" }, { noImplicitAny: 1 }, { lib: "esnext" }]) };
  if (laying === "ts-nocheck in front" && hasAotFile) writeFileSync(join(installed, "index.aot.ts"), "// @ts-nocheck\n" + readFileSync(join(installed, "index.aot.ts"), "utf8"));
  writeFileSync(join(installed, "package.json"), JSON.stringify(manifest, null, 2));
  if (laying === "index.js changed") writeFileSync(join(installed, "index.js"), readFileSync(join(installed, "index.js"), "utf8") + "\n;0;\n");
  if (laying === "without index.aot.ts") rmSync(join(installed, "index.aot.ts"), { force: true });
  if (laying === "index.aot.ts cut off" && hasAotFile) {
    const whole = readFileSync(join(installed, "index.aot.ts"), "utf8");
    writeFileSync(join(installed, "index.aot.ts"), whole.slice(0, random.between(1, whole.length - 1)));
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
  // The same files as the build reads, in plain Bun.
  const expected = await run([bun, "--no-install", "--conditions=aot", "main.ts"], join(folder, "app"));
  if (expected.signal || expected.late) return finding("plain Bun ends badly on the package with the condition", folder, seed, notes, expected.text);
  if (compilesAotFile.has(laying) && (expected.out !== installedPlain.out || expected.code !== installedPlain.code)) return finding("index.aot.ts prints something else than index.js", folder, seed, notes, firstDifference(installedPlain.out, expected.out));

  const build = await run([bun, "compile", ...flags, "./main.ts", "--outfile", "app", "--aot-report=report.json"], join(folder, "app"), 300);
  if (build.signal || build.late) return finding(build.late ? "the build hangs" : "the build ends by a signal", folder, seed, notes, build.text);
  if (build.code !== 0) {
    if (hasAotFile && mayStopTheBuild.has(laying) && expected.code !== 0 && /^error: /m.test(build.text)) return count(`${laying}: the build stops with an error, and plain Bun fails too`);
    return finding("the build is refused", folder, seed, notes, build.text);
  }
  const hasLostTypes = /TS1000(09|10): .*published/.test(build.text);
  // The statistic counts the files that kept their types. Behind `// @ts-nocheck` index.aot.ts is compiled without them, and the build says so.
  const isCompiledUnchecked = laying === "ts-nocheck in front" && /compiled without types/.test(build.text);
  const usesAotFile = hasLostTypes || isCompiledUnchecked || JSON.parse(readFileSync(join(folder, "app/report.json"), "utf8")).statistics.TypedVersionsUsed > 0;
  const compiledFrom = usesAotFile ? "index.aot.ts" + (hasLostTypes ? " without its types" : "") : laying === "the condition points at index.d.ts" ? "index.d.ts" : "index.js";
  count(`${laying}: compiled from ${compiledFrom}`);
  if (hasAotFile && !usesAotFile && compilesAotFile.has(laying)) return finding("index.aot.ts is not compiled", folder, seed, notes, build.text);
  if (usesAotFile && compilesJavaScript.has(laying)) return finding("index.aot.ts is compiled although nothing names it", folder, seed, notes, build.text);
  if (hasLostTypes && laying === "as written") count("THE TYPES ARE LOST OF A PACKAGE INSTALLED AS IT WAS WRITTEN: " + shapeOf(build.text.match(/warn[^\n]*/)?.[0] ?? "no warning"));
  const compiled = await run(["./app"], join(folder, "app"));
  if (compiled.signal || compiled.late) return finding(compiled.late ? "the executable hangs" : "the executable ends by a signal", folder, seed, notes, compiled.text);
  if (compiled.out !== expected.out || compiled.code !== expected.code) return finding("the executable prints something else", folder, seed, notes, firstDifference(expected.out, compiled.out));
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
