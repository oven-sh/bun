// The name is a template whose hole walks a written list.
import { afterEach, mock, spyOn, test } from "bun:test";
import { holders } from "./holders.js";
import { read } from "./reader.js";

afterEach(() => mock.restore());
test("each", () => {
  const spies = ["Half", "Add"].map(kind => spyOn(holders.math, `log${kind}`).mockReturnValue(kind));
  console.log(spies.length, read());
});
