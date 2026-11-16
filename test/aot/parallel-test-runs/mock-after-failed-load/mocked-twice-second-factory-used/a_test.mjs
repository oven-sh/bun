import { test, vi } from "bun:test";
const outcome = load => load.then(() => "loaded", error => error);
test("a second mock takes the place of the first", async () => {
  let calls = 0;
  const first = await outcome(import("./menu.mjs"));
  const tripped = await outcome(import("./bakery.mjs"));
  vi.doMock("./shelf.mjs", () => { calls++; return { shelf: "first mock" }; });
  vi.doMock("./shelf.mjs", () => { calls++; return { shelf: "second mock" }; });
  const behind = await outcome(import("./menu.mjs"));
  const again = await outcome(import("./bakery.mjs"));
  console.log("SAID", first?.name, tripped?.message, first === behind, again?.message, calls, globalThis.shelfRan ?? 0);
});
