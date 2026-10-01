// Research prototype: the batch form against the command that stands for a linter.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { tsgoRules } from "../../error-baseline-format/top-down/diagnosticwriter";
import { getErrorBaseline } from "../../error-baseline-format/top-down/error_baseline";
import { type Diagnostic, toWriterInput } from "../../error-baseline-format/top-down/shape";
import type { CheckInput, MaterialiseResult } from "./check";
import { createManifestCheck } from "./manifest";
import { type Oracle, runInstances } from "./run";

const env = { ...process.env } as Record<string, string | undefined>;
const command = [process.execPath, join(import.meta.dir, "fakes", "lints.ts")];
const base = mkdtempSync(join(realpathSync(tmpdir()), "ccds-manifest-"));
process.on("exit", () => rmSync(base, { recursive: true, force: true }));
let made = 0;

function inputOf(name: string, files: Record<string, string>, roots = Object.keys(files)): CheckInput {
  const all = Object.entries(files).map(([n, content]) => ({ name: "/.src/" + n, content }));
  const id = made++;
  return {
    name, suite: "compiler", casePath: name, configuration: {}, compilerOptions: { noErrorTruncation: true },
    defaultOptions: { newLine: "crlf", skipDefaultLibCheck: true }, captureSuggestions: false, useCaseSensitiveFileNames: true,
    currentDirectory: "/.src", configFile: undefined,
    roots: all.filter(f => roots.includes(f.name.slice(6))), otherFiles: all.filter(f => !roots.includes(f.name.slice(6))),
    rootNames: roots.map(r => "/.src/" + r), links: [], includeLibDirectory: false,
    materialise(): MaterialiseResult {
      const root = `${base}/${id}`;
      for (const f of all) {
        mkdirSync(dirname(root + f.name), { recursive: true });
        writeFileSync(root + f.name, f.content);
      }
      return { ok: true, value: { root, currentDirectory: root + "/.src", rootNames: roots.map(r => `${root}/.src/${r}`), toReal: v => root + v,
        toVirtual: p => (p.startsWith(root + "/") ? p.slice(root.length) : undefined), mapText: t => t.replaceAll(root + "/", "/").replaceAll(root, "/") } };
    },
  };
}

function oracleFor(input: CheckInput, diagnostics: Diagnostic[]): Oracle {
  if (diagnostics.length === 0) return { kind: "C" };
  const files = [...input.roots, ...input.otherFiles].map(f => ({ unitName: f.name, content: f.content }));
  const w = toWriterInput(tsgoRules, files, diagnostics);
  return { kind: "E", bytes: tsgoRules.model.toBytes(getErrorBaseline(tsgoRules, w.files, w.diagnostics, false).text), path: "" };
}

const wanted: Diagnostic = {
  category: "error", code: 2322, messageText: "Type 'string' is not assignable to type 'number'.",
  next: [{ messageText: "A line of the chain." }],
  location: { file: "/.src/a.ts", start: 6, length: 1, line: 1, character: 7 },
  relatedInformation: [{ code: 6500, messageText: "The expected type comes from here.", location: { file: "/.src/a.ts", start: 9, length: 6, line: 1, character: 10 } }],
};
const order = (d: Diagnostic) => "//~ diag " + JSON.stringify(d).replaceAll('"/.src/a.ts"', '"{file}"') + "\n";

test("one process, many instances, each failure at its instance", async () => {
  const good = inputOf("a.ts", { "a.ts": 'const x: number = "s";\n' + order(wanted) });
  const oracle = oracleFor(good, [wanted]);
  const inputs = [
    good,
    inputOf("clean.ts", { "clean.ts": "const y = 1;\n" }),
    inputOf("killed.ts", { "killed.ts": "//~ kill SIGKILL\n" }),
    inputOf("after.ts", { "after.ts": "const z = 1;\n" }),
    inputOf("refused.ts", { "refused.ts": "//~ refuse configFile is not supported\n" }),
    inputOf("raw.ts", { "raw.ts": "//~ raw Bun has crashed\n" }),
    inputOf("standin.ts", { "standin.ts": "//~ standin checker.getTypeOfExpression\n" }),
    inputOf("unknown.ts", { "unknown.ts": '//~ raw {"id":"7","diagnostics":[],"standIns":[],"extra":1}\n' }),
    inputOf("exit.ts", { "exit.ts": "//~ exit 0\n" }),
    inputOf("last.ts", { "last.ts": "const = ;\n" }),
  ];
  const check = createManifestCheck({ command, env, directory: base + "/manifests" });
  const results = await runInstances(inputs, check, { oracle: i => (i.name === "a.ts" ? oracle : { kind: "C" }) });
  expect(results.map(r => [r.name, r.status, r.level ?? "", r.reason])).toEqual([
    ["a.ts", "pass", "baseline", ""],
    ["clean.ts", "pass", "baseline", ""],
    ["killed.ts", "error", "", "crash: the command ended by the signal SIGKILL"],
    ["after.ts", "pass", "baseline", ""],
    ["refused.ts", "error", "", "refusal: the command refused: configFile is not supported"],
    ["raw.ts", "error", "", "protocol: the line of the report: no JSON"],
    ["standin.ts", "provisional", "baseline", "reached 1 stand-ins"],
    ["unknown.ts", "error", "", "protocol: the line of the report: the unknown field extra"],
    ["exit.ts", "error", "", "protocol: the command ended after 0 of 1 lines"],
    ["last.ts", "fail", "baseline", "2 diagnostics where the oracle has none, the first is TS1005: Expected identifier but found \"=\""],
  ]);
});

test("a thousand instances in four processes", async () => {
  const inputs = Array.from({ length: 1000 }, (_, i) => inputOf(`n${i}.ts`, { [`n${i}.ts`]: `export const v${i}: number = ${i};\n` }));
  const check = createManifestCheck({ command, env, directory: base + "/manifests", batchSize: 250 });
  const t0 = performance.now();
  const results = await runInstances(inputs, check, { oracle: () => ({ kind: "C" }), concurrency: 4 });
  console.log("1000 instances:", Math.round(performance.now() - t0), "ms");
  expect(results.filter(r => r.status === "pass" && r.level === "baseline").length).toBe(1000);
});

test("a command that keeps its lines back: the blame is proved on the instance alone", async () => {
  const inputs = [
    inputOf("k0.ts", { "k0.ts": "const a = 1;\n" }),
    inputOf("k1.ts", { "k1.ts": "const b = 1;\n" }),
    inputOf("k2.ts", { "k2.ts": "//~ kill SIGKILL\n" }),
    inputOf("k3.ts", { "k3.ts": "const c = 1;\n" }),
  ];
  const check = createManifestCheck({ command, env: { ...env, FAKE_LINT_KEEPS_LINES: "1" }, directory: base + "/manifests" });
  const results = await runInstances(inputs, check, { oracle: () => ({ kind: "C" }) });
  expect(results.map(r => [r.name, r.status, r.reason])).toEqual([
    ["k0.ts", "pass", ""],
    ["k1.ts", "pass", ""],
    ["k2.ts", "error", "crash: the command ended by the signal SIGKILL"],
    ["k3.ts", "pass", ""],
  ]);
});
