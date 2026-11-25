import { test, mock } from "bun:test";

test("a CommonJS file that was imported, and its text", async () => {
  const { part } = await import("./part.cjs");
  const { default: text } = await import("./part.cjs", { with: { type: "text" } });
  const ledger1 = await import("./ledger.mjs").catch(error => error);
  await mock.module("./part.cjs", () => ({ part: 2 }));
  const ledger2 = await import("./ledger.mjs").catch(error => error);
  console.log("SAID " + [part, text.length, ledger1.name, ledger1 === ledger2].join(","));
});
