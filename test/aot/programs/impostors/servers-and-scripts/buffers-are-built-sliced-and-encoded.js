import { Buffer } from "node:buffer";

const text = Buffer.from("héllo wörld", "utf8");
console.log(text.length, text.toString("hex"), text.toString("base64"), text.toString("base64url"), text.toString("latin1").length, text.toString("utf8", 0, 6));
console.log(Buffer.from("aGk=", "base64").toString(), Buffer.from("6869", "hex").toString(), Buffer.from([104, 105, 256 + 33]).toString(), Buffer.from("zz", "hex").length);
const joined = Buffer.concat([Buffer.from("ab"), Buffer.alloc(2, "x"), new Uint8Array([99])]);
console.log(joined.toString(), joined.indexOf("x"), joined.includes("c"), joined.lastIndexOf("x"), joined.indexOf("nope"), Buffer.byteLength("héllo"), Buffer.isBuffer(joined), Buffer.isBuffer(new Uint8Array(1)));

const numbers = Buffer.alloc(24);
numbers.writeUInt32BE(0xdeadbeef, 0);
numbers.writeInt16LE(-2, 4);
numbers.writeDoubleLE(1.5, 8);
numbers.writeBigUInt64BE(2n ** 63n, 16);
console.log(numbers.readUInt32BE(0), numbers.readUInt32LE(0), numbers.readInt16LE(4), numbers.readUInt8(4), numbers.readDoubleLE(8), numbers.readBigUInt64BE(16), numbers.readFloatBE(0));
try {
  numbers.readUInt32BE(22);
} catch (error) {
  console.log(error.name, error.code);
}
const view = joined.subarray(1, 3);
view[0] = 66;
console.log(joined.toString(), view.toString(), view.buffer === joined.buffer, joined.slice(-2).toString());
console.log(Buffer.compare(Buffer.from("a"), Buffer.from("b")), Buffer.from("a").equals(Buffer.from("a")), [Buffer.from("b"), Buffer.from("a")].sort(Buffer.compare).join());
console.log(JSON.stringify(Buffer.from("hi")), Buffer.from(JSON.parse(JSON.stringify(Buffer.from("hi")))).toString(), [...Buffer.from("hi").entries()]);
const target = Buffer.alloc(6, ".");
console.log(Buffer.from("abcd").copy(target, 1, 1), target.toString(), target.fill("xy", 4).toString(), target.write("Z", 0), target.toString(), target.swap16().toString(), target.reverse().toString());
console.log(Buffer.from(new Uint16Array([1, 2]).buffer).length, Buffer.from("€").toJSON().data, Buffer.alloc(3).toString("hex"), Buffer.allocUnsafe(5).length, Buffer.poolSize);
console.log(new TextDecoder("utf-8", { fatal: false }).decode(Buffer.from([0xe2, 0x82])), atob(btoa("round trip")), Buffer.from("\ud800").toString("hex"));
