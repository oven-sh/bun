// Generates options_table.ts from the reference sources (research helper; the output is data, not logic).
import { readFileSync, writeFileSync } from "node:fs";
const ref = "/workspace/ref/typescript-go/internal";
const decl = readFileSync(ref + "/tsoptions/declscompiler.go", "utf8").split("\n");
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
const enums = readFileSync(ref + "/tsoptions/enummaps.go", "utf8").split("\n");
const core = readFileSync(ref + "/core/compileroptions.go", "utf8");
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
writeFileSync(new URL("./options_table.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
for (const [k, v] of Object.entries(enumMaps)) console.log(k, v.length, v.filter(x => x[1] === -1).map(x => x[0]).join(","));
