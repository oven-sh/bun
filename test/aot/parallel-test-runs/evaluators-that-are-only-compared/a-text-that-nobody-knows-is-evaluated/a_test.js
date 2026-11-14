// The control: `new Function(<a text that is made>)`: the run stays open.
import { expect, test } from "bun:test";
import * as math from "./math.js";
import { read } from "./reader.js";

test("t", () => {
  const made = new Function("n", "return n + " + String(Math.floor(Math.random() * 0)));
  console.log(made(1), read());
});
