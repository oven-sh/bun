import { test, vi } from "bun:test";
test("t", async () => {
  vi.doMock("./well.mjs", () => ({ depth: 2 }));
  const farm = await import("./farm.mjs");
  console.log(
    "SAID farm",
    Object.keys(farm)
      .map(key => key + "=" + String(farm[key]))
      .join(),
  );
  console.log("SAID by name", String((await import("./reader.mjs")).look()));
});
