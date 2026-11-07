// Runs the worlds of write-loads.ts as test runs: `bun test --isolate --aot` against `bun test --isolate`, a project for each row of deeds, and holds what each world printed against the reference, world by world.
// run-alone.ts wraps a program in one test file and counts every difference of a program with files as an order of loads. Here the test files are the worlds, and none observes an order.
//
//   bun run-loads.ts --bun <the Bun that builds and runs> --work <folder> --finds <folder> [--seconds 3600] [--whole] [--share 1/8] [--rows 2,3] [--in-company 50] [--only <part of a name>]
//
// Without `--whole` it draws: a row of two or three deeds (`--rows`), 50 of 100 in company. `--whole` takes every row once, alone and in company, `--share 1/8` the first of eight equal parts of them.
// THE ORACLE: compiled gives an answer that the reference gives. Where a world parts, both run twice more. Where the reference wavers, it runs 40 times in all, and a find is an answer that is none of its answers.
// What it keeps under --finds is laid out as run-batch.ts lays it out: <kind>-<hash of the words>/<size as a power of two>/{project.txt, report.txt}, and index.txt. project.txt holds the files of the one world
// behind `// @filename: ./<path>`. It prints a line with {"taken": n, ..} for every 20 projects, as run-batch.ts does for each batch.
import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { rowsOfDeeds, writeProject, type Deed, type Project } from "./write-loads.ts";

const { values: options } = parseArgs({
  // lane.ts hands every driver what run-batch.ts takes.
  strict: false,
  allowPositionals: true,
  options: {
    bun: { type: "string", default: process.execPath },
    work: { type: "string" },
    finds: { type: "string" },
    seconds: { type: "string", default: "0" },
    whole: { type: "boolean", default: false },
    share: { type: "string", default: "1/1" },
    rows: { type: "string", default: "2,3" },
    "in-company": { type: "string", default: "50" },
    only: { type: "string", default: "" },
  },
});
const { bun, work, finds } = options as Record<string, string>;
if (!work || !finds) throw new Error("Expected --work and --finds");
const folder = join(work, `loads-${process.pid}`);
mkdirSync(finds, { recursive: true });

