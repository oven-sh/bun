import { test, expect, vi, mock } from "bun:test";
import { loopOver, sums, adds } from "../src/b.mjs";
const lay = () => { try { mock.module("../src/a.mjs", () => ({ value: "text", count: {}, add: n => "added" + n })); } catch (error) { console.log("SAID mock threw", error.constructor.name); } };
test("by name", async () => {
  console.log("SAID", loopOver(4, -1, () => {}), sums(5, -1, () => {}), adds(3, -1, () => {}));
  console.log("SAID laid", loopOver(6, 3, lay), sums(6, -1, lay), adds(4, 2, lay));
  console.log("SAID undone", loopOver(8, 4, () => { try { mock.restore(); } catch (error) { console.log("SAID undo threw", error.constructor.name); } }), sums(5, -1, () => {}), adds(3, -1, () => {}));
});
