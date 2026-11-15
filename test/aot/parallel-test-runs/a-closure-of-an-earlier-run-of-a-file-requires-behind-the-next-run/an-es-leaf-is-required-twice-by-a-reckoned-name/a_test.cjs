const { test } = require("bun:test");
const short = m => (m && m.id !== undefined ? String(m.id).replace(/^.*[\\/]/, "") : String(m));
test("t", async () => {
  try { require("./piece.cjs"); } catch {}
  try { require("./piece.cjs"); } catch {}
  { const later = globalThis.laters[0]; try { later("./le" + "af.mjs"); console.log("SAID closure", 0, "acted"); } catch (e) { console.log("SAID closure", 0, "threw", e && e.message); } }
  { const later = globalThis.laters[0]; try { later("./le" + "af.mjs"); console.log("SAID closure", 0, "acted"); } catch (e) { console.log("SAID closure", 0, "threw", e && e.message); } }
  const o = globalThis.objects ?? [], leaf = globalThis.leaf;
  console.log("SAID bodies", globalThis.bodies ?? o.length);
  o.forEach((m, i) => console.log("SAID object", i, "children", m.children.map(short).join("+") || "none", "| the very leaf among them:", leaf ? m.children.includes(leaf) : "no leaf", "| is its parent:", leaf ? leaf.parent === m : "no leaf"));
  if (leaf && !o.includes(leaf.parent)) console.log("SAID the parent of the leaf is", short(leaf.parent), "children", leaf.parent && leaf.parent.children ? leaf.parent.children.map(short).join("+") || "none" : "-");
});
function namesTheLeaves() { return [require("./leaf.mjs")]; }
