import { readdirSync, readFileSync, statSync } from "node:fs";
const root = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const dec = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
let n = 0; const bad: string[] = []; const bom8: string[] = []; const bom16: string[] = []; const nonascii: string[] = [];
function walk(d: string) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = d + "/" + e.name;
    if (e.isDirectory()) walk(p);
    else {
      n++;
      const b = readFileSync(p);
      if (b.length >= 2 && ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff))) { bom16.push(p.slice(root.length + 1)); continue; }
      if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) bom8.push(p.slice(root.length + 1));
      try { dec.decode(b); } catch { bad.push(p.slice(root.length + 1)); }
      if (b.some(x => x >= 0x80)) nonascii.push(p);
    }
  }
}
walk(root + "/compiler"); walk(root + "/conformance");
console.log({ files: n, invalidUtf8: bad, utf16Bom: bom16, utf8Bom: bom8.length, nonAscii: nonascii.length });
