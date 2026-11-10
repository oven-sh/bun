class Node { constructor(key) { this.key = key; this.next = null; } weigh() { return this.key * 2; } }
class Point { constructor(x) { this.x = x; } weigh() { return this.x + 1; } }
class Leaf extends Node { leaf = true; }
function pick(i) { return i % 3 ? new Node(i) : new Point(i); }
function read(one) { return one instanceof Node ? one.key : one.x; }
let sum = 0; const kept = [];
for (let i = 0; i < 40; i++) { const one = pick(i); kept.push(one); sum += read(one) + one.weigh(); }
for (const one of kept) { if (one instanceof Node) one.next = kept[0]; else one.x = 'text'; }
console.log(sum, kept[1].next === kept[0], kept[3].x, typeof kept[0].x);
