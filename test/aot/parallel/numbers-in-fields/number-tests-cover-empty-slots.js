// A slot that was emptied, by a delete, an accessor or a name that comes later, fails the test for a number.
function Counter() { this.hits = 0; this.misses = 0; this.rate = 0.5; }
Counter.prototype.hits = 1000; Counter.prototype.later = 5;
Counter.prototype.add = function (turns, at, deed) {
  for (let turn = 0; turn < turns; turn++) {
    if (turn === at) deed(this);
    this.hits += 1;
    this.misses += this.hits & 1;
    this.rate = this.rate * 0.5 + this.misses;
    this.later += this.hits;
  }
  return [this.hits, this.misses, this.rate, this.later].map(String).join(" ") + " " + Object.keys(this) + " " + Object.hasOwn(this, "hits");
};
if (typeof hostCounter === "function") hostCounter(new Counter());
const reads = [];
const deeds = [() => {}, c => { delete c.hits; }, c => { delete c.misses; }, c => { delete c.rate; delete c.later; }, c => { c.rate = "1"; },
  c => Object.defineProperty(c, "misses", { get() { reads.push("misses"); return 9; }, configurable: true }), c => Object.defineProperty(c, "hits", { value: 3 }),
  c => { delete c.misses; c.misses = 2; }, c => { c.hits = undefined; }, c => { c.later = {}; }, c => { c.misses = -0; }, c => { c.hits = 2 ** 31 - 2; }];
for (const deed of deeds) for (const at of [0, 1, 7]) {
  const counter = new Counter();
  let said;
  try { said = counter.add(12, at, deed); } catch (error) { said = error.name; }
  console.log(said, reads.splice(0).length);
}
