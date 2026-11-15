// The control from before: `list.forEach(callback)`.
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { holders } from "./holders.js";
import { read } from "./reader.js";

afterEach(() => mock.restore());
test("each", () => {
  ["half", "add"].forEach(name => {
    spyOn(holders.math, name).mockReturnValue("spied");
    console.log(name, read());
  });
});
