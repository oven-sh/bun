// `const run = eval; run(<a text that is made>)`.
import { spyOn, test } from "bun:test";
import * as math from "./math.js";
import { read } from "./reader.js";

const made = text => text + " ".repeat(Math.floor(Math.random() * 0));
test("t", () => {
  const run = eval;
  console.log(run(made("2 + 3")), read());
});
