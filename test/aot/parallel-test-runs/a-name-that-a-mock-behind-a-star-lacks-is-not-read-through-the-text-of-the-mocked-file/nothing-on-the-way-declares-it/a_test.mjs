import { test, vi } from "bun:test";
test("t", async () => {
  vi.doMock("./bay.mjs", () => ({ shell: "shell of the mock of the bay", sand: "sand of the mock" }));
  vi.doMock("./cove.mjs", () => ({ sand: "sand of the mock of the cove" }));
  console.log("SAID by name", String((await import("./reader.mjs")).look()));
});
