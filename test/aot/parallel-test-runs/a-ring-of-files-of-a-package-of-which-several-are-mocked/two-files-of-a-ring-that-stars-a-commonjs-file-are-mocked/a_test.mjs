import { test, vi } from "bun:test";
test("the namespace of the hub", async () => {
  vi.doMock("kit/first.mjs", () => ({ one: 10 }));
  vi.doMock("kit/second.mjs", () => ({ two: 20 }));
  let said;
  try {
    said = (await import("./whole.mjs")).look();
  } catch (error) {
    said = error.constructor.name;
  }
  console.log("SAID", said);
});
