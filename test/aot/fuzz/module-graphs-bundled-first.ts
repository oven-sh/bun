// Module graphs of both kinds (generated/module-graphs-of-both-kinds.ts), each written into one file by `bun build --target=bun` first.
// The bundle wraps files in `__commonJS(..)` and `__esm(..)` functions that run them at the first call. The bundle built with --aot has to
// print what the bundle prints under `bun run`.
//
//   bun module-graphs-bundled-first.ts --bun <bun> --work <folder> --out <folder> [--seconds 300] [--jobs 8] [--seed 1] [--flags "<flags of the --aot build>"] [--most 7] [--esbuild <path of the esbuild command>]
//
//   the bundle   in the ES module format or the CommonJS format, minified or not, as one file or split into chunks (`--splitting`)
//   the bundler  Bun; with --esbuild, esbuild for every second seed: its wrappers are written in another way
//   many         one seed in eight joins 40 to 400 graphs into one entry point, so that one file holds hundreds of wrappers; the time of its build is printed
//
// A finding: a command that ends by a signal or runs out of its time, a build with --aot that fails, an executable that prints something else.
// One folder per finding in --out, at most three of one kind and first difference.
import { spawn } from "bun";
import { cpSync, mkdirSync, renameSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { program } from "../generated/module-graphs-of-both-kinds";
import { Random } from "./random";

const argument = (name: string, otherwise?: string) => {
  const at = process.argv.indexOf("--" + name);
  if (at > 0) return process.argv[at + 1];
  if (otherwise === undefined) throw new Error(`--${name} is missing`);
  return otherwise;
};
const bun = argument("bun", process.execPath);
const work = argument("work");
const out = argument("out");
const until = Date.now() + Number(argument("seconds", "300")) * 1000;
const flags = argument("flags", "").split(" ").filter(Boolean);
const most = Number(argument("most", "7"));
const esbuild = argument("esbuild", "");
let seed = Number(argument("seed", "1"));
const environment = { ...process.env, BUN_ENABLE_CRASH_REPORTING: "0", DO_NOT_TRACK: "1", NO_COLOR: "1" };

async function run(argv: string[], cwd: string, seconds: number) {
  const started = Date.now();
  const child = spawn(argv, { cwd, env: environment, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  let late = false;
  const timer = setTimeout(() => ((late = true), child.kill("SIGKILL")), seconds * 1000);
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  await child.exited;
  clearTimeout(timer);
  const ended = late ? "out of time" : child.signalCode ? String(child.signalCode) : "exit " + child.exitCode;
  return { stdout, stderr, ended, seconds: (Date.now() - started) / 1000 };
}

let programs = 0;
let skipped = 0;
let findings = 0;
let slowest = 0;
let classesMovedUp = 0;
// The build moves a class without side effects to the top of its file, as Bun's transpiler does. Plain Bun leaves a file marked `// @bun` as it is,
// so a module that reads such a class early gets a ReferenceError there and the class in the executable.
const isClassMovedUp = (plain: string, compiled: string) =>
  plain.endsWith(" throws ReferenceError") &&
  compiled.startsWith(plain.slice(0, -"throws ReferenceError".length) + "function{");
const kinds = new Map<string, number>();
mkdirSync(join(out, "findings"), { recursive: true });

function keep(folder: string, sources: string, mine: number, kind: string, said: string) {
  const count = (kinds.get(kind) ?? 0) + 1;
  kinds.set(kind, count);
  findings++;
  console.log(`seed ${mine}: ${kind}: ${said.split("\n").slice(0, 3).join(" | ").slice(0, 400)}`);
  if (count > 3) return;
  const kept = join(out, "findings", `${kind.replace(/[^a-z0-9]+/gi, "-").slice(0, 80)}-${mine}`);
  rmSync(kept, { recursive: true, force: true });
  cpSync(folder, kept, { recursive: true, filter: path => !path.endsWith("/exe") });
  cpSync(sources, join(kept, "src"), { recursive: true });
  writeFileSync(join(kept, "said.txt"), kind + "\n" + said);
}

async function one(mine: number) {
  const r = new Random(mine);
  const folder = join(work, "graph-" + mine);
  const sources = join(work, "sources-" + mine);
  rmSync(folder, { recursive: true, force: true });
  rmSync(sources, { recursive: true, force: true });
  mkdirSync(join(folder, "src"), { recursive: true });
  const many = r.chance(1 / 8) ? r.pick([40, 100, 200, 400]) : 1;
  let entry = "";
  if (many === 1) {
    const graph = program(mine, most);
    if (graph.importsBesideTheRest) return void (skipped++, rmSync(folder, { recursive: true, force: true }));
    for (const [name, text] of Object.entries({ ...graph.files, [graph.file]: graph.text }))
      writeFileSync(join(folder, "src", name), text);
    entry = graph.file;
  } else {
    const lines: string[] = [];
    for (let at = 0; at < many; at++) {
      const graph = program(mine * 1000 + at, 4);
      if (graph.importsBesideTheRest || graph.requiresWhatAwaits) continue;
      mkdirSync(join(folder, "src", "g" + at), { recursive: true });
      for (const [name, text] of Object.entries({ ...graph.files, [graph.file]: graph.text }))
        writeFileSync(join(folder, "src", "g" + at, name), text);
      // Each graph ends in a timer. How long an `import()` takes beside a timer is not part of the language, so the next graph waits.
      lines.push(`await import("./g${at}/${graph.file}");\nawait new Promise(resolve => setTimeout(resolve, 10));`);
    }
    entry = "main.mjs";
    writeFileSync(join(folder, "src", entry), lines.join("\n") + "\n");
  }
  const format = r.pick(["esm", "esm", "cjs"]);
  const shape = [
    ...(r.chance(0.25) ? ["--minify"] : r.chance(0.2) ? ["--minify-syntax"] : []),
    ...(format === "esm" && r.chance(0.2) ? ["--splitting"] : []),
  ];
  const byEsbuild = esbuild !== "" && mine % 2 === 1;
  const bundling = await run(
    byEsbuild
      ? [
          esbuild,
          join("src", entry),
          "--bundle",
          "--platform=node",
          "--format=" + format,
          "--log-level=error",
          ...shape,
          "--outdir=bundle",
        ]
      : [bun, "build", "--target=bun", "--format=" + format, ...shape, join("src", entry), "--outdir", "bundle"],
    folder,
    120,
  );
  // A graph that the bundler itself rejects says nothing about --aot.
  if (bundling.ended !== "exit 0") return void (skipped++, rmSync(folder, { recursive: true, force: true }));
  const file = join("bundle", entry.replace(/\.[a-z]+$/, ".js"));
  // The sources go out of the way: a bundle that still loads one of them from disk (createRequire, module.require) fails here and is left out,
  // and so is a bundle that is no valid program (`import.meta` in the CommonJS format).
  renameSync(join(folder, "src"), sources);
  const plain = await run([bun, file], folder, 60);
  if (plain.ended !== "exit 0")
    return void (skipped++,
    rmSync(sources, { recursive: true, force: true }),
    rmSync(folder, { recursive: true, force: true }));
  programs++;
  const notes = `${byEsbuild ? "esbuild" : "bun build"} format ${format} ${shape.join(" ")} graphs ${many}\n`;
  const build = await run([bun, "build", "--compile", "--aot", ...flags, file, "--outfile", "exe"], folder, 600);
  slowest = Math.max(slowest, build.seconds);
  if (many > 1 || build.seconds > 30)
    console.log(`seed ${mine}: ${many} graphs in one file: built in ${build.seconds.toFixed(1)} s`);
  if (build.ended !== "exit 0")
    keep(
      folder,
      sources,
      mine,
      build.ended.startsWith("exit") ? "build fails" : "build " + build.ended,
      notes + build.stderr.slice(-4000) + build.stdout.slice(-2000),
    );
  else {
    const compiled = await run([join(folder, "exe")], folder, 120);
    if (!compiled.ended.startsWith("exit"))
      keep(folder, sources, mine, "run " + compiled.ended, notes + compiled.stderr.slice(-4000));
    else if (compiled.stdout !== plain.stdout || compiled.ended !== plain.ended) {
      const a = plain.stdout.split("\n");
      const b = compiled.stdout.split("\n");
      const movedUp = a
        .filter((line, index) => isClassMovedUp(line, b[index] ?? ""))
        .map(line => line.slice(0, -" throws ReferenceError".length));
      // A member of such a class is read early too.
      const isOfClassMovedUp = (line: string) =>
        line.endsWith(" throws ReferenceError") &&
        movedUp.some(label => line.startsWith(label + ".") || line.startsWith(label + " "));
      const at = a.findIndex((line, index) => line !== b[index] && !isOfClassMovedUp(line));
      if (at < 0 && a.length === b.length && compiled.ended === plain.ended) classesMovedUp++;
      else
        keep(
          folder,
          sources,
          mine,
          "prints something else",
          `${notes}plain ${plain.ended}, compiled ${compiled.ended}; line ${at + 1}\nplain:    ${a[at]}\ncompiled: ${b[at]}\n--- stderr of the executable\n${compiled.stderr.slice(-2000)}`,
        );
    }
  }
  rmSync(folder, { recursive: true, force: true });
  rmSync(sources, { recursive: true, force: true });
}

await Promise.all(
  Array.from({ length: Number(argument("jobs", "8")) }, async () => {
    while (Date.now() < until) await one(seed++);
  }),
);
console.log(
  `programs ${programs} skipped ${skipped} findings ${findings} classes moved up ${classesMovedUp} slowest build ${slowest.toFixed(1)} s next seed ${seed}`,
);
