// Each node gets a number computed from the field of the node before it, until it has left the int32 range.
const log = [];
function Link(value, previous) { this.value = value; this.previous = previous; }
function extend(link) { return new Link(link.value * 2 + 1, link); }
let link = new Link(1, null);
for (let i = 0; i < 40; i++) link = extend(link);
let sum = 0, steps = 0; for (let each = link; each !== null; each = each.previous) { sum += each.value; steps++; }
log.push(link.value, link.value | 0, sum, steps, link.previous.previous.value);
class Counter { constructor(start) { this.n = start; } next() { return new Counter(this.n + 1073741824); } }
let counter = new Counter(0); for (let i = 0; i < 5; i++) counter = counter.next(); log.push(counter.n, counter.n | 0);
console.log(log.join("; "));
