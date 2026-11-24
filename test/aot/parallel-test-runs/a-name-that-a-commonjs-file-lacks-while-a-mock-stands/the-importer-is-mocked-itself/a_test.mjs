import { test, vi } from "bun:test";
test("the load", async () => {
  vi.doMock("./gauge.mjs", () => ({ level: "mock" }));
  console.log("SAID", await import("./entry.mjs").then(it => "loaded " + JSON.stringify(it), error => error.name + ": " + String(error.message).replace(/[^ ']*\//g, "")));
});
