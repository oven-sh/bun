// Each evaluation of a class has a prototype of its own. A name laid on one of them is seen on that one alone, whichever evaluation it is (the first, the second, a later one):
// what the run time keeps from one evaluation for the next may be no structure that belongs to one object. EACH CASE HAS A CLASS WRITTEN FOR IT ALONE, and nothing lists a prototype before the name is laid:
// listing flattens a dictionary and heals the fault for that class for good. (The fault: `constructor,extra` on a prototype that nobody wrote on; then a crash.)
"use strict";
class Base { constructor(n) { this.size = n; } }
const kinds = {
  "plain": [
    () => class Lone { constructor(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.size = n + work; } },
    () => class Lone { constructor(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.size = n + work; } },
    () => class Lone { constructor(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.size = n + work; } },
    () => class Lone { constructor(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.size = n + work; } },
    () => class Lone { constructor(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.size = n + work; } },
    () => class Lone { constructor(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.size = n + work; } },
  ],
  "with members": [
    () => class Lone { constructor(n) { this.size = n; } twice() { return this.size * 2; } get half() { return this.size / 2; } static of(n) { return new Lone(n); } },
    () => class Lone { constructor(n) { this.size = n; } twice() { return this.size * 2; } get half() { return this.size / 2; } static of(n) { return new Lone(n); } },
    () => class Lone { constructor(n) { this.size = n; } twice() { return this.size * 2; } get half() { return this.size / 2; } static of(n) { return new Lone(n); } },
    () => class Lone { constructor(n) { this.size = n; } twice() { return this.size * 2; } get half() { return this.size / 2; } static of(n) { return new Lone(n); } },
    () => class Lone { constructor(n) { this.size = n; } twice() { return this.size * 2; } get half() { return this.size / 2; } static of(n) { return new Lone(n); } },
    () => class Lone { constructor(n) { this.size = n; } twice() { return this.size * 2; } get half() { return this.size / 2; } static of(n) { return new Lone(n); } },
  ],
  "an heir": [
    () => class Heir extends Base { constructor(n) { super(n); this.mark = n; } },
    () => class Heir extends Base { constructor(n) { super(n); this.mark = n; } },
    () => class Heir extends Base { constructor(n) { super(n); this.mark = n; } },
    () => class Heir extends Base { constructor(n) { super(n); this.mark = n; } },
    () => class Heir extends Base { constructor(n) { super(n); this.mark = n; } },
    () => class Heir extends Base { constructor(n) { super(n); this.mark = n; } },
  ],
};
for (const [kind, sites] of Object.entries(kinds)) {
  for (let written = 0; written < 5; written++) {
    const make = sites[written], classes = [];
    for (let each = 0; each < 5; each++) classes.push(make());
    classes[written].prototype.extra = 7;
    const read = classes.map(Class => String(Class.prototype.extra)).join();
    console.log(kind, "laid on", written, read, classes.map(Class => Object.getOwnPropertyNames(Class.prototype).join("+")).join());
  }
  const make = sites[5], later = [];
  for (let each = 0; each < 4; each++) later.push(make());
  delete later[1].prototype.constructor;
  later[2].prototype.more = 1;
  later[2].prototype.still = 2;
  const born = make();
  console.log(kind, "one loses a name, one gets two, one is born behind them", String(born.prototype.more), String(later[3].prototype.still), typeof born.prototype.constructor, typeof later[1].prototype.constructor, new born(3).size);
}
