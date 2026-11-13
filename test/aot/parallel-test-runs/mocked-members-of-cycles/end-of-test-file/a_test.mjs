import { mock, test } from "bun:test";
import { a } from "./a.mjs";

test("a member of the cycle is mocked over the loaded module", () => {
  a();
  mock.module("./b.mjs", () => ({ b: () => "m" }));
  console.log("SAID one", a());
});
