// Text is encoded into views and into parts of views, while the buffers behind them are transferred, resized and collected.
//
//   views      Uint8Array, Int8Array, Uint8ClampedArray, Uint16Array, Float64Array, Buffer, a subclass, DataView; small, large, empty;
//              at an offset; over a resizable buffer (fixed length or length-tracking); over a shared buffer
//   parts      view.subarray(begin), view.subarray(begin, end), a part of a part, the whole view on one way and a part on the other
//   bounds     inside, at the ends, beyond, negative, fractions, NaN, infinities, -0, undefined, an object with valueOf that changes the buffer
//   texts      ASCII of 0 to 70 characters, Latin-1, two, three and four byte characters, lone surrogates, ropes, pieces of longer strings
//   in between a transfer, a resize, a collection, a store through the view, or nothing
//   the result only `read` and `written` are read, or it is destructured, kept, spread or compared
//   handlers   every call stands in a try block but one, which cannot throw: a plain Uint8Array, an element of it read on both sides of the call
//   printed    per step: read, written, the length of the view and a hash of its bytes
import type { Random } from "./random";

const makers = [
  "new Uint8Array(SIZE)",
  "new Uint8Array(SIZE)",
  "new Uint8Array(SIZE)",
  "new Int8Array(SIZE)",
  "new Uint8ClampedArray(SIZE)",
  "new Uint16Array(SIZE)",
  "new Float64Array(SIZE)",
  "Buffer.alloc(SIZE)",
  "new Bytes(SIZE)",
  "new Uint8Array(new ArrayBuffer(SIZE + 8), 4, SIZE)",
  "new Uint8Array(new ArrayBuffer(SIZE, { maxByteLength: SIZE * 2 + 8 }))",
  "new Uint8Array(new ArrayBuffer(SIZE + 4, { maxByteLength: SIZE * 2 + 8 }), 2, SIZE)",
  "new Uint8Array(new SharedArrayBuffer(SIZE))",
];

const bounds = ["0", "1", "2", "3", "7", "8", "15", "16", "17", "63", "64", "1000", "-1", "-2", "-8", "-1000", "1.5", "-1.5", "NaN", "Infinity", "-Infinity", "-0", "2 ** 31", "2 ** 32 + 1", "undefined", "at", "at + 1", "view.length", "view.length - 1", "view.length >> 1"]; // prettier-ignore

const texts = [
  '""',
  '"a"',
  '"abc"',
  '"abcdefg"',
  '"abcdefgh"',
  '"abcdefghijklmnop"',
  '"abcdefghijklmnopq"',
  '"x".repeat(63)',
  '"x".repeat(64)',
  '"x".repeat(70)',
  '"é"',
  '"abcé"',
  '"é".repeat(9)',
  '"日本語"',
  '"ab日"',
  '"😀"',
  '"a😀b"',
  '"\\ud800"',
  '"a\\udc00b"',
  '"\\ud800\\ud800"',
  '"ro" + hidden + "pe"',
  '"é" + hidden + "日"',
  '("prefix of a longer string " + hidden).slice(3, 15)',
  '("日本語のテキスト" + hidden).slice(1, 4)',
  "pieces[step & 7]",
];

const between = [
  "",
  "",
  "",
  "Bun.gc(true);",
  "view[0] = 7;",
  "if (!(view.buffer instanceof SharedArrayBuffer)) bufferOf(view).transfer();",
  "if (bufferOf(view).resizable) bufferOf(view).resize(view.buffer.byteLength >> 1);",
  "if (bufferOf(view).resizable) bufferOf(view).resize(bufferOf(view).maxByteLength);",
  "junk = new Array(2000).fill(0).map((_, i) => ({ i }));",
];

