import { test, mock, vi, jest } from "bun:test";

test("made up", async () => {
  const said = [];
  vi.doMock("./tray.mjs", () => ({ tray: "mock" }));
  const { shelf } = await import("./shelf.mjs"); said.push(shelf());
  const { other } = await import("./other.mjs"); said.push(other);
  const { default: read } = await import("./reader.cjs"); said.push(read.a);
  const { default: text } = await import("./stock.json", { with: { type: "text" } }); said.push(text.length);
  const first = await import("./ledger.mjs").catch(error => error);
  await mock.module("./stock.json", () => ({ default: { a: 2 } }));
  const second = await import("./ledger.mjs").catch(error => error);
  said.push(first.name, first === second);
  console.log("SAID " + said.join(","));
});
