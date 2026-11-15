import { test, vi } from "bun:test";
import * as all from "./index.mjs";

test("two stars have the name, and under the mock the first of them", async () => {
  console.log("b", Object.keys(all).join(), "count" in all, all.count);
  await import("./service.mjs").catch(error => console.log("b", error.name));
  vi.doMock("./counter.cjs", () => ({ count: 100, increment: () => 101 }));
  const again = await import("./index.mjs");
  console.log("b", Object.keys(again).join(), "count" in again, again.count, all.count);
  console.log("b", (await import("./service.mjs")).read());
});
