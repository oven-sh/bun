import { test } from "bun:test";
import { order } from "./order";

test("the third file imports it anew", () => {
  console.log("c", order());
});
