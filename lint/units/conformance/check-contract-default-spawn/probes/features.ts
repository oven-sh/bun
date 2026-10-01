// Facts about the run instances that decide what a spawned command line can reproduce (research probe).
const P = new URL("../../enumerator/prototype/", import.meta.url).pathname;
const { enumerateInstances } = await import(P + "compiler_runner.ts");
const { makeUnitsFromTest, srcFolder } = await import(P + "test_case_parser.ts");
const { getCommandLineOption, getHarnessOption } = await import(P + "harnessutil.ts");
const { getNormalizedAbsolutePath, isRootedDiskPath, getBaseFileName } = await import(P + "tspath.ts");
const { readFile } = await import(P + "vfs.ts");
import { existsSync } from "node:fs";

const casesRoot = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const baselines = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";
const e = enumerateInstances({ casesRoot });
const run = e.instances.filter((i: any) => i.status === "run");
const counts: Record<string, number> = {};
const samples: Record<string, string[]> = {};
const bump = (k: string, name: string) => { counts[k] = (counts[k] ?? 0) + 1; (samples[k] ??= []).length < 4 && samples[k].push(name); };
const optionUse: Record<string, number> = {};
const harnessUse: Record<string, number> = {};
const requireStr = "require(";
const referencesRegex = /reference[\t\n\f\r ]path/;
const cache = new Map<string, string>();
let plainEligible = 0, plainEligibleE = 0, plainEligibleC = 0;
const rows: string[] = [];
for (const inst of run) {
  const file = casesRoot + "/" + inst.casePath;
  let content = cache.get(file);
  if (content === undefined) { content = readFile(file).contents as string; cache.set(file, content); }
  const made = makeUnitsFromTest(content, file);
  if (!made.ok) { bump("units-panic", inst.name); continue; }
  const t = made.value;
  const config: Map<string, string> | undefined = inst.config;
  const currentDirectory = getNormalizedAbsolutePath(config?.get("currentdirectory") ?? "", srcFolder);
  const isE = existsSync(baselines + "/" + inst.suite + "/" + inst.name.replace(/\.tsx?$/, ".errors.txt"));
  const flags: string[] = [];
  bump(isE ? "E" : "C", inst.name);
  let compilerOpts = 0, harnessOpts = 0, unknown = 0;
  if (config !== undefined) {
    for (const [k] of config) {
      if (k === "typescriptversion") continue;
      const c = getCommandLineOption(k);
      if (c !== undefined) { compilerOpts++; optionUse[c.name] = (optionUse[c.name] ?? 0) + 1; continue; }
      const h = getHarnessOption(k);
      if (h !== undefined) { harnessOpts++; harnessUse[h.name] = (harnessUse[h.name] ?? 0) + 1; continue; }
      unknown++;
    }
  }
  if (compilerOpts > 0) flags.push("compiler-options");
  if (harnessOpts > 0) flags.push("harness-options");
  if (unknown > 0) flags.push("unknown-options");
  if (t.tsConfigFileUnitData !== undefined) flags.push("tsconfig-unit");
  if (t.symlinks.size > 0) flags.push("symlinks");
  if (currentDirectory !== srcFolder) flags.push("currentdirectory");
  if (t.currentDirectory !== currentDirectory) flags.push("units-currentdirectory-differs");
  const units = t.testUnitData;
  const abs = units.map((u: any) => getNormalizedAbsolutePath(u.name, currentDirectory));
  if (abs.some((a: string) => !a.startsWith(currentDirectory + "/"))) flags.push("unit-outside-cwd");
  if (units.some((u: any) => isRootedDiskPath(u.name))) flags.push("rooted-unit-name");
  if (abs.some((a: string) => /^[a-zA-Z]:/.test(a))) flags.push("drive-letter");
  if (abs.some((a: string) => a.startsWith("/.lib/") || a.startsWith("/.ts/"))) flags.push("unit-in-lib-folder");
  if (new Set(abs).size !== abs.length) flags.push("duplicate-unit-path");
  if (new Set(abs.map((a: string) => a.toLowerCase())).size !== new Set(abs).size) flags.push("case-colliding-paths");
  if (abs.some((a: string) => /[<>:"|?*\\\0]/.test(a.replace(/^[a-zA-Z]:/, "")))) flags.push("name-unsafe-on-windows");
  if (abs.some((a: string) => abs.some((b: string) => b !== a && b.startsWith(a + "/")))) flags.push("file-is-also-directory");
  if (units.some((u: any) => u.content.includes("/.lib/"))) flags.push("content-mentions-/.lib/");
  if (units.some((u: any) => /(from|import|require\(|path=|types=|import\()\s*["']\//.test(u.content))) flags.push("content-absolute-specifier");
  // roots
  const last = units[units.length - 1];
  let rootsAll = true;
  if (t.tsConfigFileUnitData === undefined) {
    if ((config?.get("noimplicitreferences") ?? "") !== "" || last.content.includes(requireStr) || referencesRegex.test(last.content)) rootsAll = units.length === 1;
  }
  if (!rootsAll) flags.push("roots-are-last-unit-only");
  if (units.length > 1) flags.push("multi-unit");
  const rootUnits = rootsAll ? abs : [abs[abs.length - 1]];
  if (rootUnits.some((a: string) => a.endsWith(".json") || a.endsWith(".tsbuildinfo"))) flags.push("root-json");
  if (rootUnits.every((a: string) => a.endsWith(".json") || a.endsWith(".tsbuildinfo"))) flags.push("no-program-root");
  if (units.some((u: any) => /\.(js|jsx|mjs|cjs)$/.test(u.name))) flags.push("js-unit");
  if (units.some((u: any) => getBaseFileName(u.name) === "package.json")) flags.push("package-json-unit");
  if (abs.some((a: string) => a.includes("/node_modules/"))) flags.push("node_modules-unit");
  for (const f of flags) bump(f, inst.name);
  const blocking = flags.filter(f => ["compiler-options", "harness-options", "unknown-options", "tsconfig-unit", "symlinks", "currentdirectory", "unit-outside-cwd", "drive-letter", "content-mentions-/.lib/", "content-absolute-specifier", "no-program-root"].includes(f));
  if (blocking.length === 0) { plainEligible++; isE ? plainEligibleE++ : plainEligibleC++; }
  rows.push([inst.name, isE ? "E" : "C", flags.join(",")].join("\t"));
}
console.log(JSON.stringify({ run: run.length, counts, plainEligible, plainEligibleE, plainEligibleC }, null, 1));
console.log("samples", JSON.stringify(samples));
console.log("compiler options used (instances):", JSON.stringify(Object.entries(optionUse).sort((a, b) => b[1] - a[1])));
console.log("harness options used (instances):", JSON.stringify(Object.entries(harnessUse).sort((a, b) => b[1] - a[1])));
await Bun.write((process.argv[2] ?? "/tmp/features.tsv"), rows.join("\n") + "\n");
