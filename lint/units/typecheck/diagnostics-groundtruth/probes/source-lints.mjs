import fs from "node:fs";
import path from "node:path";
const BYTE = String.raw`(?:b'(?:[^'\\]|\\.|\\x[0-9a-fA-F]{2})'|0)`;
const PARAM = String.raw`\|\s*&{0,2}\s*(\w+)\s*(?::\s*&?\s*u8\s*)?\|`;
const USE = String.raw`\*{0,2}\s*\1`;
const CMP1 = String.raw`(?:${USE}\s*==\s*${BYTE}|${BYTE}\s*==\s*${USE}|matches!\(\s*${USE}\s*,\s*${BYTE}(?:\s*\|\s*${BYTE})*\s*\))`;
const BODY_EQ = String.raw`\s*(?:${CMP1})(?:\s*\|\|\s*${CMP1})*\s*\)`;
const BODY_NE = String.raw`\s*${USE}\s*!=\s*${BYTE}\s*\)`;
const BANNED = [
  new RegExp(String.raw`\.contains\(\s*&\s*${BYTE}\s*\)`, "g"),
  new RegExp(String.raw`\.(?:iter|bytes)\(\)\s*\.position\(\s*${PARAM}${BODY_EQ}`, "g"),
  new RegExp(String.raw`\.(?:iter|bytes)\(\)\s*\.rposition\(\s*${PARAM}${BODY_EQ}`, "g"),
  new RegExp(String.raw`\.(?:iter|bytes)\(\)\s*\.any\(\s*${PARAM}${BODY_EQ}`, "g"),
  new RegExp(String.raw`\.(?:iter|bytes)\(\)\s*\.all\(\s*${PARAM}${BODY_NE}`, "g"),
  new RegExp(String.raw`\.(?:iter|bytes)\(\)\s*\.find\(\s*${PARAM}${BODY_EQ}`, "g"),
  new RegExp(String.raw`\.(?:iter|bytes)\(\)\s*\.filter\(\s*${PARAM}${BODY_EQ}\s*\.count\(\)`, "g"),
  new RegExp(String.raw`\.split\(\s*${PARAM}${BODY_EQ}`, "g"),
];
function* walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) yield* walk(p); else if (p.endsWith(".rs")) yield p; } }
let hits = 0, files = 0, multi = 0, allowDead = 0;
for (const p of walk(process.argv[2])) {
  files++;
  const content = fs.readFileSync(p, "utf8");
  const stripped = content.replace(/^[ \t]*\/\/.*$/gm, "");
  for (const re of BANNED) for (const m of stripped.matchAll(re)) { hits++; console.log("byte-search", p, m[0]); }
  if (/#\[\s*(?:cfg_attr\([^\]]+?,\s*)?allow\([^)]*\bdead_code\b[^)]*\)[^\]]*\]/.test(content)) { allowDead++; console.log("allow(dead_code)", p); }
  const lines = content.split("\n"); let run = 0;
  lines.forEach((l, i) => { const t = l.trimStart(); const c = t.startsWith("//") || t.startsWith("/*") || t === "*" || t === "*/" || t.startsWith("* "); if (c) { run++; if (run === 2 && !p.endsWith("diagnostics_generated.rs")) { multi++; console.log("comment run", p + ":" + (i + 1)); } } else run = 0; });
  if (/\b(TODO|FIXME|XXX|HACK)\b/.test(content)) console.log("marker", p);
}
console.log({ files, hits, allowDead, multi });
