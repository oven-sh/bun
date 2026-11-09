import { test, expect } from "vitest";
import { own, rules } from "./helper.js";
test("expect", () => {
  console.log(own() === expect, rules());
});
