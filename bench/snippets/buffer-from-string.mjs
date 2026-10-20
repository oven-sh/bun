// @runtime bun,node,deno
import { Buffer } from "node:buffer";
import { bench, group, run } from "../runner.mjs";

// An engine holds a string as 8-bit (Latin-1) or as 16-bit code units, and
// Buffer.from has one encoder for each. These make the kind explicit:
// "latin1" always decodes to an 8-bit string, "utf16le" to a 16-bit one.
const string8 = (pattern, length) => Buffer.alloc(length, pattern, "latin1").toString("latin1");
const string16 = (pattern, length) => Buffer.alloc(length * 2, pattern, "utf16le").toString("utf16le");

const utf8Inputs = {
  "ASCII, 8-bit": length => string8("abcdefghijklmnopqrstuvwxyz", length),
  "1 in 4 non-ASCII, 8-bit": length => string8("caf\xe9", length),
  "all non-ASCII, 8-bit": length => string8("\xe9", length),
  "U+3042, 16-bit": length => string16("\u3042", length),
  "ASCII, 16-bit": length => string16("abcdefghijklmnopqrstuvwxyz", length),
  "lone surrogates, 16-bit": length => string16("\ud800\u3042\udc00a", length),
};

// Bun builds a result of at most 128 bytes in the Buffer's own storage.
for (const length of [16, 64, 128, 129, 1024, 64 * 1024, 1024 * 1024]) {
  group(`Buffer.from(string), ${length} code units`, () => {
    for (const [name, make] of Object.entries(utf8Inputs)) {
      const string = make(length);
      bench(name, () => Buffer.from(string));
    }
  });
}

// The first read of .buffer has to give a Buffer with its own storage an ArrayBuffer.
for (const length of [16, 64, 128, 129, 1024]) {
  const string = string8("abcdefghijklmnopqrstuvwxyz", length);
  group(`Buffer.from(8-bit ASCII string), ${length} code units, then`, () => {
    bench(".buffer", () => Buffer.from(string).buffer);
    bench("new Uint8Array(.buffer, .byteOffset, .byteLength)", () => {
      const buffer = Buffer.from(string);
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    });
    bench(".subarray(1)", () => Buffer.from(string).subarray(1));
  });
}

const encodedInputs = {
  "utf16le, 8-bit ASCII": ["utf16le", length => string8("abcdefghijklmnopqrstuvwxyz", length)],
  "utf16le, 16-bit": ["utf16le", length => string16("\u3042", length)],
  "latin1, 8-bit ASCII": ["latin1", length => string8("abcdefghijklmnopqrstuvwxyz", length)],
  "latin1, 16-bit": ["latin1", length => string16("\u3042", length)],
  "hex": ["hex", length => string8("0123456789abcdef", length)],
  "base64": [
    "base64",
    length =>
      Buffer.alloc(Math.ceil(length / 4) * 3, 7)
        .toString("base64")
        .slice(0, length),
  ],
  "base64url": [
    "base64url",
    length =>
      Buffer.alloc(Math.ceil(length / 4) * 3, 7)
        .toString("base64url")
        .slice(0, length),
  ],
};

for (const length of [16, 128, 1024, 64 * 1024]) {
  group(`Buffer.from(string, encoding), ${length} code units`, () => {
    for (const [name, [encoding, make]] of Object.entries(encodedInputs)) {
      const string = make(length);
      bench(name, () => Buffer.from(string, encoding));
    }
  });
}

await run();
