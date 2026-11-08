import { test } from "bun:test";
import { read } from "./reader";
test("a", () => {
  console.log("a", read());
});
