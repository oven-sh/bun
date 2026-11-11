import { test, vi } from "bun:test";
globalThis.log = [];
test("t", async () => {
  const first = await import("@r3564-made-up/kit");
  first.bump();
  vi.doMock("@r3564-made-up/kit", async () => {
    const other = await vi.importActual("./other.mjs");
    return { x: "over " + other.sees() + " " + other.counts() };
  });
  const one = await import("@r3564-made-up/kit");
  vi.doUnmock("@r3564-made-up/kit");
  const back = await import("@r3564-made-up/kit");
  vi.doMock("@r3564-made-up/kit", () => ({ x: "two" }));
  const two = await import("@r3564-made-up/kit");
  vi.doUnmock("@r3564-made-up/kit");
  const last = await import("@r3564-made-up/kit");
  console.log("SAID", log.join(" "), "|", one.x, back === first, back.count(), "|", two.x, "|", last === first, last.x);
}, 5000);
