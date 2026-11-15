const { test } = require("bun:test");
const short = m => (m && m.id !== undefined ? String(m.id).replace(/^.*[\\/]/, "") : String(m));
test("t", async () => {
  try { require("./piece.cjs"); } catch {}
  try { require("./piece.cjs"); } catch {}
  { const later = globalThis.laters[0]; try { later("./le" + "af.mjs"); console.log("SAID closure", 0, "acted"); } catch (e) { console.log("SAID closure", 0, "threw", e && e.name); } }
  await 0; await 0; await new Promise(done => setImmediate(done));
  try { require("./leaf.mjs"); console.log("SAID the entry required it"); } catch (e) { console.log("SAID the entry threw", e && e.name); }
  { const later = globalThis.laters[0]; try { later("./le" + "af.mjs"); console.log("SAID closure", 0, "acted"); } catch (e) { console.log("SAID closure", 0, "threw", e && e.name); } }
  const o = globalThis.objects;
  console.log("SAID bodies", o.length, "| entry children", module.children.map(short).join("+") || "none");
  o.forEach((m, i) => console.log("SAID object", i, "children", m.children.map(short).join("+") || "none"));
});
function namesTheLeaf() { return require("./leaf.mjs"); }
