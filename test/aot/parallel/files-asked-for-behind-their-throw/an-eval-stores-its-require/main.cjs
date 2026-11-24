// What a direct eval stored into require is what that run's closures call, and the other runs' closures load as before.
globalThis.laters = [];
globalThis.other = name => ({ v: "other " + name });
for (let turn = 0; turn < 3; turn++) {
  try { require("./a.cjs"); console.log("loaded"); } catch (e) { console.log(e.message); }
  for (const l of laters) try { console.log(l()); } catch (e) { console.log(e.message); }
}
