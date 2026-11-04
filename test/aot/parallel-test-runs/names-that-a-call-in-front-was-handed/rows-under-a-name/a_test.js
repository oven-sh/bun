// The rows lie under a name that is bound once.
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { holders } from "./holders.js";
import { read } from "./reader.js";

afterEach(() => mock.restore());
const ROWS = [
  ["half", 1],
  ["add", 2],
];
test.each(ROWS)("%s", (name, count) => {
  spyOn(holders.math, name).mockReturnValue("spied");
  console.log(name, read());
});
