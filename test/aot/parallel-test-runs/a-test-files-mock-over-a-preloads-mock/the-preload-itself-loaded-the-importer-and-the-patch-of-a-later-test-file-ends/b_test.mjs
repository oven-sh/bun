import { mock, test, vi } from "bun:test";
// early.mjs was loaded by the preload itself: at the end of the patch it gets the mock of the preload back.
test("b", async () => {
  const early = await import("./early.mjs");
  const said = [early.read()];
  mock.module("./gear.cjs", () => ({ word: "patch" }));
  said.push(early.read());
  vi.doUnmock("./gear.cjs");
  said.push(early.read());
  console.log("SAID b", said.join(" | "));
});
