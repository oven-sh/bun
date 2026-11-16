class Node { constructor(key) { this.key = key; this.next = null; } weigh() { return this.key * 2; } }
class Point { constructor(x) { this.x = x; } weigh() { return this.x + 1; } }
class Leaf extends Node { leaf = true; }
function pick(i) { return i % 3 ? new Node(i) : new Point(i); }
function read(one) { return one instanceof Node ? one.key : one.x; }
let sum = 0; const kept = [];
for (let i = 0; i < 40; i++) { const one = pick(i); kept.push(one); sum += read(one) + one.weigh(); }
console.log(sum, kept.length, kept[1].key, kept[3].x);
