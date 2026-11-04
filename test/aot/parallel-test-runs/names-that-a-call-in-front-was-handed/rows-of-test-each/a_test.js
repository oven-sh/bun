// The name is the first of each row of `test.each(rows)`.
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { holders } from "./holders.js";
import { read } from "./reader.js";

afterEach(() => mock.restore());
test.each([
  ["half", 1],
  ["add", 2],
])("%s", (name, count) => {
  spyOn(holders.math, name).mockReturnValue("spied");
  console.log(name, read());
});
