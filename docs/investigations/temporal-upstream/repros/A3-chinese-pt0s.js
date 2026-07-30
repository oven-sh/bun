// Expected: ~P274178Y or RangeError. Actual: PT0S.
const r = new Temporal.PlainDate(1582,1,1,"chinese").until(
  new Temporal.PlainDate(275760,1,1,"chinese"), {largestUnit:"year"}).toString();
if (r !== "PT0S") throw new Error("FIXED: " + r);
print("BUG: " + r);
