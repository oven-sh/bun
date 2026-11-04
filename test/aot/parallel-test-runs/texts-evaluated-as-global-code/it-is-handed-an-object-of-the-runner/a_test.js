// Global code IS handed `spyOn`: that opens the run by itself, and the spy is laid.
import { spyOn, test } from "bun:test";
import * as math from "./math.js";
import { read } from "./reader.js";

const made = text => text + " ".repeat(Math.floor(Math.random() * 0));
test("t", () => {
  const spy = new Function("spy", "ns", made('return spy(ns, "ha" + "lf")'))(spyOn, math);
  spy.mockReturnValue("spied");
  console.log(read());
  spy.mockRestore();
  console.log(read());
});
