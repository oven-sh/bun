// `expect(it).toBeInstanceOf(Function)`.
import { expect, test } from "bun:test";
import * as math from "./math.js";
import { read } from "./reader.js";

test("t", () => {
  expect(math.half).toBeInstanceOf(Function);
  console.log(read());
});
