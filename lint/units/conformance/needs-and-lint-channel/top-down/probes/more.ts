import { readFileSync } from "node:fs";
const lines = readFileSync("inst.tsv", "utf8").split("\n").filter(Boolean);
const head = lines[0].split("\t");
const rows = lines.slice(1).map(l => Object.fromEntries(l.split("\t").map((v, i) => [head[i], v])));
const split = readFileSync("split.tsv", "utf8").split("\n").filter(Boolean).slice(1).map(l => l.split("\t"));
const files = new Map<string, string[]>();
for (const s of split) files.set(s[0] + "/" + s[1], [s[4], ...(s[5] ?? "").split("|"), ...(s[6] ?? "").split("|")].filter(Boolean));
let nolibTrue = 0, nolibE = 0, libSet = 0, js = 0, jsE = 0, jsC = 0, allowjs = 0, checkjs = 0, jsx = 0, dts = 0, json = 0, missing = 0, caseIns = 0, link = 0, pretty = 0, capt = 0;
const targets = new Map<string, number>();
for (const r of rows) {
  if (r.status !== "run") continue;
  const c = r.configuration ? JSON.parse(r.configuration) : {};
  if (c.nolib === "true") { nolibTrue++; if (r.kind === "E") nolibE++; }
  if (c.lib !== undefined) libSet++;
  if (c.allowjs === "true") allowjs++;
  if (c.checkjs === "true") checkjs++;
  if (c.usecasesensitivefilenames === "false") caseIns++;
  if (c.link !== undefined || c.symlink !== undefined) link++;
  if (c.pretty === "true") pretty++;
  if (c.capturesuggestions === "true") capt++;
  targets.set(c.target ?? "(none)", (targets.get(c.target ?? "(none)") ?? 0) + 1);
  const f = files.get(r.suite + "/" + r.name);
  if (!f) { missing++; continue; }
  if (f.some(x => /\.(js|jsx|mjs|cjs)$/.test(x))) { js++; if (r.kind === "E") jsE++; else jsC++; }
  if (f.some(x => /\.(tsx|jsx)$/.test(x))) jsx++;
  if (f.some(x => /\.d\.(ts|mts|cts)$/.test(x))) dts++;
  if (f.some(x => /\.json$/.test(x))) json++;
}
console.log(JSON.stringify({ nolibTrue, nolibE, libSet, allowjs, checkjs, instancesWithAJsUnit: js, jsE, jsC, withJsxOrTsxUnit: jsx, withDtsUnit: dts, withJsonUnit: json, notInSplit: missing, caseInsensitive: caseIns, linkOrSymlink: link, pretty, captureSuggestions: capt }));
console.log("targets:", [...targets].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" "));
