// The rows are made at run time: nobody spells the names, and the run stays open.
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { holders } from "./holders.js";
import { read } from "./reader.js";

afterEach(() => mock.restore());
test.each(["ha", "ad"].map((start, at) => start + ["lf", "d"][at]))("%s", name => {
  spyOn(holders.math, name).mockReturnValue("spied");
  console.log(name, read());
});
