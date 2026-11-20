// TextEncoder.encode and TextDecoder.decode of every width, lone surrogates, marks, invalid bytes, views of every kind, streams, and subclasses.
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const fatal = new TextDecoder("utf-8", { fatal: true });
const keeping = new TextDecoder("utf-8", { ignoreBOM: true });
const latin = new TextDecoder("latin1");
const sixteen = new TextDecoder("utf-16le");
const wide = "日本語";
const texts: string[] = ["", "a", "\u007f", "\u0080", "ÿ", "café", wide, "😀", "\ud83d", "\ude00", "a\ud83db", "\ude00\ud83d", "\ud83d😀", "￿￾", "﻿", "﻿abc", "a﻿", "x".repeat(15), "x".repeat(16), "x".repeat(64), "x".repeat(127) + "é",
  (wide + "x").repeat(31), (wide + "x").repeat(32), (wide + "x").repeat(33), "😀".repeat(64), "😀".repeat(65), "\ud83d".repeat(128), "\ud83d".repeat(129), "y".repeat(5000), "y".repeat(5000) + wide, "a" + "é".repeat(3000), (wide + "abc").slice(3), ("(" + wide + ")").slice(1, -1), "left " + "right".repeat(3) + wide];
const invalid: number[][] = [[0x80], [0xc0, 0x80], [0xe0, 0x80, 0x80], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xf0, 0x9f, 0x98], [0x61, 0xff, 0x62], [0xe6, 0x97], [0xef, 0xbb], [0xef, 0xbb, 0xbf], [0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x41], [0xc3, 0x28], [0xf8, 0x88, 0x80, 0x80, 0x80]];
let digest = 0;
const add = (text: string) => {
  for (let i = 0; i < text.length; i++) digest = (Math.imul(digest, 31) + text.charCodeAt(i)) | 0;
  digest = (digest + text.length) | 0;
};
function tryDecode(which: TextDecoder, bytes: any, options?: any): string {
  try {
    return JSON.stringify(which.decode(bytes, options));
  } catch (error: any) {
    return error.name + " " + error.code;
  }
}
function roundTrips(list: string[]): number {
  let total = 0;
  for (const text of list) {
    const bytes = encoder.encode(text);
    total += bytes.length + bytes.byteOffset + bytes.buffer.byteLength;
    for (let i = 0; i < bytes.length; i++) digest = (Math.imul(digest, 31) + bytes[i]) | 0;
    add(decoder.decode(bytes));
    const other = encoder.encode(text);
    if (other.length) other[0] = 97;
    add(decoder.decode(other));
    add(tryDecode(fatal, other));
    add(keeping.decode(bytes));
    add(latin.decode(bytes));
    add(sixteen.decode(bytes));
    add(decoder.decode(bytes.subarray(1)));
    add(decoder.decode(new Uint8Array(bytes.buffer)));
    add(decoder.decode(bytes.buffer));
    add(decoder.decode(Buffer.from(bytes)));
    add(decoder.decode(new Uint16Array(bytes.buffer.slice(0, bytes.length & ~1))));
    add(decoder.decode(new DataView(bytes.buffer)));
  }
  return total;
}
for (let turn = 0; turn < 3; turn++) console.log(roundTrips(texts), digest);
for (const bytes of invalid) {
  const view = new Uint8Array(bytes);
  console.log(tryDecode(decoder, view), tryDecode(fatal, view), tryDecode(keeping, view), tryDecode(latin, view), tryDecode(decoder, view, { stream: true }), tryDecode(decoder, encoder.encode("é")), tryDecode(decoder, view, { stream: true }), tryDecode(decoder, undefined), tryDecode(decoder, view, null));
}
for (let i = 0; i < 3; i++) console.log(tryDecode(decoder, wide), tryDecode(decoder, null), tryDecode(decoder, undefined), tryDecode(decoder, 1), tryDecode(decoder, []), tryDecode(decoder, new Uint8Array(0)), encoder.encode(undefined as any).length, encoder.encode().length, encoder.encode(null as any).length, encoder.encode(12 as any).join(), encoder.encode({ toString: () => wide } as any).join());
// Bytes drawn from a seed: mostly leads and continuations, so that most sequences break off somewhere.
let seed = 12345;
const draw = (n: number): number => {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return (seed >>> 8) % n;
};
const kinds = [0x41, 0x7f, 0x80, 0x8f, 0x90, 0x9f, 0xa0, 0xbf, 0xc0, 0xc1, 0xc2, 0xdf, 0xe0, 0xe1, 0xec, 0xed, 0xee, 0xef, 0xf0, 0xf1, 0xf3, 0xf4, 0xf5, 0xff, 0xbb, 0x9f, 0x98, 0x80];
for (let round = 0; round < 40; round++) {
  const list: Uint8Array[] = [];
  for (let i = 0; i < 60; i++) {
    const view = new Uint8Array(i < 50 ? draw(14) : 240 + draw(40));
    for (let k = 0; k < view.length; k++) view[k] = kinds[draw(kinds.length)];
    list.push(view);
  }
  for (const view of list) {
    add(decoder.decode(view));
    add(keeping.decode(view));
    add(tryDecode(fatal, view));
    add(tryDecode(decoder, view.subarray(1)));
  }
  console.log(round, digest);
}
for (let length = 0; length < 300; length++) {
  let text = "";
  for (let k = 0; k < length; k++) text += String.fromCharCode([0x41, 0xe9, 0x4e00, 0xd83d, 0xde00, 0x7ff, 0x800, 0xffff][draw(8)]);
  for (const part of [text, text.slice(1), text + "\ud83d"]) {
    const bytes = encoder.encode(part);
    add(String(bytes.length));
    for (let k = 0; k < bytes.length; k++) digest = (Math.imul(digest, 31) + bytes[k]) | 0;
    add(decoder.decode(bytes));
  }
}
console.log(digest);
const shared = new Uint8Array(new SharedArrayBuffer(4)).fill(0x62);
const resizable = new Uint8Array(new ArrayBuffer(4, { maxByteLength: 8 })).fill(0x63);
const detached = new Uint8Array(4);
structuredClone(detached.buffer, { transfer: [detached.buffer] });
class Encoder extends TextEncoder { encode(text?: string) { return super.encode(text + "!"); } }
class Decoder extends TextDecoder { decode(bytes?: any, options?: any) { return super.decode(bytes, options) + "?"; } }
const own: any = new TextDecoder();
own.decode = () => "own";
for (let i = 0; i < 3; i++) {
  console.log(tryDecode(decoder, shared), tryDecode(decoder, resizable), tryDecode(decoder, detached), new Decoder().decode(new Encoder().encode("sub")), own.decode(shared), decoder.decode.call(keeping, encoder.encode("﻿a")).length);
  (resizable.buffer as any).resize(2 + i);
}
try { (encoder.encode as any).call({}, "a"); } catch (error: any) { console.log(error.name); }
try { (decoder.decode as any).call({}, shared); } catch (error: any) { console.log(error.name); }
// Valid text of every width with a few bytes broken, at every distance from its ends.
const pieces = ["x", "é", wide, "😀", "ab", "￿", "߿", "ࠀ", "\u{10ffff}"];
for (let round = 0; round < 600; round++) {
  let text = "";
  const length = 8 + draw(90);
  for (let i = 0; i < length; i++) text += pieces[draw(1 + (round % pieces.length))];
  const bytes = encoder.encode(text);
  const broken = draw(4);
  for (let i = 0; i < broken; i++) bytes[draw(bytes.length)] = kinds[draw(kinds.length)];
  const view = bytes.subarray(draw(3), bytes.length - draw(4));
  add(decoder.decode(view));
  add(tryDecode(fatal, view));
  add(keeping.decode(view));
  if (round % 100 === 99) console.log(round, digest);
}
