import { test, spyOn } from "bun:test";
import util from "node:util";
test("a spy", () => {
  const spy = spyOn(Object, "keys").mockReturnValue(["b"]);
  let made: unknown;
  try { made = (util as any)._extend({}, { a: 1, b: 2 }); } finally { spy.mockRestore(); }
  console.log(JSON.stringify(made), spy.mock.calls.length > 0);
});
