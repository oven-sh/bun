// Expected: RangeError. Actual: Duration with sign=-1.
const v = (2 - 2**-52) * 2**127;
const d = new Temporal.Duration(0,0,0,0,0,0,0,0,0, v);
if (d.sign !== -1) throw new Error("FIXED");
print("BUG: sign=" + d.sign + " ns=" + d.nanoseconds);
