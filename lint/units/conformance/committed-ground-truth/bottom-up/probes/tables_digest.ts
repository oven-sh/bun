// The four digests of groundtruth tables, computed from the assembled runner. usage: bun tables_digest.ts <assembled set>
import { createHash } from "node:crypto";
const runner = process.argv[2] + "/test/cli/lint/conformance/runner/";
const G = await import(runner + "gostrings.ts");
const S = await import(runner + "stringutil.ts");
const c0 = process.cpuUsage();
const parts: Record<string, string[]> = { lower: [], foldKey: [], space: [], white: [] };
for (let r = 0; r <= 0x10ffff; r++) {
  const l = G.unicodeToLower(r);
  if (l !== r) parts.lower.push(`${r.toString(16)} ${l.toString(16)}\n`);
  const k = G.foldKey(r);
  if (k !== r) parts.foldKey.push(`${r.toString(16)} ${k.toString(16)}\n`);
  if (G.isSpace(r)) parts.space.push(`${r.toString(16)}\n`);
  if (S.isWhiteSpaceLike(r)) parts.white.push(`${r.toString(16)} ${S.isWhiteSpaceSingleLine(r)} ${S.isLineBreak(r)}\n`);
}
const out: Record<string, string> = {};
for (const [k, v] of Object.entries(parts)) out[k] = createHash("sha256").update(v.join("")).digest("hex");
const c = process.cpuUsage(c0);
console.log(JSON.stringify({ ...out, rows: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v.length])), cpuMs: Math.round((c.user + c.system) / 1000), unicodeOfRuntime: process.versions.unicode }));
