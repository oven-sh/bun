import { test, mock } from "bun:test";

test("a file read by require and as text", async () => {
  const { default: read } = await import("./reader.cjs");
  const { default: text } = await import("./data.json", { with: { type: "text" } });
  const ledger1 = await import("./ledger.mjs").catch(error => error);
  await mock.module("./data.json", () => ({ default: { a: 2 } }));
  const ledger2 = await import("./ledger.mjs").catch(error => error);
  console.log("SAID " + [read.a, text.length, ledger1.name, ledger1 === ledger2].join(","));
});
