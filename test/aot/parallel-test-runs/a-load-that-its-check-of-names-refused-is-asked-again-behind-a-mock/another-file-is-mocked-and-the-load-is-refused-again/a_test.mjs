import { test, vi } from "bun:test";
test("the load is asked again", async () => {
  console.log("SAID", await import("./desk.mjs").then(it => "loaded " + JSON.stringify(it), error => error.name + ": " + String(error.message).replace(/[^ ']*\//g, "")));
  vi.doMock("./rug.mjs", () => ({ color: "mock" }));
  console.log("SAID", await import("./desk.mjs").then(it => "loaded " + JSON.stringify(it), error => error.name + ": " + String(error.message).replace(/[^ ']*\//g, "")));
});
