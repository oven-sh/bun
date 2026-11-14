// Buffer.from stops at the first bad pair of hex digits, and Uint8Array.fromHex throws.
// STATISTIC: ByteLiteralsEncoded = 12
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
show("empty, Buffer.from", () => Buffer.from("", "hex"));
show("empty, Uint8Array.fromHex", () => Uint8Array.fromHex(""));
show("odd length, Buffer.from", () => Buffer.from("686", "hex"));
show("odd length, Uint8Array.fromHex", () => Uint8Array.fromHex("686"));
show("five pairs, Buffer.from", () => Buffer.from("68656c6c6f", "hex"));
show("five pairs, Uint8Array.fromHex", () => Uint8Array.fromHex("68656c6c6f"));
show("upper case, Buffer.from", () => Buffer.from("68656C6C6F", "hex"));
show("upper case, Uint8Array.fromHex", () => Uint8Array.fromHex("68656C6C6F"));
show("bad pair in the middle, Buffer.from", () => Buffer.from("68zz65", "hex"));
show("bad pair in the middle, Uint8Array.fromHex", () => Uint8Array.fromHex("68zz65"));
show("bad pair at the end, Buffer.from", () => Buffer.from("6865zz", "hex"));
show("bad pair at the end, Uint8Array.fromHex", () => Uint8Array.fromHex("6865zz"));
show("bad second digit, Buffer.from", () => Buffer.from("686g65", "hex"));
show("bad second digit, Uint8Array.fromHex", () => Uint8Array.fromHex("686g65"));
show("CJK in the middle, Buffer.from", () => Buffer.from("68中中65", "hex"));
show("CJK in the middle, Uint8Array.fromHex", () => Uint8Array.fromHex("68中中65"));
show("low bytes spell digits, Buffer.from", () => Buffer.from("Ķĸ65", "hex"));
show("low bytes spell digits, Uint8Array.fromHex", () => Uint8Array.fromHex("Ķĸ65"));
export {};
