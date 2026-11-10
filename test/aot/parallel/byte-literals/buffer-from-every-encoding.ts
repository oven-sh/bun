// Buffer.from with a literal string and a literal encoding gives the bytes that plain Bun gives.
// STATISTIC: ByteLiteralsEncoded = 143
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
show("empty, no encoding", () => Buffer.from(""));
show("empty, utf8", () => Buffer.from("", "utf8"));
show("empty, utf-8", () => Buffer.from("", "utf-8"));
show("empty, latin1", () => Buffer.from("", "latin1"));
show("empty, binary", () => Buffer.from("", "binary"));
show("empty, ascii", () => Buffer.from("", "ascii"));
show("empty, hex", () => Buffer.from("", "hex"));
show("empty, base64", () => Buffer.from("", "base64"));
show("empty, base64url", () => Buffer.from("", "base64url"));
show("empty, ucs2", () => Buffer.from("", "ucs2"));
show("empty, ucs-2", () => Buffer.from("", "ucs-2"));
show("empty, utf16le", () => Buffer.from("", "utf16le"));
show("empty, utf-16le", () => Buffer.from("", "utf-16le"));
show("ASCII, no encoding", () => Buffer.from("hello, world"));
show("ASCII, utf8", () => Buffer.from("hello, world", "utf8"));
show("ASCII, utf-8", () => Buffer.from("hello, world", "utf-8"));
show("ASCII, latin1", () => Buffer.from("hello, world", "latin1"));
show("ASCII, binary", () => Buffer.from("hello, world", "binary"));
show("ASCII, ascii", () => Buffer.from("hello, world", "ascii"));
show("ASCII, hex", () => Buffer.from("hello, world", "hex"));
show("ASCII, base64", () => Buffer.from("hello, world", "base64"));
show("ASCII, base64url", () => Buffer.from("hello, world", "base64url"));
show("ASCII, ucs2", () => Buffer.from("hello, world", "ucs2"));
show("ASCII, ucs-2", () => Buffer.from("hello, world", "ucs-2"));
show("ASCII, utf16le", () => Buffer.from("hello, world", "utf16le"));
show("ASCII, utf-16le", () => Buffer.from("hello, world", "utf-16le"));
show("NUL alone, no encoding", () => Buffer.from("\x00"));
show("NUL alone, utf8", () => Buffer.from("\x00", "utf8"));
show("NUL alone, utf-8", () => Buffer.from("\x00", "utf-8"));
show("NUL alone, latin1", () => Buffer.from("\x00", "latin1"));
show("NUL alone, binary", () => Buffer.from("\x00", "binary"));
show("NUL alone, ascii", () => Buffer.from("\x00", "ascii"));
show("NUL alone, hex", () => Buffer.from("\x00", "hex"));
show("NUL alone, base64", () => Buffer.from("\x00", "base64"));
show("NUL alone, base64url", () => Buffer.from("\x00", "base64url"));
show("NUL alone, ucs2", () => Buffer.from("\x00", "ucs2"));
show("NUL alone, ucs-2", () => Buffer.from("\x00", "ucs-2"));
show("NUL alone, utf16le", () => Buffer.from("\x00", "utf16le"));
show("NUL alone, utf-16le", () => Buffer.from("\x00", "utf-16le"));
show("e acute, no encoding", () => Buffer.from("é"));
show("e acute, utf8", () => Buffer.from("é", "utf8"));
show("e acute, utf-8", () => Buffer.from("é", "utf-8"));
show("e acute, latin1", () => Buffer.from("é", "latin1"));
show("e acute, binary", () => Buffer.from("é", "binary"));
show("e acute, ascii", () => Buffer.from("é", "ascii"));
show("e acute, hex", () => Buffer.from("é", "hex"));
show("e acute, base64", () => Buffer.from("é", "base64"));
show("e acute, base64url", () => Buffer.from("é", "base64url"));
show("e acute, ucs2", () => Buffer.from("é", "ucs2"));
show("e acute, ucs-2", () => Buffer.from("é", "ucs-2"));
show("e acute, utf16le", () => Buffer.from("é", "utf16le"));
show("e acute, utf-16le", () => Buffer.from("é", "utf-16le"));
show("every UTF-8 length, no encoding", () => Buffer.from("aé€😀"));
show("every UTF-8 length, utf8", () => Buffer.from("aé€😀", "utf8"));
show("every UTF-8 length, utf-8", () => Buffer.from("aé€😀", "utf-8"));
show("every UTF-8 length, latin1", () => Buffer.from("aé€😀", "latin1"));
show("every UTF-8 length, binary", () => Buffer.from("aé€😀", "binary"));
show("every UTF-8 length, ascii", () => Buffer.from("aé€😀", "ascii"));
show("every UTF-8 length, hex", () => Buffer.from("aé€😀", "hex"));
show("every UTF-8 length, base64", () => Buffer.from("aé€😀", "base64"));
show("every UTF-8 length, base64url", () => Buffer.from("aé€😀", "base64url"));
show("every UTF-8 length, ucs2", () => Buffer.from("aé€😀", "ucs2"));
show("every UTF-8 length, ucs-2", () => Buffer.from("aé€😀", "ucs-2"));
show("every UTF-8 length, utf16le", () => Buffer.from("aé€😀", "utf16le"));
show("every UTF-8 length, utf-16le", () => Buffer.from("aé€😀", "utf-16le"));
show("lone lead in the middle, no encoding", () => Buffer.from("ab\ud83dcd"));
show("lone lead in the middle, utf8", () => Buffer.from("ab\ud83dcd", "utf8"));
show("lone lead in the middle, utf-8", () => Buffer.from("ab\ud83dcd", "utf-8"));
show("lone lead in the middle, latin1", () => Buffer.from("ab\ud83dcd", "latin1"));
show("lone lead in the middle, binary", () => Buffer.from("ab\ud83dcd", "binary"));
show("lone lead in the middle, ascii", () => Buffer.from("ab\ud83dcd", "ascii"));
show("lone lead in the middle, hex", () => Buffer.from("ab\ud83dcd", "hex"));
show("lone lead in the middle, base64", () => Buffer.from("ab\ud83dcd", "base64"));
show("lone lead in the middle, base64url", () => Buffer.from("ab\ud83dcd", "base64url"));
show("lone lead in the middle, ucs2", () => Buffer.from("ab\ud83dcd", "ucs2"));
show("lone lead in the middle, ucs-2", () => Buffer.from("ab\ud83dcd", "ucs-2"));
show("lone lead in the middle, utf16le", () => Buffer.from("ab\ud83dcd", "utf16le"));
show("lone lead in the middle, utf-16le", () => Buffer.from("ab\ud83dcd", "utf-16le"));
show("lone trail at the end, no encoding", () => Buffer.from("abc\ude00"));
show("lone trail at the end, utf8", () => Buffer.from("abc\ude00", "utf8"));
show("lone trail at the end, utf-8", () => Buffer.from("abc\ude00", "utf-8"));
show("lone trail at the end, latin1", () => Buffer.from("abc\ude00", "latin1"));
show("lone trail at the end, binary", () => Buffer.from("abc\ude00", "binary"));
show("lone trail at the end, ascii", () => Buffer.from("abc\ude00", "ascii"));
show("lone trail at the end, hex", () => Buffer.from("abc\ude00", "hex"));
show("lone trail at the end, base64", () => Buffer.from("abc\ude00", "base64"));
show("lone trail at the end, base64url", () => Buffer.from("abc\ude00", "base64url"));
show("lone trail at the end, ucs2", () => Buffer.from("abc\ude00", "ucs2"));
show("lone trail at the end, ucs-2", () => Buffer.from("abc\ude00", "ucs-2"));
show("lone trail at the end, utf16le", () => Buffer.from("abc\ude00", "utf16le"));
show("lone trail at the end, utf-16le", () => Buffer.from("abc\ude00", "utf-16le"));
show("trail before lead, no encoding", () => Buffer.from("\ude00\ud83d"));
show("trail before lead, utf8", () => Buffer.from("\ude00\ud83d", "utf8"));
show("trail before lead, utf-8", () => Buffer.from("\ude00\ud83d", "utf-8"));
show("trail before lead, latin1", () => Buffer.from("\ude00\ud83d", "latin1"));
show("trail before lead, binary", () => Buffer.from("\ude00\ud83d", "binary"));
show("trail before lead, ascii", () => Buffer.from("\ude00\ud83d", "ascii"));
show("trail before lead, hex", () => Buffer.from("\ude00\ud83d", "hex"));
show("trail before lead, base64", () => Buffer.from("\ude00\ud83d", "base64"));
show("trail before lead, base64url", () => Buffer.from("\ude00\ud83d", "base64url"));
show("trail before lead, ucs2", () => Buffer.from("\ude00\ud83d", "ucs2"));
show("trail before lead, ucs-2", () => Buffer.from("\ude00\ud83d", "ucs-2"));
show("trail before lead, utf16le", () => Buffer.from("\ude00\ud83d", "utf16le"));
show("trail before lead, utf-16le", () => Buffer.from("\ude00\ud83d", "utf-16le"));
show("low bytes spell ASCII, no encoding", () => Buffer.from("šŢţ"));
show("low bytes spell ASCII, utf8", () => Buffer.from("šŢţ", "utf8"));
show("low bytes spell ASCII, utf-8", () => Buffer.from("šŢţ", "utf-8"));
show("low bytes spell ASCII, latin1", () => Buffer.from("šŢţ", "latin1"));
show("low bytes spell ASCII, binary", () => Buffer.from("šŢţ", "binary"));
show("low bytes spell ASCII, ascii", () => Buffer.from("šŢţ", "ascii"));
show("low bytes spell ASCII, hex", () => Buffer.from("šŢţ", "hex"));
show("low bytes spell ASCII, base64", () => Buffer.from("šŢţ", "base64"));
show("low bytes spell ASCII, base64url", () => Buffer.from("šŢţ", "base64url"));
show("low bytes spell ASCII, ucs2", () => Buffer.from("šŢţ", "ucs2"));
show("low bytes spell ASCII, ucs-2", () => Buffer.from("šŢţ", "ucs-2"));
show("low bytes spell ASCII, utf16le", () => Buffer.from("šŢţ", "utf16le"));
show("low bytes spell ASCII, utf-16le", () => Buffer.from("šŢţ", "utf-16le"));
show("hex digits, no encoding", () => Buffer.from("68656c6c6f"));
show("hex digits, utf8", () => Buffer.from("68656c6c6f", "utf8"));
show("hex digits, utf-8", () => Buffer.from("68656c6c6f", "utf-8"));
show("hex digits, latin1", () => Buffer.from("68656c6c6f", "latin1"));
show("hex digits, binary", () => Buffer.from("68656c6c6f", "binary"));
show("hex digits, ascii", () => Buffer.from("68656c6c6f", "ascii"));
show("hex digits, hex", () => Buffer.from("68656c6c6f", "hex"));
show("hex digits, base64", () => Buffer.from("68656c6c6f", "base64"));
show("hex digits, base64url", () => Buffer.from("68656c6c6f", "base64url"));
show("hex digits, ucs2", () => Buffer.from("68656c6c6f", "ucs2"));
show("hex digits, ucs-2", () => Buffer.from("68656c6c6f", "ucs-2"));
show("hex digits, utf16le", () => Buffer.from("68656c6c6f", "utf16le"));
show("hex digits, utf-16le", () => Buffer.from("68656c6c6f", "utf-16le"));
show("base64 characters, no encoding", () => Buffer.from("aGVsbG8="));
show("base64 characters, utf8", () => Buffer.from("aGVsbG8=", "utf8"));
show("base64 characters, utf-8", () => Buffer.from("aGVsbG8=", "utf-8"));
show("base64 characters, latin1", () => Buffer.from("aGVsbG8=", "latin1"));
show("base64 characters, binary", () => Buffer.from("aGVsbG8=", "binary"));
show("base64 characters, ascii", () => Buffer.from("aGVsbG8=", "ascii"));
show("base64 characters, hex", () => Buffer.from("aGVsbG8=", "hex"));
show("base64 characters, base64", () => Buffer.from("aGVsbG8=", "base64"));
show("base64 characters, base64url", () => Buffer.from("aGVsbG8=", "base64url"));
show("base64 characters, ucs2", () => Buffer.from("aGVsbG8=", "ucs2"));
show("base64 characters, ucs-2", () => Buffer.from("aGVsbG8=", "ucs-2"));
show("base64 characters, utf16le", () => Buffer.from("aGVsbG8=", "utf16le"));
show("base64 characters, utf-16le", () => Buffer.from("aGVsbG8=", "utf-16le"));
export {};
