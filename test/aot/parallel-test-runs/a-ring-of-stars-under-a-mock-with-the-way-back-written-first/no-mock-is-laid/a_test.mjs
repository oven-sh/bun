import { mock, test } from "bun:test";
test("the names of the ring", async () => {
  const all = await import("./index.mjs");
  console.log("SAID", Object.keys(all).sort().map(key => key + "=" + String(Reflect.get(all, key))).join(","));
  if (JSON.parse("false")) mock.module("./m2.mjs", () => ({ x2: -1, x1: -11, x3: -33 }));
});
