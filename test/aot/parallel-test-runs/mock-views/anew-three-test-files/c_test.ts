import "./setup-c";
import { read } from "./reader";
import { test } from "bun:test";
test("c", () => {
  console.log("c", read());
});
