// Compares the tokens of the probe's scanner (Bun's lexer, restarted, with the tree's regular expressions and
// JSX elements) with the tokens espree gives for the same file.
// usage: ESLINT_PIN=/tmp/cmp-probe/eslint-pin node tokens-diff.cjs <list of files> [/tmp/c3u/probe]
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const PIN = process.env.ESLINT_PIN || "/tmp/cmp-probe/eslint-pin";
const espree = require(path.join(PIN, "node_modules/espree"));
const list = process.argv[2];
const probe = process.argv[3] || "/tmp/c3u/probe";
const out = execFileSync(probe, ["tokens-batch", list], { env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0" }, maxBuffer: 1 << 30 }).toString();
let files = 0, same = 0, bunRejects = 0, espreeRejects = 0, failed = 0, different = 0, tokens = 0, jsxSpans = 0, regexps = 0;
for (const line of out.split("\n")) {
  if (!line) continue;
  const tab = line.indexOf("\t");
  const file = line.slice(0, tab), rest = line.slice(tab + 1);
  files++;
  if (rest === "PARSE_ERROR") { bunRejects++; continue; }
  if (rest.endsWith("FAILED")) { failed++; console.log("SCAN FAILED", file); continue; }
  const code = fs.readFileSync(file, "utf8");
  let theirs = null;
  for (const sourceType of ["module", "script", "commonjs"]) {
    try {
      theirs = espree.tokenize(code, { ecmaVersion: "latest", sourceType, range: true, ecmaFeatures: { jsx: file.endsWith("x"), globalReturn: true } });
      break;
    } catch {}
  }
  if (!theirs) { espreeRejects++; continue; }
  // UTF-16 index -> byte offset
  const bytes = new Uint32Array(code.length + 1);
  let b = 0;
  for (let i = 0; i < code.length; i++) {
    bytes[i] = b;
    const c = code.charCodeAt(i);
    if (c < 0x80) b += 1; else if (c < 0x800) b += 2; else if (c >= 0xd800 && c < 0xdc00 && i + 1 < code.length) { bytes[i + 1] = b; b += 4; i++; } else b += 3;
  }
  bytes[code.length] = b;
  const mine = rest.trim().split(" ").filter(Boolean).map(t => { const m = /^(\d+)-(\d+)([JR]?)$/.exec(t); return { start: +m[1], end: +m[2], tag: m[3] }; });
  if (mine.length && code.startsWith("#!") && mine[0].start === 0) mine.shift();
  const expected = theirs.map(t => ({ start: bytes[t.range[0]], end: bytes[t.range[1]] }));
  // One JSX element is one token of the scanner.
  const merged = [];
  let k = 0;
  for (const m of mine) {
    if (m.tag === "J") {
      jsxSpans++;
      while (k < expected.length && expected[k].start < m.end) {
        if (expected[k].start < m.start || expected[k].end > m.end) merged.push({ start: -1, end: -1 });
        k++;
      }
      merged.push({ start: m.start, end: m.end });
      continue;
    }
    if (m.tag === "R") regexps++;
    if (k < expected.length) merged.push(expected[k++]); else merged.push({ start: -1, end: -1 });
  }
  while (k < expected.length) merged.push(expected[k++]);
  tokens += mine.length;
  let bad = -1;
  if (merged.length !== mine.length) bad = Math.min(merged.length, mine.length);
  for (let i = 0; i < mine.length && i < merged.length; i++) if (mine[i].start !== merged[i].start || mine[i].end !== merged[i].end) { bad = i; break; }
  if (bad < 0) same++;
  else {
    different++;
    const m = mine[bad], e = merged[bad];
    console.log(`DIFFERENT ${file} token ${bad}: scanner ${m ? m.start + "-" + m.end : "none"} espree ${e ? e.start + "-" + e.end : "none"} text ${JSON.stringify(Buffer.from(code).subarray(m ? m.start : 0, m ? Math.min(m.end, m.start + 40) : 0).toString())}`);
  }
}
console.log(`${files} files: ${same} with the same tokens, ${different} different, ${failed} where the scan failed, ${bunRejects} Bun's parser rejects, ${espreeRejects} espree rejects; ${tokens} tokens, ${regexps} regular expressions, ${jsxSpans} JSX elements`);
