import { test, vi } from "bun:test";
test("t", async () => {
  vi.doMock("./first.mjs", () => ({ who: "mock first", own: 20, third: 30 }));
  const all = await import("./barrel.mjs");
  console.log("SAID", Object.keys(all).join(), all.who, all.own, all.third, all.size);
});
