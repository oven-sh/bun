// Every file that the runner reads, through the merged reader: what is UTF-16, what has a byte order mark, what is not ASCII.
// usage: bun scan_corpus_text.ts [typescript-go checkout]
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { utf8String } from "../runner/gostrings";
import { decodeBytes } from "../runner/vfs";

const ref = process.argv[2] ?? "/workspace/ref/typescript-go";
const ts = ref + "/_submodules/TypeScript";
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const groups: [string, string[]][] = [
  ["cases (compiler, conformance)", [...walk(ts + "/tests/cases/compiler"), ...walk(ts + "/tests/cases/conformance")]],
  ["tests/lib", walk(ts + "/tests/lib")],
  ["TypeScript .errors.txt", readdirSync(ts + "/tests/baselines/reference").filter(f => f.endsWith(".errors.txt")).map(f => ts + "/tests/baselines/reference/" + f)],
  ["typescript-go .errors.txt", walk(ref + "/testdata/baselines/reference/submodule").filter(f => f.endsWith(".errors.txt"))],
  ["lists", [ref + "/testdata/submoduleAccepted.txt", ref + "/testdata/submoduleTriaged.txt"]],
];
for (const [name, files] of groups) {
  const c = { files: files.length, bytes: 0, utf16: 0, utf8Bom: 0, invalid: 0, notAscii: 0, crlf: 0, loneCr: 0, nul: 0, reencodeDiffers: 0 };
  const examples: string[] = [];
  for (const f of files) {
    const raw = readFileSync(f);
    c.bytes += raw.length;
    if (raw.length >= 2 && ((raw[0] === 0xff && raw[1] === 0xfe) || (raw[0] === 0xfe && raw[1] === 0xff))) c.utf16++;
    else if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) c.utf8Bom++;
    const decoded = decodeBytes(raw);
    let text: string;
    try {
      text = utf8String(decoded);
    } catch {
      c.invalid++;
      if (examples.length < 5) examples.push(f.slice(ref.length + 1));
      continue;
    }
    if (!Buffer.from(text, "utf8").equals(Buffer.from(decoded))) c.reencodeDiffers++;
    if (/[^\x00-\x7f]/.test(text)) c.notAscii++;
    if (text.includes("\r\n")) c.crlf++;
    if (/\r(?!\n)/.test(text)) c.loneCr++;
    if (text.includes("\0")) c.nul++;
  }
  console.log(name, JSON.stringify(c), examples.join(" "));
}
