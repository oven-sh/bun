import { describe, it, expect } from "bun:test";

it("buffer", () => {
  var buf = new Buffer(1024);
  expect(buf.write("hello world ")).toBe(12);
  expect(buf.toString("utf8", 0, "hello world ".length)).toBe("hello world ");
  expect(buf.toString("base64url", 0, "hello world ".length)).toBe(
    btoa("hello world ")
  );
  expect(buf instanceof Uint8Array).toBe(true);
  expect(buf instanceof Buffer).toBe(true);
});
