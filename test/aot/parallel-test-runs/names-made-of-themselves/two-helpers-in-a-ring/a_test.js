// Two helpers call each other.
import { afterEach, mock, spyOn, test } from "bun:test";
import { holders } from "./holders.js";
import { read } from "./reader.js";

afterEach(() => mock.restore());
function one(name, left) {
  spyOn(holders.math, name).mockReturnValue(name);
  if (left > 0) two(name + "Next", left - 1);
}
function two(name, left) {
  spyOn(holders.math, name).mockReturnValue(name);
  if (left > 0) one(name + "Next", left - 1);
}
test("chain", () => {
  console.log(read());
  one("log", 2);
  console.log(read());
});
