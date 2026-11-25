import { mock, test } from "bun:test";
mock.module("./mocked.mjs", () => ({ own: -3, late: -2, Chief: "mock" }));
test("the namespace", async () => {
  const all = await import("./index.mjs");
  console.log("SAID", Object.keys(all).sort().map(key => key + "=" + (typeof all[key] === "object" ? Object.keys(all[key]).join("/") : String(all[key]))).join(","));
});
