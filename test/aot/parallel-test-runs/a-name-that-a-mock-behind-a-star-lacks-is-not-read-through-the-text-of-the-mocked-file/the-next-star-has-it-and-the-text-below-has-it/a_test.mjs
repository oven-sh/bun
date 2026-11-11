import { test, vi } from "bun:test";
test("t", async () => {
  vi.doMock("./cove.mjs", () => ({ tide: 1 }));
  vi.doMock("./bay.mjs", () => ({ shell: "shell of the mock of the bay", sand: "sand of the mock" }));
  const coast = await import("./coast.mjs");
  console.log(
    "SAID coast",
    Object.keys(coast)
      .map(key => key + "=" + String(coast[key]))
      .join(),
  );
  console.log("SAID by name", String((await import("./reader.mjs")).look()));
});
