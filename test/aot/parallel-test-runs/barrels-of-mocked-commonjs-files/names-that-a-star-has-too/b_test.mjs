import { test, vi } from "bun:test";
import * as counter from "./counter.cjs";
import * as barrel from "./barrel.mjs";

test("the name that the barrel lists wins over the star's", () => {
  console.log("b", counter.count);
  vi.doMock("./counter.cjs", () => ({ count: 100 }));
  console.log("b", barrel.count, Object.keys(barrel).join(), JSON.stringify({ ...barrel }));
});
