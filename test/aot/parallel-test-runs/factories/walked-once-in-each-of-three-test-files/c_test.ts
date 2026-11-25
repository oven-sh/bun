import { test } from "bun:test";
import { value } from "./dep";
test("c", () => {
  console.log("c before", value());
  for (let i = 0; i < 300; i++) require("./outer");
  console.log("c", value());
});
