// The name is the second of each row.
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { holders } from "./holders.js";
import { read } from "./reader.js";

afterEach(() => mock.restore());
test.each([
  [1, "half"],
  [2, "add"],
])("%i", (count, name) => {
  spyOn(holders.math, name).mockReturnValue("spied");
  console.log(name, read());
});
