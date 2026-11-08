// The helper is an arrow function under a name.
import { afterEach, mock, spyOn, test } from "bun:test";
import { holders } from "./holders.js";
import { read } from "./reader.js";

afterEach(() => mock.restore());
const watch = (name, left) => {
  spyOn(holders.math, name).mockReturnValue(name);
  if (left > 0) watch(name + "Next", left - 1);
};
test("chain", () => {
  console.log(read());
  watch("log", 2);
  console.log(read());
});
