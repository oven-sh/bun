// One lane of ../burst.ts that runs run-batch.ts. It takes what ../run.ts takes from burst.ts and leaves the same files in --out, so burst.ts treats both alike.
//
//   bun test/aot/fuzz/fuzzilli/lane.ts --kind few --minutes 60 --jobs 8 --out /tmp/lane
//
//   --kind <name>   which programs are drawn and how many share a build: one of `kinds` below
//   --minutes <n>   how long (default 60); a file STOP in --out ends it sooner
//   --jobs <n>      how many drivers run side by side (default 4). A driver builds on one thread and runs one program at a time, so it fills about one core.
//                   Every second one draws TypeScript, the others JavaScript
//   --out <folder>  status.txt ("programs <n>", rewritten every 20 s), findings.tsv (a line for each find, in the columns of ../run.ts), as-tests/ (each find as a file of ../../parallel),
//                   finds/ (what run-batch.ts keeps: the program, both outputs and a report), logs/<driver>.log
//   --bun <path>    the Bun under test (default: the one that runs this script)
//   what else stands on the command line goes to every driver, behind the options of the kind
//
// The programs are drawn here, so nothing is needed but Bun. Where `unshare` can make a network of its own, the drivers run in one that reaches nothing: a drawn program may name any host.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeProgram, type Program } from "../beds";

const drawn = "--group 1 --ordinary-scenes 100 --milliseconds 1000 --ends-early 100";
const rewritten =
  "--hands-over-built-ins 50 --prints-into-a-text 60 --prints-members 70 --one-scene 25 --hooks-fail 30 --names-of-globals 15 --unwraps-try-blocks 35";
/** What a build proves of a small program it doesn't prove beside many others, and a build of many judges four times as many programs in the same time. Each kind has found what the others missed. */
const kinds: Record<string, string> = {
  few: `${drawn} --count 1 --together 50 --few-to-a-build 100 --families 25 --slow 10 --ignores-type-errors 100 --compares-errors --options-of-the-project 30`,
  many: `${drawn} ${rewritten} --count 400 --together 32 --scenes-of-every-size 50 --families 50 --validates 25 --collects 100`,
  packages: `${drawn} ${rewritten} --count 4,12,40 --splits 100 --validates 50 --collects 100`,
  external: `${drawn} ${rewritten} --count 400 --together 32 --scenes-of-every-size 50 --families 60 --beside-an-external 100 --collects 100`,
};
/** Kept for a list of their own, not as finds: what an executable built without --aot does too, the end of a time or memory limit, an answer that changes from run to run, and what shows in a validating build alone. */
const quiet = /^(?:as-an-executable-without---aot|limit|unsteady|validation|validating-build-stopped)-/;

const words = process.argv.slice(2);
function taken(name: string): string | undefined {
  const at = words.indexOf(`--${name}`);
  if (at >= 0) return words.splice(at, 2)[1];
}
const kind = taken("kind") ?? "few";
const minutes = Number(taken("minutes") ?? 60);
const jobs = Number(taken("jobs") ?? 4);
const out = taken("out");
const bun = taken("bun") ?? process.execPath;
if (!out || !(kind in kinds)) {
  console.error(
    `usage: bun test/aot/fuzz/fuzzilli/lane.ts --kind ${Object.keys(kinds).join("|")} --minutes <n> --jobs <n> --out <folder> [--bun <path>]`,
  );
  process.exit(1);
}

for (const folder of ["finds", "logs", "work"]) mkdirSync(join(out, folder), { recursive: true });
const alone =
  process.platform === "linux" &&
  Bun.spawnSync({ cmd: ["unshare", "-Urn", "true"], stdio: ["ignore", "ignore", "ignore"] }).exitCode === 0
    ? ["unshare", "-Urn"]
    : [];
