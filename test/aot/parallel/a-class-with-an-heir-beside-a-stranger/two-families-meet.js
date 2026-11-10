class Node { constructor(key) { this.key = key; this.next = null; } weigh() { return this.key * 2; } }
class Point { constructor(x) { this.x = x; } weigh() { return this.x + 1; } }
class Leaf extends Node { leaf = true; }
class Spot extends Point { spot = 7; weigh() { return this.spot; } }
function pick(i) { return i % 3 ? new Node(i) : new Point(i); }
function read(one) { return one instanceof Node ? one.key : one.x; }
let sum = 0; const kept = [];
for (let i = 0; i < 40; i++) { const one = pick(i); kept.push(one); sum += read(one) + one.weigh(); }
kept.push(new Leaf(9), new Spot(8));
let all = 0; for (const one of kept) all += one.weigh();
console.log(sum, all, kept[40].leaf, kept[41].spot, kept[41].x);
