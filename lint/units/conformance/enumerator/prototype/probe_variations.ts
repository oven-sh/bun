// Which branches of the variation code the corpus reaches (research probe).
import { enumerateFiles, skippedTests } from "./compiler_runner";
import { getCompilerVaryByMap, getFileBasedTestConfigurations, splitOptionValues } from "./harnessutil";
import { extractCompilerSettings } from "./test_case_parser";
import { getBaseFileName } from "./tspath";
import { readFile } from "./vfs";
const root = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const vary = getCompilerVaryByMap();
const c = { files: 0, noSettings: 0, star: 0, exclude: 0, dedupe: 0, emptyValue: 0, varying: 0, maxVariations: 0, upperInName: 0, multiOption: 0 };
const hist = new Map<number, number>();
const starEx: string[] = [];
const usedVary = new Map<string, number>();
const unknownNames = new Map<string, number>();
for (const f of [...enumerateFiles(root + "/compiler", true), ...enumerateFiles(root + "/conformance", true)]) {
  if (skippedTests.includes(getBaseFileName(f))) continue;
  c.files++;
  const s = extractCompilerSettings(readFile(f).contents);
  if (s.size === 0) c.noSettings++;
  let varyingHere = 0;
  for (const [k, v] of s) {
    if (!vary.has(k)) continue;
    const parts = v.split(",").map(x => x.trim()).filter(x => x !== "");
    if (v.length === 0 || parts.length === 0) c.emptyValue++;
    if (parts.includes("*")) { c.star++; starEx.push(`${f.slice(root.length + 1)}\t@${k}: ${v}`); }
    if (parts.some(p => p.startsWith("-") || p.startsWith("!"))) { c.exclude++; starEx.push(`${f.slice(root.length + 1)}\t@${k}: ${v}`); }
    const out = splitOptionValues(v, k);
    const inc = parts.filter(p => p !== "*" && !p.startsWith("-") && !p.startsWith("!"));
    if (!parts.includes("*") && out.length < inc.length) c.dedupe++;
    if (out.length > 1) { varyingHere++; usedVary.set(k, (usedVary.get(k) ?? 0) + 1); if (out.some(x => x !== x.toLowerCase())) c.upperInName++; }
  }
  const cfgs = getFileBasedTestConfigurations(s, vary);
  const n = Math.max(1, cfgs.length);
  hist.set(n, (hist.get(n) ?? 0) + 1);
  if (varyingHere > 0) c.varying++;
  if (varyingHere > 1) c.multiOption++;
  c.maxVariations = Math.max(c.maxVariations, n);
}
console.log(JSON.stringify(c));
console.log("instances per file:", JSON.stringify([...hist].sort((a, b) => a[0] - b[0])));
console.log("options that vary in at least one file:", usedVary.size, JSON.stringify([...usedVary].sort((a, b) => b[1] - a[1])));
console.log("star or exclusion:");
for (const x of [...new Set(starEx)]) console.log("  ", x);
