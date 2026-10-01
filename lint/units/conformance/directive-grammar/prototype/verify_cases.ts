// Writes one line per case, path TAB sha256 of the canonical record, to compare with the Go generator's file.
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { extractCompilerSettings, makeUnitsFromTest, srcFolder } from "./test_case_parser";
import { readFile } from "./vfs";

const root = process.argv[2];
const files: string[] = [];
function walk(dir: string) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(p)) files.push(p);
  }
}
walk(join(root, "conformance"));
walk(join(root, "compiler"));
const byBytes = (a: string, b: string) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
const rels = files.map(f => f.slice(root.length + 1).replaceAll("\\", "/")).sort(byBytes);
const sha = (s: string) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
const unitLine = (content: string) => `${Buffer.byteLength(content, "utf8")} ${sha(content)}`;

const out: string[] = [];
for (const rel of rels) {
  const r = readFile(join(root, rel));
  if (!r.ok) throw new Error(rel + ": " + r.reason);
  const content = r.value;
  const made = makeUnitsFromTest(content, rel);
  const rec: string[] = [];
  rec.push(`decoded ${Buffer.byteLength(content, "utf8")} ${sha(content)}`);
  rec.push("panic " + (made.ok ? "" : made.reason));
  const cd = made.ok ? made.value.currentDirectory : "";
  const cdRaw = made.ok && made.value.globalOptions.has("currentdirectory") ? made.value.globalOptions.get("currentdirectory")! : "";
  if (made.ok && cd !== (cdRaw === "" ? srcFolder : cdRaw)) throw new Error(rel + ": current directory " + cd + " against " + cdRaw);
  rec.push("currentDirectory " + cdRaw);
  const maps: [string, Map<string, string>][] = [
    ["settings", extractCompilerSettings(content)],
    ["globalOptions", made.ok ? made.value.globalOptions : new Map()],
  ];
  for (const [field, m] of maps) {
    rec.push(`${field} ${m.size}`);
    for (const k of [...m.keys()].sort(byBytes)) rec.push(k + "=" + m.get(k));
  }
  const sym = made.ok ? made.value.symlinks : new Map<string, string>();
  rec.push(`symlinks ${sym.size}`);
  for (const k of [...sym.keys()].sort(byBytes)) {
    rec.push(k);
    rec.push(sym.get(k)!);
  }
  const config = made.ok ? made.value.tsConfigFileUnitData : undefined;
  rec.push(`configUnit ${config ? 1 : 0}`);
  if (config) {
    rec.push(config.name);
    rec.push(unitLine(config.content));
  }
  const units = made.ok ? made.value.testUnitData : [];
  rec.push(`units ${units.length}`);
  for (const u of units) {
    rec.push(u.name);
    rec.push(unitLine(u.content));
  }
  out.push(rel + "\t" + sha(rec.map(x => x + "\n").join("")) + "\n");
}
await Bun.write(process.argv[3], out.join(""));
console.error("cases:", rels.length);
