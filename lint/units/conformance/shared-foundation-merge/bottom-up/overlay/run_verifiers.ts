// Runs every surviving verifier of the upper prototypes in one tree and stores its output.
// usage: bun run.ts <tree root> <out dir> <gt-ebf binary> <gt-prefix binary> [only id prefix]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";

const [tree, out, gtEbf, gtPrefix, only] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const REF = "/workspace/ref/typescript-go";
const CASES = REF + "/_submodules/TypeScript/tests/cases";
const gunzipTo = (gz: string, to: string) => writeFileSync(to, gunzipSync(readFileSync(join(tree, gz))));

interface Task {
  id: string;
  cmd: string[];
  pre?: () => void;
  post?: () => string;
  test?: boolean;
  env?: Record<string, string>;
}
const b = (script: string, ...args: string[]) => ["bun", join(tree, script), ...args];
// A loaded machine makes a test that spawns a process pass the default limit of 5 s: the limit is no part of what is compared.
const t = (script: string) => ["bun", "test", "--timeout", "180000", join(tree, script)];
const cmpFile = (a: string, gz: string) => () => {
  const x = readFileSync(a);
  const y = gunzipSync(readFileSync(join(tree, gz)));
  return x.equals(y) ? `post: ${a.split("/").pop()} is byte-identical to ${gz}` : `post: ${a.split("/").pop()} DIFFERS from ${gz}`;
};
const canon = (x: any): any =>
  Array.isArray(x) ? x.map(canon) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canon(x[k])])) : x;
const cmpJson = (a: string, bPath: string) => () => {
  const x = JSON.parse(readFileSync(a, "utf8"));
  const y = JSON.parse(readFileSync(join(tree, bPath), "utf8"));
  let bad = 0;
  const names: string[] = [];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (JSON.stringify(canon(x[i])) !== JSON.stringify(canon(y[i]))) {
      bad++;
      names.push(x[i]?.name + (x[i]?.refused ? " [refused: " + x[i].refused + "]" : ""));
    }
  }
  return `post: records ${x.length} vs ${y.length}, differing ${bad}${bad ? ": " + names.join("; ") : ""}`;
};

