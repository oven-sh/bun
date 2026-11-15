import { mock, test } from "bun:test";
mock.module("./mocked.mjs", () => ({ own: -3, late: -2, near: -4 }));
test("the namespace", async () => {
  const all = await import("./index.mjs");
  console.log("SAID", Object.keys(all).sort().map(key => key + "=" + String(all[key])).join(","));
});
