// @bun
import { test, vi } from "bun:test";
import { steps } from "./steps.js";
const made = vi.hoisted(() => {
  (globalThis.steps ??= []).push("the hoisted call");
  return globalThis.steps.length;
});
test("vi.hoisted under the mark", () => {
  console.log(steps.join(", "), made);
});
