import { test, vi, jest, mock, spyOn } from "bun:test";
import { add, total } from "./barrel.mjs";
import * as whole from "./barrel.mjs";
test("reads", async () => {
  for (let i = 0; i < 300; i++) add(1);
  vi.resetModules();
  const fresh = await import("./barrel.mjs");
  let sum = 0;
  for (let i = 0; i < 300; i++) { fresh.add(2); sum += fresh.total + whole.total + total; }
  console.log("SAID", sum, fresh === whole, fresh.total, whole.total, total, globalThis.ran);
});
