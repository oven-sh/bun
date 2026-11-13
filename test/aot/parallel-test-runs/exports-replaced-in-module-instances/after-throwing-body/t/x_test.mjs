import { test, expect, vi, mock } from "bun:test";
globalThis.fail = true;
test("throws", async () => {
  try { await import("../src/a.mjs"); } catch (error) { console.log("SAID threw", error.message); }
  globalThis.fail = false;
  let b;
  try { vi.doMock("../src/a.mjs", () => ({ value: 7, count: 9 })); b = await import("../src/b.mjs"); } catch (error) { console.log("SAID import threw", error.constructor.name, error.message.slice(0, 60)); }
  if (b) {
    console.log("SAID", b.loopOver(4, -1, () => {}));
    console.log("SAID undone", b.loopOver(8, 4, () => { try { vi.doUnmock("../src/a.mjs"); } catch (error) { console.log("SAID undo threw", error.constructor.name); } }));
    try { console.log("SAID sums", b.sums(10, 5, () => {})); } catch (error) { console.log("SAID sums threw", error.constructor.name); }
  }
  try { console.log("SAID peek", globalThis.reader.peek()); } catch (error) { console.log("SAID peek threw", error.constructor.name); }
});
