import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const root = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const files: string[] = [];
function walk(d: string) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } }
walk(join(root, "conformance")); walk(join(root, "compiler"));
let crlf = 0, lf = 0, mixed = 0, none = 0, loneCr = 0, nul = 0, utf16 = 0;
for (const f of files) {
  const b = readFileSync(f);
  let nCrlf = 0, nLf = 0, nCr = 0, hasNul = false;
  for (let i = 0; i < b.length; i++) {
    if (b[i] === 0) hasNul = true;
    if (b[i] === 13) { if (b[i + 1] === 10) { nCrlf++; i++; } else nCr++; }
    else if (b[i] === 10) nLf++;
  }
  if (hasNul) nul++;
  if ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff)) utf16++;
  if (nCr > 0) loneCr++;
  if (nCrlf > 0 && nLf > 0) mixed++; else if (nCrlf > 0) crlf++; else if (nLf > 0) lf++; else none++;
}
console.log(JSON.stringify({ files: files.length, crlfOnly: crlf, lfOnly: lf, mixed, noLineBreak: none, withLoneCr: loneCr, withNulByte: nul, utf16Bom: utf16 }));
