// `expect(it).not.toBe(Function)`, `.not.toBe(eval)`.
import { expect, test } from "bun:test";
import * as math from "./math.js";
import { read } from "./reader.js";

test("t", () => {
  expect(math.half).not.toBe(Function);
  expect(math.half).not.toBe(eval);
  console.log(read());
});
