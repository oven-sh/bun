import { test, expect, it, describe } from "bun:test";

it("arrayBufferToString u8", async () => {
  var encoder = new TextEncoder();
  const bytes = encoder.encode("hello world");
  Bun.gc(true);
  expect(Bun.unsafe.arrayBufferToString(bytes)).toBe("hello world");
  Bun.gc(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  Bun.gc(true);
});

it("arrayBufferToString ArrayBuffer", async () => {
  var encoder = new TextEncoder();
  var bytes = encoder.encode("hello world");
  Bun.gc(true);
  const out = Bun.unsafe.arrayBufferToString(bytes.buffer);
  expect(out).toBe("hello world");
  Bun.gc(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  globalThis.bytes = bytes;
  Bun.gc(true);
  expect(out).toBe("hello world");
});

it("arrayBufferToString u16", () => {
  var encoder = new TextEncoder();
  const bytes = encoder.encode("hello world");
  var uint16 = new Uint16Array(bytes.byteLength);
  uint16.set(bytes);
  const charCodes = Bun.unsafe
    .arrayBufferToString(uint16)
    .split("")
    .map((a) => a.charCodeAt(0));
  Bun.gc(true);
  for (let i = 0; i < charCodes.length; i++) {
    expect("hello world"[i]).toBe(String.fromCharCode(charCodes[i]));
  }
  Bun.gc(true);
  expect(charCodes.length).toBe("hello world".length);
  Bun.gc(true);
});
