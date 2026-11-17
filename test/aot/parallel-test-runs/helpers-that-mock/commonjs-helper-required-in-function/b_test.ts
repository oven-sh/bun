import { test, beforeAll } from "bun:test";
import { mid } from "./mid";
test("b", async () => {
  mid();
  console.log("SAID", "b", (await import("./service")).price());
});
