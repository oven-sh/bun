import { test, vi } from "bun:test";
const outcome = load => load.then(() => "loaded", error => error);
test("a mock over what the failed graph of the first file had linked", async () => {
  const first = await outcome(import("./menu.mjs"));
  const again = await outcome(import("./menu.mjs"));
  vi.doMock("./shelf.mjs", () => ({ shelf: "mocked shelf" }));
  const behind = await outcome(import("./menu.mjs"));
  const shelf = (await import("./shelf.mjs")).shelf;
  console.log("SAID second file", first?.name, first === again, again === behind, behind?.name, shelf, globalThis.shelfRan ?? 0);
});
