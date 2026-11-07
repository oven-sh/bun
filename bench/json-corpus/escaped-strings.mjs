// Writes documents whose strings have escapes into this directory, one per kind of text:
// `bun bench/json-corpus/escaped-strings.mjs`. Two benches read every document of the directory:
// `bun bench/json-corpus/jsonc-parse.mjs strings-` and `scripts/bench-json-rust.sh strings-`.
// A string with an escape is decoded into a copy, so the cost of these documents is the cost of that decoder.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const dir = dirname(Bun.fileURLToPath(import.meta.url));
const MB = 1024 * 1024;
const repeat = (unit, bytes) => Buffer.alloc(bytes - (bytes % Buffer.byteLength(unit)), unit).toString();

// A string with no escape next to one that has an escape: both are in one 64-byte block of the index.
const neighbours = (count, clean) => Array.from({ length: count }, (_, i) => (i % 2 ? "a\nb" : clean(i)));
const ascii = length => i => ("t" + i).padEnd(length, "x").slice(0, length);

// The signature of a package version in a registry manifest: lines of 60 base64 characters that end with \r\n.
const base64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function signature(seed) {
  let text = "-----BEGIN PGP SIGNATURE-----\r\nVersion: OpenPGP.js v4.10.10\r\nComment: https://openpgpjs.org\r\n\r\n";
  for (let line = 0; line < 8; line++) {
    for (let i = 0; i < 60; i++) text += base64[(seed = (seed * 1103515245 + 12345) >>> 0) >>> 26];
    text += "\r\n";
  }
  return text + "=AbCd\r\n-----END PGP SIGNATURE-----\r\n";
}

const documents = {
  // Source text as a source map holds it: a line break every 64 bytes.
  "source-lines": { sourcesContent: [repeat("// " + Buffer.alloc(60, "p").toString() + "\n", MB)] },
  // One megabyte between two escapes.
  "long-run": ["\n" + repeat("p", MB) + "\n"],
  // Source text with tabs, CRLF line ends and quoted strings: two to four escapes next to each other.
  "tabs-crlf": {
    sourcesContent: [repeat('function f(a, b) {\r\n\tif (a === "x") {\r\n\t\treturn b + "y";\r\n\t}\r\n}\r\n', MB)],
  },
  // JSON in a string: a quote every one to ten bytes.
  "json-in-json": {
    payload: JSON.stringify(
      Array.from({ length: 12000 }, (_, i) => ({ id: i, name: "item" + i, ok: i % 2 === 0, tags: ["a", "b"] })),
    ),
  },
  "pgp-signatures": {
    versions: Object.fromEntries(
      Array.from({ length: 1200 }, (_, i) => [`1.0.${i}`, { dist: { "npm-signature": signature(i + 1) } }]),
    ),
  },
  // One character between two escapes, of one to four bytes.
  "one-byte-runs": [repeat("a\n", MB / 2)],
  "one-accent-runs": [repeat("é\n", MB / 2)],
  "one-cjk-runs": [repeat("日\n", MB / 2)],
  "one-emoji-runs": [repeat("😀\n", MB / 2)],
  // Short strings, each with two or four escapes.
  "short-strings": Object.fromEntries(
    Array.from({ length: 16000 }, (_, i) => ["script:" + i, `tsc -p "./tsconfig.${i}.json" && echo "done ${i}"`]),
  ),
  // Strings of about 20 bytes with one escape each, in ASCII and not.
  "short-one-escape": Array.from({ length: 40000 }, (_, i) => `line ${i} of the text\n`),
  "short-accents": Array.from({ length: 40000 }, (_, i) => `café numéro ${i}\n`),
  // Keys with an escape. A key is decoded like a value.
  "escaped-keys": Object.fromEntries(Array.from({ length: 16000 }, (_, i) => [`key\t${i}`, i])),
  "neighbours-8": neighbours(40000, ascii(8)),
  "neighbours-16": neighbours(40000, ascii(16)),
  "neighbours-40": neighbours(24000, ascii(40)),
  "neighbours-72": neighbours(16000, ascii(72)),
  // The same with text of 150 bytes that changes between ASCII and other characters.
  "neighbours-mixed": neighbours(
    8000,
    i => `${i} Tiếng Việt là ngôn ngữ chính thức của Việt Nam, hơn 90 triệu người dùng hằng ngày.`,
  ),
  // Nothing but escapes.
  "escape-only": [repeat('\n\t"\\', MB / 2)],
  // Text that is not ASCII: CJK lines, and accented Latin words between ASCII ones.
  cjk: [repeat("日本語のテキスト中文文档安装运行测试代码注释\n", MB)],
  accents: [repeat("// naïve café über " + Buffer.alloc(40, "p").toString() + "\n", MB)],
  // No escape at all. A string of this document is not copied.
  none: Object.fromEntries(
    Array.from({ length: 16000 }, (_, i) => ["key" + i, "value number " + i + " in plain text"]),
  ),
};

for (const [name, value] of Object.entries(documents)) {
  writeFileSync(join(dir, `strings-${name}.json`), JSON.stringify(value));
}

// Every character as a \u escape, which JSON.stringify does not write.
const escaped = Array.from(repeat('日本語のテキスト\n\t"é"', (3 * MB) / 8), unit =>
  Array.from({ length: unit.length }, (_, i) => "\\u" + unit.charCodeAt(i).toString(16).padStart(4, "0")).join(""),
).join("");
writeFileSync(join(dir, "strings-all-escaped.json"), `["${escaped}"]`);

// Lines of bytes that are not UTF-8, each with a \n escape. Only a bench that reads bytes sees them as they are:
// `scripts/bench-json-rust.sh strings-invalid`, or an import of the file with `with { type: "jsonc" }`.
const invalid = {
  // One byte that starts no sequence in a line of ASCII.
  sparse: Buffer.concat([Buffer.from("// " + Buffer.alloc(57, "p").toString()), Buffer.from([0xff])]),
  // The same in a line of CJK text.
  cjk: Buffer.concat([Buffer.from("日本語のテキスト中文文档安装运行测试代码"), Buffer.from([0xff])]),
  // Russian words in Windows-1251, where each letter is one byte that is not ASCII.
  cp1251: Buffer.from(
    Array.from("Привет мир, это текст в кодировке Windows-1251 ", c => c.charCodeAt(0) - (c >= "А" ? 0x350 : 0)),
  ),
};
for (const [name, unit] of Object.entries(invalid)) {
  const line = Buffer.concat([unit, Buffer.from("\\n")]);
  const body = Buffer.alloc(MB - (MB % line.length), line);
  writeFileSync(join(dir, `strings-invalid-${name}.json`), Buffer.concat([Buffer.from('["'), body, Buffer.from('"]')]));
}
