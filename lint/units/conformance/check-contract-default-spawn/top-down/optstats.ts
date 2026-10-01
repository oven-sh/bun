import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
const text = gunzipSync(readFileSync("/workspace/notes/lint/units/conformance/enumerator-topdown/vectors/instances.tsv.gz")).toString("utf8");
const rows = text.split("\n").slice(1).filter(Boolean).map(l => l.split("\t"));
const harness = new Set(["usecasesensitivefilenames","baselinefile","includebuiltfile","filename","libfiles","noimplicitreferences","currentdirectory","symlink","link","notypesandsymbols","fullemitpaths","reportdiagnostics","capturesuggestions","typescriptversion"]);
let run = 0, empty = 0, onlyHarness = 0; const byKey = new Map<string, number>();
const kinds = { E: 0, C: 0 }; const emptyKinds = { E: 0, C: 0 };
const keysets = new Map<string, number>();
for (const r of rows) {
  if (r[4] !== "run") continue;
  run++;
  const cfg = JSON.parse(r[8] || "{}");
  const keys = Object.keys(cfg);
  (kinds as any)[r[6]]++;
  const compilerKeys = keys.filter(k => !harness.has(k));
  if (keys.length === 0) empty++;
  if (compilerKeys.length === 0) { onlyHarness++; (emptyKinds as any)[r[6]]++; }
  for (const k of keys) byKey.set(k, (byKey.get(k) ?? 0) + 1);
  const ks = compilerKeys.sort().map(k => k + "=" + cfg[k]).join(",");
  keysets.set(ks, (keysets.get(ks) ?? 0) + 1);
}
console.log({ run, empty, onlyHarness, kinds, emptyKinds });
console.log([...byKey].sort((a, b) => b[1] - a[1]).slice(0, 40));
console.log([...keysets].sort((a, b) => b[1] - a[1]).slice(0, 15));
console.log("distinct compiler option sets", keysets.size);
