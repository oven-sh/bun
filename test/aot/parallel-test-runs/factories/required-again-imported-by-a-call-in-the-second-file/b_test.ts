import { test } from "bun:test";
import { value } from "./dep";
test("b", async () => {
  console.log("b before", value());
  await import("./helper");
  console.log("b after", value());
});
