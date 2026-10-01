// usage: bun stats.ts <repo>: what the enumeration does how often over the corpus.
const repo = process.argv[2];
const H = `${repo}/test/cli/lint/conformance`;
const cr = await import(`${H}/runner/compiler_runner.ts`);
const vfs = await import(`${H}/runner/vfs.ts`);
const tcp = await import(`${H}/runner/test_case_parser.ts`);
const hv = await import(`${H}/runner/harnessutil_variations.ts`);
const tspath = await import(`${H}/runner/tspath.ts`);
const casesDir = `${H}/corpus/cases`;
const vary = cr.getCompilerVaryByMap();
const files: string[] = [];
for (const r of cr.newCompilerBaselineRunners(casesDir)) for (const f of r.enumerateTestFiles()) files.push(f);
const kept = files.filter(f => !cr.skippedTests.includes(tspath.getBaseFileName(f)));
let instances = 0, units = 0, unitBytes = 0, withConfig = 0, withLinks = 0, lines = 0, commentLines = 0, settingsTotal = 0, multi = 0, instWithConfig = 0, withCurDir = 0, unitsOfInstances = 0, bytesOfInstances = 0;
const names = new Map<string, number>();
const perCase: number[] = [];
for (const f of kept) {
  const r = vfs.readFile(f);
  const text = r.contents as string;
  const st = tcp.extractCompilerSettings(text);
  settingsTotal += st.size;
  for (const k of st.keys()) names.set(k, (names.get(k) ?? 0) + 1);
  const cs = hv.getFileBasedTestConfigurations(st, vary);
  const n = Math.max(1, cs.length);
  instances += n;
  perCase.push(n);
  if (n > 1) multi++;
  const u = tcp.parseTestFilesAndSymlinks(text, f, (name: string, content: string) => ({ value: { content, name }, error: undefined }));
  if (!u.ok) continue;
  units += u.units.length;
  unitsOfInstances += u.units.length * n;
  let b = 0;
  for (const x of u.units) b += x.content.length;
  unitBytes += b;
  bytesOfInstances += b * n;
  const hasConfig = u.units.some((x: any) => tcp.getConfigNameFromFileName(x.name) !== "");
  if (hasConfig) { withConfig++; instWithConfig += n; }
  if (u.symlinks.size > 0) withLinks++;
  if (u.currentDirectory !== "") withCurDir++;
  for (const l of text.split(/\r?\n/)) { lines++; if (l.startsWith("//")) commentLines++; }
}
console.log({ files: files.length, cases: kept.length, instances, casesWithMoreThanOneInstance: multi, maxInstancesOfACase: Math.max(...perCase), units, unitsOverInstances: unitsOfInstances, unitChars: unitBytes, unitCharsOverInstances: bytesOfInstances, casesWithConfigUnit: withConfig, instancesWithConfigUnit: instWithConfig, casesWithLinks: withLinks, casesWithCurrentDirectory: withCurDir, lines, linesThatStartWithTwoSlashes: commentLines, settingsTotal, distinctSettingNames: names.size });
console.log([...names].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${k}:${v}`).join(" "));
