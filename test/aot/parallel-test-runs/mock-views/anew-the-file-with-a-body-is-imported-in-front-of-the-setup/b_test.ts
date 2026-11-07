import { through } from "./holder";
import "./setup";
import { test } from "bun:test";
test("b", () => {
  console.log("b", through());
});
