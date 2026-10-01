// usage: bun raw.ts <bin> <out.jsonl> <jobs> <timeoutMs> <nth> <offset>
import { realpathSync, rmSync, mkdtempSync, appendFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openCorpus } from "/tmp/dcc-scratch/test/cli/lint/conformance/runner";
import { toRealPath } from "/tmp/dcc-scratch/test/cli/lint/conformance/runner/materialise";
import { getNormalizedAbsolutePath } from "/tmp/dcc-scratch/test/cli/lint/conformance/runner/tspath";

const [bin, outPath, jobsArg = "4", timeoutArg = "60000", nthArg = "1", offArg = "0"] = process.argv.slice(2);
const jobs = Number(jobsArg), timeoutMs = Number(timeoutArg), nth = Number(nthArg), off = Number(offArg);
const corpus = openCorpus("/tmp/dcc-scratch/test/cli/lint/conformance/corpus");
const t0 = performance.now();
const run = corpus.enumerateInstances().filter(i => i.status === "run").filter((_, k) => k % nth === off);
console.error(`enumerated in ${Math.round(performance.now() - t0)} ms: ${run.length} instances`);
const base = mkdtempSync(join(realpathSync.native(tmpdir()), "dccbu-raw-"));
writeFileSync(outPath, "");
const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
env.BUN_FEATURE_FLAG_EXPERIMENTAL_LINT = "1";
env.BUN_DEBUG_QUIET_LOGS = "1";
env.NO_COLOR = "1";
delete env.FORCE_COLOR;
delete env.BUN_OPTIONS;
let next = 0, done = 0;
const started = performance.now();
async function worker() {
  for (let k = next++; k < run.length; k = next++) {
    const i = run[k];
    const root = join(base, k.toString(36));
    const rec: any = { name: i.name, kind: i.oracle.class, casePath: i.casePath };
    try {
      const built = corpus.input(i, root);
      if (!built.ok) rec.notLaid = built.reason;
      else {
        const real = realpathSync.native(resolve(root));
        const cd = getNormalizedAbsolutePath(built.input.currentDirectory, "/");
        const operands = built.input.rootFiles.map(name => toRealPath(real, getNormalizedAbsolutePath(name, cd)));
        const cwd = realpathSync.native(toRealPath(real, cd));
        rec.roots = built.input.rootFiles;
        rec.cwd = built.input.currentDirectory;
        const t = performance.now();
        const proc = Bun.spawn({ cmd: [bin, "--lint", ...operands], cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: timeoutMs, killSignal: "SIGKILL" });
        const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        rec.ms = Math.round(performance.now() - t);
        rec.exitCode = proc.exitCode;
        rec.signal = proc.signalCode;
        rec.stdout = stdout.slice(0, 2000);
        rec.stderrBytes = stderr.length;
        rec.stderr = (stderr.length > 40000 ? stderr.slice(0, 30000) + "\n<<<cut>>>\n" + stderr.slice(-10000) : stderr).replaceAll(real, "");
      }
    } catch (error) {
      rec.threw = String(error);
    } finally {
      try { rmSync(root, { recursive: true, force: true }); } catch {}
    }
    appendFileSync(outPath, JSON.stringify(rec) + "\n");
    done++;
  }
}
await Promise.all(Array.from({ length: jobs }, worker));
rmSync(base, { recursive: true, force: true });
console.log(`done ${done} in ${Math.round((performance.now() - started) / 1000)} s`);
