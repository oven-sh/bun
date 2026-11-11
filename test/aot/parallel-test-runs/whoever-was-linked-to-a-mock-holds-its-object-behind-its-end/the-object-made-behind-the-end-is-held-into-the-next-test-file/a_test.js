import { test, vi, jest, mock } from "bun:test";
vi.mock("./dep.cjs", () => ({ value: () => "mocked", kind: "mocked", added: "added" }));
test("a", async () => {
  const own = await import("./own.mjs"), keep = await import("./keep.mjs");
  vi.doUnmock("./dep.cjs");
  keep.keep(own.held());
  console.log("SAID a", keep.show());
});
