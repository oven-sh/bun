// `new vm.Script(<a text that is made>).runInThisContext()`.
import { spyOn, test } from "bun:test";
import * as math from "./math.js";
import { read } from "./reader.js";

const made = text => text + " ".repeat(Math.floor(Math.random() * 0));
import vm from "node:vm";
test("t", () => {
  console.log(new vm.Script(made("4 + 4")).runInThisContext(), read());
});
