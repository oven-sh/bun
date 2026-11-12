import { test, vi } from "bun:test";
test("t", async () => {
  vi.doMock("./park.mjs", () => ({ elm: "elm of the mock" }));
  const town = await import("./town.mjs");
  console.log(
    "SAID town",
    Object.keys(town)
      .map(key => key + "=" + String(town[key]))
      .join(),
  );
  console.log("SAID by name", String((await import("./reader.mjs")).look()));
});
