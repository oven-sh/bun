// A loop in code that runs once turns as often as a loop anywhere else. A function that in the end only reads and computes leaves no call in such a loop,
// be it in the top-level code of a module or in a function that is called once. Where only its throw stays out of the copy, the call stands behind the copy.
// IR-UNTIL InlineHeads
// IRM= 0 CallDirect v[0-9]+(, v[0-9]+)? function=f[0-9]+(?!.*isAfterInlinedHead)
// IRM= 2 CallDirect v[0-9]+(, v[0-9]+)? function=f[0-9]+.*isAfterInlinedHead
// IR= 0 calledOnce CallDirect v[0-9]+ function=f[0-9]+(?!.*isAfterInlinedHead)
// IR= 1 calledOnce CallDirect v[0-9]+ function=f[0-9]+.*isAfterInlinedHead
function byIndex(o) { const entries = Object.entries(o); let total = 0; for (let i = 0; i < entries.length; i++) total += entries[i][0].length + entries[i][1]; return total; }
const point = { x: 1, y: 2.5 };
let sum = 0;
for (let n = 0; n < 1000; n++) { point.x = n & 7; sum += byIndex(point); }
console.log(sum);

function namesAndSizes(o) { const entries = Object.entries(o); let total = 0; for (let i = 0; i < entries.length; i++) total += entries[i][0].length * 10 + entries[i][1]; return total; }
function calledOnce(first, turns, step) { const size = { width: 3, height: 4.5 }; let sum = 0; for (let n = first; n < turns; n += step) { size.width = n % 5; sum += namesAndSizes(size); } return sum; }
console.log(calledOnce(0, 1000, 1));

function priceOf(record, rate) {
  if (record.count < 0) throw new RangeError("a count of " + record.count + " at a price of " + record.price + " and a rate of " + rate + " for " + record.name + " cannot be sold");
  return record.count * record.price * rate;
}
const records = [];
for (let n = 0; n < 50; n++) records.push({ name: "item " + n, count: n, price: n / 4 });
let sold = 0;
for (let n = 0; n < records.length; n++) sold += priceOf(records[n], 3);
console.log(sold);
