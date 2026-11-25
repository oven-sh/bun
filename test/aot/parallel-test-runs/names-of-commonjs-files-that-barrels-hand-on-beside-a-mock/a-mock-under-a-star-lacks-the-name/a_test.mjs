import { test, mock } from "bun:test";
mock.module("./prices.mjs", () => ({ other: "the other of the mock" }));
test("a name that the mock lacks is nowhere, though the file that declares it has run", async () => {
  console.log((await import("./rates.cjs")).rate);
  const till = await import("./till.mjs");
  console.log(String(till.byStatement()), "|", String(till.offNamespace()), "|", String(till.byKey("rate")));
});
