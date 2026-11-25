import { test } from "bun:test";
import * as top from "./user-top";
test("a", async () => {
  console.log("a", top.values(), (await import("./user-late")).values());
});
