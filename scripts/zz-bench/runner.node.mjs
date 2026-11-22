// Temporary: times the binaries of two builds of main and two of this branch on one machine, in turns.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";

const windows = process.platform === "win32";
const root = join(import.meta.dirname, "../..");
const work = mkdtempSync(join(tmpdir(), "zz-bench-"));
const [step, minutes] = process.argv.slice(2);
const env = { ...process.env, NO_COLOR: "1", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", PUPPETEER_SKIP_DOWNLOAD: "1" };
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 1 << 28, cwd: root, env, ...options });
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(" ")}: ${result.error ?? result.status}\n${result.stdout}${result.stderr}`);
  return result;
}

const builds = {
  main1: "01a201c1-e2c0-482f-a4a4-ab5b9731e7bc",
  pr1: "01a201cc-cb4b-4e38-8a1f-ceb4323cb2e3",
  main2: "01a201c1-e2c0-482f-a4a4-ab5b9731e7bc",
  pr2: process.env.BUILDKITE_BUILD_ID,
};
const binaries = process.env.ZZ_LOCAL ? JSON.parse(process.env.ZZ_LOCAL) : {};
for (const [name, build] of process.env.ZZ_LOCAL ? [] : Object.entries(builds)) {
  const folder = join(work, name);
  mkdirSync(folder);
  const target = step.replace(/-build-bun$/, "");
  run("buildkite-agent", ["artifact", "download", `bun-${target}.zip`, folder, "--step", step, "--build", build]);
  const zip = join(
    folder,
    readdirSync(folder, { recursive: true }).find(file => file.endsWith(".zip")),
  );
  if (windows) run(join(process.env.SystemRoot, "System32/tar.exe"), ["-xf", zip, "-C", folder]);
  else run("unzip", ["-q", zip, "-d", folder]);
  binaries[name] = join(folder, `bun-${target}`, windows ? "bun.exe" : "bun");
  chmodSync(binaries[name], 0o755);
}
if (!process.env.ZZ_LOCAL) run(binaries.main2, ["install"]);

writeFileSync(join(work, "check.ts"), `export const a: Map<string, Promise<number[]>> = new Map();\n`);
writeFileSync(join(work, "rss.js"), `require("http");require("fs");console.log(process.memoryUsage.rss())`);
const tsc = [join(root, "node_modules/typescript/lib/_tsc.js"), "--noEmit", "--target", "esnext", "check.ts"];
const big = join(root, "node_modules/typescript/lib/typescript.js");
const program = join(import.meta.dirname, "program.mjs");
const exe = name => join(work, `program-${name}${windows ? ".exe" : ""}`);
function time(times, action) {
  let best = Infinity;
  for (let i = 0; i < times; i++) {
    const start = process.hrtime.bigint();
    action();
    best = Math.min(best, Number(process.hrtime.bigint() - start));
  }
  return best;
}
const whole = {
  "process: start": bun => time(40, () => run(bun, ["-e", "0"])),
  "process: start, node modules": bun => time(20, () => run(bun, [join(work, "rss.js")])),
  "process: memory at start": bun => Number(run(bun, [join(work, "rss.js")]).stdout),
  "process: tsc": bun => time(2, () => run(bun, tsc, { cwd: work })),
  "process: tsc without JIT": bun => time(1, () => run(bun, tsc, { cwd: work, env: { ...env, BUN_JSC_useJIT: "0" } })),
  "process: prettier": bun =>
    time(2, () => run(bun, ["node_modules/prettier/bin/prettier.cjs", "src/js/node/fs.ts", "src/js/node/net.ts"])),
  "process: bundle typescript.js": bun =>
    time(2, () => run(bun, ["build", big, "--minify", "--sourcemap", "--target=node", "--outdir", join(work, "out")])),
  "process: compile ahead of time": (bun, name) =>
    time(1, () => run(bun, ["build", "--compile", "--aot", program, "--outfile", exe(name)])),
  "process: compiled program": (_, name) => time(3, () => run(exe(name), [])),
};

console.log(`ZZ machine ${JSON.stringify({ step, cpu: cpus()[0].model, cores: cpus().length })}`);
for (const [name, bun] of Object.entries(binaries)) console.log(`ZZ binary ${name} ${run(bun, ["--revision"]).stdout}`);
const names = Object.keys(binaries);
const said = new Set();
const say = text => text.trim() && !said.has(text) && said.add(text) && console.log(`ZZ note ${text.slice(0, 600)}`);
const deadline = Date.now() + Number(minutes) * 60_000;
for (let round = 0, took = 0; round === 0 || Date.now() + took < deadline; round++) {
  const start = Date.now();
  for (const name of names.map((_, i) => names[(i * (round % 2 ? -1 : 1) + round + names.length) % names.length])) {
    const row = {};
    try {
      const { stdout, stderr } = run(binaries[name], [join(import.meta.dirname, "cases.mjs")], { timeout: 180_000 });
      Object.assign(row, JSON.parse(stdout));
      say(stderr);
    } catch (error) {
      say(String(error));
    }
    for (const [key, action] of Object.entries(whole)) {
      try {
        row[key] = action(binaries[name], name);
      } catch (error) {
        say(`${key}: ${error}`);
      }
    }
    console.log(`ZZ row ${name} ${JSON.stringify(row)}`);
  }
  took = Date.now() - start;
}
console.log("ZZ done. This step fails on purpose: the commit is temporary.");
process.exit(1);
