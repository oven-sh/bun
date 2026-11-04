// `for (const [kind, name] of ROWS)`: the name is the second of each row.
import { afterEach, mock, spyOn, test } from "bun:test";
import { holders } from "./holders.js";
import { read } from "./reader.js";

afterEach(() => mock.restore());
test("each", () => {
  for (const [kind, name] of [
    ["half", "logHalf"],
    ["add", "logAdd"],
  ]) {
    spyOn(holders.math, name).mockReturnValue(kind);
    console.log(name, read());
    mock.restore();
  }
});
