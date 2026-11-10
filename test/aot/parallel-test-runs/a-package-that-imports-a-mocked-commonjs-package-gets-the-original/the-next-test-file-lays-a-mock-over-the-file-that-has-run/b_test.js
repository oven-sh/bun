import { test, vi, jest, mock } from "bun:test";
jest.mock("dep", () => ({ value: () => "second", kind: "second", added: "added" }));
test("b", async () => {
  const ofPackage = (await import("reads")).seen, ofFile = (await import("./own.mjs")).seen;
  console.log("SAID b", await ofFile(), "|", await ofPackage(), "|", String(globalThis.runs));
});
