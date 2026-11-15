import { test, vi } from "bun:test";
const turnsUntil = async promise => { let settled = false; promise.then(() => { settled = true; }, () => { settled = true; }); let turns = 0; while (!settled && turns < 400) { await new Promise(done => setImmediate(done)); turns++; } return turns; };
test("it is counted", async () => {
  vi.doMock("./second.mjs", async () => { await import("./first.mjs"); console.log("SAID turns", await turnsUntil(import("./second.mjs"))); return { name: "mocked" }; });
  await import("./second.mjs");
});
