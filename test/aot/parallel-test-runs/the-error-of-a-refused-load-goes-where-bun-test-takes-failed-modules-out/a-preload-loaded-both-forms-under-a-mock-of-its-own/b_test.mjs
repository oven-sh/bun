import { test, mock, vi } from "bun:test";

test("made up", async () => {
  const said = [];
  const first = await import("./ledger.mjs").catch(error => error);
  await mock.module("./stock.json", () => ({ default: { a: 2 } }));
  const second = await import("./ledger.mjs").catch(error => error);
  said.push(first.name, first === second);
  console.log("SAID " + said.join(","));
});
