import { readFileSync } from "node:fs";
const lines = readFileSync("split.tsv", "utf8").split("\n").filter(Boolean);
const head = lines[0].split("\t");
const rows = lines.slice(1).map(l => { const p = l.split("\t"); return Object.fromEntries(head.map((h, i) => [h, p[i] ?? ""])); });
console.log("rows", rows.length, "head", head.join(","));
const rule = new Map<string, number>();
let withConfig = 0, multiRoot = 0, others = 0, single = 0, nm = 0, pkg = 0, json = 0, noRoot = 0;
const cwd = new Map<string, number>();
for (const r of rows) {
  rule.set(r.rule, (rule.get(r.rule) ?? 0) + 1);
  cwd.set(r.currentDirectory, (cwd.get(r.currentDirectory) ?? 0) + 1);
  const roots = r.roots ? r.roots.split(/[,;| ]/).filter(Boolean) : [];
  const oth = r.others ? r.others.split(/[,;| ]/).filter(Boolean) : [];
  if (r.config) withConfig++;
  if (roots.length === 0) noRoot++;
  if (roots.length > 1) multiRoot++;
  if (oth.length) others++;
  if (roots.length === 1 && oth.length === 0 && !r.config) single++;
  const all = [...roots, ...oth];
  if (all.some(f => f.includes("/node_modules/"))) nm++;
  if (all.some(f => f.endsWith("/package.json"))) pkg++;
  if (all.some(f => f.endsWith(".json") && !f.endsWith("/package.json"))) json++;
}
console.log({ withConfig, multiRoot, others, single, nm, pkg, json, noRoot });
console.log("rules", JSON.stringify([...rule]));
console.log("current directories", JSON.stringify([...cwd].sort((a, b) => b[1] - a[1]).slice(0, 12)));
console.log(rows.filter(r => r.config).slice(0, 3).map(r => JSON.stringify(r).slice(0, 400)).join("\n"));
console.log(rows.filter(r => r.others).slice(0, 2).map(r => JSON.stringify(r).slice(0, 400)).join("\n"));
