// The raw runs by suite under the rules of the default check: run, a result, the guard, what is near it, the causes.
import { readFileSync } from "node:fs";
const commandCodes = new Set(["syntax", "cannot-read-file", "unsupported-extension", "internal-error", "internal-stand-in"]);
const head = /^(?:(\S.*?)\((\d+),(\d+)\): )?(error|warning|suggestion|message) (?:TS(-?\d+)|([A-Za-z@][A-Za-z0-9@/_-]*)): (.*)$/s;
const rows = readFileSync("/tmp/dccbu/raw-release-full.jsonl", "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const out: Record<string, Record<string, number>> = {};
const add = (suite: string, key: string) => { (out[suite] ??= {})[key] = (out[suite][key] ?? 0) + 1; };
for (const r of rows) {
  for (const suite of [r.casePath.split("/")[0], "all"]) {
    add(suite, `run ${r.kind}`);
    if (r.exitCode === undefined) { add(suite, `${r.kind} unsupported (layout)`); continue; }
    add(suite, `${r.kind} a result`);
    if (r.signal || ![0, 2].includes(r.exitCode) || r.stdout) { add(suite, `${r.kind} crash`); continue; }
    const lines = r.stderr.split("\n").filter(Boolean).map((l: string) => head.exec(l));
    if (lines.some((m: unknown) => m === null)) { add(suite, `${r.kind} crash (stderr)`); continue; }
    const silent = r.exitCode === 0 && r.stderr === "";
    const failing = lines.filter((m: RegExpExecArray) => m[5] === undefined && (commandCodes.has(m[6]) || m[1] === undefined));
    const rules = lines.filter((m: RegExpExecArray) => m[5] === undefined && !commandCodes.has(m[6]) && m[1] !== undefined);
    if (silent) add(suite, `${r.kind} wrote nothing, exit code 0`);
    if (!silent && r.exitCode === 0) add(suite, `${r.kind} lines and exit code 0`);
    if (failing.length > 0) {
      const kinds = new Set(failing.map((m: RegExpExecArray) => m[6]));
      const cause = ["internal-error", "cannot-read-file", "unsupported-extension", "syntax"].find(k => kinds.has(k)) ?? "unknown code";
      add(suite, `${r.kind} fail: ${cause}`);
    } else if (r.kind === "C") {
      add(suite, `C pass${rules.length > 0 ? " (reports of rules left out)" : ""}`);
    } else add(suite, `E fail: nothing${rules.length > 0 ? " (reports of rules left out)" : ""}`);
  }
}
for (const [suite, counts] of Object.entries(out)) {
  console.log(suite);
  for (const [k, v] of Object.entries(counts).sort()) console.log(`  ${String(v).padStart(6)}  ${k}`);
}
