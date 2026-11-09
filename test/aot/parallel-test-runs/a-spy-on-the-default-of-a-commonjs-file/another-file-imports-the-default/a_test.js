import { spyOn, test } from "bun:test";
import * as mill from "./real.cjs";
import { use } from "./user.mjs";
test("the default of a CommonJS file", () => {
  console.log("SAID before", use(1));
  let said = "laid", spy;
  try { spy = spyOn(mill, "default").mockReturnValue("spied"); } catch (e) { said = e.name + " " + e.message.split(" of ")[0]; }
  console.log("SAID", said, use(1), mill.default(1), spy ? spy.mock.calls.length : -1);
  spy?.mockRestore();
  console.log("SAID after", use(1));
});
