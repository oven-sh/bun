import { test, vi, jest, mock } from "bun:test";
vi.mock("./dep.cjs", () => ({ value: () => "mocked", kind: "mocked", added: "mocked" }));
test("t", async () => {
  const one = await import("./one.mjs");
  console.log("SAID while", one.seen());
  vi.doUnmock("./dep.cjs");
  const two = await import("./two.mjs");
  console.log("SAID behind", one.seen(), "|", two.seen(), "|", one.held() === two.held(), two.held() === (await import("./dep.cjs")));
});
