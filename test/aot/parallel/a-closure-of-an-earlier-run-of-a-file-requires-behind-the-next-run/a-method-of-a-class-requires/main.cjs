(async () => {
  try { require("./piece.cjs"); } catch {}
  try { require("./piece.cjs"); } catch {}
  try { await globalThis.laters[0](); console.log("SAID acted"); } catch (e) { console.log("SAID threw", e && e.name); }
  const o = globalThis.objects, leaf = globalThis.leaf;
  console.log("SAID bodies", o.length);
  o.forEach((m, i) => console.log("SAID object", i, "children", m.children.map(c => String(c.id).replace(/^.*[\\/]/, "")).join("+") || "none", "| is the parent of the leaf:", leaf ? leaf.parent === m : "no leaf"));
})();
function namesTheLeaves() { return [require("./leaf.cjs"), require("./spare.cjs"), require("./leaf.mjs"), require("./leaf.json")]; }
