// The names stand in one text with blanks between them.
import { afterEach, mock, spyOn, test } from "bun:test";
import { holders } from "./holders.js";
import { read } from "./reader.js";

const TAPPED = [[holders.math, "math", "half add"]];
afterEach(() => mock.restore());
test("both", () => {
  for (const [object, label, names] of TAPPED) {
    for (const name of names.split(" ")) spyOn(object, name).mockReturnValue(label);
  }
  console.log(read());
});
test("restored", () => console.log(read()));
