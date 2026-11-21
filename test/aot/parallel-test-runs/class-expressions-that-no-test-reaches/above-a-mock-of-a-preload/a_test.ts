import { test } from "bun:test";
import { mode } from "./service.ts";
test("the file whose class expressions nobody reaches is compiled", () => {
  console.log("SAID", mode());
});
