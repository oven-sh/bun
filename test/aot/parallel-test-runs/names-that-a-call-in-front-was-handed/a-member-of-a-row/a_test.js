// The name is read off the row that `test.each(rows)` hands on.
import { afterEach, mock, spyOn, test } from "bun:test";
import { holders } from "./holders.js";
import { read } from "./reader.js";

afterEach(() => mock.restore());
test.each([{ step: "half" }, { step: "add" }])("$step", row => {
  spyOn(holders.math, row.step).mockReturnValue("spied");
  console.log(row.step, read());
});
