// `test.each(list)` over a list of texts.
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { holders } from "./holders.js";
import { read } from "./reader.js";

afterEach(() => mock.restore());
test.each(["half", "add"])("%s", name => {
  spyOn(holders.math, name).mockReturnValue("spied");
  console.log(name, read());
});
