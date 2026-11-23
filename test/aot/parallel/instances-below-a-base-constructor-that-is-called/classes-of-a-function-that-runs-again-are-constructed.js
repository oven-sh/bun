// Four classes are written in a function that runs 3,000 times: each run has prototype objects of its own, and the sites, which remember those of the first run, make their own cells below the others: 83 constructions a run, of which only the first at each site and prototype asks the run time.
// COUNT: operation:operationAOTSetConstructPrototype <= 40000
"use strict";
const unseen = (x) => [x][JSON.parse("0")];
function family(round) {
  class Base { constructor(n) { this.size = n + 1; this.ratio = n / 2; this.name = "b" + (n & 1); } }
  class Heir extends Base { constructor(n) { super(n); this.mark = n + 2; } }
  class Called { constructor(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.size = n + work; this.ratio = n / 4; } }
  class Below extends Called { constructor(n) { super(n); this.mark = n; } }
  let sum = 0;
  for (let i = 0; i < 40; i++) { const one = new Base(i + round); sum += one.size + one.ratio + one.name.length; const two = new Called(i); sum += two.size + two.ratio; }
  const heir = unseen(new Heir(round)), below = unseen(new Below(round)), called = unseen(new Called(round));
  return sum + heir.size + heir.mark + heir.ratio + below.size + below.mark + below.ratio + called.size + (heir instanceof Base ? 1 : 0) + (below instanceof Called ? 1 : 0) + (Object.getPrototypeOf(called) === Called.prototype ? 1 : 0);
}
let total = 0;
for (let round = 0; round < 3000; round++) {
  total += family(round);
  if (round % 50 === 7) Bun.gc(true);
}
console.log(total);
