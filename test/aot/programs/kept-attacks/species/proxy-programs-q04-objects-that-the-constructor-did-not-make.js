// Species: proxy programs  objects that the constructor did not make. It prints what plain Bun prints.
const log = [];
function Node1() { log.push("before " + this.next); this.next = null; this.seen = peek(this); }
function peek(node) { return node.next === null ? "null" : typeof node.next; }
class Heir extends Node1 { constructor() { super(); this.next = this; } }
const plain = {}; Node1.call(plain); plain.next = plain;
const bare = Object.create(Node1.prototype); const made = Reflect.construct(Node1, [], Heir);
const heir = new Heir(), node = new Node1(); node.next = heir;
for (const each of [plain, bare, made, heir, node]) log.push(typeof each.next + ":" + each.seen + ":" + (each instanceof Heir) + ":" + ("next" in each));
console.log(log.join("; "));
