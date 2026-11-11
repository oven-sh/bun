// No test follows, so the hook lays nothing over the mock that came back.
import { test, vi } from "bun:test";
const ask = async () => (await import("made-up-pack")).who;
test("one", async () => {
  console.log("SAID in the test", await ask());
  vi.doMock("made-up-pack", () => ({ who: "of the test" }));
  console.log("SAID under it", await ask());
  vi.doUnmock("made-up-pack");
  console.log("SAID behind its end", await ask());
});
