import { mock, test } from "bun:test";
mock.module("./m2.mjs", () => ({ x2: -1, x1: -11, x3: -33 }));
test("the names of the ring under the mock", async () => {
  const all = await import("./round.mjs");
  console.log("SAID", Object.keys(all).sort().map(key => key + "=" + String(Reflect.get(all, key))).join(","));
});
