// answers: without-library
// # bind() fixes a receiver and leading operands. What it makes is called, bound again, constructed with, kept, and asked for its name and length, also where the function had been given a member, another name or another length first.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 23 of 23 of 23
// # CHECK-NEXT: exited with 0
function add(a, b, c) { return (this ? this.base : 0) + a + b + (c === undefined ? 100 : c); }
const holder = { base: 1000, add };
function boundHere(n) { const bound = add.bind(holder, n); return bound(1, 2) + ":" + bound(1) + ":" + bound.length + ":" + bound.name; }
function boundTwice(n) { const bound = add.bind(holder, n).bind(null, 1); return bound(2) + ":" + bound.length + ":" + bound.name; }
function boundMethod(n) { const bound = holder.add.bind({ base: n }); return bound(1, 2, 3); }
function constructed(n) { function Point(x, y) { this.x = x; this.y = y; } const Bound = Point.bind(null, n); const made = new Bound(2); return made.x + ":" + made.y + ":" + (made instanceof Point) + ":" + (made instanceof Bound); }
function changedFirst(n) { function plain(a) { return a + n; } plain.tag = n; const bound = plain.bind(null, 1); return bound() + ":" + bound.tag + ":" + plain.tag; }
function renamedFirst(n) { function plain(a) { return a; } Object.defineProperty(plain, "name", { value: "other" + n }); Object.defineProperty(plain, "length", { value: 5 }); const bound = plain.bind(null); return bound.name + ":" + bound.length; }
function kept(list, n) { list.push(add.bind({ base: n }, 1, 2)); return list.length; }
const list = [];
for (let n = 0; n < 3; n++) { report(boundHere(n)); report(boundTwice(n)); report(boundMethod(n)); report(constructed(n)); report(changedFirst(n)); report(renamedFirst(n)); report(kept(list, n)); }
report(list[0](3) + list[1]() + list[2](5, 6));
report("end");
