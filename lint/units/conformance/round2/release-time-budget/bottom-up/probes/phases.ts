// usage: bun phases.ts <repo> [passes]
// The steps of enumerateInstances one at a time over the whole corpus, each metered: what of the pass is which step.
import { readFileSync } from "node:fs";
import { sample, delta, fmt } from "./meter.ts";
const repo = process.argv[2];
const passes = Number(process.argv[3] ?? 2);
const H = `${repo}/test/cli/lint/conformance`;
const cr = await import(`${H}/runner/compiler_runner.ts`);
const vfs = await import(`${H}/runner/vfs.ts`);
const tcp = await import(`${H}/runner/test_case_parser.ts`);
const hv = await import(`${H}/runner/harnessutil_variations.ts`);
const ho = await import(`${H}/runner/harnessutil_options.ts`);
const tspath = await import(`${H}/runner/tspath.ts`);
const gs = await import(`${H}/runner/gostrings.ts`);
const casesDir = `${H}/corpus/cases`;
const vary = cr.getCompilerVaryByMap();
for (let pass = 1; pass <= passes; pass++) {
  console.log(`-- pass ${pass}`);
  let s = sample();
  const step = (label: string) => { const t = sample(); console.log(fmt(label, delta(s, t))); s = sample(); };
  const runners = cr.newCompilerBaselineRunners(casesDir);
  const files: string[] = [];
  for (const r of runners) for (const f of r.enumerateTestFiles()) files.push(f);
  step(`1 list files (${files.length})`);
  const kept = files.filter(f => !cr.skippedTests.includes(tspath.getBaseFileName(f)));
  step(`2 skippedTests filter (${kept.length})`);
  const bytes = kept.map(f => readFileSync(f));
  step("3 readFileSync");
  const texts = bytes.map((b, k) => (b.length === 0 ? "" : gs.utf8String(vfs.decodeBytes(b), kept[k])));
  step("4 decode");
  const settings = texts.map(t => tcp.extractCompilerSettings(t));
  step("5 extractCompilerSettings");
  const configs = settings.map(st => hv.getFileBasedTestConfigurations(st, vary));
  step("6 getFileBasedTestConfigurations");
  const units = texts.map((t, k) => tcp.parseTestFilesAndSymlinks(t, kept[k], (name: string, content: string) => ({ value: { content, name }, error: undefined })));
  step("7 parseTestFilesAndSymlinks");
  let n = 0;
  const by: Record<string, number> = {};
  for (let k = 0; k < kept.length; k++) {
    const u = units[k];
    const base = tspath.getBaseFileName(kept[k]);
    const cs = configs[k].length > 0 ? configs[k] : [undefined];
    for (const c of cs) {
      n++;
      if (!u.ok) { by.invalid = (by.invalid ?? 0) + 1; continue; }
      const made = ho.getInstanceStatus(base, u, c?.config);
      by[made.status] = (by[made.status] ?? 0) + 1;
    }
  }
  step(`8 getInstanceStatus (${n} ${JSON.stringify(by)})`);
  for (let k = 0; k < kept.length; k++) {
    const cs = configs[k].length > 0 ? configs[k] : [undefined];
    for (const c of cs) cr.getConfiguredName(kept[k], c);
  }
  step("9 getConfiguredName");
}
