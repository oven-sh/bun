// TextEncoder.prototype.encode with a literal string gives the bytes that plain Bun gives.
// STATISTIC: ByteLiteralsEncoded = 0
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
const sharedEncoder = new TextEncoder();
show("empty, a new encoder", () => new TextEncoder().encode(""));
show("empty, a shared encoder", () => sharedEncoder.encode(""));
show("ASCII, a new encoder", () => new TextEncoder().encode("hello, world"));
show("ASCII, a shared encoder", () => sharedEncoder.encode("hello, world"));
show("NUL alone, a new encoder", () => new TextEncoder().encode("\x00"));
show("NUL alone, a shared encoder", () => sharedEncoder.encode("\x00"));
show("e acute, a new encoder", () => new TextEncoder().encode("é"));
show("e acute, a shared encoder", () => sharedEncoder.encode("é"));
show("every UTF-8 length, a new encoder", () => new TextEncoder().encode("aé€😀"));
show("every UTF-8 length, a shared encoder", () => sharedEncoder.encode("aé€😀"));
show("lone lead in the middle, a new encoder", () => new TextEncoder().encode("ab\ud83dcd"));
show("lone lead in the middle, a shared encoder", () => sharedEncoder.encode("ab\ud83dcd"));
show("lone trail at the end, a new encoder", () => new TextEncoder().encode("abc\ude00"));
show("lone trail at the end, a shared encoder", () => sharedEncoder.encode("abc\ude00"));
show("trail before lead, a new encoder", () => new TextEncoder().encode("\ude00\ud83d"));
show("trail before lead, a shared encoder", () => sharedEncoder.encode("\ude00\ud83d"));
show("low bytes spell ASCII, a new encoder", () => new TextEncoder().encode("šŢţ"));
show("low bytes spell ASCII, a shared encoder", () => sharedEncoder.encode("šŢţ"));
show("hex digits, a new encoder", () => new TextEncoder().encode("68656c6c6f"));
show("hex digits, a shared encoder", () => sharedEncoder.encode("68656c6c6f"));
show("base64 characters, a new encoder", () => new TextEncoder().encode("aGVsbG8="));
show("base64 characters, a shared encoder", () => sharedEncoder.encode("aGVsbG8="));
export {};
