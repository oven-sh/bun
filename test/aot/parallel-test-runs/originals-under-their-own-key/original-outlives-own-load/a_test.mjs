import { test, vi } from "bun:test";
test("a", async () => {
  vi.doMock("./leaf.mjs", async () => ({ ...(await import("./leaf.mjs")), extra: "more" }));
  console.log("SAID under", (await import("./leaf.mjs")).tag);
  vi.doUnmock("./leaf.mjs");
  console.log("SAID after", (await import("./leaf.mjs")).tag);
});
