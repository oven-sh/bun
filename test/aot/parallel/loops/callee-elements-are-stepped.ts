// Functions and methods that count in arrays and are called in loops: the ends of int32, fractions, both zeros, holes, texts, growth, other stores amid the loop, values that are used, keys out of bounds, throws.
const show = (v: any): string => (Object.is(v, -0) ? "-0" : typeof v === "object" && v ? JSON.stringify(Array.from(v, show)) : String(v));
const counts: any[] = [0, 0, 0, 0];
const high: any[] = [2147483640, 0, -2147483645, 1];
const fractions: any[] = [0.5, -0, 1, 4294967290];
const holes: any[] = [1, , 3, 4];
const texts: any[] = ["a", 1, 2, 3];
const grown: any[] = [0];
const typed = new Int32Array(4);
let sum: any = 0;
const steps: Record<string, (x: any) => any> = {
  count(x) {
    counts[x & 3]++;
  },
  high(x) {
    high[x & 3] += 2;
    if (x === 25) high[1] = 2147483647;
  },
  down(x) {
    high[x & 3] -= 1000000000;
  },
  fractions(x) {
    fractions[x & 3]--;
  },
  holes(x) {
    holes[x & 3]++;
    if (x === 9) delete holes[0];
  },
  texts(x) {
    texts[x & 3] += 1;
  },
  grown(x) {
    grown[x % 6]++;
    if (x === 11) grown.push(7);
    if (x === 13) grown.length = 2;
  },
  typed(x) {
    ++typed[x & 7];
  },
  used(x) {
    const was = counts[x % 4]++;
    sum = (sum + was) | 0;
    return was;
  },
  changed(x) {
    counts[x & 3]++;
    if (x === 12) counts[0] = 1.5;
    if (x === 20) counts[1] = "t";
    if (x === 33) throw new Error("at " + x);
  },
};
class Bins {
  bins: any[] = [0, 0, 0, 0];
  total = 0;
  put(x: any): void {
    this.bins[x & 3]++;
    this.total++;
  }
}
const bins = new Bins();
function note(x: any): void {
  counts[x & 3]++;
}
function run(k: number): any {
  for (let i = 0; i < k; i++) note(i * 5);
  return counts;
}
function fill(k: number): any {
  for (let i = 0; i < k; i++) {
    bins.put(i);
    if (i & 1) bins.put(i + 1);
  }
  return bins.bins;
}
console.log(show(run(0)), show(run(50)), show(fill(0)), show(fill(41)), bins.total);
for (const name of Object.keys(steps)) {
  const step = steps[name];
  for (const k of [0, 3, 40]) {
    try {
      let last: any;
      for (let i = 0; i < k; i++) last = step(i);
      console.log(name, show(last), show(counts), show(high), show(fractions), show(holes), show(texts), show(grown), show(typed), sum);
    } catch (error: any) {
      console.log(name, error.message, show(counts));
    }
  }
}
console.log(show(run(9)));
