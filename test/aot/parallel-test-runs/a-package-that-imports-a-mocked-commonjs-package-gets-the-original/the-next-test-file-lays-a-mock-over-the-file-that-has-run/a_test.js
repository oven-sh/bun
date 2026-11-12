import { test, vi, jest, mock } from "bun:test";
vi.mock("dep", () => ({ value: () => "mocked", kind: "mocked", added: "added" }));
test("a", async () => {
  const ofPackage = (await import("reads")).seen, ofFile = (await import("./own.mjs")).seen;
  console.log("SAID a", await ofFile(), "|", await ofPackage(), "|", String(globalThis.runs));
});
