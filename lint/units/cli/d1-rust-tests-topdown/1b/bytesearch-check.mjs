import { readFileSync } from "node:fs";
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
for (const f of process.argv.slice(2)) {
  const stripped = readFileSync(f, "utf8").replace(/^[ \t]*\/\/.*$/gm, "");
  let n = 0;
  for (const re of BANNED) for (const m of stripped.matchAll(re)) { n++; console.log(f, "MATCH", m[0]); }
  console.log(f, "matches:", n);
}
