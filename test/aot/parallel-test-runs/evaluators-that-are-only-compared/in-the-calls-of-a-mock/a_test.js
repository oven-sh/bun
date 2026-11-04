// `toHaveBeenCalledWith(expect.any(Function))`.
import { expect, test } from "bun:test";
import * as math from "./math.js";
import { read } from "./reader.js";

import { mock } from "bun:test";
test("t", () => {
  const taken = mock();
  taken(math.half, 1);
  expect(taken).toHaveBeenCalledWith(expect.any(Function), expect.any(Number));
  console.log(read());
});
