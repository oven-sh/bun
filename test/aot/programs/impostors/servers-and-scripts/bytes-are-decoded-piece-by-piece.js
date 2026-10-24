import { StringDecoder } from "node:string_decoder";

const euro = Buffer.from("a€b😀c");
const decoder = new StringDecoder("utf8");
const pieces = [];
for (const byte of euro) pieces.push(decoder.write(Buffer.from([byte])));
console.log(pieces, JSON.stringify(decoder.end()), decoder.encoding);
const cut = new StringDecoder("utf8");
console.log(JSON.stringify(cut.write(euro.subarray(0, 3))), JSON.stringify(cut.end()), JSON.stringify(new StringDecoder("hex").write(euro.subarray(0, 2))));
const base64 = new StringDecoder("base64");
console.log(base64.write(Buffer.from("ab")), base64.write(Buffer.from("cd")), base64.end(), new StringDecoder("utf16le").write(Buffer.from("hi", "utf16le")), new StringDecoder("latin1").write(Buffer.from([0xe9])));
try {
  new StringDecoder("klingon");
} catch (error) {
  console.log(error.name, error.code);
}

const streaming = new TextDecoder("utf-8");
let text = "";
for (let i = 0; i < euro.length; i += 2) text += streaming.decode(euro.subarray(i, i + 2), { stream: true });
console.log(text + streaming.decode(), streaming.encoding, streaming.fatal, streaming.ignoreBOM);
try {
  new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array([0xff]));
} catch (error) {
  console.log(error.name, error.code);
}
console.log(new TextDecoder().decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x61])).length, new TextDecoder("utf-8", { ignoreBOM: true }).decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x61])).length);
console.log(new TextDecoder("utf-16le").decode(new Uint8Array([0x61, 0, 0x3d, 0xd8, 0, 0xde])), new TextDecoder("latin1").decode(new Uint8Array([0xe9, 0x80])), new TextDecoder("windows-1252").encoding);
const encoder = new TextEncoder();
const room = new Uint8Array(5);
console.log(encoder.encode("€").length, encoder.encodeInto("a€€", room), room, encoder.encode("\ud800").join(), encoder.encode().length, encoder.encoding);
const stream = new Blob([euro.subarray(0, 3), euro.subarray(3)]).stream().pipeThrough(new TextDecoderStream());
let joined = "";
for await (const piece of stream) joined += piece;
console.log(joined, joined.length, [...joined].length, joined.isWellFormed(), "\ud800".toWellFormed() === "�", joined.normalize("NFD").length);
