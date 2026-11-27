import { test, mock } from "bun:test";
test("t", async () => {
  try { require("./piece.cjs"); } catch {}
  mock.module("./piece.cjs", () => ({ default: "mocked" }));
  await import("./wrap.mjs").catch(() => {});
  const later = globalThis.laters[0];
  try { later("./le" + "af.cjs"); console.log("SAID acted"); } catch (e) { console.log("SAID threw", e && e.name); }
  const o = globalThis.objects, leaf = globalThis.leaf;
  console.log("SAID bodies", o.length);
  o.forEach((x, i) => console.log("SAID object", i, "children", x.children.map(c => String(c.id).replace(/^.*[\\/]/, "")).join("+") || "none", "| the very object of the leaf among them:", leaf ? x.children.includes(leaf) : "no leaf", "| is its parent:", leaf ? leaf.parent === x : "no leaf"));
});
function namesTheLeaves() { return [require("./leaf.cjs"), require("./leaf.json")]; }
