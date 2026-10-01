// usage: bun coverage.ts <H>: which branches of the enumerator the sample of one case in 40 reaches, counted in cases: the whole corpus and the sample.
import { readFileSync } from "node:fs";
import { join } from "node:path";
const home = process.argv[2];
const { enumerateInstances } = await import(join(home, "runner/compiler_runner"));
const { parseTestFilesAndSymlinks, getConfigNameFromFileName } = await import(join(home, "runner/test_case_parser"));
const { readFile } = await import(join(home, "runner/vfs"));
const casesDir = join(home, "corpus/cases");
const sampled = (name: string, n: number) => Bun.hash.crc32(name) % n === 0;
const features = new Map<string, { all: Set<string>; sample: Set<string> }>();
const mark = (feature: string, file: string) => {
  let f = features.get(feature);
  if (f === undefined) features.set(feature, (f = { all: new Set(), sample: new Set() }));
  f.all.add(file);
  if (sampled(file, 40)) f.sample.add(file);
};
const instances = enumerateInstances(casesDir);
const perCase = new Map<string, any[]>();
for (const i of instances) {
  const list = perCase.get(i.file);
  if (list === undefined) perCase.set(i.file, [i]);
  else list.push(i);
}
for (const [file, list] of perCase) {
  mark("any case with an instance", file);
  if (list.length > 1) mark("more than one instance (variations)", file);
  if (list.length >= 10) mark("ten instances or more", file);
  for (const i of list) {
    if (i.status === "skip") mark("skip: " + i.skipReason.replace(/^(unsupported (?:baseUrl|outFile)) .*/, "$1"), file);
    if (i.status === "invalid") mark("invalid", file);
    if (i.notes.length > 0) mark("notes of the config reader", file);
    if (i.emitOnly) mark("emitOnly", file);
    if (i.config === undefined) mark("no setting at all", file);
  }
  const raw = readFileSync(join(casesDir, file));
  if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) mark("UTF-8 byte order mark", file);
  if ((raw[0] === 0xff && raw[1] === 0xfe) || (raw[0] === 0xfe && raw[1] === 0xff)) mark("UTF-16", file);
  if (raw.includes(13)) mark("a carriage return in the file", file);
  const text = readFile(join(casesDir, file));
  if (!text.ok) continue;
  if (/^\/\/\s*@\w+\s*:.*\*/m.test(text.contents)) mark("a setting with *", file);
  if (/^\/\/\s*@\w+\s*:.*[,\s][-!]\w/m.test(text.contents)) mark("a setting with an excluded value", file);
  const units = parseTestFilesAndSymlinks(text.contents, join(casesDir, file), (name: string, content: string) => ({ value: { name, content }, error: undefined }));
  if (!units.ok) { mark("units: panic", file); continue; }
  if (units.units.length > 1) mark("more than one unit", file);
  if (units.symlinks.size > 0) mark("links (@link or @symlink)", file);
  if (units.currentDirectory !== "") mark("@currentDirectory", file);
  const config = units.units.filter((u: any) => getConfigNameFromFileName(u.name) !== "");
  if (config.length > 0) mark("a config unit (tsconfig.json or jsconfig.json)", file);
  if (config.some((u: any) => /"extends"/.test(u.content))) mark("a config unit with extends", file);
  if (config.some((u: any) => /"extends"\s*:\s*"[^./]/.test(u.content))) mark("a config unit that extends a package", file);
  if (config.length > 0 && list.some((i: any) => i.status === "skip")) mark("a config unit and a skip", file);
  if (units.globalOptions.get("runexternalcode") !== undefined) mark("@runExternalCode", file);
}
const rows = [...features].sort((a, b) => a[0] < b[0] ? -1 : 1);
for (const [feature, f] of rows) console.log(`${String(f.all.size).padStart(6)} cases, ${String(f.sample.size).padStart(4)} in the sample  ${feature}${f.sample.size === 0 ? "   <-- none, e.g. " + [...f.all].slice(0, 3).join(", ") : ""}`);
