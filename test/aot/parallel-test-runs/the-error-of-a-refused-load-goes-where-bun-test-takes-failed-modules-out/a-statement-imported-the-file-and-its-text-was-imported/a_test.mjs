import { test, mock } from "bun:test";

test("an ES file that a statement imported and that was imported as text", async () => {
  const { user } = await import("./user.mjs");
  const { default: text } = await import("./part.mjs", { with: { type: "text" } });
  const ledger1 = await import("./ledger.mjs").catch(error => error);
  await mock.module("./part.mjs", () => ({ part: 2 }));
  const ledger2 = await import("./ledger.mjs").catch(error => error);
  console.log("SAID " + [typeof user, text.length, ledger1.name, ledger1 === ledger2].join(","));
});
