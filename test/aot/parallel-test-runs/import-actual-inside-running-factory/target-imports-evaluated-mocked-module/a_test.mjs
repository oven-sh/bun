import { test, vi } from "bun:test";
import * as first from "./k.mjs";
test("t", async () => {
  first.bump();
  vi.doMock("./k.mjs", async () => {
    const other = await vi.importActual("./other.mjs");
    return { x: "over " + other.sees() + " " + other.counts() };
  });
  const one = await import("./k.mjs");
  console.log("SAID", log.join(" "), "|", one.x, first.count());
}, 5000);
