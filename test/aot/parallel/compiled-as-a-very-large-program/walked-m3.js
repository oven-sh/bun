// Flags: --aot-heat=ReadOffStructure
// The name that a walk hands out is kept in a member, and the name is an index or reads like a number, true, null or undefined. walked-key.js says what went wrong.
const SIGNALS = { 1: "SIGHUP", 2: "SIGINT", 15: "SIGTERM" };
function makeSeen() { return { last: "none", calls: 0, total: 0, largest: 0, smallest: 0, odd: 0, even: 0 }; }
function walk(seen, weight) {
  seen.calls += 1; seen.total += weight; if (seen.total > 100) seen.total -= 100;
  if (weight > seen.largest) seen.largest = weight; if (weight < seen.smallest || seen.calls === 1) seen.smallest = weight;
  if (weight % 2 === 1) seen.odd += 1; else seen.even += 1; if (seen.odd > seen.even + 10) seen.odd = seen.even;
  if (seen.largest - seen.smallest > 50) seen.largest = seen.smallest + 50;
  for (const num in SIGNALS) { seen.last = num; }
  return seen.calls; }
function nameOfLast(seen) { return SIGNALS[seen.last] ?? "?"; }
const seen = makeSeen();
walk(seen, 1); console.log("R=" + nameOfLast(seen));
walk(seen, 2); console.log("R=" + nameOfLast(seen));
