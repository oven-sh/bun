// usage: bun dump.ts <runner directory> <cases directory> <out file>
// Every field of every instance that enumerateInstances makes, one JSON line each, and the same for every case through enumerateCase: the text whose digest two runners must share.
import { createHash } from "node:crypto";
import { writeFileSync, readdirSync } from "node:fs";
const [runnerDir, casesDir, out] = process.argv.slice(2);
const cr = await import(`${runnerDir}/compiler_runner.ts`);
const line = (i: any) =>
  JSON.stringify({
    name: i.name, testName: i.testName, suite: i.suite, file: i.file, basename: i.basename, configName: i.configName,
    config: i.config === undefined ? null : [...i.config],
    status: i.status, skipReason: i.skipReason ?? null, invalidReason: i.invalidReason ?? null, notes: i.notes, emitOnly: i.emitOnly,
    keys: Object.keys(i),
  }) + "\n";
const all = cr.enumerateInstances(casesDir);
const whole = all.map(line).join("");
// The same instances through enumerateCase, case by case in the order of the paths.
const paths: string[] = [];
const walk = (rel: string) => {
  for (const e of readdirSync(`${casesDir}/${rel}`, { withFileTypes: true })) {
    if (e.isDirectory()) walk(`${rel}/${e.name}`);
    else paths.push(`${rel}/${e.name}`);
  }
};
walk("compiler");
walk("conformance");
paths.sort();
const byCase = paths.map(p => cr.enumerateCase(casesDir, p).map(line).join("")).join("");
writeFileSync(out, whole + "--- enumerateCase ---\n" + byCase);
const h = (s: string) => createHash("sha256").update(s).digest("hex");
console.log(`enumerateInstances: ${all.length} instances, sha256 ${h(whole)}`);
console.log(`enumerateCase over ${paths.length} paths: sha256 ${h(byCase)}`);
