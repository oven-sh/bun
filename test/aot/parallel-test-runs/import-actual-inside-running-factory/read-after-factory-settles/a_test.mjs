import { test, vi } from "bun:test";
const tell = f => { try { return String(f()); } catch (error) { return error.name; } };
import * as first from "./k.mjs";
test("t", async () => {
  first.bump();
  vi.doMock("./k.mjs", async () => {
    const other = await vi.importActual("./other.mjs");
    globalThis.kept = other;
    return { x: "over " + other.sees() + " " + other.counts() };
  });
  const one = await import("./k.mjs");
  console.log("SAID", log.join(" "), "|", one.x, first.count());
  console.log("SAID settled bodies", log.join(" "));
  console.log("SAID settled value", tell(() => globalThis.kept.sees()));
  console.log("SAID settled count", tell(() => globalThis.kept.counts()), first.count());
  vi.doUnmock("./k.mjs");
  console.log("SAID ended bodies", log.join(" "));
  console.log("SAID ended value", tell(() => globalThis.kept.sees()));
  console.log("SAID ended count", tell(() => globalThis.kept.counts()), first.count());
}, 5000);
