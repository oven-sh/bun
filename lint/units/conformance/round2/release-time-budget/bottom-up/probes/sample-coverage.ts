// usage: bun sample-coverage.ts <repo>: what the sample of one case in 40 (crc32 of the path) holds of each kind of case.
const repo = process.argv[2];
const H = `${repo}/test/cli/lint/conformance`;
const cr = await import(`${H}/runner/compiler_runner.ts`);
const vfs = await import(`${H}/runner/vfs.ts`);
const tcp = await import(`${H}/runner/test_case_parser.ts`);
const casesDir = `${H}/corpus/cases`;
const sampled = (name: string, n: number) => Bun.hash.crc32(name) % n === 0;
const all = cr.enumerateInstances(casesDir);
const byCase = new Map<string, any[]>();
for (const i of all) (byCase.get(i.file) ?? byCase.set(i.file, []).get(i.file)!).push(i);
const kinds: Record<string, { all: number; in40: number; in250: number }> = {};
const add = (kind: string, file: string) => {
  const k = (kinds[kind] ??= { all: 0, in40: 0, in250: 0 });
  k.all++;
  if (sampled(file, 40)) k.in40++;
  if (sampled(file, 250)) k.in250++;
};
for (const [file, instances] of byCase) {
  add("cases", file);
  add(file.startsWith("compiler/") ? "cases of compiler" : "cases of conformance", file);
  if (instances.length > 1) add("cases with more than one instance", file);
  const text = vfs.readFile(`${casesDir}/${file}`).contents as string;
  const u = tcp.parseTestFilesAndSymlinks(text, file, (name: string, content: string) => ({ value: { content, name }, error: undefined }));
  if (u.ok) {
    if (u.units.length > 1) add("cases with more than one unit", file);
    if (u.units.some((x: any) => tcp.getConfigNameFromFileName(x.name) !== "")) add("cases with a config unit", file);
    if (u.symlinks.size > 0) add("cases with links", file);
    if (u.currentDirectory !== "") add("cases with @currentDirectory", file);
  }
  if (file.endsWith(".tsx")) add("cases .tsx", file);
  for (const i of instances) {
    add("instances", file);
    if (i.status === "skip") add("skip: " + i.skipReason.replace(/^(unsupported (?:baseUrl|outFile)) .*/, "$1"), file);
    if (i.notes.length > 0) add("instances with a note", file);
    if (i.emitOnly) add("instances of skippedEmitTests", file);
  }
}
for (const [k, v] of Object.entries(kinds)) console.log(`${String(v.all).padStart(6)} ${String(v.in40).padStart(5)} ${String(v.in250).padStart(5)}  ${k}`);
