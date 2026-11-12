import { test, mock, vi } from "bun:test";
import pull from "./pull.cjs";

test("made up", async () => {
  const said = [];
  await mock.module("./stock.json", () => ({ default: { a: 3 } }));
  said.push(JSON.stringify(pull()));
  vi.doUnmock("./stock.json");
  said.push(JSON.stringify(pull()));
  const first = await import("./ledger.mjs").catch(error => error);
  await mock.module("./stock.json", () => ({ default: { a: 2 } }));
  const second = await import("./ledger.mjs").catch(error => error);
  said.push(first.name, first === second);
  console.log("SAID " + said.join(","));
});
