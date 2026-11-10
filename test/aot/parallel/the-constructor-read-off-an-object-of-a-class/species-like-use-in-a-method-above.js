// A method above makes the list that it fills by this.constructor.
// STATISTIC: ConstructorsReadOffObjectsOfClasses >= 1
class List { items; constructor(items = []) { this.items = items; } map(f) { const made = new this.constructor(); for (const x of this.items) made.items.push(f(x)); return made; } total() { let t = 0; for (const x of this.items) t += x; return t; } }
class Doubling extends List { total() { return super.total() * 2; } }
let sum = 0;
for (let i = 0; i < 200; i++) { const from = i & 1 ? new List([i, 1]) : new Doubling([i, 2]); sum += from.map(x => x + 1).total(); }
console.log(sum);
