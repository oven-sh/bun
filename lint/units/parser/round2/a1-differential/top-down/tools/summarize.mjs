// usage: node summarize.mjs <probe.out> [api]   groups the sources of a probe by base>head and validity for tsc
import { readFileSync } from "node:fs";
const api = process.argv[3] ?? "t.ts.plain";
const text = readFileSync(process.argv[2], "utf8");
const blocks = text.split(/\n(?=")/);
const rows = [];
for (const block of blocks) {
  const lines = block.split("\n");
  if (!lines[0]) continue;
  let src;
  try { src = JSON.parse(lines[0]); } catch { continue; }
  const tsc = lines[1];
  const dialect = api.includes(".tsx.") ? "tsx" : "ts";
  const parse = new RegExp(`parse\\.${dialect}\\[([^\\]]*)\\]`).exec(tsc)[1];
  const chkL = /chk\.tsL\[([^\]]*)\]/.exec(tsc)?.[1];
  const chk = (api.includes(".exp") || api.includes(".deco")) && chkL !== undefined ? chkL : new RegExp(`chk\\.${dialect}\\[([^\\]]*)\\]`).exec(tsc)[1];
  const oth = /oth\[([^\]]*)\]/.exec(tsc)[1];
  const line = lines.find(l => l.trim().startsWith(api + ":"));
  if (!line) continue;
  const m = new RegExp(`${api.replaceAll(".", "\\.")}: (A|R .*?)( ==| -> (A|R.*?))(  meta.*)?$`).exec(line.trim());
  const base = m[1][0];
  const head = m[2] === " ==" ? base : m[3][0];
  rows.push({ src, valid: parse === "" && chk === "", base, head, parse, chk, oth, baseMsg: m[1], headMsg: m[2] === " ==" ? m[1] : m[3], meta: m[4] ?? "" });
}
const groups = {};
for (const r of rows) (groups[`${r.base}>${r.head} tsc:${r.valid ? "valid" : "INVALID"}`] ??= []).push(r);
for (const key of Object.keys(groups).sort()) {
  console.log(`\n## ${key} (${groups[key].length})`);
  for (const r of groups[key]) console.log(`  ${JSON.stringify(r.src)}   ${r.parse ? "parse:" + r.parse + " " : ""}${r.chk ? "chk:" + r.chk + " " : ""}${r.oth ? "oth:" + r.oth + " " : ""}${r.base === "R" ? " base " + r.baseMsg.slice(2, 70) : ""}${r.head === "R" && r.headMsg !== r.baseMsg ? " head " + r.headMsg.slice(2, 70) : ""}${r.meta}`);
}
