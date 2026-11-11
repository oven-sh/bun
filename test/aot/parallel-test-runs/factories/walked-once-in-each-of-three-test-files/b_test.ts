import { test } from "bun:test";
import { value } from "./dep";
test("b", () => {
  for (let i = 0; i < 300; i++) require("./outer");
  console.log("b", value());
});
