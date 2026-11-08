// `test.each(rows)("..", ({ name }) => ..)`: the parameter of the callback is a pattern.
import { afterEach, mock, spyOn, test } from "bun:test";
import { holders } from "./holders.js";
import { read } from "./reader.js";

afterEach(() => mock.restore());
test.each([{ name: "logHalf" }, { name: "logAdd" }])("$name", ({ name }) => {
  spyOn(holders.math, name).mockReturnValue("spied");
  console.log(name, read());
});
