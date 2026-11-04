import "./setup";
import { through } from "./between";
import { test } from "bun:test";
test("b", () => {
  console.log("b", through());
});
