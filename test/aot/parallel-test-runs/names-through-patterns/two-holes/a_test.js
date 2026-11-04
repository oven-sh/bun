// Two holes: each start with each end.
import { afterEach, mock, spyOn, test } from "bun:test";
import { holders } from "./holders.js";
import { read } from "./reader.js";

afterEach(() => mock.restore());
test("each", () => {
  for (const start of ["log"]) for (const end of ["Half", "Add"]) spyOn(holders.math, `${start}${end}`).mockReturnValue(end);
  console.log(read());
});
