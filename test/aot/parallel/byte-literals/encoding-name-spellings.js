// An encoding's name is matched in any letter case, an unknown name throws, and an encoding that is not a string means UTF-8.
// STATISTIC: ByteLiteralsEncoded = 36
function hashOf(bytes) {
  let hash = 2166136261;
  for (let index = 0; index < bytes.length; index++) hash = Math.imul(hash ^ bytes[index], 16777619);
  return (hash >>> 0).toString(16);
}
function hexOf(bytes) {
  let hex = "";
  const shown = Math.min(bytes.length, 40);
  for (let index = 0; index < shown; index++) hex += (bytes[index] < 16 ? "0" : "") + bytes[index].toString(16);
  return bytes.length > shown ? hex + ".." : hex;
}
function prototypeOf(value) {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Buffer.prototype ? "Buffer.prototype" : prototype === Uint8Array.prototype ? "Uint8Array.prototype" : "another prototype";
}
function describe(bytes) {
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
function show(label, make) {
  try {
    const first = make();
    const described = describe(first);
    const second = make();
    for (let index = 0; index < first.length; index++) first[index] ^= 0xa5;
    const third = make();
    const areIndependent = first !== second && first.buffer !== second.buffer && describe(second) === described && describe(third) === described;
    console.log(label, "|", described, "|", areIndependent ? "independent" : "SHARED");
  } catch (error) {
    console.log(label, "| throws", error.name, "|", error.code, "|", error.message);
  }
}
show("every UTF-8 length, utf8", () => Buffer.from("aé€😀", "utf8"));
show("every UTF-8 length, UTF8", () => Buffer.from("aé€😀", "UTF8"));
show("every UTF-8 length, UtF8", () => Buffer.from("aé€😀", "UtF8"));
show("every UTF-8 length, utf-8", () => Buffer.from("aé€😀", "utf-8"));
show("every UTF-8 length, UTF-8", () => Buffer.from("aé€😀", "UTF-8"));
show("every UTF-8 length, UtF-8", () => Buffer.from("aé€😀", "UtF-8"));
show("every UTF-8 length, latin1", () => Buffer.from("aé€😀", "latin1"));
show("every UTF-8 length, LATIN1", () => Buffer.from("aé€😀", "LATIN1"));
show("every UTF-8 length, LaTiN1", () => Buffer.from("aé€😀", "LaTiN1"));
show("every UTF-8 length, binary", () => Buffer.from("aé€😀", "binary"));
show("every UTF-8 length, BINARY", () => Buffer.from("aé€😀", "BINARY"));
show("every UTF-8 length, BiNaRy", () => Buffer.from("aé€😀", "BiNaRy"));
show("every UTF-8 length, ascii", () => Buffer.from("aé€😀", "ascii"));
show("every UTF-8 length, ASCII", () => Buffer.from("aé€😀", "ASCII"));
show("every UTF-8 length, AsCiI", () => Buffer.from("aé€😀", "AsCiI"));
show("every UTF-8 length, hex", () => Buffer.from("aé€😀", "hex"));
show("every UTF-8 length, HEX", () => Buffer.from("aé€😀", "HEX"));
show("every UTF-8 length, HeX", () => Buffer.from("aé€😀", "HeX"));
show("every UTF-8 length, base64", () => Buffer.from("aé€😀", "base64"));
show("every UTF-8 length, BASE64", () => Buffer.from("aé€😀", "BASE64"));
show("every UTF-8 length, BaSe64", () => Buffer.from("aé€😀", "BaSe64"));
show("every UTF-8 length, base64url", () => Buffer.from("aé€😀", "base64url"));
show("every UTF-8 length, BASE64URL", () => Buffer.from("aé€😀", "BASE64URL"));
show("every UTF-8 length, BaSe64UrL", () => Buffer.from("aé€😀", "BaSe64UrL"));
show("every UTF-8 length, ucs2", () => Buffer.from("aé€😀", "ucs2"));
show("every UTF-8 length, UCS2", () => Buffer.from("aé€😀", "UCS2"));
show("every UTF-8 length, UcS2", () => Buffer.from("aé€😀", "UcS2"));
show("every UTF-8 length, ucs-2", () => Buffer.from("aé€😀", "ucs-2"));
show("every UTF-8 length, UCS-2", () => Buffer.from("aé€😀", "UCS-2"));
show("every UTF-8 length, UcS-2", () => Buffer.from("aé€😀", "UcS-2"));
show("every UTF-8 length, utf16le", () => Buffer.from("aé€😀", "utf16le"));
show("every UTF-8 length, UTF16LE", () => Buffer.from("aé€😀", "UTF16LE"));
show("every UTF-8 length, UtF16lE", () => Buffer.from("aé€😀", "UtF16lE"));
show("every UTF-8 length, utf-16le", () => Buffer.from("aé€😀", "utf-16le"));
show("every UTF-8 length, UTF-16LE", () => Buffer.from("aé€😀", "UTF-16LE"));
show("every UTF-8 length, UtF-16Le", () => Buffer.from("aé€😀", "UtF-16Le"));
show("every UTF-8 length, unknown \"nope\"", () => Buffer.from("aé€😀", "nope"));
show("every UTF-8 length, unknown \"\"", () => Buffer.from("aé€😀", ""));
show("every UTF-8 length, unknown \"utf9\"", () => Buffer.from("aé€😀", "utf9"));
show("every UTF-8 length, unknown \"utf 8\"", () => Buffer.from("aé€😀", "utf 8"));
show("every UTF-8 length, unknown \"utf8 \"", () => Buffer.from("aé€😀", "utf8 "));
show("every UTF-8 length, unknown \" utf8\"", () => Buffer.from("aé€😀", " utf8"));
show("every UTF-8 length, unknown \"utf_8\"", () => Buffer.from("aé€😀", "utf_8"));
show("every UTF-8 length, unknown \"utf16\"", () => Buffer.from("aé€😀", "utf16"));
show("every UTF-8 length, unknown \"utf-16\"", () => Buffer.from("aé€😀", "utf-16"));
show("every UTF-8 length, unknown \"ucs-4\"", () => Buffer.from("aé€😀", "ucs-4"));
show("every UTF-8 length, unknown \"base-64\"", () => Buffer.from("aé€😀", "base-64"));
show("every UTF-8 length, unknown \"buffer\"", () => Buffer.from("aé€😀", "buffer"));
show("every UTF-8 length, unknown \"BUFFER\"", () => Buffer.from("aé€😀", "BUFFER"));
show("every UTF-8 length, unknown \"latin-1\"", () => Buffer.from("aé€😀", "latin-1"));
show("every UTF-8 length, unknown \"us-ascii\"", () => Buffer.from("aé€😀", "us-ascii"));
show("every UTF-8 length, unknown \"ıtf8\"", () => Buffer.from("aé€😀", "ıtf8"));
show("every UTF-8 length, unknown \"utf8\\u0000\"", () => Buffer.from("aé€😀", "utf8\x00"));
show("every UTF-8 length, encoding undefined", () => Buffer.from("aé€😀", undefined));
show("every UTF-8 length, encoding null", () => Buffer.from("aé€😀", null));
show("every UTF-8 length, encoding 1", () => Buffer.from("aé€😀", 1));
show("every UTF-8 length, encoding 0", () => Buffer.from("aé€😀", 0));
show("every UTF-8 length, encoding true", () => Buffer.from("aé€😀", true));
show("every UTF-8 length, encoding false", () => Buffer.from("aé€😀", false));
show("every UTF-8 length, encoding NaN", () => Buffer.from("aé€😀", NaN));
show("every UTF-8 length, encoding {}", () => Buffer.from("aé€😀", {}));
show("every UTF-8 length, encoding []", () => Buffer.from("aé€😀", []));
show("every UTF-8 length, encoding [\"hex\"]", () => Buffer.from("aé€😀", ["hex"]));
show("every UTF-8 length, encoding Symbol.iterator", () => Buffer.from("aé€😀", Symbol.iterator));
show("every UTF-8 length, encoding 1n", () => Buffer.from("aé€😀", 1n));
show("every UTF-8 length, encoding () => 1", () => Buffer.from("aé€😀", () => 1));
show("every UTF-8 length, encoding void 0", () => Buffer.from("aé€😀", void 0));
show("every UTF-8 length, three arguments", () => Buffer.from("aé€😀", "latin1", 2));
show("every UTF-8 length, a length and no encoding", () => Buffer.from("aé€😀", undefined, 2));
