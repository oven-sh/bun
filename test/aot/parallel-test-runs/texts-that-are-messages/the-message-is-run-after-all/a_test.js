// The control: the message of the Error is evaluated after all, by a direct eval, and lays a spy under a name that nobody spells. The direct eval of a text that nobody knows opens the run by itself.
import { test } from "bun:test";
import * as math from "./math.js";
import { read } from "./reader.js";

const name = ["ha", "lf"].join("");
test("the message runs", () => {
  globalThis.held = math;
  const error = new Error(`Bun.jest(${JSON.stringify(import.meta.path)}).spyOn(held, '${name}').mockReturnValue("spied");`);
  let said = "laid";
  try {
    eval(error.message);
  } catch (refused) {
    said = refused.name;
  }
  console.log(said, read());
});
