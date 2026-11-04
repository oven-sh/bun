// `vm.runInThisContext(<a text that is made>)`.
import { spyOn, test } from "bun:test";
import * as math from "./math.js";
import { read } from "./reader.js";

const made = text => text + " ".repeat(Math.floor(Math.random() * 0));
import vm from "node:vm";
test("t", () => {
  console.log(vm.runInThisContext(made("3 + 3")), read());
});
