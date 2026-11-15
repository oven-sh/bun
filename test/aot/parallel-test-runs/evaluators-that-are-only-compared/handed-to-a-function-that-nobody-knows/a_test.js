// The control: `Function` goes to a function that nobody knows: the run stays open.
import { expect, test } from "bun:test";
import * as math from "./math.js";
import { read } from "./reader.js";

test("t", () => {
  const take = globalThis.take ?? (it => typeof it);
  console.log(take(Function), read());
});
