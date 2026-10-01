// Reads a report of sweep.ts and says, per class of the oracle, what each instance came to: the command printed nothing, it printed a
// diagnostic whose code is a name (which the default check throws on, so the sweep counts it as "crash"), or it really died or hung.
// usage: bun classify-report.ts <report.json> [--list]
import { readFileSync } from "node:fs";

interface Entry {
  kind: "E" | "C";
  casePath: string;
  outcome: string;
  reason: string;
}
const report = JSON.parse(readFileSync(process.argv[2], "utf8")) as {
  check: string;
  seconds: number;
  totals: unknown;
  instances: Record<string, Entry>;
};
const list = process.argv.includes("--list");

const named = /^the check threw: Error: stderr line \d+ has the code ([A-Za-z@][A-Za-z0-9@/_-]*), which is no code of TypeScript$/;
function classOf(e: Entry): string {
  if (e.outcome === "pass") return "pass";
  if (e.outcome === "fail") return e.reason.startsWith("no diagnostic where") ? "silent (E: nothing printed)" : "fail: other";
  if (e.outcome === "unsupported") return "unsupported: " + e.reason.replace(/:.*/s, "");
  if (e.outcome === "timeout") return "HANG: timeout";
  if (e.outcome === "unavailable" || e.outcome === "provisional" || e.outcome === "skip") return e.outcome;
  if (e.outcome !== "crash") return e.outcome;
  const m = named.exec(e.reason);
  if (m !== null) return `printed a named code: ${m[1]}`;
  const r = e.reason.replace(/^the check threw: Error: /, "");
  if (r.startsWith("the command reports an error of its own")) return "printed internal-error";
  if (r.startsWith("the command ended by the signal")) return "CRASH: " + r.slice(0, 60);
  if (r.startsWith("the command ended with the exit code")) return "CRASH: " + r.slice(0, 60);
  if (r.startsWith("the command refused: error: ")) return "refused (exit code 1)";
  // The exit code of a memory error under AddressSanitizer is 1 as well.
  if (r.startsWith("the command refused: ")) return "CRASH: exit code 1 without a refusal";
  if (r.startsWith("the command wrote to stdout")) return "CRASH: wrote to stdout";
  if (r.startsWith("the command did not end in time")) return "HANG: did not end in time";
  if (/^stderr line \d+ is /.test(r)) return "CRASH: stderr of no known form";
  if (r.startsWith("the exit code is ")) return "CRASH: exit code and stderr disagree";
  if (/^stderr line \d+ names a file/.test(r)) return "printed a file that is not of the instance";
  return "crash: other: " + r.slice(0, 80);
}

const counts = new Map<string, { E: number; C: number }>();
const shown: string[] = [];
for (const [name, e] of Object.entries(report.instances)) {
  const c = classOf(e);
  const cell = counts.get(c) ?? { E: 0, C: 0 };
  cell[e.kind]++;
  counts.set(c, cell);
  const real = c.startsWith("CRASH") || c.startsWith("HANG") || c.startsWith("crash: other") || c === "fail: other";
  if (real || (list && e.kind === "C" && c !== "pass" && !c.startsWith("unsupported"))) {
    shown.push(`${c}\t${e.kind}\t${name}\t${e.casePath}\t${e.reason.slice(0, 200)}`);
  }
}
const all = Object.values(report.instances);
console.log(`check ${report.check}; ${all.length} instances ran (E ${all.filter(e => e.kind === "E").length}, C ${all.filter(e => e.kind === "C").length}); ${report.seconds} s`);
for (const [c, n] of [...counts].sort((a, b) => b[1].E + b[1].C - a[1].E - a[1].C)) {
  console.log(`${String(n.E + n.C).padStart(6)}  E ${String(n.E).padStart(5)}  C ${String(n.C).padStart(5)}  ${c}`);
}
if (shown.length > 0) console.log("\n" + shown.sort().join("\n"));
