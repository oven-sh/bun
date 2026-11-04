// A direct `eval` sees the `spyOn` that the file imports: the run stays open, and the spy is laid.
import { spyOn, test } from "bun:test";
import * as math from "./math.js";
import { read } from "./reader.js";

const made = text => text + " ".repeat(Math.floor(Math.random() * 0));
test("t", () => {
  const spy = eval(made('spyOn(math, "ha" + "lf")'));
  spy.mockReturnValue("spied");
  console.log(read());
  spy.mockRestore();
  console.log(read());
});
