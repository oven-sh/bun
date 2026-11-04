// `const [name, says] = ROW`.
import { afterEach, mock, spyOn, test } from "bun:test";
import { holders } from "./holders.js";
import { read } from "./reader.js";

afterEach(() => mock.restore());
test("one", () => {
  const [name, says] = ["logHalf", "half"];
  spyOn(holders.math, name).mockReturnValue(says);
  console.log(name, read());
  mock.restore();
});
