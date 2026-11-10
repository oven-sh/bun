class Node { constructor(key) { this.key = key; this.next = null; } weigh() { return this.key * 2; } }
class Point { constructor(x) { this.x = x; } weigh() { return this.x + 1; } }
class Leaf extends Node { leaf = true; }
class A { weigh() { return 1; } }
class B { weigh() { return 2; } }
class C { weigh() { return 3; } }
function pick(i) { return i % 3 ? new Node(i) : new Point(i); }
function read(one) { return one instanceof Node ? one.key : one.x; }
let sum = 0; const kept = [];
for (let i = 0; i < 40; i++) { const one = pick(i); kept.push(one); sum += read(one) + one.weigh(); }
kept.push(new Leaf(9), new A, new B, new C);
let all = 0; for (const one of kept) all += one.weigh();
console.log(sum, all, kept.length);
