import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
const rows = JSON.parse(readFileSync(process.argv[2] ?? "/tmp/im-td/rows.json", "utf8")) as any[];
const tsv = gunzipSync(readFileSync(import.meta.dir + "/../../../enumerator/vectors/instances.tsv.gz")).toString("utf8").split("\n").filter(Boolean).slice(1).map(l => l.split("\t"));
const kind = new Map(tsv.map(t => [t[1] + "/" + t[0], t[6]]));
for (const r of rows) {
  r.kind = kind.get(r.suite + "/" + r.name) ?? "";
  // settings named link and symlink are directives of the case, not options
  if (r.detail["rooted-setting"]) {
    r.detail["rooted-setting"] = r.detail["rooted-setting"].filter((d: string) => !/^(link|symlink)=/.test(d));
    if (r.detail["rooted-setting"].length === 0) r.causes = r.causes.filter((c: string) => c !== "rooted-setting");
  }
}
const absolute = ["rooted-reference-lib", "rooted-reference", "rooted-specifier", "rooted-path-in-json"];
type P = "linux" | "darwin" | "win32";
function reasons(r: any, p: P): string[] {
  const out: string[] = [];
  const has = (c: string) => r.causes.includes(c);
  if (has("undecided-roots")) return ["undecided-roots"];
  if (has("invalid")) return ["invalid"];
  if (has("dos-root")) out.push("dos-root");
  if (absolute.some(has)) out.push("absolute-path-in-text");
  if (has("case-insensitive-requested") && p === "linux") out.push("case-insensitive-requested");
  if (has("case-collision") && p !== "linux") out.push("case-collision");
  if (p === "win32" && (has("windows-reserved-name") || has("windows-character") || has("windows-trailing-dot-or-space"))) out.push("windows-name");
  if (p === "win32" && has("link-to-file")) out.push("link-to-file");
  return out;
}
for (const p of ["linux", "darwin", "win32"] as P[]) {
  const by = new Map<string, number[]>();
  let total = [0, 0, 0, 0];
  for (const r of rows) {
    const rs = reasons(r, p);
    if (rs.length === 0) continue;
    const add = (k: string) => {
      const e = by.get(k) ?? [0, 0, 0, 0];
      e[0]++; if (r.run) e[1]++; if (r.run && r.kind === "E") e[2]++; if (r.run && r.kind === "C") e[3]++;
      by.set(k, e);
    };
    for (const x of rs) add(x);
    total[0]++; if (r.run) total[1]++; if (r.run && r.kind === "E") total[2]++; if (r.run && r.kind === "C") total[3]++;
  }
  console.log(p, "instances that cannot be written faithfully [all, run, run with errors expected, run clean]:", total);
  for (const [k, v] of [...by].sort((a, b) => b[1][0] - a[1][0])) console.log("   ", k.padEnd(30), v.join(" "));
}
const first = new Map<string, string>();
const lines = ["suite\tname\trun\tkind\tlinux\tdarwin\twin32\tcauses\tlongestPath"];
for (const r of rows) {
  const l = reasons(r, "linux"), d = reasons(r, "darwin"), w = reasons(r, "win32");
  if (l.length + d.length + w.length === 0 && r.causes.length === 0) continue;
  lines.push([r.suite, r.name, r.run ? "run" : "skipped", r.kind, l.join(","), d.join(","), w.join(","), r.causes.join(","), r.maxPath].join("\t"));
}
writeFileSync(process.argv[3] ?? import.meta.dir + "/../vectors/materialisation.tsv", lines.join("\n") + "\n");
console.log("rows written", lines.length - 1);
console.log("rooted-setting instances", rows.filter(r => r.causes.includes("rooted-setting")).length, "run", rows.filter(r => r.run && r.causes.includes("rooted-setting")).length);
console.log("links instances", rows.filter(r => r.causes.some((c: string) => c.startsWith("link-"))).length, "run", rows.filter(r => r.run && r.causes.some((c: string) => c.startsWith("link-"))).length, "link-to-file run", rows.filter(r => r.run && r.causes.includes("link-to-file")).length);
console.log("cwd not /.src", rows.filter(r => r.causes.includes("current-directory")).length);