const tasks: Task[] = [
  { id: "dg.verify_cases", cmd: b("directive-grammar/prototype/verify_cases.ts", CASES, join(out, "dg.cases.tsv")), post: cmpFile(join(out, "dg.cases.tsv"), "directive-grammar/vectors/cases.tsv.gz") },
  { id: "dg.verify_vectors", cmd: b("directive-grammar/prototype/verify_vectors.ts", join(tree, "directive-grammar/vectors/synthetic-inputs.json"), join(out, "dg.synth.json")), post: cmpJson(join(out, "dg.synth.json"), "directive-grammar/vectors/synthetic-expected.json") },
  { id: "en.verify_counts", cmd: b("enumerator/prototype/verify_counts.ts") },
  { id: "en.verify_names", cmd: b("enumerator/prototype/verify_names.ts") },
  { id: "en.verify_paths", pre: () => gunzipTo("enumerator/vectors/paths-sample.tsv.gz", join(out, "en.paths.tsv")), cmd: b("enumerator/prototype/verify_paths.ts", join(out, "en.paths.tsv")) },
  { id: "en.verify_reasons", pre: () => gunzipTo("enumerator/vectors/skip-reasons.tsv.gz", join(out, "en.reasons.tsv")), cmd: b("enumerator/prototype/verify_reasons.ts", join(out, "en.reasons.tsv")) },
  { id: "entd.make_vectors", cmd: b("enumerator-topdown/prototype/make_vectors.ts", REF, join(out, "entd.instances.tsv")), post: cmpFile(join(out, "entd.instances.tsv"), "enumerator-topdown/vectors/instances.tsv.gz") },
  { id: "ebf.p.roundtrip.all.auto.order", cmd: b("error-baseline-format/prototype/roundtrip.ts", "all", "auto", "order") },
  { id: "ebf.p.roundtrip.all.auto.full", cmd: b("error-baseline-format/prototype/roundtrip.ts", "all", "auto", "full") },
  { id: "ebf.p.selfcheck", cmd: b("error-baseline-format/prototype/selfcheck.ts") },
  { id: "ebf.p.readerfuzz", cmd: b("error-baseline-format/prototype/readerfuzz.ts", "2000", "1") },
  { id: "ebf.p.crosscheck.corpus", cmd: b("error-baseline-format/prototype/crosscheck.ts", "corpus", gtEbf) },
  { id: "ebf.p.crosscheck.fuzz", cmd: b("error-baseline-format/prototype/crosscheck.ts", "fuzz", gtEbf, "2000", "1") },
  { id: "ebf.p.crosscheck_tsc", cmd: b("error-baseline-format/prototype/crosscheck_tsc.ts", "1000", "1") },
  { id: "ebf.p.verify_units.go", cmd: b("error-baseline-format/prototype/verify_units.ts", "go") },
  { id: "ebf.p.verify_units.ts", cmd: b("error-baseline-format/prototype/verify_units.ts", "ts") },
  { id: "ebf.td.roundtrip.go.tsgo.direct", cmd: b("error-baseline-format/top-down/roundtrip.ts", "go", "tsgo", "direct") },
  { id: "ebf.td.roundtrip.go.tsgo.shape", cmd: b("error-baseline-format/top-down/roundtrip.ts", "go", "tsgo", "shape") },
  { id: "ebf.td.roundtrip.ts.tsc.direct", cmd: b("error-baseline-format/top-down/roundtrip.ts", "ts", "tsc", "direct") },
  { id: "ebf.td.roundtrip.ts.tsc.shape", cmd: b("error-baseline-format/top-down/roundtrip.ts", "ts", "tsc", "shape") },
  { id: "ebf.td.roundtrip.ts.tsgo.direct", cmd: b("error-baseline-format/top-down/roundtrip.ts", "ts", "tsgo", "direct") },
  { id: "ebf.td.roundtrip.godiff.tsgo.direct", cmd: b("error-baseline-format/top-down/roundtrip.ts", "godiff", "tsgo", "direct") },
  { id: "ebf.td.check_units.go", cmd: b("error-baseline-format/top-down/check_units.ts", "go") },
  { id: "ebf.td.check_units.ts", cmd: b("error-baseline-format/top-down/check_units.ts", "ts") },
  { id: "ebf.td.crosscheck_go.corpus", cmd: b("error-baseline-format/top-down/crosscheck_go.ts", gtEbf, "corpus") },
  { id: "ebf.td.crosscheck_go.fuzz", cmd: b("error-baseline-format/top-down/crosscheck_go.ts", gtEbf, "fuzz", "5000", "12345") },
  { id: "ebf.td.reader_fuzz.sane", cmd: b("error-baseline-format/top-down/reader_fuzz.ts", "3000", "1", "sane", "alone", "plain", "lf") },
  { id: "ebf.td.reader_fuzz.tricky", cmd: b("error-baseline-format/top-down/reader_fuzz.ts", "3000", "2", "tricky", "units", "all", "all") },
  { id: "im.verify_vectors", cmd: b("instance-materialisation/prototype/verify_vectors.ts", join(tree, "instance-materialisation/vectors/vectors.json.gz"), join(tree, "instance-materialisation/vectors/expected.json.gz")) },
  { id: "im.verify_split.tsgo", cmd: b("instance-materialisation/prototype/verify_split.ts", "tsgo") },
  { id: "im.verify_split.ts", cmd: b("instance-materialisation/prototype/verify_split.ts", "ts") },
  { id: "im.verify_materialise", cmd: b("instance-materialisation/prototype/verify_materialise.ts", join(out, "mat")) },
  { id: "im.verify_prefix", pre: () => mkdirSync("/tmp/im", { recursive: true }), cmd: b("instance-materialisation/prototype/verify_prefix.ts", gtPrefix) },
  { id: "imtd.verify_paths", cmd: b("instance-materialisation/top-down/prototype/verify_paths.ts") },
  { id: "imtd.verify_roots", cmd: b("instance-materialisation/top-down/prototype/verify_roots.ts") },
  { id: "imtd.verify_materialize", cmd: b("instance-materialisation/top-down/prototype/verify_materialize.ts") },
  { id: "imtd.to_file_name_lower_case", cmd: b("instance-materialisation/top-down/prototype/to_file_name_lower_case.ts") },
  { id: "ccds.p.verify_plain", cmd: b("check-contract-default-spawn/prototype/verify_plain.ts") },
  { id: "ccds.p.run_all", cmd: b("check-contract-default-spawn/prototype/run_all.ts") },
  { id: "ccds.p.run_utf16", cmd: b("check-contract-default-spawn/prototype/run_utf16.ts") },
  { id: "ccds.p.spawn.test", cmd: t("check-contract-default-spawn/prototype/spawn.test.ts"), test: true },
  { id: "ccds.td.plain.test", cmd: t("check-contract-default-spawn/top-down/plain.test.ts"), test: true },
  { id: "ccds.td.spawn.test", cmd: t("check-contract-default-spawn/top-down/spawn.test.ts"), test: true },
  { id: "ccds.td.manifest.test", cmd: t("check-contract-default-spawn/top-down/manifest.test.ts"), test: true },
  { id: "ccds.td.drive.replay", cmd: b("check-contract-default-spawn/top-down/drive.ts", "replay") },
  { id: "ccds.td.drive.empty", cmd: b("check-contract-default-spawn/top-down/drive.ts", "empty") },
  { id: "ccds.td.drive.plain", cmd: b("check-contract-default-spawn/top-down/drive.ts", "plain") },
  { id: "ccds.td.drive.plain-configured", cmd: b("check-contract-default-spawn/top-down/drive.ts", "plain-configured") },
  { id: "ccds.td.drive_spawn.operands", cmd: b("check-contract-default-spawn/top-down/drive_spawn.ts", "conformance/types/tuple", "operands") },
  { id: "ccds.td.drive_spawn.manifest", cmd: b("check-contract-default-spawn/top-down/drive_spawn.ts", "conformance/types/tuple", "manifest") },
  { id: "oe.bu.expectations.test", cmd: t("oracle-and-expectations/bottom-up/prototype/expectations.test.ts"), test: true },
  { id: "oe.bu.verify_list", cmd: b("oracle-and-expectations/bottom-up/prototype/verify_list.ts") },
  { id: "oe.td.selfcheck", cmd: b("oracle-and-expectations/top-down/prototype/selfcheck.ts") },
  { id: "tfs.td.conformance.test", cmd: t("test-file-and-sweep/top-down/conformance.test.ts"), test: true, env: { TFS_CHECK: "replay" } },
  { id: "tfs.bu.proto.test", cmd: t("test-file-and-sweep/bottom-up/prototype/proto.test.ts"), test: true },
  { id: "tfs.bu.proto2.test", cmd: t("test-file-and-sweep/bottom-up/prototype/proto2.test.ts"), test: true },
];

