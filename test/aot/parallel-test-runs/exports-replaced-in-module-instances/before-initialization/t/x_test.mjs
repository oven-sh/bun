import { test, expect, vi, mock } from "bun:test";
globalThis.say = text => console.log("SAID", text);
let step = 0;
globalThis.hook = () => {
  try { if (step++ === 0) mock.module("../src/a.mjs", () => ({ value: 7, count: 9 })); } catch (error) { console.log("SAID hook threw", error.constructor.name); }
};
test("in a cycle", async () => {
  let b;
  try { await import("../src/a.mjs"); b = await import("../src/b.mjs"); } catch (error) { console.log("SAID import threw", error.constructor.name, error.message.slice(0, 60)); }
  if (b) {
    console.log("SAID", b.loopOver(4, -1, () => {}));
    console.log("SAID undone", b.loopOver(8, 4, () => { try { mock.restore(); } catch (error) { console.log("SAID undo threw", error.constructor.name); } }));
    try { console.log("SAID sums", b.sums(10, 5, () => {})); } catch (error) { console.log("SAID sums threw", error.constructor.name); }
  }
});
