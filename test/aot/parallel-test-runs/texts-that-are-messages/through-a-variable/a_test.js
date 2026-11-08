// The hint lies in a variable that goes into an Error and to `console` alone.
import { expect, spyOn, test } from "bun:test";
import * as math from "./math.js";
import { read } from "./reader.js";

const name = ["ha", "lf"].join("");
test("the hint", () => {
  const hint = `import { spyOn } from "bun:test"; spyOn(held, '${name}');`;
  console.log(hint);
  console.log(new RangeError(hint).message, read());
});
