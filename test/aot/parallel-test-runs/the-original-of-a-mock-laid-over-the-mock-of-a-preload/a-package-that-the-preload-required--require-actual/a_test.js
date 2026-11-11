import { test, vi, jest, mock } from "bun:test";
vi.mock("widget", () => ({ ...jest.requireActual("widget"), who: name }));
const name = "later";
const say = (at, o, same) => { try { console.log("SAID", at, Object.keys(o).sort().join("+"), o.who, o.other, same === undefined ? "" : "the same object: " + same); } catch (e) { console.log("SAID", at, "threw", String(e.message).slice(0, 60)); } };
test("t", async () => {
  say("asked", await import("widget"));
  say("required", require("widget"));
});
