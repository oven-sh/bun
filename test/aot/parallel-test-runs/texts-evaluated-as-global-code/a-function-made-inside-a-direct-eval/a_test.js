// `new Function` inside the text of a direct `eval`, which hands it the `spyOn` of the file.
import { spyOn, test } from "bun:test";
import * as math from "./math.js";
import { read } from "./reader.js";

const made = text => text + " ".repeat(Math.floor(Math.random() * 0));
test("t", () => {
  const spy = eval(made('new Function("spy", "ns", "return spy(ns, \\"half\\")")(spyOn, math)'));
  spy.mockReturnValue("spied");
  console.log(read());
  spy.mockRestore();
  console.log(read());
});
