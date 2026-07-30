// Expected: completes promptly or throws. Actual: O(year_span) walltime.
const t0 = Date.now();
new Temporal.PlainDate(2000,1,1,"chinese").until(
  new Temporal.PlainDate(5000,1,1,"chinese"), {largestUnit:"month"});
const dt = Date.now() - t0;
print("3000y chinese month until: " + dt + "ms");
if (dt < 200) throw new Error("FIXED");
