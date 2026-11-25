import { test, vi } from "bun:test";
globalThis.log = [];
test("t", async () => {
  const first = await import("./k.cjs");
  first.bump();
  vi.doMock("./k.cjs", async () => {
    log.push("factory");
    const other = await vi.importActual("./other.mjs");
    log.push("counts", other.counts(), first.count());
    return { x: "mocked over " + other.sees() };
  });
  const mocked = await import("./k.cjs");
  console.log("SAID", log.join(" "), "|", mocked.x);
}, 5000);
