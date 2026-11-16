// what the handler throws is dropped by `continue` in the finalizer, and the next turn asks again
for (const turn of [1, 2]) {
  try { throw 0; }
  catch { console.log("turn", turn, require("./lib.cjs").v); }
  finally { continue; }
}
console.log("done");
