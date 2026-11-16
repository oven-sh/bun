// A constant reaches the call through a const binding, a folded concatenation, a template, an import, a helper function or a loop.
// STATISTIC: ByteLiteralsEncoded = 35
import { Buffer as ImportedBuffer } from "node:buffer";
import * as bufferModule from "node:buffer";
import { TextEncoder as ImportedTextEncoder } from "node:util";
function hashOf(bytes: Uint8Array) {
  let hash = 2166136261;
  for (let index = 0; index < bytes.length; index++) hash = Math.imul(hash ^ bytes[index], 16777619);
  return (hash >>> 0).toString(16);
}
function hexOf(bytes: Uint8Array) {
  let hex = "";
  const shown = Math.min(bytes.length, 40);
  for (let index = 0; index < shown; index++) hex += (bytes[index] < 16 ? "0" : "") + bytes[index].toString(16);
  return bytes.length > shown ? hex + ".." : hex;
}
function prototypeOf(value: object) {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Buffer.prototype ? "Buffer.prototype" : prototype === Uint8Array.prototype ? "Uint8Array.prototype" : "another prototype";
}
function describe(bytes: Uint8Array) {
  return [
    "[" + hexOf(bytes) + "]",
    hashOf(bytes),
    "offset " + bytes.byteOffset,
    "of " + bytes.buffer.byteLength,
    "length " + bytes.length,
    prototypeOf(bytes),
    bytes.constructor.name,
    Buffer.isBuffer(bytes) ? "is a Buffer" : "is no Buffer",
    Object.prototype.toString.call(bytes),
    "part: " + prototypeOf(bytes.subarray(0, 1)),
  ].join(" | ");
}
function show(label: string, make: () => Uint8Array) {
  try {
    const first = make();
    const described = describe(first);
    const second = make();
    for (let index = 0; index < first.length; index++) first[index] ^= 0xa5;
    const third = make();
    const areIndependent = first !== second && first.buffer !== second.buffer && describe(second) === described && describe(third) === described;
    console.log(label, "|", described, "|", areIndependent ? "independent" : "SHARED");
  } catch (error: any) {
    console.log(label, "| throws", error.name, "|", error.code, "|", error.message);
  }
}
const constString = "bound to a const \xe9\u20ac";
const constEncoding = "latin1";
const constHex = "68656c" + "6c6f";
const constNumbers = [1, 2, 300];
let reassigned = "first";
const from = Buffer.from;
const BufferUnderAnotherName = Buffer;
const encoderAtTopLevel = new TextEncoder();
const atTopLevel = Buffer.from("at top level \ud83d");
const atTopLevelWithEncoding = Buffer.from("YXQgdG9wIGxldmVs", "base64");
const encodedAtTopLevel = new TextEncoder().encode("at top level \ude00");
const fromHexAtTopLevel = Uint8Array.fromHex("746f70");
const numbersAtTopLevel = new Uint8Array([1, 2, 3]);
console.log("top level |", describe(atTopLevel));
console.log("top level, base64 |", describe(atTopLevelWithEncoding));
console.log("top level, TextEncoder |", describe(encodedAtTopLevel));
console.log("top level, fromHex |", describe(fromHexAtTopLevel));
console.log("top level, numbers |", describe(numbersAtTopLevel));

function bytesOf(input: string) {
  return Buffer.from(input);
}
function bytesIn(input: string, encoding: BufferEncoding) {
  return Buffer.from(input, encoding);
}
function encoded(input: string) {
  return new TextEncoder().encode(input);
}
function withDefault(input = "the default", encoding: BufferEncoding = "utf16le") {
  return Buffer.from(input, encoding);
}
const arrow = (input: string) => Uint8Array.fromBase64(input);

