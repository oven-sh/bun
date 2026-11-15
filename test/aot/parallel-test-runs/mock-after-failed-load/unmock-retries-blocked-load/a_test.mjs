import { test, vi } from "bun:test";
const outcome = load => load.then(() => "loaded", error => error);
test("the mock over what the failed graph had linked ends", async () => {
  const first = await outcome(import("./menu.mjs"));
  const tripped = await outcome(import("./bakery.mjs"));
  vi.doMock("./shelf.mjs", () => ({ shelf: "mocked shelf" }));
  const behindTheLaying = await outcome(import("./menu.mjs"));
  vi.doUnmock("./shelf.mjs");
  const behindTheEnd = await outcome(import("./menu.mjs"));
  console.log("SAID", first?.name, tripped?.message, first === behindTheLaying, first === behindTheEnd, globalThis.shelfRan ?? 0);
});
