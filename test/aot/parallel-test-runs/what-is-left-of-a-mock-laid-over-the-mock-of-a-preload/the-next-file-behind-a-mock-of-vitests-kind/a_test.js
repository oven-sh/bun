import { test, vi, jest, mock } from "bun:test";
const read = (o, n) => { try { return String(o[n]); } catch { return "threw"; } };
const keys = o => Object.keys(o).sort().join("+");
import { seen, names, read as readSecond } from "./second.js";
test("t", async () => {
  vi.doMock("./dep.js", () => ({ who: "later", more: "later more" }));
  console.log("SAID second", seen(), names(), readSecond("other"), readSecond("more"));
  console.log("SAID the preload holds", read(held, "who"), read(held, "other"), read(held, "more"), keys(held), heldUser());
});
