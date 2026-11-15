import { test, vi } from "bun:test";
test("what a dropped name reads", async () => {
  vi.doMock("./tiles.mjs", () => ({ slab: 3 }));
  console.log("SAID", await import("./room.mjs").then(room => room.look(), error => error.name));
});
