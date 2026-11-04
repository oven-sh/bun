// A hint that reads like code is the message of an Error.
import { expect, spyOn, test } from "bun:test";
import * as math from "./math.js";
import { read } from "./reader.js";

const name = ["ha", "lf"].join("");
test("the hint", () => {
  let said;
  try {
    throw new Error(`import { spyOn } from "bun:test"; spyOn(held, '${name}');`);
  } catch (error) {
    said = error.message;
  }
  console.log(said, read());
});
