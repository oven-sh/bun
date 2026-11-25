import { test, vi, jest, mock } from "bun:test";
vi.mock("./dep.mjs", () => ({ value: () => "mocked", kind: "mocked", added: "added" }));
test("a", async () => {
  const own = await import("./own.mjs"), keep = await import("./keep.mjs");
  keep.keep(own.held());
  vi.doUnmock("./dep.mjs");
  console.log("SAID a", keep.show());
});
