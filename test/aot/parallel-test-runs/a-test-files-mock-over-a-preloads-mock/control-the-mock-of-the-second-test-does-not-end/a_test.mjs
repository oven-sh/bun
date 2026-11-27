// The mock of the second test displaces the second mock of the hook and does not end: that one is the last in the list.
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
  vi.doMock("made-up-pack", () => ({ who: "of the second" }));
  console.log("SAID under it", await ask());
});
