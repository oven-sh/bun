// Buffer.from reads base64 leniently, and Uint8Array.fromBase64 reads it as its options say.
// STATISTIC: ByteLiteralsEncoded = 36
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
show("empty, Buffer.from base64", () => Buffer.from("", "base64"));
show("empty, Buffer.from base64url", () => Buffer.from("", "base64url"));
show("empty, Uint8Array.fromBase64", () => Uint8Array.fromBase64(""));
show("empty, Uint8Array.fromBase64, { alphabet: \"base64url\" }", () => Uint8Array.fromBase64("", { alphabet: "base64url" }));
show("empty, Uint8Array.fromBase64, { lastChunkHandling: \"strict\" }", () => Uint8Array.fromBase64("", { lastChunkHandling: "strict" }));
show("one character, Buffer.from base64", () => Buffer.from("a", "base64"));
show("one character, Buffer.from base64url", () => Buffer.from("a", "base64url"));
show("one character, Uint8Array.fromBase64", () => Uint8Array.fromBase64("a"));
show("one character, Uint8Array.fromBase64, { alphabet: \"base64url\" }", () => Uint8Array.fromBase64("a", { alphabet: "base64url" }));
show("one character, Uint8Array.fromBase64, { lastChunkHandling: \"strict\" }", () => Uint8Array.fromBase64("a", { lastChunkHandling: "strict" }));
show("three characters, Buffer.from base64", () => Buffer.from("aGk", "base64"));
show("three characters, Buffer.from base64url", () => Buffer.from("aGk", "base64url"));
show("three characters, Uint8Array.fromBase64", () => Uint8Array.fromBase64("aGk"));
show("three characters, Uint8Array.fromBase64, { alphabet: \"base64url\" }", () => Uint8Array.fromBase64("aGk", { alphabet: "base64url" }));
show("three characters, Uint8Array.fromBase64, { lastChunkHandling: \"strict\" }", () => Uint8Array.fromBase64("aGk", { lastChunkHandling: "strict" }));
show("padded twice too often, Buffer.from base64", () => Buffer.from("aGk===", "base64"));
show("padded twice too often, Buffer.from base64url", () => Buffer.from("aGk===", "base64url"));
show("padded twice too often, Uint8Array.fromBase64", () => Uint8Array.fromBase64("aGk==="));
show("padded twice too often, Uint8Array.fromBase64, { alphabet: \"base64url\" }", () => Uint8Array.fromBase64("aGk===", { alphabet: "base64url" }));
show("padded twice too often, Uint8Array.fromBase64, { lastChunkHandling: \"strict\" }", () => Uint8Array.fromBase64("aGk===", { lastChunkHandling: "strict" }));
show("hello without padding, Buffer.from base64", () => Buffer.from("aGVsbG8", "base64"));
show("hello without padding, Buffer.from base64url", () => Buffer.from("aGVsbG8", "base64url"));
show("hello without padding, Uint8Array.fromBase64", () => Uint8Array.fromBase64("aGVsbG8"));
show("hello without padding, Uint8Array.fromBase64, { alphabet: \"base64url\" }", () => Uint8Array.fromBase64("aGVsbG8", { alphabet: "base64url" }));
show("hello without padding, Uint8Array.fromBase64, { lastChunkHandling: \"strict\" }", () => Uint8Array.fromBase64("aGVsbG8", { lastChunkHandling: "strict" }));
show("newline inside, Buffer.from base64", () => Buffer.from("aGVs\nbG8=", "base64"));
show("newline inside, Buffer.from base64url", () => Buffer.from("aGVs\nbG8=", "base64url"));
show("newline inside, Uint8Array.fromBase64", () => Uint8Array.fromBase64("aGVs\nbG8="));
show("newline inside, Uint8Array.fromBase64, { alphabet: \"base64url\" }", () => Uint8Array.fromBase64("aGVs\nbG8=", { alphabet: "base64url" }));
show("newline inside, Uint8Array.fromBase64, { lastChunkHandling: \"strict\" }", () => Uint8Array.fromBase64("aGVs\nbG8=", { lastChunkHandling: "strict" }));
show("whitespace around, Buffer.from base64", () => Buffer.from("\t aGVsbG8=\r\n", "base64"));
show("whitespace around, Buffer.from base64url", () => Buffer.from("\t aGVsbG8=\r\n", "base64url"));
show("whitespace around, Uint8Array.fromBase64", () => Uint8Array.fromBase64("\t aGVsbG8=\r\n"));
show("whitespace around, Uint8Array.fromBase64, { alphabet: \"base64url\" }", () => Uint8Array.fromBase64("\t aGVsbG8=\r\n", { alphabet: "base64url" }));
show("whitespace around, Uint8Array.fromBase64, { lastChunkHandling: \"strict\" }", () => Uint8Array.fromBase64("\t aGVsbG8=\r\n", { lastChunkHandling: "strict" }));
show("both alphabets, Buffer.from base64", () => Buffer.from("+/-_", "base64"));
show("both alphabets, Buffer.from base64url", () => Buffer.from("+/-_", "base64url"));
show("both alphabets, Uint8Array.fromBase64", () => Uint8Array.fromBase64("+/-_"));
show("both alphabets, Uint8Array.fromBase64, { alphabet: \"base64url\" }", () => Uint8Array.fromBase64("+/-_", { alphabet: "base64url" }));
show("both alphabets, Uint8Array.fromBase64, { lastChunkHandling: \"strict\" }", () => Uint8Array.fromBase64("+/-_", { lastChunkHandling: "strict" }));
show("invalid character inside, Buffer.from base64", () => Buffer.from("aGVs*bG8=", "base64"));
show("invalid character inside, Buffer.from base64url", () => Buffer.from("aGVs*bG8=", "base64url"));
show("invalid character inside, Uint8Array.fromBase64", () => Uint8Array.fromBase64("aGVs*bG8="));
show("invalid character inside, Uint8Array.fromBase64, { alphabet: \"base64url\" }", () => Uint8Array.fromBase64("aGVs*bG8=", { alphabet: "base64url" }));
show("invalid character inside, Uint8Array.fromBase64, { lastChunkHandling: \"strict\" }", () => Uint8Array.fromBase64("aGVs*bG8=", { lastChunkHandling: "strict" }));
show("padding inside, Buffer.from base64", () => Buffer.from("aGVs=bG8=", "base64"));
show("padding inside, Buffer.from base64url", () => Buffer.from("aGVs=bG8=", "base64url"));
show("padding inside, Uint8Array.fromBase64", () => Uint8Array.fromBase64("aGVs=bG8="));
show("padding inside, Uint8Array.fromBase64, { alphabet: \"base64url\" }", () => Uint8Array.fromBase64("aGVs=bG8=", { alphabet: "base64url" }));
show("padding inside, Uint8Array.fromBase64, { lastChunkHandling: \"strict\" }", () => Uint8Array.fromBase64("aGVs=bG8=", { lastChunkHandling: "strict" }));
show("only padding, Buffer.from base64", () => Buffer.from("====", "base64"));
show("only padding, Buffer.from base64url", () => Buffer.from("====", "base64url"));
show("only padding, Uint8Array.fromBase64", () => Uint8Array.fromBase64("===="));
show("only padding, Uint8Array.fromBase64, { alphabet: \"base64url\" }", () => Uint8Array.fromBase64("====", { alphabet: "base64url" }));
show("only padding, Uint8Array.fromBase64, { lastChunkHandling: \"strict\" }", () => Uint8Array.fromBase64("====", { lastChunkHandling: "strict" }));
show("CJK inside, Buffer.from base64", () => Buffer.from("aGVs中bG8=", "base64"));
show("CJK inside, Buffer.from base64url", () => Buffer.from("aGVs中bG8=", "base64url"));
show("CJK inside, Uint8Array.fromBase64", () => Uint8Array.fromBase64("aGVs中bG8="));
show("CJK inside, Uint8Array.fromBase64, { alphabet: \"base64url\" }", () => Uint8Array.fromBase64("aGVs中bG8=", { alphabet: "base64url" }));
show("CJK inside, Uint8Array.fromBase64, { lastChunkHandling: \"strict\" }", () => Uint8Array.fromBase64("aGVs中bG8=", { lastChunkHandling: "strict" }));
show("low byte spells padding, Buffer.from base64", () => Buffer.from("aGkĽ", "base64"));
show("low byte spells padding, Buffer.from base64url", () => Buffer.from("aGkĽ", "base64url"));
show("low byte spells padding, Uint8Array.fromBase64", () => Uint8Array.fromBase64("aGkĽ"));
show("low byte spells padding, Uint8Array.fromBase64, { alphabet: \"base64url\" }", () => Uint8Array.fromBase64("aGkĽ", { alphabet: "base64url" }));
show("low byte spells padding, Uint8Array.fromBase64, { lastChunkHandling: \"strict\" }", () => Uint8Array.fromBase64("aGkĽ", { lastChunkHandling: "strict" }));
show("one byte with one padding, Buffer.from base64", () => Buffer.from("AA=", "base64"));
show("one byte with one padding, Buffer.from base64url", () => Buffer.from("AA=", "base64url"));
show("one byte with one padding, Uint8Array.fromBase64", () => Uint8Array.fromBase64("AA="));
show("one byte with one padding, Uint8Array.fromBase64, { alphabet: \"base64url\" }", () => Uint8Array.fromBase64("AA=", { alphabet: "base64url" }));
show("one byte with one padding, Uint8Array.fromBase64, { lastChunkHandling: \"strict\" }", () => Uint8Array.fromBase64("AA=", { lastChunkHandling: "strict" }));
show("nonzero spare bits, Buffer.from base64", () => Buffer.from("AB==", "base64"));
show("nonzero spare bits, Buffer.from base64url", () => Buffer.from("AB==", "base64url"));
show("nonzero spare bits, Uint8Array.fromBase64", () => Uint8Array.fromBase64("AB=="));
show("nonzero spare bits, Uint8Array.fromBase64, { alphabet: \"base64url\" }", () => Uint8Array.fromBase64("AB==", { alphabet: "base64url" }));
show("nonzero spare bits, Uint8Array.fromBase64, { lastChunkHandling: \"strict\" }", () => Uint8Array.fromBase64("AB==", { lastChunkHandling: "strict" }));
export {};
