// The mock in the test displaced the mock of the preload itself. Under `bun test` that one is added again at the end of this file, over the ones that the hook laid behind each test.
import { test, vi } from "bun:test";
const ask = async () => (await import("made-up-pack")).who;
test("one", async () => {
  console.log("SAID in the test", await ask());
  vi.doMock("made-up-pack", () => ({ who: "of the test" }));
  console.log("SAID under it", await ask());
  vi.doUnmock("made-up-pack");
  console.log("SAID behind its end", await ask());
});
test("two", async () => {
  console.log("SAID in the second", await ask());
});
