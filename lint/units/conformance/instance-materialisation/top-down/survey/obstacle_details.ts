import { readFileSync } from "node:fs";
const rows = JSON.parse(readFileSync(process.argv[2] ?? "/tmp/im-td/rows.json", "utf8")) as any[];
const show = (cause: string, max = 40) => {
  console.log("==== " + cause);
  const seen = new Set<string>();
  let i = 0;
  for (const r of rows) {
    if (!r.causes.includes(cause)) continue;
    if (seen.has(r.casePath)) continue;
    seen.add(r.casePath);
    if (i++ >= max) continue;
    console.log("  " + r.casePath + (r.run ? "" : " [skipped]") + "  " + [...new Set(r.detail[cause] as string[])].slice(0, 4).join(" ; ").slice(0, 260));
  }
};
for (const c of ["dos-root", "rooted-specifier", "rooted-path-in-json", "rooted-reference", "case-collision", "windows-reserved-name", "non-ascii-name", "unit-name-twice", "case-insensitive-requested", "link-to-file"]) show(c);
// rooted settings by key
const keys = new Map<string, number>();
for (const r of rows) for (const d of r.detail["rooted-setting"] ?? []) { const k = d.split("=")[0]; keys.set(k, (keys.get(k) ?? 0) + 1); }
console.log("rooted-setting keys", [...keys]);
const cwds = new Map<string, number>();
for (const r of rows) for (const d of r.detail["current-directory"] ?? []) cwds.set(d, (cwds.get(d) ?? 0) + 1);
console.log("current directories", [...cwds]);
// combined classes
const abs = ["rooted-reference-lib", "rooted-reference", "rooted-specifier", "rooted-path-in-json", "rooted-setting"];
const cnt = (f: (r: any) => boolean) => [rows.filter(f).length, rows.filter(r => r.run && f(r)).length];
console.log("any rooted path in text or settings:", cnt(r => r.causes.some((c: string) => abs.includes(c))));
console.log("rooted path other than /.lib reference:", cnt(r => r.causes.some((c: string) => abs.includes(c) && c !== "rooted-reference-lib")));
console.log("links:", cnt(r => r.causes.some((c: string) => c.startsWith("link-"))));
console.log("no obstacle at all:", cnt(r => r.causes.filter((c: string) => c !== "current-directory" && c !== "non-ascii-name").length === 0));
console.log("all units under /.src:", cnt(r => !r.causes.includes("dos-root")));
