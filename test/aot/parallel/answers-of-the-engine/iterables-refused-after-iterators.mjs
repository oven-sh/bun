// Values that are not iterable, where objects with iterators of their own were iterated before.
class Steps {
  constructor(count) { this.count = count; }
  [Symbol.iterator]() { return this; }
  next() { return { done: this.count-- <= 0, value: ["a", 1] }; }
}
function loop(x) { let count = 0; for (const value of x) count++; return count; }
function pattern(x) { const [a, b] = x; return a; }
function entries(x) { return Object.fromEntries(x); }
const values = [5, 1.5, true, false, Symbol("s"), 1n, {}, () => 1, { [Symbol.iterator]: 5 }, { [Symbol.iterator]: null }];
for (const f of [loop, pattern, entries]) {
  const messages = values.map(() => new Set());
  for (let i = 0; i < 30000; i++) {
    f(new Steps(2));
    const index = i % values.length;
    try { f(values[index]); } catch (e) { messages[index].add(e.name + ": " + e.message); }
  }
  for (const set of messages) console.log(f.name, [...set].join(" | "));
}
