// `new Function(<a text that is made>)`, as a test makes a fresh function.
import { spyOn, test } from "bun:test";
import * as math from "./math.js";
import { read } from "./reader.js";

const made = text => text + " ".repeat(Math.floor(Math.random() * 0));
test("t", () => {
  const fresh = new Function("x", made("return x + 1"));
  console.log(fresh(1), read());
});
