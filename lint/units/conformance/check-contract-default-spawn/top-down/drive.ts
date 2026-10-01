// Research prototype: every run instance of the reference through the checks that need no command.
// usage: bun drive.ts <replay|empty|plain|plain-configured> [directory below the cases]
import { emptyCheck, plainReplayCheck, replayCheck } from "./checks";
import { buildInputs, oracleOf } from "./inputs";
import { type RunResult, runInstances } from "./run";

const which = process.argv[2] ?? "replay";
const only = process.argv[3];
const t0 = performance.now();
const built = buildInputs({ only });
const t1 = performance.now();
const cache = new Map<string, ReturnType<typeof oracleOf>>();
const oracle = (i: { name: string; suite: "compiler" | "conformance" }) => {
  const key = i.suite + "/" + i.name;
  let o = cache.get(key);
  if (o === undefined) cache.set(key, (o = oracleOf(i)));
  return o;
};
const check =
  which === "replay" ? replayCheck(oracle)
  : which === "empty" ? emptyCheck()
  : plainReplayCheck(oracle, which === "plain-configured");
const results = await runInstances(built.inputs, check, { oracle, concurrency: 1, loose: true });
const t2 = performance.now();
const count: Record<string, number> = {};
const examples: Record<string, string[]> = {};
for (const r of results) {
  const key = `${r.kind} ${r.status}${r.level !== undefined ? " at " + r.level : ""}${r.loose !== undefined ? (r.loose.equal ? ", loose equal" : ", loose differs") : ""}`;
  count[key] = (count[key] ?? 0) + 1;
  if (r.status !== "pass") {
    const why = `${key}: ${(r.loose?.reason || r.reason).replace(/\d+/g, "n").slice(0, 90)}`;
    (examples[why] ??= []).push(r.suite + "/" + r.name);
  }
}
console.log(`check ${check.name}: ${built.inputs.length} inputs, ${built.skipped} skipped, ${built.unsplit.length} not split`);
console.log(`build ${Math.round(t1 - t0)} ms, run ${Math.round(t2 - t1)} ms`);
console.log(JSON.stringify(count, null, 1));
for (const [why, names] of Object.entries(examples).sort((a, b) => b[1].length - a[1].length).slice(0, 12)) {
  console.log(`  ${names.length}  ${why}   e.g. ${names.slice(0, 3).join(", ")}`);
}
for (const u of built.unsplit.slice(0, 5)) console.log("  not split:", u);
const firstFail = results.find((r: RunResult) => r.status === "fail" && r.diff !== undefined && which !== "empty");
if (firstFail !== undefined) console.log(`first diff, ${firstFail.suite}/${firstFail.name}: ${firstFail.reason}\n${firstFail.diff}`);
