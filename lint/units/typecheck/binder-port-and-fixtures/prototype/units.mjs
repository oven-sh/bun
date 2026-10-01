// Lists the units that can be binder fixtures: every unit of every case that passes the filters, written as the harness of the reference makes them.
// usage: bun units.mjs <out dir>
import fs from "node:fs";
import path from "node:path";
const CASES = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const BASE = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";
const optionRegex = /^\/{2}\s*@(\w+)\s*:\s*([^\r\n]*)/;
const out = process.argv[2];
function walk(dir, list) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, list); else list.push(p);
  }
}
export function parseCase(code, fileName) {
  const units = [];
  const directives = new Map();
  let current = null, content = "";
  for (const line of code.split(/\r?\n/)) {
    const m = optionRegex.exec(line);
    if (m) {
      const key = m[1].toLowerCase();
      if (key !== "filename") { directives.set(key, m[2].trim()); continue; }
      if (current !== null) units.push({ name: current, content });
      current = m[2].trim(); content = "";
      continue;
    }
    if (content.length !== 0) content += "\n";
    content += line;
  }
  units.push({ name: current ?? path.basename(fileName), content });
  return { units, directives, single: current === null };
}
const why = new Map();
const bump = k => why.set(k, (why.get(k) ?? 0) + 1);
const rows = [], list = [];
for (const suite of ["compiler", "conformance"]) {
  const files = [];
  walk(path.join(CASES, suite), files);
  for (const f of files) {
    const rel = path.relative(CASES, f).split(path.sep).join("/");
    if (!/\.tsx?$/.test(rel)) { bump("case is not .ts or .tsx"); continue; }
    const bytes = fs.readFileSync(f);
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) { bump("case has a byte order mark"); continue; }
    if (bytes.includes(0) || !Buffer.from(bytes.toString("utf8"), "utf8").equals(bytes)) { bump("case is not UTF-8"); continue; }
    const { units, directives, single } = parseCase(bytes.toString("utf8"), f);
    let blocked = null;
    for (const k of ["moduledetection", "nolib", "currentdirectory", "symlink", "link"]) if (directives.has(k)) blocked = k;
    if (/^react-jsx/i.test(directives.get("jsx") ?? "")) blocked = "jsx react-jsx";
    if (/node/i.test(directives.get("module") ?? "")) blocked = "module node*";
    if (blocked) { bump("directive " + blocked); continue; }
    const stem = path.basename(rel).replace(/\.tsx?$/, "");
    const baseline = path.join(BASE, suite, stem + ".symbols");
    if (!fs.existsSync(baseline)) { bump("no baseline of that name"); continue; }
    const baselineText = fs.readFileSync(baseline, "utf8");
    const errors = fs.existsSync(path.join(BASE, suite, stem + ".errors.txt")) ? "E" : "C";
    const typescriptBaseline = path.join(CASES, "..", "baselines", "reference", stem + ".symbols");
    const oracle = fs.existsSync(typescriptBaseline) && fs.readFileSync(typescriptBaseline).equals(fs.readFileSync(baseline)) ? "same-as-typescript" : "tsgo-differs";
    units.forEach((u, i) => {
      const base = path.basename(u.name);
      const m = /\.(d\.ts|ts|tsx|js|jsx)$/.exec(base);
      if (!m) { bump("unit extension"); return; }
      if (u.name.includes("node_modules")) { bump("unit in node_modules"); return; }
      if (u.content.trim() === "") { bump("unit is empty"); return; }
      if (/^\/\/\/\s*<reference\s/m.test(u.content)) { bump("unit has a triple-slash reference"); return; }
      if (/@ts-(ignore|expect-error|nocheck)/.test(u.content)) { bump("unit has a @ts- directive comment"); return; }
      const lang = m[1] === "d.ts" ? "dts" : m[1];
      if ((lang === "js" || lang === "jsx") && u.content.includes("/**")) { bump("JavaScript unit with JSDoc"); return; }
      if (units.filter(o => path.basename(o.name) === base).length !== 1) { bump("unit base name is not unique"); return; }
      if (!baselineText.includes("=== " + u.name + " ===\r\n")) { bump("unit is not in the baseline"); return; }
      const id = single ? base : `${stem}__${i}__${base}`;
      const dir = path.join(out, "units", single ? "" : `${stem}__${i}`);
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, base);
      fs.writeFileSync(file, u.content);
      const virtual = single ? base : `${stem}__${i}/${base}`;
      rows.push([id, rel, suite, stem, String(i), u.name, single ? "single" : "unit", lang, errors, oracle, String(Buffer.byteLength(u.content)), virtual].join("\t"));
      list.push(`${virtual}=${file}=${baseline}=${u.name}`);
      bump("usable " + (single ? "single" : "unit") + " " + lang);
    });
  }
}
fs.writeFileSync(path.join(out, "units.tsv"), rows.join("\n") + "\n");
fs.writeFileSync(path.join(out, "units.list.txt"), list.join("\n") + "\n");
console.log([...why.entries()].sort().map(([k, v]) => `${k}=${v}`).join("\n"));
