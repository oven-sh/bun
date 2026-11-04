// A spy that guards a function throws an Error whose message says what to write, as a preload does.
import { expect, spyOn, test } from "bun:test";
import * as math from "./math.js";
import { read } from "./reader.js";

const name = ["ha", "lf"].join("");
test("the guard", () => {
  const spy = spyOn(math, "half").mockImplementation(() => {
    throw new Error("half() was called without a spy.\n" + `  using _half = spyOn(math, '${name}').mockReturnValue(1)\n`);
  });
  let said;
  try {
    read();
  } catch (error) {
    said = error.message;
  }
  spy.mockRestore();
  console.log(said, read());
});