const drivers = Array.from({ length: jobs }, (_, index) =>
  Bun.spawn({
    cmd: [...alone, process.execPath, join(import.meta.dir, "run-batch.ts"), "--bun", bun, "--work", join(out, "work", String(index)), "--finds", join(out, "finds"), "--batches", "0", "--seconds", String(minutes * 60), "--flags=--aot-threads=1", "--draws", index % 2 ? "js" : "ts", ...kinds[kind].split(" "), ...words], // prettier-ignore
    cwd: join(out, "work"),
    env: {
      ...process.env,
      BUN_ENABLE_CRASH_REPORTING: "0",
      DO_NOT_TRACK: "1",
      NO_COLOR: "1",
      BUN_DEBUG_QUIET_LOGS: "1",
    },
    stdio: ["ignore", Bun.file(join(out, "logs", `${index}.log`)), Bun.file(join(out, "logs", `${index}.errors`))],
  }),
);

const programs = () =>
  readdirSync(join(out, "logs"))
    .filter(name => name.endsWith(".log"))
    .flatMap(name => [...readFileSync(join(out, "logs", name), "latin1").matchAll(/\{"taken":(\d+)/g)])
    .reduce((sum, [, count]) => sum + Number(count), 0);
/** run-batch.ts keeps a find as <kind>-<hash of its words>/<size of the program, as a power of two>: one cause at several sizes. The smallest program of each stands for it. */
const kept = () => {
  const smallest = new Map<string, number>();
  const index = join(out, "finds", "index.txt");
  for (const name of existsSync(index) ? readFileSync(index, "utf8").split("\n").filter(Boolean) : []) {
    const [stem, size] = name.split("/");
    smallest.set(stem, Math.min(smallest.get(stem) ?? Infinity, Number(size)));
  }
  return [...smallest].map(([stem, size]) => `${stem}/${size}`);
};
const status = () =>
  writeFileSync(join(out, "status.txt"), `programs ${programs()} finds ${kept().filter(name => !quiet.test(name)).length} kept beside them ${kept().filter(name => quiet.test(name)).length}\n`); // prettier-ignore
// A batch that is under way at the end of the time is given two minutes more.
const last = Date.now() + minutes * 60_000 + 120_000;
const watch = setInterval(() => {
  status();
  if (existsSync(join(out, "STOP")) || Date.now() > last) for (const driver of drivers) driver.kill();
}, 20_000);
await Promise.all(drivers.map(driver => driver.exited));
clearInterval(watch);
status();

// Each find in the columns of ../run.ts: when, bed, mode, binary, kind, what is guilty, source, name, detail, how to run it again.
const lines: string[] = [];
for (const name of kept().filter(name => !quiet.test(name))) {
  const folder = join(out, "finds", name);
  const file = readdirSync(folder).find(each => each.startsWith("program."));
  const report = readFileSync(join(folder, "report.txt"), "latin1").split("\n");
  const stem = name.replace(/\/\d+$/, "");
  const flags = (/ --aot (.*)$/.exec(report[1] ?? "")?.[1] ?? "")
    .split(" ")
    .filter(flag => flag && flag !== "--aot-threads=1");
  const text = file ? readFileSync(join(folder, file), "latin1") : "";
  if (file && text) {
    // Behind a line "// @filename: ./<path>" stands a further file of the program.
    const [main, ...others] = text.split(/^\/\/ @filename: \.\/(\S+)\n/m);
    const files = Object.fromEntries(others.flatMap((path, index) => (index % 2 ? [] : [[path, others[index + 1]]])));
    writeProgram(join(out, "as-tests"), stem, {
      text: (flags.length ? `// Flags: ${flags.join(" ")}\n` : "") + main,
      extension: file.slice("program.".length) as Program["extension"],
      ...(others.length ? { files } : {}),
    });
  }
  lines.push(
    [new Date().toISOString(), "product", kind, bun, stem.replace(/-[0-9a-f]{8}$/, ""), "", `fuzzilli/${kind}`, stem, report[0].slice(0, 300), `${folder}: report.txt says how it was built and what both printed`].join("\t"), // prettier-ignore
  );
}
writeFileSync(join(out, "findings.tsv"), lines.map(line => line + "\n").join(""));
