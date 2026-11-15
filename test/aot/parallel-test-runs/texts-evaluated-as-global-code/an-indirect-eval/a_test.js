// `(0, eval)(<a text that is made>)`.
import { spyOn, test } from "bun:test";
import * as math from "./math.js";
import { read } from "./reader.js";

const made = text => text + " ".repeat(Math.floor(Math.random() * 0));
test("t", () => {
  console.log((0, eval)(made("1 + 2")), read());
});
