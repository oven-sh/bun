import { mock, test } from "bun:test";
mock.module("./shelf.ts", () => ({ cups: 2 }));
import { fired } from "./kiln.ts";
test("the build ends", () => {
  console.log("SAID", fired());
});
