(async () => {
  const act = i => console.log("SAID closure", i, globalThis.laters[i]());
  try { require("./piece.cjs"); } catch {}
  try { require("./piece.cjs"); } catch {}
  act(0);
  act(globalThis.laters.length - 1);
  const o = globalThis.objects, leaf = globalThis.leaf;
  console.log("SAID bodies", o.length, "| distinct objects", new Set(o).size);
  o.forEach((m, i) => console.log("SAID object", i, "children", m.children.length, "| the leaf among them:", leaf ? m.children.includes(leaf) : "no leaf", "| is the parent of the leaf:", leaf ? leaf.parent === m : "no leaf"));
})();
function namesTheLeaf() { return require("./leaf.cjs"); }
