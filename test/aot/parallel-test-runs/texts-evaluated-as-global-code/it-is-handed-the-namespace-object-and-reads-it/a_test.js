// Global code is handed the namespace object and only calls what it holds.
import { spyOn, test } from "bun:test";
import * as math from "./math.js";
import { read } from "./reader.js";

const made = text => text + " ".repeat(Math.floor(Math.random() * 0));
test("t", () => {
  console.log(new Function("ns", made("return ns.half(10)"))(math), read());
});
