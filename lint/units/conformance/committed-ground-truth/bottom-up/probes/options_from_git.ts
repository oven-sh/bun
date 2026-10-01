// The option table of the runner from the Go source text of a commit, read with git plumbing: no Go, no worktree of the clone.
// The body is enumerator/prototype/gen_options_table.ts; only the three reads and the output differ.
// usage: bun options_from_git.ts <typescript-go clone> <commit> <out file>
import { writeFileSync } from "node:fs";
const [clone, commit, outFile] = process.argv.slice(2);
const show = (path: string): string => {
  const p = Bun.spawnSync(["git", "-C", clone, "show", `${commit}:${path}`]);
  if (p.exitCode !== 0) throw new Error(p.stderr.toString());
  return p.stdout.toString("utf8");
};
const decl = show("internal/tsoptions/declscompiler.go").split("\n");
const kindMap: Record<string, string> = {
  CommandLineOptionTypeString: "string",
  CommandLineOptionTypeNumber: "number",
  CommandLineOptionTypeBoolean: "boolean",
  CommandLineOptionTypeObject: "object",
  CommandLineOptionTypeList: "list",
  CommandLineOptionTypeListOrElement: "listOrElement",
  CommandLineOptionTypeEnum: "enum",
};
const affects = [
  "AffectsProgramStructure",
  "AffectsEmit",
  "AffectsModuleResolution",
  "AffectsBindDiagnostics",
  "AffectsSemanticDiagnostics",
  "AffectsSourceFile",
  "AffectsDeclarationPath",
  "AffectsBuildInfo",
];
interface Row { name: string; kind: string; isFilePath: boolean; isCommandLineOnly: boolean; affects: boolean; line: number }
const rows: Row[] = [];
let group = "";
let cur: Record<string, string> | undefined;
let curLine = 0;
for (let i = 0; i < decl.length; i++) {
  const line = decl[i];
  const g = /^var (\w+) = \[\]\*CommandLineOption\{/.exec(line);
  if (g) { group = g[1]; continue; }
  if (!group) continue;
  if (/^\}/.test(line)) { group = ""; continue; }
  if (/^\t\{$/.test(line)) { cur = {}; curLine = i + 1; continue; }
  if (/^\t\},?$/.test(line)) {
    if (cur) {
      const kind = kindMap[cur.Kind.replace(/\s*\/\/.*$/, "").trim()];
      if (!kind) throw new Error("kind? " + cur.Kind);
      rows.push({
        name: JSON.parse(cur.Name),
        kind,
        isFilePath: cur.IsFilePath === "true",
        isCommandLineOnly: cur.IsCommandLineOnly === "true",
        affects: affects.some(a => cur![a] === "true"),
        line: curLine,
      });
    }
    cur = undefined;
    continue;
  }
  if (cur) {
    const m = /^\t\t(\w+):\s*(.*?),?\s*(\/\/.*)?$/.exec(line);
    if (m) cur[m[1]] = m[2];
  }
}
if (rows.length !== 126) throw new Error("expected 126 declarations, got " + rows.length);

// enum maps
const enums = show("internal/tsoptions/enummaps.go").split("\n");
const core = show("internal/core/compileroptions.go");
const constValue = (name: string): number => {
  const m = new RegExp("^\\s*" + name + "\\s+\\w+\\s*=\\s*(\\d+)", "m").exec(core);
  if (m) return Number(m[1]);
  throw new Error("no const " + name);
};
const iota: Record<string, number> = {};
// ModuleDetectionKind and NewLineKind are spelled with explicit values or iota; read both forms.
const enumMaps: Record<string, [string, number | string][]> = {};
let mapName = "";
for (const line of enums) {
  const s = /^var (\w+) = collections\.NewOrderedMapFromList/.exec(line);
  if (s) { mapName = s[1]; enumMaps[mapName] = []; continue; }
  if (/^\}\)/.test(line)) { mapName = ""; continue; }
  if (!mapName) continue;
  const e = /^\t\{Key: "([^"]+)", Value: (.+?)\},/.exec(line);
  if (!e) continue;
  const v = e[2].trim();
  if (v.startsWith('"')) enumMaps[mapName].push([e[1], JSON.parse(v)]);
  else {
    const c = v.replace(/^core\./, "");
    let n: number;
    try { n = constValue(c); } catch { n = iota[c] ?? -1; }
    enumMaps[mapName].push([e[1], n]);
  }
}
const out = { rows, enumMaps };
writeFileSync(outFile, JSON.stringify(out, null, 1) + "\n");
for (const [k, v] of Object.entries(enumMaps)) console.log(k, v.length, v.filter(x => x[1] === -1).map(x => x[0]).join(","));
