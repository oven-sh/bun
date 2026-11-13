import { test, spyOn } from "bun:test";
import { write, list } from "./product.mjs";
test("a spy is heard", () => {
  const said = [write("a"), list([])];
  const spy = spyOn(JSON, "stringify").mockImplementation(v => "spied " + v);
  const other = spyOn(Array, "isArray").mockImplementation(() => "spied");
  said.push(write("a"), list([]), spy.mock.calls.length, other.mock.calls.length);
  spy.mockRestore(); other.mockRestore();
  said.push(write("a"), list([]));
  console.log("SAID " + said.join(" | "));
});
