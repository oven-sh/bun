// isAscii, isUtf8, transcode, resolveObjectURL, and SlowBuffer called and constructed.
import { SlowBuffer, isAscii, isUtf8, resolveObjectURL, transcode } from "node:buffer";
function ascii() { return isAscii(Buffer.from("abc")); }
function utf8() { return isUtf8(new Uint8Array([0xff])); }
console.log(ascii(), utf8());
function moved() { return transcode(Buffer.from("€"), "utf8", "ucs2"); }
console.log(moved() instanceof Buffer, moved().length, moved().toString("hex"), typeof moved().readUInt8, moved().offset);
const url = URL.createObjectURL(new Blob(["abc"], { type: "text/plain" }));
function resolved() { return resolveObjectURL(url); }
console.log(resolved() instanceof Blob, resolved().size, resolved().type, await resolved().text(), resolveObjectURL("blob:nothing"));
function slow() { return new SlowBuffer(3); }
function called() { return SlowBuffer(3); }
console.log(slow() instanceof Buffer, slow().length, called().length, typeof slow().parent, slow().fill(1).toString("hex"));
try { isAscii(1); } catch (error) { console.log(error.code); }
