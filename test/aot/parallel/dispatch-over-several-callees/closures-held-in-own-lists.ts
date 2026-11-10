const out: string[] = [];
const show = (v: unknown): string => Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : v instanceof Error ? v.name + " " + v.message : typeof v === "object" && v ? "object" : String(v);
type Handler = (n: number) => number;
function makeHandler(kind: number): Handler {
  let calls = 0;
  switch (kind) {
    case 0: return n => n + ++calls;
    case 1: return n => (n ^ kind) + ++calls;
    case 2: return n => n * 3 - ++calls;
    default: return n => n - kind;
  }
}
const ints: number[] = JSON.parse("[" + Array.from({ length: 48 }, (_, k) => (k * 7919) % 101 - 20).join() + "]");
const fractions: number[] = JSON.parse("[" + Array.from({ length: 48 }, (_, k) => k / 4).join() + "]");
const large: number[] = JSON.parse("[" + Array.from({ length: 48 }, (_, k) => (k % 3) * 2147483647).join() + "]");
function sums(name: string, run: (list: number[]) => number): void {
  for (const list of [ints, fractions, large, ints]) {
    try { out.push(name + " " + show(run(list))); } catch (error) { out.push(name + " threw " + show(error)); }
  }
}

const plain: Handler[] = [];
for (let k = 0; k < 16; k++) plain.push(makeHandler(k & 3));
sums("bits", list => { let total = 0; for (let k = 0; k < list.length; k++) total = (total + plain[k & 15](list[k])) & 0xffffff; return total; });
sums("sum", list => { let total = 0; for (let k = 0; k < list.length; k++) total += plain[k & 15](list[k]); return total; });
sums("of", list => { let total = 0; for (const n of list) total = (total * 3 + plain[n & 15](n)) % 1000; return total; });
sums("each", list => { let total = 0; for (const handler of plain) total += handler(list[total & 31]); return total; });

const marked: Handler[] = [];
for (let k = 0; k < 16; k++) marked.push(makeHandler(k & 3));
for (let k = 0; k < 16; k += 3) Object.assign(marked[k], { mark: k });
sums("marked", list => { let total = 0; for (let k = 0; k < list.length; k++) total = (total + marked[k & 15](list[k])) & 0xffffff; return total; });
sums("marked sum", list => { let total = 0; for (let k = 0; k < list.length; k++) total += marked[k & 15](list[k]); return total; });

const late: Handler[] = [];
for (let k = 0; k < 16; k++) late.push(makeHandler(k & 3));
sums("marked late", list => {
  let total = 0;
  for (let k = 0; k < list.length; k++) { const handler = late[(k * 5) & 15]; total = (total + handler(list[k])) | 0; if (k % 11 === 10) Object.assign(handler, { late: k }); }
  return total;
});

const bare: Handler[] = [];
for (let k = 0; k < 16; k++) bare.push(makeHandler(k & 3));
Object.setPrototypeOf(bare[2], null); Object.defineProperty(bare[5], "name", { value: "five" }); Object.freeze(bare[7]);
sums("without a prototype", list => { let total = 0; for (let k = 0; k < list.length; k++) total = (total + bare[k & 15](list[k])) & 0xffffff; return total; });

const holes: Handler[] = [];
for (let k = 0; k < 16; k++) holes.push(makeHandler(k & 3));
delete holes[9];
sums("a hole", list => { let total = 0; for (let k = 0; k < list.length; k++) { try { total = (total + holes[k & 15](list[k])) & 0xffffff; } catch { total += 7; } } return total; });

const short: Handler[] = [];
for (let k = 0; k < 13; k++) short.push(makeHandler(k & 3));
sums("too short", list => { let total = 0; for (let k = 0; k < list.length; k++) total = (total + short[k & 15](list[k])) & 0xffffff; return total; });

const swapped: Handler[] = [];
for (let k = 0; k < 16; k++) swapped.push(makeHandler(k & 3));
sums("swapped", list => {
  let total = 0;
  for (let k = 0; k < list.length; k++) { total = (total + swapped[k & 15](list[k])) & 0xffff; const other = swapped[(k + 5) & 15]; swapped[(k + 5) & 15] = swapped[k & 15]; swapped[k & 15] = other; }
  return total;
});

const two: Handler[] = [];
for (let k = 0; k < 16; k++) two.push(k & 1 ? n => n + k : n => n * k);
sums("two", list => { let total = 0; for (let k = 0; k < list.length; k++) total += two[k & 15](list[k]); return total; });

const three: Handler[] = [];
for (let k = 0; k < 15; k++) three.push(k % 3 === 0 ? n => n + k : k % 3 === 1 ? n => n * k : n => n - k / 2);
Object.assign(three[4], { mark: 4 });
sums("three", list => { let total = 0; for (let k = 0; k < list.length; k++) total += three[k % 15](list[k]); return total; });

const eight: Handler[] = [];
for (let k = 0; k < 16; k++) {
  switch (k & 7) {
    case 0: eight.push(n => n + k); break;
    case 1: eight.push(n => n - k); break;
    case 2: eight.push(n => n * k); break;
    case 3: eight.push(n => n ^ k); break;
    case 4: eight.push(n => n & k); break;
    case 5: eight.push(n => n | k); break;
    case 6: eight.push(n => n % (k + 1)); break;
    default: eight.push(n => k - n);
  }
}
Object.assign(eight[11], { mark: 11 });
sums("eight", list => { let total = 0; for (let k = 0; k < list.length; k++) total += eight[k & 15](list[k]); return total; });

const five: Handler[] = [];
for (let k = 0; k < 15; k++) {
  switch (k % 5) {
    case 0: five.push(n => n + k); break;
    case 1: five.push(n => n - k); break;
    case 2: five.push(n => n * k); break;
    case 3: five.push(n => n ^ k); break;
    default: five.push(n => { if (n === 44) throw new RangeError("n is " + n); return k - n; });
  }
}
sums("five", list => { let total = 0; for (let k = 0; k < list.length; k++) { try { total += five[k % 15](list[k]); } catch (error) { total -= show(error).length; } } return total; });
console.log(out.join("\n"));
