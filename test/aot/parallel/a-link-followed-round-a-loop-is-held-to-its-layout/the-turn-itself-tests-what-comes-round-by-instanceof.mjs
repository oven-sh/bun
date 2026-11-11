class Knot { constructor(tag, up) { this.tag = tag; this.up = up; this.seen = 0; } }
const nothing = JSON.parse("null");
const low = new Knot(1, nothing), mid = new Knot(2, low), high = new Knot(3, mid);
delete mid.tag;
export function climb(start) {
  let sum = 0, at = start;
  while (true) {
    if (at.tag === undefined) sum += 1000; else sum += at.tag;
    if (at.seen) sum += 1; else sum += 2;
    const up = at.up;
    if (!(up instanceof Knot)) break;
    at = up;
  }
  return sum;
}
let all = 0;
for (let turn = 0; turn < 3000; turn++) all = (all * 7 + climb(high)) % 1000003;
console.log(all);
