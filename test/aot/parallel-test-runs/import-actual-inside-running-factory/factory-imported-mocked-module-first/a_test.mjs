import { test, vi } from "bun:test";
globalThis.log = [];
test("t", async () => {
  let first;
  vi.doMock("./k.mjs", async () => {
    log.push("factory");
    first = await import("./k.mjs");
    first.bump();
    const other = await vi.importActual("./other.mjs");
    log.push("counts", other.counts(), first.count());
    return { x: "mocked over " + other.sees() };
  });
  const mocked = await import("./k.mjs");
  console.log("SAID", log.join(" "), "|", mocked.x);
}, 5000);
