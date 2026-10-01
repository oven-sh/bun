// Probe of the runner side of proposal (d): options through one variable, the report through a file, one process per instance.
// usage: bun report_roundtrip.ts <bun executable> <instances> <at a time>
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const [exe, countText, widthText] = process.argv.slice(2);
const count = Number(countText), width = Number(widthText);
const dir = mkdtempSync(join(tmpdir(), "nlc-report-"));
const fake = join(import.meta.dir, "fake_report_lint.ts");
const source = join(dir, "min.ts");
writeFileSync(source, 'const x: number = "s";\n');
const longList = Array.from({ length: 40 }, (_, i) => `es20${String(15 + (i % 10))}.part${i}`);
const options = {
  compilerOptions: { noErrorTruncation: true, newLine: "crlf", skipDefaultLibCheck: true, target: "es2015", strict: false, lib: longList, jsxFactory: 'a"b\\c', outDir: join(dir, "out dir/ü/日本") },
  libDirectory: join(dir, "libs"),
};
const sent = JSON.stringify(options);
async function one(i: number, extra: Record<string, string | undefined>) {
  const report = join(dir, `report-${i}.json`);
  const env = { ...process.env, BUN_DEBUG_QUIET_LOGS: "1", NO_COLOR: "1", FORCE_COLOR: undefined, BUN_OPTIONS: undefined, BUN_INTERNAL_LINT_OPTIONS: sent, BUN_INTERNAL_LINT_REPORT: report, ...extra };
  const proc = Bun.spawn({ cmd: [exe, fake, source], env, cwd: dir, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, report };
}
const first = await one(0, {});
const parsed = JSON.parse(readFileSync(first.report, "utf8"));
const echoEqual = JSON.stringify(parsed.options) === sent;
const refused = await one(1, { BUN_INTERNAL_LINT_OPTIONS: '{"compilerOptions":{"noSuchOptionForTheProbe":true}}' });
let next = 2;
const started = performance.now();
await Promise.all(Array.from({ length: width }, async () => {
  while (next < count + 2) {
    const r = await one(next++, {});
    JSON.parse(readFileSync(r.report, "utf8"));
  }
}));
const wallMs = performance.now() - started;
console.log(JSON.stringify({
  bytesOfTheVariable: Buffer.byteLength(sent),
  exitCode: first.exitCode,
  stdoutEmpty: first.stdout === "",
  stderrLines: first.stderr.split("\n").filter(Boolean).length,
  optionsComeBackEqual: echoEqual,
  diagnosticsInReport: parsed.diagnostics.length,
  unknownOption: { exitCode: refused.exitCode, namesIt: refused.stderr.includes("noSuchOptionForTheProbe") },
  instances: count, atATime: width, wallMs: Math.round(wallMs), msEach: +(wallMs / count).toFixed(1),
}));
rmSync(dir, { recursive: true, force: true });
