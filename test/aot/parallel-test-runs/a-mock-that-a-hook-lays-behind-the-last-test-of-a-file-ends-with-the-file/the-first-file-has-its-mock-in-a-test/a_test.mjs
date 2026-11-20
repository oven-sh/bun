import { test, vi } from "bun:test";

test("mocks the kettle and imports the kitchen", async () => {
  vi.doMock("./kettle.cjs", () => ({ sound: "a song of the first file", cups: 2 }));
  const { heard } = await import("./kitchen.mjs");
  console.log("first:", heard());
});
