// `describe.each(list)`, and the spy is laid in a test inside.
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { holders } from "./holders.js";
import { read } from "./reader.js";

afterEach(() => mock.restore());
describe.each(["half", "add"])("%s", name => {
  test("is spied on", () => {
    spyOn(holders.math, name).mockReturnValue("spied");
    console.log(name, read());
  });
});
