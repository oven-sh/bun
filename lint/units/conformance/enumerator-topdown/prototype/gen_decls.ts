// Extracts the option declarations from declscompiler.go (research probe).
import { readFileSync } from "node:fs";
const src = readFileSync("/workspace/ref/typescript-go/internal/tsoptions/declscompiler.go", "utf8");
const lines = src.split("\n");
type Decl = Record<string, string> & { list: string; line: number };
const decls: Decl[] = [];
let list = "";
let cur: Decl | null = null;
let depth = 0;
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  let m = /^var (\w+) = \[\]\*CommandLineOption\{/.exec(l);
  if (m) { list = m[1]; depth = 0; continue; }
  if (!list) continue;
  if (/^\}/.test(l)) { list = ""; continue; }
  if (/^\t\{\s*$/.test(l)) { cur = { list, line: i + 1 } as Decl; continue; }
  if (/^\t\},?\s*$/.test(l)) { if (cur) decls.push(cur); cur = null; continue; }
  if (cur) {
    m = /^\t\t(\w+):\s*(.*?),?\s*(\/\/.*)?$/.exec(l);
    if (m) cur[m[1]] = m[2].replace(/,$/, "");
  }
}
const out = decls.map(d => ({
  list: d.list, line: d.line, name: JSON.parse(d.Name), short: d.ShortName ? JSON.parse(d.ShortName) : "",
  kind: d.Kind.replace("CommandLineOptionType", ""),
  isFilePath: d.IsFilePath === "true", isCommandLineOnly: d.IsCommandLineOnly === "true", isTSConfigOnly: d.IsTSConfigOnly === "true",
  affects: Object.keys(d).filter(k => k.startsWith("Affects") && d[k] === "true").map(k => k.slice(7)),
}));
if (process.argv[2] === "json") console.log(JSON.stringify(out));
else for (const o of out) console.log([o.list === "commonOptionsWithBuild" ? "common" : "compiler", o.line, o.name, o.kind, o.isFilePath ? "filePath" : "", o.isCommandLineOnly ? "cmdOnly" : "", o.isTSConfigOnly ? "tsconfigOnly" : "", o.affects.join("+")].join("\t"));
console.error("count", out.length, "distinct lowercase names", new Set(out.map(o => o.name.toLowerCase())).size);
