import { test } from "bun:test";
import { show } from "./page.ts";

test("b", () => {
  console.log("b", show());
});