export function generate(r: Random, typed: boolean): string {
  const any = typed ? ": any" : "";
  const number = typed ? ": number" : "";
  const string = typed ? ": string" : "";
  const bytes = typed ? ": Uint8Array" : "";
  const functions: string[] = [];
  const calls: string[] = [];
  const count = 3 + r.below(5);
  for (let index = 0; index < count; index++) {
    const begin = r.pick(bounds);
    const end = r.chance(0.3) ? `, ${r.pick(bounds)}` : "";
    const part = r.pick([
      `view.subarray(${begin}${end})`,
      `view.subarray(${begin}${end})`,
      `view.subarray(${begin}${end}).subarray(${r.pick(bounds)})`,
      `(at > 0 ? view.subarray(at) : view)`,
      `view`,
      `view.subarray({ valueOf() { ${r.pick(between)} return ${r.pick(["0", "1", "3"])}; } }${typed ? " as any" : ""})`,
    ]);
    const use = r.pick([
      `const counts = encoder.encodeInto(text, target); return counts.read + "/" + counts.written;`,
      `const { read, written } = encoder.encodeInto(text, target); return read + "/" + written;`,
      `return "/" + encoder.encodeInto(text, target).written;`,
      `const counts = encoder.encodeInto(text, target); kept.push(counts); return JSON.stringify(counts);`,
      `return JSON.stringify({ ...encoder.encodeInto(text, target) });`,
      `const counts = encoder.encodeInto(text, target); kept.push(target); return counts.read + "/" + counts.written + "@" + target.byteOffset;`,
      `let all = ""; for (let i = 0; i < 3; i++) all += encoder.encodeInto(text, target).written + ","; return all;`,
    ]);
    functions.push(`function write${index}(view${r.chance(0.5) ? bytes : any}, text${r.chance(0.7) ? string : any}, at${number}, step${number})${string} {
  const target = ${part};
  ${r.pick(between)}
  ${use}
}`);
    const size = r.pick([0, 1, 2, 7, 8, 16, 24, 64, 65, 300, 5000]);
    calls.push(`{
  let view${any} = ${r.pick(makers).replaceAll("SIZE", String(size))};
  for (let step = 0; step < ${r.pick([1, 3, 20, 200])}; step++) {
    let answer;
    try { answer = write${index}(view, ${r.pick(texts)}, step % ${1 + r.below(20)}, step); } catch (error${any}) { answer = "throws " + error.name; }
    show(${index}, answer, view);
    ${r.chance(0.2) ? `if (view.byteLength === 0) view = ${r.pick(makers).replaceAll("SIZE", String(size || 8))};` : ""}
  }
}`);
  }
  // Nothing in this one throws, so it is called under no handler. There the compiler follows each way to the call by itself, and on one of them the call takes the view that
  // the part was cut out of. It is drawn behind everything else: what an earlier seed made is still made.
  const part = r.pick([
    `view.subarray(at)`,
    `view.subarray(at, view.length)`,
    `view.subarray(at).subarray(1)`,
    `view.subarray(1, -1).subarray(at)`,
    `(at > 0 ? view.subarray(at) : view)`,
  ]);
  functions.push(`function writeWithoutHandler(view${r.chance(0.5) ? bytes : any}, text${string}, at${number})${string} {
  ${r.pick([
    `return encoder.encodeInto(text, ${part}).written + "/" + view[at];`,
    `const before = view[at]; const { read, written } = encoder.encodeInto(text, ${part}); return before + "/" + read + "/" + written + "/" + view[at];`,
    `let written = 0; for (let i = 0; i < 3; i++) written += encoder.encodeInto(text, view.subarray(written + at)).written; return written + "/" + view[at];`,
    `const before = view[at]; encoder.encodeInto(text, ${part}); return before + "/" + view[at];`,
    `const counts = encoder.encodeInto(text, ${part}); kept.push(counts); return JSON.stringify(counts) + view[at];`,
  ])}
}`);
  calls.push(`{
  const view = new Uint8Array(${r.pick([8, 16, 24, 64, 300])});
  for (let step = 0; step < ${r.pick([3, 20, 200])}; step++) show(${count}, writeWithoutHandler(view, ${r.pick(texts)}, step % ${1 + r.below(7)}), view);
}`);
  return `class Bytes extends Uint8Array {}
const encoder = new TextEncoder();
const hidden${string} = JSON.parse('[""]')[0];
const pieces${typed ? ": string[]" : ""} = JSON.parse('["<div>","row","é","Product 17","</div>","日本","1,299.00",""]');
const kept${typed ? ": any[]" : ""} = [];
let junk${any} = null;
function bufferOf(view${any})${any} { return view.buffer; }
let lines = 0, hash = 0;
function show(which${number}, answer${any}, view${any}) {
  let sum = 0;
  try { const all = new Uint8Array(view.buffer, view.byteOffset, view.byteLength); for (let i = 0; i < all.length; i++) sum = (sum * 31 + all[i]) | 0; } catch { sum = -1; }
  const line = which + " " + answer + " " + view.byteLength + " " + sum;
  for (let i = 0; i < line.length; i++) hash = (hash * 33 + line.charCodeAt(i)) | 0;
  if (lines++ < 60) console.log(line);
}
${functions.join("\n")}
${calls.join("\n")}
console.log(lines, hash, kept.length, kept.map(one => (ArrayBuffer.isView(one) ? one.constructor.name + one.byteLength : JSON.stringify(one))).join().length, typeof junk);
`;
}
