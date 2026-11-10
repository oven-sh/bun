import { test, mock } from "bun:test";

test("both forms came by statements", async () => {
  const { user } = await import("./user.mjs");
  const said = user();
  const ledger1 = await import("./ledger.mjs").catch(error => error);
  await mock.module("./part.mjs", () => ({ part: 2 }));
  const ledger2 = await import("./ledger.mjs").catch(error => error);
  console.log("SAID " + [said, ledger1.name, ledger1 === ledger2].join(","));
});
