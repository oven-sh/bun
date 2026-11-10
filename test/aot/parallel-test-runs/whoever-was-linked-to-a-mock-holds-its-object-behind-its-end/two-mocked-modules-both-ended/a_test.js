import { test, vi, jest, mock } from "bun:test";
vi.mock("dep", () => ({ value: () => "mocked", kind: "mocked", added: "mocked" }));
vi.mock("./other.cjs", () => ({ value: () => "other mocked", kind: "other mocked", added: "other mocked" }));
test("t", async () => {
  const one = await import("./one.mjs");
  console.log("SAID while", one.seen());
  vi.doUnmock("dep");
  console.log("SAID one ended", one.seen());
  vi.doUnmock("./other.cjs");
  console.log("SAID both ended", one.seen());
});
