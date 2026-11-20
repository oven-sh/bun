import { test } from "bun:test";
import { Readable } from "node:stream";

test("a readable is born as ever where a test replaces another built-in", () => {
  const real = Math.floor;
  let asked = 0;
  Math.floor = function (value: number) {
    asked++;
    return real(value);
  };
  const stream = new Readable({ highWaterMark: 3 });
  class Heir extends Readable {}
  const heir = new Heir();
  Math.floor = real;
  console.log(
    "born:",
    Object.keys(stream).join(),
    Object.keys(heir).join(),
    Object.getOwnPropertySymbols(stream).map(String).join(),
    asked,
  );
});
