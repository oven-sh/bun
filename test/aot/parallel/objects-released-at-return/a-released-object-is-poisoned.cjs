// Flags: --aot-testing=CheckProofsAtRunTime
"use strict";
class Link { constructor(value, next) { this.value = value; this.next = next; } }
function chain(n) { let head = null; for (let i = n; i > 0; i--) head = new Link(i, head); return head; }
function copy(a) { let head = new Link("head", null), tail = head; for (; a; a = a.next) { const link = a; tail.next = link; tail = link; } return head.next; }
function copyAll(a) { let head = new Link("head", null), tail = head; for (; a; a = a.next) { const link = a; tail.next = link; tail = link; } tail.next = null; return head.next; }
const ways = [copy, copyAll, copy];
const kept = [];
for (let turn = 0; turn < 40; turn++) {
  const list = ways[turn % 3](chain(turn % 5));
  kept.push(new Link(turn, list));
}
let text = "";
for (const link of kept) { text += link.value; for (let at = link.next; at; at = at.next) text += "." + at.value; text += " "; }
console.log(text);
