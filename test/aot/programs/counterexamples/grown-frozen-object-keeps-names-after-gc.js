// An object grows by computed keys and is frozen, sealed or made non-extensible: behind the next collection its names still stand for their own values.
let serial = 0; const fresh = () => ++serial;
const makers = [
  () => ({ n31: fresh(), n22: fresh(), n23: fresh(), n28: fresh(), n16: fresh(), kind: fresh(), size: fresh(), n14: fresh(), n17: fresh(), "4294967294": fresh(), n25: fresh(), n47: fresh(), n18: fresh(), n42: fresh(), n33: fresh(), n8: fresh(), n35: fresh(), n0: fresh(), n7: fresh(), n3: fresh(), "4294967295": fresh(), n40: fresh(), n29: fresh() }),
  () => ({ n22: fresh() }),
  () => ({ n7: fresh(), n1: fresh(), n35: fresh(), n12: fresh(), length: fresh() }),
];
const pairs = o => Object.entries(o).map(p => p[0] + ":" + p[1]).join();
function churn() { let junk = []; for (let i = 0; i < 400000; i++) junk.push({ i, s: "x" + i }); return junk.length; }
for (const deed of ["none", "freeze", "seal", "preventExtensions"]) for (const count of [0, 3, 8, 9, 12]) {
  const o = makers[1](); o.n22 = 295; for (let i = 0; i < count; i++) o["extra" + i] = i;
  if (deed !== "none") Object[deed](o);
  const before = pairs(o); churn(); const after = pairs(o);
  console.log(deed, count, before === after ? "the same behind the collection" : "WAS " + before + " IS " + after, "| n22 by a key made now:", o[["n", "22"].join("")], "| JSON", JSON.stringify(o).slice(0, 44));
}
