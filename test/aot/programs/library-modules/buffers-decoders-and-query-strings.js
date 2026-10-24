// node:buffer, node:string_decoder, node:querystring and node:punycode: encodings, reads and writes of numbers, slices that share memory, search, comparison, transcode, Blob and File, characters split over two chunks, and escaping.
import { Buffer, Blob, File, constants, transcode, isUtf8, isAscii, btoa, atob, kMaxLength } from "node:buffer";
import { StringDecoder } from "node:string_decoder";
import querystring from "node:querystring";

process.noDeprecation = true;
const text = Buffer.from("héllo wörld");
console.log(text.length, text.toString("hex"), text.toString("base64"), text.toString("base64url"), text.toString("latin1").length, text.toString("utf8", 0, 3), text.toString("ascii").length);
console.log(Buffer.from("aGk=", "base64").toString(), Buffer.from("6869", "hex").toString(), Buffer.from("hi", "utf16le").length, Buffer.from([256, -1, 1.5]).join(), Buffer.from(new Uint16Array([1, 2]).buffer).length);
const numbers = Buffer.alloc(16);
numbers.writeUInt32BE(0xdeadbeef, 0);
numbers.writeInt16LE(-2, 4);
numbers.writeDoubleLE(1.5, 6);
numbers.writeUInt8(255, 14);
console.log(numbers.readUInt32BE(0).toString(16), numbers.readInt16LE(4), numbers.readDoubleLE(6), numbers.readUInt8(14), numbers.readUInt16BE(0), numbers.readBigUInt64BE(0).toString(16), numbers.readIntBE(0, 3));
try {
  numbers.readUInt32BE(14);
} catch (error) {
  console.log(error.code, error.name);
}
const whole = Buffer.from("abcdef"), part = whole.subarray(1, 3);
part[0] = 66;
console.log(whole.toString(), part.toString(), whole.slice(-2).toString(), Buffer.concat([part, part], 3).toString(), Buffer.alloc(3, "xy").toString(), Buffer.allocUnsafe(2).length);
console.log(whole.indexOf("d"), whole.includes("zz"), whole.lastIndexOf("f"), Buffer.compare(Buffer.from("a"), Buffer.from("b")), whole.equals(Buffer.from("aBcdef")), Buffer.byteLength("é"), Buffer.isBuffer(whole), Buffer.isBuffer(new Uint8Array(1)), Buffer.isEncoding("hex"), Buffer.isEncoding("nope"));
console.log(JSON.stringify(Buffer.from("hi")), whole.fill("z", 4).toString(), whole.copy(numbers, 0, 0, 2), Buffer.from("0102", "hex").swap16().toString("hex"), [...Buffer.from("ab").entries()].join("|"), whole.write("Q", 0), whole.toString());
console.log(transcode(Buffer.from("é"), "utf8", "latin1").length, isUtf8(Buffer.from([0xc3, 0x28])), isAscii(Buffer.from("abc")), btoa("hi"), atob("aGk="), kMaxLength === constants.MAX_LENGTH, typeof constants.MAX_STRING_LENGTH);
const blob = new Blob(["ab", Buffer.from("cd")], { type: "text/plain" });
console.log(blob.size, blob.type, await blob.text(), await blob.slice(1, 3).text(), new File(["x"], "name.txt").name, Blob === globalThis.Blob);

const decoder = new StringDecoder("utf8");
const euro = Buffer.from("€");
console.log(JSON.stringify(decoder.write(euro.subarray(0, 1))), JSON.stringify(decoder.write(euro.subarray(1, 2))), decoder.write(euro.subarray(2)), JSON.stringify(decoder.end()), JSON.stringify(new StringDecoder("utf8").end(euro.subarray(0, 2))), new StringDecoder("hex").write(Buffer.from("hi")), new StringDecoder("base64").write(Buffer.from("h")) + "|" + new StringDecoder("utf16le").write(Buffer.from([104, 0])));

console.log(JSON.stringify(querystring.parse("a=1&a=2&b=x%20y&c&d=%E4")), querystring.stringify({ a: [1, 2], b: "x y", c: "", d: true, e: null }), querystring.escape("a b&c=d/é"), querystring.unescape("a%20b%zz"), querystring.stringify({ a: 1, b: 2 }, ";", ":"), JSON.stringify(querystring.parse("a:1;b:2", ";", ":")), JSON.stringify(querystring.parse("a=1&b=2&c=3", null, null, { maxKeys: 2 })));
