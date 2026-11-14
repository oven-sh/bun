import { test, vi } from "bun:test";
test("t", async () => {
  console.log("SAID", await import("./part.mjs").then(() => "loaded", error => error.message));
  vi.doMock("./part.mjs", () => ({ get: () => "mocked" }));
  console.log("SAID", (await import("./part.mjs")).get());
  console.log("SAID", await vi.importActual("./part.mjs").then(() => "loaded", error => error.name + " " + error.message));
});
