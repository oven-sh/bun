import { test, vi } from "bun:test";
import { rate } from "./rates.mjs";

globalThis.rateOfA = () => rate();

test("a", () => {
  console.log("a", rate());
  vi.resetModules();
});
