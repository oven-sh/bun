// Raw survey: every run instance of the corpus through `<bin> --lint <operands>`, as the default check spawns it; what came back is written as it is.
// usage: bun raw.ts <bin> <out.jsonl> [jobs] [timeoutMs] [every-nth]
import { realpathSync, rmSync, mkdtempSync, appendFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openCorpus } from "/tmp/dcc-scratch/test/cli/lint/conformance/runner";
import { toRealPath } from "/tmp/dcc-scratch/test/cli/lint/conformance/runner/materialise";
import { getNormalizedAbsolutePath } from "/tmp/dcc-scratch/test/cli/lint/conformance/runner/tspath";

const [bin, outPath, jobsArg = "4", timeoutArg = "60000", nthArg = "1"] = process.argv.slice(2);
const jobs = Number(jobsArg);
const timeoutMs = Number(timeoutArg);
const nth = Number(nthArg);
const corpus = openCorpus("/tmp/dcc-scratch/test/cli/lint/conformance/corpus");
const run = corpus
  .enumerateInstances()
  .filter(i => i.status === "run")
  .filter((_, k) => k % nth === 0);
const base = mkdtempSync(join(realpathSync.native(tmpdir()), "dcc-raw-"));
writeFileSync(outPath, "");
const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
env.BUN_FEATURE_FLAG_EXPERIMENTAL_LINT = "1";
env.BUN_DEBUG_QUIET_LOGS = "1";
env.NO_COLOR = "1";
delete env.FORCE_COLOR;
delete env.BUN_OPTIONS;
for (const extra of (process.env.DCC_ENV ?? "").split(";;").filter(x => x !== "")) {
  const eq = extra.indexOf("=");
  env[extra.slice(0, eq)] = extra.slice(eq + 1);
}

let next = 0;
let done = 0;
const started = performance.now();
async function worker() {
  for (let k = next++; k < run.length; k = next++) {
    const i = run[k];
    const root = join(base, k.toString(36));
    const rec: any = { name: i.name, kind: i.oracle.class, casePath: i.casePath };
    try {
      const built = corpus.input(i, root);
      if (!built.ok) {
        rec.notLaid = built.reason;
      } else {
        const real = realpathSync.native(resolve(root));
        const cd = getNormalizedAbsolutePath(built.input.currentDirectory, "/");
        const operands = built.input.rootFiles.map(name => toRealPath(real, getNormalizedAbsolutePath(name, cd)));
        const cwd = realpathSync.native(toRealPath(real, cd));
        rec.roots = built.input.rootFiles;
        const t = performance.now();
        const proc = Bun.spawn({
          cmd: [bin, "--lint", ...operands],
          cwd,
          env,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          timeout: timeoutMs,
          killSignal: "SIGKILL",
        });
        const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        rec.ms = Math.round(performance.now() - t);
        rec.exitCode = proc.exitCode;
        rec.signal = proc.signalCode;
        rec.timedOut = rec.ms >= timeoutMs && proc.signalCode !== null;
        rec.stdout = stdout.length > 2000 ? stdout.slice(0, 2000) : stdout;
        rec.stderrBytes = stderr.length;
        rec.stderr = (stderr.length > 40000 ? stderr.slice(0, 30000) + "\n<<<cut>>>\n" + stderr.slice(-10000) : stderr).replaceAll(real, "");
      }
    } catch (error) {
      rec.threw = String(error);
    } finally {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {}
    }
    appendFileSync(outPath, JSON.stringify(rec) + "\n");
    if (++done % 1000 === 0) console.error(`${done} of ${run.length}, ${Math.round((performance.now() - started) / 1000)} s`);
  }
}
await Promise.all(Array.from({ length: jobs }, worker));
rmSync(base, { recursive: true, force: true });
console.log(`done ${done} in ${Math.round((performance.now() - started) / 1000)} s`);