const summary: string[] = [];
for (const task of tasks) {
  if (only !== undefined && !task.id.startsWith(only)) continue;
  const file = join(out, task.id + ".out");
  if (existsSync(file) && process.env.FORCE !== "1") {
    summary.push(`${task.id}\tcached`);
    continue;
  }
  task.pre?.();
  const t0 = performance.now();
  const p = Bun.spawnSync(task.cmd, { cwd: tree, env: { ...process.env, ...(task.env ?? {}), NO_COLOR: "1", FORCE_COLOR: "0" }, stdout: "pipe", stderr: "pipe", timeout: 1800_000 });
  const ms = performance.now() - t0;
  let text = `$ ${task.cmd.join(" ").replaceAll(tree, "<tree>").replaceAll(out, "<out>")}\n--- stdout\n${p.stdout.toString()}\n--- stderr\n${p.stderr.toString()}\n--- exit ${p.exitCode}\n`;
  if (task.post && p.exitCode === 0) {
    try {
      text += task.post() + "\n";
    } catch (e) {
      text += "post: FAILED " + e + "\n";
    }
  }
  writeFileSync(file, text);
  const line = `${task.id}\texit ${p.exitCode}\t${(ms / 1000).toFixed(1)}s`;
  summary.push(line);
  console.log(line);
}
writeFileSync(join(out, "_summary.tsv"), summary.join("\n") + "\n");
