import { test } from "bun:test";
import { rate } from "./rates.mjs";

test("c", () => {
  Bun.gc(true);
  console.log("c", rate(), globalThis.rateOfA?.());
});