type Run = { worlds: Map<string, string>; end: string; stderr: string };
async function run(more: string[]): Promise<Run> {
  const child = Bun.spawn({
    cmd: [bun, "test", "--isolate", ...more, "./p"],
    cwd: folder,
    env: { ...process.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", NO_COLOR: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 600_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  // A world prints lines that begin with the number of a deed, and a last line that names it.
  const worlds = new Map<string, string>();
  let lines: string[] = [];
  for (const line of stdout.split("\n")) {
    if (line.startsWith("== END ")) {
      worlds.set(line.slice(7), lines.join("\n"));
      lines = [];
    } else if (/^[1-9] /.test(line)) lines.push(line);
  }
  return { worlds, end: child.signalCode ?? String(exitCode), stderr: stderr.slice(-4000) };
}
const reference = () => run([]);
const compiled = () => run(["--aot"]);

function keepFind(kind: string, summary: string, files: Record<string, string>) {
  const group = `${kind}-${Bun.hash
    .crc32(summary.replace(/[0-9a-f]/g, ""))
    .toString(16)
    .padStart(8, "0")}`;
  const name = `${group}/${Math.floor(Math.log2(Math.max(1, Object.values(files)[0].length)))}`;
  if (existsSync(join(finds, name))) return;
  mkdirSync(join(finds, name), { recursive: true });
  for (const [file, text] of Object.entries(files)) writeFileSync(join(finds, name, file), text.slice(0, 256 << 10));
  appendFileSync(join(finds, "index.txt"), name + "\n");
}

const counts: Record<string, number> = { taken: 0 };
const add = (kind: string, count = 1) => (counts[kind] = (counts[kind] ?? 0) + count);
let started = performance.now();
function tell() {
  console.log(
    `${new Date().toISOString().slice(11, 19)} ${(counts.taken / ((performance.now() - started) / 1000)).toFixed(1)} worlds a second | ${JSON.stringify(counts)}`,
  );
  for (const kind in counts) counts[kind] = 0;
  started = performance.now();
}

function firstDifference(ours: string | undefined, plain: string | undefined) {
  const [left, right] = [(ours ?? "").split("\n"), (plain ?? "").split("\n")];
  const line = Math.max(0, left.findIndex((each, at) => each !== right[at])); // prettier-ignore
  return `compiled: ${ours === undefined ? "it did not come to its end" : (left[line] ?? "")}\nbun test: ${plain === undefined ? "it did not come to its end" : (right[line] ?? "")}\n`;
}

async function judge(project: Project) {
  rmSync(folder, { recursive: true, force: true });
  for (const [path, text] of Object.entries(project.files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }
  const written = Object.keys(project.files).filter(path => path.includes("/main.test.")).map(path => path.split("/")[1]); // prettier-ignore
  counts.taken += written.length;
  const [plain, ours] = [await reference(), await compiled()];
  const parts = (name: string) => plain.worlds.get(name) !== ours.worlds.get(name);
  const hasDied = /^SIG/.test(ours.end) || Number(ours.end) >= 128;
  add("neither comes to its end", written.filter(name => !plain.worlds.has(name) && !ours.worlds.has(name)).length);
  // A run that dies takes along the worlds behind the one that killed it. They are not judged: the files run in the order of the reference, and the first that lacks its end stands for the death.
  const killer = hasDied ? [...plain.worlds.keys()].find(name => !ours.worlds.has(name)) : undefined;
  const isBehindTheDeath = (name: string) => hasDied && !ours.worlds.has(name) && name !== killer;
  add("not judged, behind a death", written.filter(isBehindTheDeath).length);
  const parting = written.filter(name => parts(name) && !isBehindTheDeath(name));
  add("same", written.filter(name => !parts(name)).length);
  if (!parting.length) return;
  const references = [plain, await reference(), await reference()];
  const again = [ours, await compiled(), await compiled()];
  const wavers = (runs: Run[], name: string) => runs.some(each => each.worlds.get(name) !== runs[0].worlds.get(name));
  if (parting.some(name => wavers(references, name))) while (references.length < 40) references.push(await reference());
  for (const name of parting) {
    const given = new Set(references.map(each => each.worlds.get(name)));
    const isNoAnswerOfTheReference = again.filter(each => !given.has(each.worlds.get(name)));
    if (!isNoAnswerOfTheReference.length) {
      add("an answer that the reference gives now and then");
      continue;
    }
    const kind = name === killer ? "signal" : wavers(again, name) ? "unsteady" : "stdout";
    add(kind);
    const summary = firstDifference(isNoAnswerOfTheReference[0].worlds.get(name), plain.worlds.get(name));
    const isOfTheWorld = (path: string) => path === "package.json" || path.startsWith(`p/${name}/`) || path.startsWith("p/zz-company/"); // prettier-ignore
    const text = Object.entries(project.files).filter(([path]) => isOfTheWorld(path)).map(([path, text]) => `// @filename: ./${path}\n${text}`).join(""); // prettier-ignore
    // One find for a row of deeds and the deed at which it parts: the files beside it are many, and the cause is mostly one.
    const partsAt = /^bun test: (\d [a-z-]+)/m.exec(summary)?.[1] ?? "";
    keepFind(
      `loads-${kind}`,
      `${project.name.replace(/--in-company$/, "")} ${partsAt}`.replace(/[a-f]/g, letter => letter.toUpperCase()),
      {
        "project.txt": text,
        "report.txt": `loads-${kind}: ${project.name}, the world ${name}: bun test --isolate --aot ./p against bun test --isolate ./p, in a project of ${written.length} worlds that do the same deeds\n${bun} test --isolate --aot ./p\n${summary}compiled ended with ${ours.end}; the reference gave ${given.size} answer${given.size > 1 ? "s" : ""} in ${references.length} runs, compiled ${new Set(again.map(each => each.worlds.get(name))).size} in ${again.length}\n${hasDied ? ours.stderr : ""}`,
      },
    );
  }
}

const rows: Deed[][] = options.rows!.split(",").flatMap(count => [...rowsOfDeeds(Number(count) as 2 | 3)]); // prettier-ignore
const lastStart = Number(options.seconds) ? performance.now() + Number(options.seconds) * 1000 : Infinity;
function* everyProject() {
  const [part, parts] = options.share!.split("/").map(Number);
  let at = 0;
  for (const inCompany of [false, true]) for (const row of rows) if (at++ % parts === part - 1) yield writeProject(row, inCompany); // prettier-ignore
}
function* drawnProjects() {
  for (;;) yield writeProject(rows[Math.floor(Math.random() * rows.length)], Math.random() * 100 < Number(options["in-company"])); // prettier-ignore
}
let judged = 0;
for (const project of options.whole ? everyProject() : drawnProjects()) {
  if (performance.now() >= lastStart) break;
  if (!project || !project.name.includes(options.only!)) continue;
  await judge(project);
  if (++judged % 20 === 0) tell();
}
if (counts.taken) tell();
rmSync(folder, { recursive: true, force: true });
