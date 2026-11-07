import { test, vi, jest, mock } from "bun:test";
import { seen } from "reads";
vi.mock("dep", () => ({ value: () => "mocked", kind: "mocked", added: "added" }));
test("t", async () => {
  console.log("SAID while", await seen());
  vi.doUnmock("dep");
  console.log("SAID behind doUnmock", await seen());
  mock.restore();
  console.log("SAID behind restore", await seen());
});