show("a const string", () => Buffer.from(constString));
show("a const string and a const encoding", () => Buffer.from(constString, constEncoding));
show("a const made of a concatenation", () => Buffer.from(constHex, "hex"));
show("a concatenation in the call", () => Buffer.from("con" + "cat" + "enated"));
show("a concatenation of a const and a literal", () => Buffer.from(constString + " and more", ("utf" + "8") as BufferEncoding));
show("a concatenation with a number", () => Buffer.from("n" + 1 + 2.5 + true + null));
show("a template without substitutions", () => Buffer.from(`a template \xe9`));
show("a template of constants", () => Buffer.from(`${constString}/${1 + 1}`));
show("a conditional on a constant", () => Buffer.from(true ? "taken" : "not taken"));
show("a parenthesized literal with a cast", () => Buffer.from(("cast" as string), "latin1" as BufferEncoding));
show("a method of a literal", () => Buffer.from("upper".toUpperCase()));
show("a repeated literal", () => Buffer.from("ab".repeat(3), "utf16le"));
show("String.fromCharCode of constants", () => Buffer.from(String.fromCharCode(0xd83d, 0x61)));
show("a const array of numbers", () => Buffer.from(constNumbers));
show("a const array of numbers, new Uint8Array", () => new Uint8Array(constNumbers));
show("an imported Buffer", () => ImportedBuffer.from("imported \u4e2d", "utf8"));
show("a Buffer off the module's namespace", () => bufferModule.Buffer.from("namespace", "hex"));
show("an imported TextEncoder", () => new ImportedTextEncoder().encode("imported \ud83d"));
show("globalThis.Buffer", () => globalThis.Buffer.from("off globalThis"));
show("Buffer under another name", () => BufferUnderAnotherName.from("another name", "ascii"));
show("from, detached", () => from("detached"));
show("an encoder made at top level", () => encoderAtTopLevel.encode("encoder at top level"));
show("a helper with a literal", () => bytesOf("through a helper \ud83d\ude00"));
show("a helper with another literal", () => bytesOf("through the same helper"));
show("a helper with a literal and an encoding", () => bytesIn("aGVscGVy", "base64"));
show("a helper with a literal and another encoding", () => bytesIn("68656c706572", "hex"));
show("a helper around TextEncoder", () => encoded("through a helper \ude00"));
show("an arrow around fromBase64", () => arrow("YXJyb3c="));
show("default parameters", () => withDefault());
show("one default parameter", () => withDefault("given"));
function reassignedBetweenCalls() {
  const before = Buffer.from(reassigned);
  reassigned = "second";
  return hexOf(before) + " " + hexOf(Buffer.from(reassigned));
}
console.log("a variable that is reassigned |", reassignedBetweenCalls(), "|", reassignedBetweenCalls());

let sum = 0;
for (let iteration = 0; iteration < 5; iteration++) {
  const inLoop = Buffer.from("in a loop");
  sum += inLoop[iteration];
  inLoop[iteration + 1] = 0;
  const encodedInLoop = new TextEncoder().encode("\u20ac in a loop");
  sum += encodedInLoop[iteration];
  encodedInLoop[iteration + 1] = 0;
  const numbersInLoop = new Uint8Array([9, 8, 7, 6, 5, 4]);
  sum += numbersInLoop[iteration];
  numbersInLoop[iteration + 1] = 0;
}
console.log("loops |", sum);

function kept() {
  const all: Uint8Array[] = [];
  for (let iteration = 0; iteration < 4; iteration++) all.push(Buffer.from("kept", "latin1"));
  all[0][0] = 1;
  all[1][1] = 2;
  all[2].fill(3);
  return all.map(hexOf).join(" ");
}
console.log("kept across iterations |", kept());

function grown() {
  const bytes = Buffer.from("grown");
  (bytes as any).extra = "a property of its own";
  return [Object.keys(bytes).join(","), (Buffer.from("grown") as any).extra].join(" | ");
}
console.log("a property on one result |", grown());

function transferred() {
  const bytes = Buffer.from("transferred");
  const moved = bytes.buffer.transfer(4);
  return [bytes.length, moved.byteLength, hexOf(new Uint8Array(moved)), hexOf(Buffer.from("transferred"))].join(" | ");
}
console.log("a buffer that is transferred |", transferred());

async function acrossAwait() {
  const before = Buffer.from("before await");
  await null;
  const after = new TextEncoder().encode("after await");
  return hexOf(before) + " " + hexOf(after);
}
console.log("across an await |", await acrossAwait());

function* acrossYield() {
  yield Buffer.from("first yield", "utf16le");
  yield Uint8Array.fromHex("7969656c64");
}
console.log("across a yield |", [...acrossYield()].map(hexOf).join(" "));

class Example {
  static bytes = Buffer.from("a static field");
  field = new TextEncoder().encode("a field");
  method() {
    return Buffer.from("a method", "ascii");
  }
}
console.log("in a class |", hexOf(Example.bytes), hexOf(new Example().field), hexOf(new Example().method()), new Example().field !== new Example().field);
