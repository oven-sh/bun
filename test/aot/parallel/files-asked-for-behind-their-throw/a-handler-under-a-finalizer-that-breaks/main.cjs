// what the handler throws is dropped by `break` in the finalizer, and the body asks again further down
first: {
  try { throw 0; }
  catch { console.log("first", require("./lib.cjs").v); }
  finally { break first; }
}
console.log("second", require("./lib.cjs").v);
