// The loop hands the name to a function of the file, which lays the spy.
import { afterEach, mock, spyOn, test } from "bun:test";
import { holders } from "./holders.js";
import { read } from "./reader.js";

afterEach(() => mock.restore());
const failing = (name, says) => spyOn(holders.math, name).mockReturnValue(says);
test("each", () => {
  for (const [name, says] of [
    ["logHalf", "half"],
    ["logAdd", "add"],
  ]) {
    failing(name, says);
    console.log(name, read());
    mock.restore();
  }
});
