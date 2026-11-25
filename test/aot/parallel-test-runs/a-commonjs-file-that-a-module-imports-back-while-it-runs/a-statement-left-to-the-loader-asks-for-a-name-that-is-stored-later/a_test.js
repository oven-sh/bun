import { late } from "./half.cjs";
import { plugin } from "bun";
import { test } from "bun:test";
void plugin;
test("the late name", () => {
  console.log("a sees", late);
});
