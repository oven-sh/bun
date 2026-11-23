import { test, vi, jest, mock } from "bun:test";
test("c", async () => {
  const ofPackage = (await import("reads")).seen, ofFile = (await import("./own.mjs")).seen;
  console.log("SAID c", await ofFile(), "|", await ofPackage(), "|", String(globalThis.runs));
});
