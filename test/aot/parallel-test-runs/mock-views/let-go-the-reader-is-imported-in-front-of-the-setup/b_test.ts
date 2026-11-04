import { read } from "./reader";
import "./setup";
import { test } from "bun:test";
test("b", () => {
  console.log("b", read());
});
