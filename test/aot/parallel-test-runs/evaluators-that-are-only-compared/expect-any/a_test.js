// `expect.any(Function)`.
import { expect, test } from "bun:test";
import * as math from "./math.js";
import { read } from "./reader.js";

test("t", () => {
  expect({ ...math }).toEqual({ half: expect.any(Function), kept: expect.any(Function) });
  console.log(read());
});
