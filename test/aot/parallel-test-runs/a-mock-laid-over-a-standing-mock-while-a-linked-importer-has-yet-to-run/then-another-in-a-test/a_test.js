import { test, vi } from "bun:test";
const read = (o, n) => { try { return String(o[n]); } catch { return "threw"; } };
const keys = o => Object.keys(o).sort().join("+");
import "./first.js";
import { seen, names, read as readSecond } from "./second.js";
test("t", async () => {
  console.log("SAID second", seen(), names(), readSecond("other"), readSecond("more"));
  console.log("SAID the preload holds", read(held, "who"), read(held, "other"), read(held, "more"), keys(held), heldUser());
  vi.doMock("./dep.js", () => ({ who: "last" }));
  console.log("SAID second", seen(), names(), readSecond("other"), readSecond("more"));
  console.log("SAID the preload holds", read(held, "who"), read(held, "other"), read(held, "more"), keys(held), heldUser());
  const asked = await import("./dep.js");
  console.log("SAID asked", read(asked, "who"), read(asked, "other"), read(asked, "more"), keys(asked), asked === held);
  console.log("SAID a new importer", (await import("./third.js")).viaThird());
});
