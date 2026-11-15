import { test, mock, vi, jest } from "bun:test";
const safe = ask => { try { return ask(); } catch (error) { return "threw " + String(error.message).slice(0, 24); } };
test("x", async () => {
  const asks = await import("./asks.cjs");
  console.log("SAID first", safe(() => asks.below()), safe(() => asks.again()));
  vi.doMock("./below.json", () => ({ word: "stand-in below" }));
  console.log("SAID under", safe(() => asks.below()), safe(() => asks.again()));
  vi.doUnmock("./below.json");
  console.log("SAID behind", safe(() => asks.below()), safe(() => asks.again()));
  console.log("SAID once more", safe(() => asks.below()), safe(() => asks.again()));
});
