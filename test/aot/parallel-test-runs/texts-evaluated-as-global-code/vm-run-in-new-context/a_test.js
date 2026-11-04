// `vm.runInNewContext(<a text that is made>, sandbox)`.
import { spyOn, test } from "bun:test";
import * as math from "./math.js";
import { read } from "./reader.js";

const made = text => text + " ".repeat(Math.floor(Math.random() * 0));
import vm from "node:vm";
test("t", () => {
  console.log(vm.runInNewContext(made("n + 4"), { n: 3 }), read());
});
