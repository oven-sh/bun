import fs from "node:fs";
const TS = "/workspace/ref/typescript-go/_submodules/TypeScript/src/compiler/diagnosticMessages.json";
const EX = "/workspace/ref/typescript-go/internal/diagnostics/extraDiagnosticMessages.json";
const GO = "/workspace/ref/typescript-go/internal/diagnostics/diagnostics_generated.go";

function readRaw(p) {
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  const byCode = new Map();
  for (const [k, m] of Object.entries(raw)) byCode.set(m.code, { ...m, key: k });
  return byCode;
}
export function convertPropertyName(orig, code) {
  let b = "";
  for (const ch of orig) {
    if (ch === "*") b += "_Asterisk";
    else if (ch === "/") b += "_Slash";
    else if (ch === ":") b += "_Colon";
    else if (!/[\p{L}\p{Nd}]/u.test(ch)) b += "_";
    else b += ch;
  }
  let v = b.replace(/_+/g, "_").replace(/^_+(\D)/, "$1").replace(/_$/, "");
  let key = v;
  if (Buffer.byteLength(key) > 100) key = Buffer.from(key).subarray(0, 100).toString();
  key = key + "_" + code;
  const exported = /^\p{Lu}/u.test(v);
  if (!exported) v = (v[0] === "_" ? "X" : "X_") + v;
  return [v, key];
}
const merged = readRaw(TS);
for (const [c, m] of readRaw(EX)) merged.set(c, m);
const all = [...merged.values()].sort((a, b) => a.code - b.code);

// parse upstream generated go
const go = fs.readFileSync(GO, "utf8");
const re = /^var (\w+) = &Message\{code: (-?\d+), category: Category(\w+), key: ("(?:[^"\\]|\\.)*"), text: ("(?:[^"\\]|\\.)*")((?:, \w+: true)*)\}$/gm;
const goList = [];
let m;
while ((m = re.exec(go))) {
  goList.push({ name: m[1], code: +m[2], category: m[3], key: JSON.parse(m[4]), text: JSON.parse(m[5]), flags: m[6] });
}
console.log("go vars", goList.length, "json merged", all.length);
let mismatches = 0;
const names = new Set();
for (let i = 0; i < Math.max(goList.length, all.length); i++) {
  const g = goList[i], j = all[i];
  if (!g || !j) { mismatches++; console.log("missing at", i); continue; }
  const [v, key] = convertPropertyName(j.key, j.code);
  names.add(v);
  const flags = (j.reportsUnnecessary ? ", reportsUnnecessary: true" : "") + (j.elidedInCompatabilityPyramid ? ", elidedInCompatibilityPyramid: true" : "") + (j.reportsDeprecated ? ", reportsDeprecated: true" : "");
  if (g.name !== v || g.code !== j.code || g.category !== j.category || g.key !== key || g.text !== j.key || g.flags !== flags) {
    mismatches++;
    if (mismatches < 10) console.log("MISMATCH", i, JSON.stringify(g), JSON.stringify([v, j.code, j.category, key, j.key, flags]));
  }
}
console.log("mismatches", mismatches, "distinct names", names.size);
// stats
let keyBytes = 0, nameBytes = 0, truncated = 0, xprefixed = 0;
const upper = new Map();
for (const j of all) { const [v, key] = convertPropertyName(j.key, j.code); keyBytes += key.length; nameBytes += v.length; if (v.length > 100) truncated++; if (/^X_|^X\d/.test(v) && !/^X_|^X\d/.test(j.key)) xprefixed++; const u = v.toUpperCase(); upper.set(u, (upper.get(u) || []).concat([v])); }
console.log("key bytes", keyBytes, "name bytes", nameBytes, "names longer than 100", truncated, "X-prefixed", xprefixed);
const coll = [...upper.values()].filter(a => a.length > 1);
console.log("names colliding under upper-casing:", coll.length); for (const c of coll.slice(0, 20)) console.log("   ", c.join(" | "));
// name length
let maxName = ""; for (const j of all) { const [v] = convertPropertyName(j.key, j.code); if (v.length > maxName.length) maxName = v; }
console.log("longest name", maxName.length);
// keyToMessage switch in go: count cases
console.log("keyToMessage cases", (go.match(/^\tcase "/gm) || []).length);
// duplicate texts (same text different code)
const byText = new Map(); for (const j of all) byText.set(j.key, (byText.get(j.key) || []).concat([j.code]));
const dupText = [...byText.entries()].filter(([, v]) => v.length > 1);
console.log("texts shared by several codes:", dupText.length, JSON.stringify(dupText.slice(0, 5)));
// duplicate names?
const byName = new Map(); for (const j of all) { const [v] = convertPropertyName(j.key, j.code); byName.set(v, (byName.get(v) || []).concat([j.code])); }
const dupName = [...byName.entries()].filter(([, v]) => v.length > 1);
console.log("names shared by several codes:", dupName.length, JSON.stringify(dupName.slice(0, 5)));
