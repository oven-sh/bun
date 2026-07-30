// Expected (spec + V8): 129. Actual (JSC): 128.
// P128DT0.000000001S with ceil to days: the 1-ns remainder is below
// ULP(128.0) after Int128/nsPerDay division collapses to double, so
// roundNumberToIncrementDouble sees trunc(q)==q and ignores roundingMode.
const d = new Temporal.Duration(0,0,0,128,0,0,0,0,0,1);
const got = d.round({smallestUnit:"day", roundingMode:"ceil"}).days;
if (got !== 128) throw new Error("FIXED: " + got);
print("BUG: 128d+1ns ceil = " + got + " (spec: 129)");
