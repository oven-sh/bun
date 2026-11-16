import { test, vi } from "bun:test";
test("s0", async () => {
  let raise;
  globalThis.signal = new Promise(done => {
    raise = done;
  });
  const hasBegun = new Promise(done => {
    globalThis.begun = done;
  });
  vi.doMock("./tax.mjs", () => ({ rate: 7 }));
  const held = await import("./bill.mjs");
  const before = held.total(100);
  vi.doUnmock("./tax.mjs");
  const load = import("./books.mjs").then(
    () => "loaded",
    error => error.name + " " + error.message,
  );
  await hasBegun;
  let required = "answered";
  try {
    require("./books.mjs");
  } catch {
    required = "refused";
  }
  raise();
  const ended = await load;
  console.log("SAID s0", before, required, ended, held.total(100), (await import("./bill.mjs")).total(100));
});
