import "./setup";
import { read } from "./reader";
import { test } from "bun:test";
test("b", () => {
  console.log("b", read());
});
