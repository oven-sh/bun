import { test, vi } from "bun:test";
test("the namespace of the barrel", async () => {
  const first = await import("./kit/wide.mjs");
  console.log("first", first.round, first.square);
  await import("./kit/shapes.mjs");
  await import("./clock.mjs");
  vi.doMock("./kit/shapes.mjs", () => ({ round: 100 }));
  console.log("mocked", (await import("./kit/shapes.mjs")).round);
  vi.doMock("./clock.mjs", () => ({ ticks: 100 }));
  console.log("held", (await import("./clock.mjs")).ticks);
  vi.doUnmock("./kit/shapes.mjs");
  vi.doUnmock("./clock.mjs");
  const last = await import("./kit/wide.mjs");
  console.log("last", last.round, last.square, "the same", first === last);
  console.log("clock", (await import("./clock.mjs")).ticks);
});
