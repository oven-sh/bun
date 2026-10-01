// The sweep of lint-parse-visit.test.ts against any binary, without bun:test: counts, and one digest per mode.
// usage: <any bun> sweep.mjs <bun under test> [<repository root>]     (four children at a time)
// The digest of the normal mode must be the same before and after a change that is to leave the normal transpile alone.
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const exe = process.argv[2];
const root = process.argv[3] ?? join(import.meta.dir, "..", "..", "..", "..", "..", "..", "wt", "parser");
const started = performance.now();
const listed = Bun.spawnSync({ cmd: ["git", "-C", root, "ls-files", "-z", "--", "test", "src/js"], stdout: "pipe", stderr: "pipe" });
if (listed.exitCode !== 0) throw new Error("git ls-files: " + listed.stderr.toString());
const files = listed.stdout.toString().split("\0").filter(file => /\.(ts|tsx|mts|cts)$/.test(file));
const dir = mkdtempSync(join(tmpdir(), "lint-parse-visit-"));
copyFileSync(join(import.meta.dir, "worker.js"), join(dir, "worker.js"));
const sentinel = "let x: (a: ) => void;\n";
const shardCount = 4;
const shards = Array.from({ length: shardCount }, () => []);
files.forEach((file, index) => shards[index % shardCount].push([index, file]));
const env = { ...process.env, BUN_DEBUG_QUIET_LOGS: "1", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", NO_COLOR: "1" };
for (const key of Object.keys(env)) if (key.startsWith("BUN_DEBUG_") && key !== "BUN_DEBUG_QUIET_LOGS") delete env[key];
async function run(shard, lint) {
  const name = `${shard}.${lint ? "lint" : "normal"}`;
  writeFileSync(join(dir, `${shard}.list.json`), JSON.stringify({ root, sentinel, files: shards[shard] }));
  const proc = Bun.spawn({
    cmd: [exe, "worker.js", `${shard}.list.json`, `${name}.jsonl`],
    cwd: dir,
    env: lint ? { ...env, BUN_DEBUG_TEST_LINT_PARSE_THEN_VISIT: "1" } : env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  let text = "";
  try { text = readFileSync(join(dir, `${name}.jsonl`), "utf8"); } catch {}
  const records = text.split("\n").filter(Boolean).map(line => JSON.parse(line));
  return { name, records, stderr, exitCode, signalCode: proc.signalCode };
}
const name = record => `${files[record.index] ?? "<sentinel>"}${record.config ? " (experimental decorators with metadata)" : ""}`;
const counts = { files: files.length, equal: 0, rejectedByBoth: 0, decorated: 0, decoratedEqual: 0 };
const differing = [], onlyWithoutLint = [], onlyWithLint = [], crashed = [], sentinels = [];
const digests = { normal: new Bun.CryptoHasher("sha256"), lint: new Bun.CryptoHasher("sha256") };
for (let first = 0; first < shardCount; first += 2) {
  const pair = [first, first + 1].filter(shard => shard < shardCount);
  const results = await Promise.all(pair.flatMap(shard => [run(shard, false), run(shard, true)]));
  for (let k = 0; k < results.length; k += 2) {
    const [normal, lint] = [results[k], results[k + 1]];
    for (const child of [normal, lint]) {
      const last = child.records.at(-1);
      if (child.exitCode !== 0 || last === undefined || "start" in last)
        crashed.push({ child: child.name, exitCode: child.exitCode, signalCode: child.signalCode, at: last && "start" in last ? name({ index: last.start, config: last.config }) : "outside a file", stderr: child.stderr.slice(-2000) });
    }
    for (const [mode, child] of [["normal", normal], ["lint", lint]])
      for (const record of child.records) if ("index" in record && record.index !== -1) digests[mode].update(JSON.stringify(record) + "\n");
    for (let i = 1; i < Math.min(normal.records.length, lint.records.length); i += 2) {
      const [n, l] = [normal.records[i], lint.records[i]];
      if (n.index === -1) { sentinels.push({ normal: n.code ?? n.errors, lint: l.code ?? l.errors }); continue; }
      if (n.config) counts.decorated++;
      if (n.code !== undefined && l.code !== undefined) {
        if (n.code === l.code) { if (n.config) counts.decoratedEqual++; else counts.equal++; continue; }
        let at = 0; while (n.code[at] === l.code[at]) at++;
        differing.push({ file: name(n), at, normal: n.code.slice(Math.max(0, at - 80), at + 80), lint: l.code.slice(Math.max(0, at - 80), at + 80) });
      } else if (n.code !== undefined) {
        onlyWithoutLint.push({ file: name(n), code: l.errors.map(message => /^TS(\d+): /.exec(message)?.[1]).find(Boolean) ?? "no code", errors: l.errors });
      } else if (l.code !== undefined) {
        onlyWithLint.push({ file: name(n), errors: n.errors });
      } else if (!n.config) counts.rejectedByBoth++;
    }
  }
}
rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify({ ...counts, differing: differing.length, onlyWithoutLint: onlyWithoutLint.length, onlyWithLint: onlyWithLint.length, crashed: crashed.length, normalDigest: digests.normal.digest("hex"), lintDigest: digests.lint.digest("hex"), ms: Math.round(performance.now() - started) }));
console.log("sentinels " + JSON.stringify(sentinels));
for (const [label, list] of [["crashed", crashed], ["differing", differing], ["parsed only without lint", onlyWithoutLint], ["parsed only with lint", onlyWithLint]])
  for (const entry of list) console.log(label + " " + JSON.stringify(entry));
