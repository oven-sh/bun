// @runtime bun,node
import { Buffer, transcode } from "node:buffer";
import { bench, group, run } from "../runner.mjs";

// UTF-16 units in each source. Example: UNITS=16,1024,32768,524288
const sizes = (process.env.UNITS ?? "16,32768").split(",").map(Number);

// The same sources on every run and in every runtime.
let state = 1;
const random = () => {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const range = (first, last) => () => first + Math.floor(random() * (last - first + 1));
const oneOf = list => () => list[Math.floor(random() * list.length)];
// `share` of the code points come from `special`, the others from `common`.
const mix = (share, special, common) => () => (random() < share ? special() : common());
// Words of 2 to 8 code points with a space between them. `share` of the words come from `special`.
const words = (share, special, common) => {
  let left = 0;
  let letter = common;
  return () => {
    if (left-- > 0) return letter();
    left = 2 + Math.floor(random() * 7);
    letter = random() < share ? special : common;
    return 0x20;
  };
};

const ascii = range(0x61, 0x7a);
const cyrillic = range(0x0430, 0x044f);
const cjk = range(0x4e00, 0x9fff);
const emoji = range(0x1f600, 0x1f64f);
const zeroWidthSpace = () => 0x200b;

// [text, from, to, next code point, encoding of the source bytes when it is not `from`]
const rows = [
  // A latin1 target converts in bulk when it can encode every code point.
  ["latin1 text", "ucs2", "latin1", mix(0.1, range(0xe0, 0xfd), ascii)],
  ["ASCII", "utf8", "latin1", ascii],
  // Every other row converts unit by unit.
  ["ASCII", "ucs2", "ascii", ascii],
  ["ASCII", "utf8", "ascii", ascii],
  ["ASCII", "latin1", "ascii", ascii],
  ["8% accented letters", "utf8", "ascii", mix(0.08, oneOf([0xe9, 0xe8, 0xe0, 0xe7, 0xea, 0xfc, 0xf1]), ascii)],
  [
    "3% curly quotes and dashes",
    "ucs2",
    "latin1",
    mix(0.03, oneOf([0x2018, 0x2019, 0x201c, 0x201d, 0x2014, 0x2026]), ascii),
  ],
  ["Cyrillic words, 20% ASCII words", "utf8", "latin1", words(0.2, ascii, cyrillic)],
  ["Cyrillic words, 20% ASCII words", "ucs2", "ascii", words(0.2, ascii, cyrillic)],
  ["CJK, 10% fullwidth punctuation", "ucs2", "latin1", mix(0.1, oneOf([0xff0c, 0x3002, 0xff1f, 0xff01]), cjk)],
  ["2% emoji", "ucs2", "ascii", mix(0.02, emoji, ascii)],
  ["all CJK", "ucs2", "latin1", cjk],
  ["all emoji", "ucs2", "latin1", emoji],
  ["all bytes above 0x7F", "ascii", "latin1", range(0x80, 0xff), "latin1"],
  ["all invalid bytes", "utf8", "latin1", range(0x80, 0xbf), "latin1"],
  // ICU, and so Node, writes nothing for a default-ignorable code point that the target cannot encode.
  ["2.5% zero width spaces", "ucs2", "ascii", mix(0.025, zeroWidthSpace, ascii)],
  ["2.5% zero width spaces", "utf8", "latin1", mix(0.025, zeroWidthSpace, ascii)],
  ["all zero width spaces", "ucs2", "latin1", zeroWidthSpace],
];

function source(units, encoding, next) {
  const text = new Uint16Array(units);
  for (let length = 0; length < units;) {
    const codePoint = next();
    if (codePoint <= 0xffff) {
      text[length++] = codePoint;
    } else if (length + 2 <= units) {
      text[length++] = 0xd800 + ((codePoint - 0x10000) >> 10);
      text[length++] = 0xdc00 + ((codePoint - 0x10000) & 0x3ff);
    } else {
      text[length++] = 0x20;
    }
  }
  const ucs2 = Buffer.from(text.buffer);
  return encoding === "ucs2" ? ucs2 : Buffer.from(ucs2.toString("ucs2"), encoding);
}

for (const units of sizes) {
  // Each row converts a pool of different sources in rotation. The unit by unit path has branches on the text,
  // and one source that repeats lets the branch predictor learn it.
  const pool = 2 ** Math.max(1, Math.min(12, Math.floor(Math.log2(2 ** 19 / units))));
  group(`${units} UTF-16 units`, () => {
    for (const [text, from, to, next, encoding = from] of rows) {
      const sources = Array.from({ length: pool }, () => source(units, encoding, next));
      let cursor = 0;
      bench(`${from} to ${to}, ${text}`, () => transcode(sources[cursor++ & (pool - 1)], from, to));
    }
  });
}

await run();
