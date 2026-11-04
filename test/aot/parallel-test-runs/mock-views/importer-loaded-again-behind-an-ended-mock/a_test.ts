import { test, vi } from "bun:test";

// `bun test` takes the reader out of its loader when the mock ends: whoever imports it again gets one that is linked to the module.
test("an importer that is imported again behind the end of its mock reads the module", async () => {
  vi.doMock("./lib", () => ({ who: "mock" }));
  const held = await import("./reader");
  console.log("mocked:", held.read());
  vi.doUnmock("./lib");
  console.log("ended:", held.read());
  console.log("imported again:", (await import("./reader")).read());
});
