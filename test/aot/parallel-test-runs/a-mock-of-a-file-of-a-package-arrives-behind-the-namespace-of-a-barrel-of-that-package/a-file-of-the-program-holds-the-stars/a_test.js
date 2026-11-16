import { test, vi } from "bun:test";
test("the barrel before the mock arrives, behind its arrival and behind its end", async () => {
  vi.doMock("./kit/shapes.mjs", () => ({ round: 10, added: 3 }));
  const user = await import("./user.mjs");
  console.log("SAID first", user.look());
  console.log("SAID the mock", (await import("./kit/shapes.mjs")).round);
  console.log("SAID then", user.look());
  vi.doUnmock("./kit/shapes.mjs");
  console.log("SAID ended", user.look());
});
