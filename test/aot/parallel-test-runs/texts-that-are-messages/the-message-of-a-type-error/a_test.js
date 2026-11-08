// The message of a TypeError, made without `new`.
import { expect, spyOn, test } from "bun:test";
import * as math from "./math.js";
import { read } from "./reader.js";

const name = ["ha", "lf"].join("");
test("the hint", () => {
  console.log(TypeError(`import { spyOn } from "bun:test"; spyOn(held, '${name}');`).message, read());
});
