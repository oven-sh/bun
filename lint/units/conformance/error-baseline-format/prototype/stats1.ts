// Corpus statistics for the error baselines: line break shapes, masks, non-ASCII, sections.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TS = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/baselines/reference";
const GO = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";

function list(dir: string): string[] {
  return readdirSync(dir).filter(f => f.endsWith(".errors.txt")).sort().map(f => join(dir, f));
}
const sets: Record<string, string[]> = {
  ts: list(TS),
  go: [...list(join(GO, "compiler")), ...list(join(GO, "conformance"))],
};
for (const [name, files] of Object.entries(sets)) {
  const c: Record<string, number> = {};
  const ex: Record<string, string[]> = {};
  const bump = (k: string, f: string) => { c[k] = (c[k] ?? 0) + 1; (ex[k] ??= []).length < 8 && ex[k].push(f.split("/").pop()!); };
  for (const f of files) {
    const s = readFileSync(f).toString("latin1");
    if (s.includes("\x1b")) bump("esc", f);
    if (/[^\r]\n/.test(s) || s.startsWith("\n")) bump("bare LF", f);
    if (/\r(?!\n)/.test(s)) bump("bare CR", f);
    if (/\r\r\n/.test(s)) bump("CR CR LF", f);
    if (s.includes("\xe2\x80\xa8") || s.includes("\xe2\x80\xa9")) bump("LS/PS", f);
    if (/[\x80-\xff]/.test(s)) bump("non-ascii", f);
    if (/[\xf0-\xf7][\x80-\xbf]{3}/.test(s)) bump("astral", f);
    if (s.includes("(--,--)")) bump("masked top", f);
    if (s.includes(":--:--")) bump("masked related", f);
    if (s.startsWith("\xef\xbb\xbf")) bump("bom at start", f);
    if (s.includes("\xef\xbb\xbf")) bump("bom anywhere", f);
    if (s.includes("\x0b")) bump("VT", f);
    if (s.includes("\x0c")) bump("FF", f);
    if (s.includes("\xc2\xa0")) bump("NBSP", f);
    if (s.includes("\x00")) bump("NUL", f);
    if (!s.endsWith("\r\n") ) bump("no trailing CRLF", f);
    if (s.endsWith("\r\n")) bump("trailing CRLF", f);
    if (/^!!! related/m.test(s)) bump("has related", f);
    if (/^!!! (warning|suggestion|message) /m.test(s)) bump("non-error category", f);
    if (s.includes("/.ts/") || s.includes("/.lib/") || s.includes("/.src/") || s.includes("bundled:///libs/")) bump("contains test path prefix", f);
    if (s.includes("file:///")) bump("file:/// uri", f);
    // invalid utf8?
    const buf = readFileSync(f);
    if (Buffer.from(buf.toString("utf8"), "utf8").compare(buf) !== 0) bump("invalid utf8", f);
    if (/TS-1\b/.test(s)) bump("code -1", f);
  }
  console.log(`== ${name}: ${files.length} files`);
  for (const k of Object.keys(c).sort()) console.log(`  ${k}: ${c[k]}  e.g. ${ex[k].join(", ")}`);
}
