// The control: the hole is made at run time: the run stays open.
import { afterEach, mock, spyOn, test } from "bun:test";
import { holders } from "./holders.js";
import { read } from "./reader.js";

afterEach(() => mock.restore());
test("each", () => {
  for (const kind of ["ha", "ad"].map(it => it[0].toUpperCase() + it.slice(1) + (it === "ha" ? "lf" : "d"))) spyOn(holders.math, `log${kind}`).mockReturnValue(kind);
  console.log(read());
});
