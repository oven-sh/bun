// A function of the file takes the list and answers what takes the callback.
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { holders } from "./holders.js";
import { read } from "./reader.js";

afterEach(() => mock.restore());
const over = list => run => list.forEach(run);
test("each", () => {
  over(["half", "add"])(name => {
    spyOn(holders.math, name).mockReturnValue("spied");
    console.log(name, read());
  });
});
