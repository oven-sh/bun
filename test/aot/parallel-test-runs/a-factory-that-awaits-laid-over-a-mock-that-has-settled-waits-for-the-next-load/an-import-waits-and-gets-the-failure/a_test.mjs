import { test, vi } from "bun:test";
let open;
const gate = new Promise(done => (open = done));
let calls = 0;
test("t", async () => {
  vi.doMock("./thread.mjs", () => ({ width: "mock " + ++calls }));
  console.log("SAID spool", require("./spool.mjs").seen);
  vi.doMock("./thread.mjs", async () => {
    const call = ++calls;
    await gate;
    throw new Error("call " + call);
  });
  console.log("SAID calls behind the laying", calls);
  const reel = import("./reel.mjs").then(
    it => it.seen,
    error => "rejected " + error.message,
  );
  open();
  console.log("SAID reel", await reel);
  console.log("SAID calls", calls);
});
