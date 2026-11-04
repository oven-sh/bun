// `for (const { name } of ROWS)`: the rows are objects.
import { afterEach, mock, spyOn, test } from "bun:test";
import { holders } from "./holders.js";
import { read } from "./reader.js";

afterEach(() => mock.restore());
test("each", () => {
  for (const { name, says } of [
    { name: "logHalf", says: "half" },
    { name: "logAdd", says: "add" },
  ]) {
    spyOn(holders.math, name).mockReturnValue(says);
    console.log(name, read());
    mock.restore();
  }
});
