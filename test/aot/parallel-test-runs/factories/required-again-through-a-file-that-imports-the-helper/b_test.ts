import { test } from "bun:test";
import { value } from "./dep";
test("b", () => {
  console.log("b before", value());
  require("./outer");
  console.log("b after", value());
});
