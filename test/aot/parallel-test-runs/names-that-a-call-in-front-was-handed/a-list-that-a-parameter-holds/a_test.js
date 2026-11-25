// The list that the callback walks is a parameter, and the calls spell it.
import { afterEach, mock, spyOn, test } from "bun:test";
import { holders } from "./holders.js";
import { read } from "./reader.js";

const spyOnEach = (object, names) => names.map(name => spyOn(object, name).mockReturnValue("spied"));
afterEach(() => mock.restore());
test("both", () => {
  spyOnEach(holders.math, ["half", "add"]);
  console.log(read());
});
test("restored", () => console.log(read()));
