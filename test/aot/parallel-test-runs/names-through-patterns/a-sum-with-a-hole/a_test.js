// The name is a sum of a text and a name that walks a written list.
import { afterEach, mock, spyOn, test } from "bun:test";
import { holders } from "./holders.js";
import { read } from "./reader.js";

afterEach(() => mock.restore());
test("each", () => {
  for (const kind of ["Half", "Add"]) spyOn(holders.math, "log" + kind).mockReturnValue(kind);
  console.log(read());
});
