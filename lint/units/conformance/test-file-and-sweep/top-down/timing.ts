// Research probe: what each part of the test file costs, for a release build and for a debug build.
// usage: <bun> timing.ts [full] [spawn]
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const t00 = performance.now();
const r = await import("./index");
const tImport = performance.now() - t00;
const full = process.argv.includes("full");
const spawn = process.argv.includes("spawn");
const out: Record<string, number | string> = { version: Bun.version, importMs: Math.round(tImport) };
const time = <T>(label: string, f: () => T): T => {
  const t = performance.now();
  const v = f();
  out[label] = Math.round(performance.now() - t);
  return v;
};
const cpu0 = process.cpuUsage();
const layout = r.referenceLayout();

const cases = time("listCases sorted (12444)", () => r.listCases(layout.casesRoot));
const index = time("indexCases unsorted", () => r.indexCases(layout.casesRoot));
out.cases = cases.length;
out.indexed = index.size;

const sampleCases = cases.filter((_, k) => k % 40 === 0);
const sampleInstances = time(`enumerateCase x${sampleCases.length} (every 40th case)`, () => sampleCases.flatMap(c => r.enumerateCase(layout.casesRoot, c)));
out.sampleInstances = sampleInstances.length;

time("enumerate one directory (conformance/types/tuple)", () => r.enumerateInstances({ casesRoot: layout.casesRoot, only: "conformance/types/tuple" }));

const corpus = time("loadCorpus (reference layout: 2 big directories)", () => r.loadCorpus(layout));

const run = sampleInstances.filter(i => i.status === "run");
out.sampleRun = run.length;
const inputs = time(`inputOf x${run.length}`, () => run.map(i => r.inputOf(i, { layout })).flatMap(x => (x.ok ? [x.input] : [])));
const oracles = new Map<string, ReturnType<typeof r.runOracleOf>>();
time("read oracles of the sample", () => {
  for (const i of inputs) oracles.set(i.name, r.runOracleOf(corpus, i.suite, i.name));
});
const oracle = (i: { name: string }) => oracles.get(i.name)!;
{
  const t = performance.now();
  const replay = await r.runInstances(inputs, r.replayCheck(oracle), { oracle });
  out[`replay check x${inputs.length}`] = Math.round(performance.now() - t);
  out.replayPass = replay.filter(x => x.status === "pass").length;
  const t2 = performance.now();
  const empty = await r.runInstances(inputs, r.emptyCheck(), { oracle });
  out[`empty check x${inputs.length}`] = Math.round(performance.now() - t2);
  out.emptyPass = `E ${empty.filter(x => x.status === "pass" && x.kind === "E").length} C ${empty.filter(x => x.status === "pass" && x.kind === "C").length}`;
}

const eFiles = [...oracles.values()].flatMap(o => (o.kind === "E" ? [o.path] : []));
out.sampleBaselines = eFiles.length;
time(`round trip x${eFiles.length}`, () => {
  for (const p of eFiles) if (!r.roundTrip(readFileSync(p)).equal) throw new Error("round trip differs: " + p);
});

if (full) {
  const e = time("enumerateInstances (all)", () => r.enumerateInstances({ casesRoot: layout.casesRoot }));
  out.instances = e.instances.length;
  time("factsOf (all)", () => e.instances.map(i => r.factsOf(corpus, i)));
}

if (spawn) {
  const dir = mkdtempSync(join(tmpdir(), "tfs-timing-"));
  const env = { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" } as Record<string, string>;
  const one = async (cmd: string[]) => {
    const p = Bun.spawn({ cmd, env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
  };
  let t = performance.now();
  for (let k = 0; k < 5; k++) await one([process.execPath, "--version"]);
  out["spawn --version, each"] = Math.round((performance.now() - t) / 5);
  const fake = new URL("../../check-contract-default-spawn/top-down/fakes/lints.ts", import.meta.url).pathname;
  await Bun.write(dir + "/a.ts", "const x: number = 1;\n");
  t = performance.now();
  for (let k = 0; k < 5; k++) await one([process.execPath, fake, "--lint", dir + "/a.ts"]);
  out["spawn fake linter, each"] = Math.round((performance.now() - t) / 5);
  t = performance.now();
  await Promise.all(Array.from({ length: 8 }, () => one([process.execPath, fake, "--lint", dir + "/a.ts"])));
  out["spawn fake linter, 8 at once, total"] = Math.round(performance.now() - t);
  t = performance.now();
  const check = r.createSpawnCheck({ command: [process.execPath, fake], env });
  const some = run.slice(0, 8).map(i => r.inputOf(i, { layout, materialiseBelow: dir + "/m" })).flatMap(x => (x.ok ? [x.input] : []));
  const results = await r.runInstances(some, check, { oracle, concurrency: 8, loose: true });
  out[`spawn check x${some.length} with the probe`] = Math.round(performance.now() - t);
  out.spawnStatuses = [...new Set(results.map(x => x.status))].join(",");
  rmSync(dir, { recursive: true, force: true });
}
const cpu = process.cpuUsage(cpu0);
out.cpuUserMs = Math.round(cpu.user / 1000);
out.cpuSystemMs = Math.round(cpu.system / 1000);
console.log(JSON.stringify(out, null, 1));
