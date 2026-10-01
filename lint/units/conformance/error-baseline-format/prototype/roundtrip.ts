// Round trip of every error baseline through the reader and the writer: write(read(bytes)) against bytes.
// usage: bun roundtrip.ts [ts|go|all] [tsgo|tsc|auto] [order|full] [--list-failures] [--show name]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { type Diagnostic, compareDiagnostics } from "./diagnosticwriter";
import { type Rules, getErrorBaseline } from "./error_baseline";
import { BaselineReadError, type ParsedDiagnostic, readErrorBaseline } from "./reader";

const TS = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/baselines/reference";
const GO = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";

function list(dir: string): string[] {
  return readdirSync(dir)
    .filter(f => f.endsWith(".errors.txt"))
    .sort()
    .map(f => join(dir, f));
}

const which = process.argv[2] ?? "all";
const rulesArg = (process.argv[3] ?? "auto") as Rules | "auto";
const compareArg = process.argv[4] ?? "order";
const showIndex = process.argv.indexOf("--show");
const show = showIndex >= 0 ? process.argv[showIndex + 1] : undefined;
const outIndex = process.argv.indexOf("--out");
const out = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;

const sets: [string, string[]][] = [];
if (which === "ts" || which === "all") sets.push(["ts", list(TS)]);
if (which === "go" || which === "all") sets.push(["go", [...list(join(GO, "compiler")), ...list(join(GO, "conformance"))]]);

const byOrder = (a: Diagnostic, b: Diagnostic): number => (a as ParsedDiagnostic).order - (b as ParsedDiagnostic).order;
const compare = compareArg === "full" ? compareDiagnostics : byOrder;

interface Outcome {
  ok: boolean;
  rules: Rules;
  reason: string;
  ambiguities: string[];
  failedChecks: string[];
}

function tryRules(text: string, rules: Rules): Outcome {
  try {
    const parsed = readErrorBaseline(text, { rules });
    const written = getErrorBaseline(parsed.files, parsed.diagnostics, compare, parsed.pretty, rules);
    if (written.text === text) return { ok: true, rules, reason: "", ambiguities: parsed.ambiguities, failedChecks: written.failedChecks };
    let at = 0;
    while (at < text.length && at < written.text.length && text[at] === written.text[at]) at++;
    const line = text.slice(0, at).split("\r\n").length;
    return {
      ok: false,
      rules,
      reason: `differs at byte ${at} (line ${line}): expected ${JSON.stringify(text.slice(Math.max(0, at - 30), at + 50))} got ${JSON.stringify(written.text.slice(Math.max(0, at - 30), at + 50))}`,
      ambiguities: parsed.ambiguities,
      failedChecks: written.failedChecks,
    };
  } catch (e) {
    if (e instanceof BaselineReadError) return { ok: false, rules, reason: "read: " + e.message, ambiguities: [], failedChecks: [] };
    return { ok: false, rules, reason: "throw: " + (e as Error).message + "\n" + (e as Error).stack, ambiguities: [], failedChecks: [] };
  }
}

const report: Record<string, unknown> = {};
for (const [name, files] of sets) {
  let pass = 0;
  const byRules: Record<string, number> = { tsgo: 0, tsc: 0 };
  const failures: { file: string; reason: string }[] = [];
  const needTsc: { file: string; reason: string }[] = [];
  const ambiguous: { file: string; notes: string[] }[] = [];
  const checks: { file: string; notes: string[] }[] = [];
  for (const f of files) {
    if (show !== undefined && basename(f) !== show) continue;
    const text = readFileSync(f).toString("latin1");
    let outcome: Outcome;
    if (rulesArg === "auto") {
      const first = tryRules(text, "tsgo");
      if (first.ok) {
        outcome = first;
      } else {
        const second = tryRules(text, "tsc");
        outcome = second.ok ? second : { ...first, reason: `tsgo: ${first.reason}\n      tsc: ${second.reason}` };
        if (second.ok) needTsc.push({ file: basename(f), reason: first.reason });
      }
    } else {
      outcome = tryRules(text, rulesArg);
    }
    if (outcome.ok) {
      pass++;
      byRules[outcome.rules]++;
      if (outcome.ambiguities.length > 0) ambiguous.push({ file: basename(f), notes: outcome.ambiguities });
      if (outcome.failedChecks.length > 0) checks.push({ file: basename(f), notes: outcome.failedChecks });
    } else {
      failures.push({ file: basename(f), reason: outcome.reason });
    }
  }
  console.log(`== ${name}: ${pass} of ${files.length} round trip (tsgo rules ${byRules.tsgo}, tsc rules ${byRules.tsc}); ${failures.length} fail`);
  for (const x of failures.slice(0, show !== undefined ? 100 : 40)) console.log(`  FAIL ${x.file}: ${x.reason.slice(0, 600)}`);
  if (rulesArg === "auto") {
    console.log(`  need the tsc rules: ${needTsc.length}`);
    for (const x of needTsc) console.log(`    ${x.file}: ${x.reason.slice(0, 300)}`);
  }
  console.log(`  with ambiguities: ${ambiguous.length}`);
  for (const x of ambiguous.slice(0, 20)) console.log(`    ${x.file}: ${x.notes.join("; ")}`);
  console.log(`  with failed checks of the writer: ${checks.length}`);
  for (const x of checks.slice(0, 20)) console.log(`    ${x.file}: ${x.notes.join("; ")}`);
  report[name] = { total: files.length, pass, byRules, failures, needTsc, ambiguous, checks };
}
if (out !== undefined) writeFileSync(out, JSON.stringify(report, null, 1));
