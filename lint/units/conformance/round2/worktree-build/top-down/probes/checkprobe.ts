// Runs the runner's own default check (probe + createSpawnCheck) against the real debug binary,
// with hand-made instances, to see what the runner makes of the real output. Nothing is written to the repository.
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSpawnCheck, probe } from "/workspace/wt/conformance/test/cli/lint/conformance/runner/check_bun_lint.ts";

const BIN = process.env.PROBE_BIN ?? "/workspace/wt/conformance/build/debug/bun-debug";
const env: Record<string, string | undefined> = { PATH: process.env.PATH, HOME: process.env.HOME };
if (process.env.PROBE_ASAN) env.ASAN_OPTIONS = process.env.PROBE_ASAN;
if (process.env.PROBE_LSAN) env.LSAN_OPTIONS = process.env.PROBE_LSAN;

const t0 = performance.now();
console.log("probe:", JSON.stringify(await probe({ command: [BIN], env })), `${Math.round(performance.now() - t0)} ms`);

const check = createSpawnCheck({ command: [BIN], env });
const cases: [string, Record<string, string>][] = [
  ["clean ts", { "/.src/a.ts": "export const x: number = 1;\n" }],
  ["type error only", { "/.src/a.ts": 'let a: number = "s";\n' }],
  ["syntax error ts", { "/.src/a.ts": "const = ;\n" }],
  ["warning only ts", { "/.src/a.ts": "let x = 1;\n--> legacy\n" }],
  ["js with debugger", { "/.src/a.js": "debugger;\n" }],
  ["json root", { "/.src/a.json": "{}\n" }],
  ["d.ts with syntax error", { "/.src/a.d.ts": "const = ;\n" }],
  ["two units", { "/.src/a.ts": "export const x = 1;\n", "/.src/b.ts": 'import { x } from "./a";\nx;\n' }],
];
for (const [name, files] of cases) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "conf-wb-1b-check-")));
  for (const [virtual, text] of Object.entries(files)) {
    const real = root + virtual;
    mkdirSync(real.slice(0, real.lastIndexOf("/")), { recursive: true });
    writeFileSync(real, text);
  }
  const input: any = {
    instance: { name: name + ".ts", status: "run", oracle: { class: "C" } },
    root,
    currentDirectory: "/.src",
    rootFiles: Object.keys(files),
    otherFiles: [],
    units: [],
    symlinks: [],
    options: {},
  };
  const started = performance.now();
  try {
    const result = await check(input, new AbortController().signal);
    console.log(`${name}: returned ${JSON.stringify(result)} (${Math.round(performance.now() - started)} ms)`);
  } catch (error) {
    console.log(`${name}: THREW ${String(error)} (${Math.round(performance.now() - started)} ms)`);
  }
}
