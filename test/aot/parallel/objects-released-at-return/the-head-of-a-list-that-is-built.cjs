"use strict";
class Link { constructor(value, next) { this.value = value; this.next = next; } }
function chain(n, step) { let head = null; for (let i = n; i > 0; i--) head = new Link(i * step, head); return head; }
function text(list) { let s = ""; for (let at = list, n = 0; at && n < 30; at = at.next, n++) s += at.value + " "; return s; }
function merge(a, b) {
  const dummy = new Link(0, null);
  let tail = dummy;
  while (a && b) {
    if (a.value <= b.value) { tail.next = a; a = a.next; } else { tail.next = b; b = b.next; }
    tail = tail.next;
  }
  tail.next = a ?? b;
  return dummy.next;
}
function copy(a) {
  let head = new Link("head", null), tail = head;
  for (; a; a = a.next) { const link = new Link(a.value, null); tail.next = link; tail = link; }
  return head.next;
}
let keep = null;
function kept(a, when) {
  let head = new Link("kept " + when, null), tail = head;
  for (let i = 0; a; a = a.next, i++) { if (i === when) keep = tail; tail.next = new Link(a.value, null); tail = tail.next; }
  return head.next;
}
function Tree() { this.root = null; }
function Node(key) { this.key = key; }
Node.prototype.left = null; Node.prototype.right = null;
Tree.prototype.splay = function (key) {
  let left, right, current = this.root;
  const dummy = left = right = new Node(null);
  while (true) {
    if (key < current.key) {
      if (!current.left) break;
      if (key < current.left.key) { const t = current.left; current.left = t.right; t.right = current; current = t; if (!current.left) break; }
      right.left = current; right = current; current = current.left;
    } else if (key > current.key) {
      if (!current.right) break;
      if (key > current.right.key) { const t = current.right; current.right = t.left; t.left = current; current = t; if (!current.right) break; }
      left.right = current; left = current; current = current.right;
    } else break;
  }
  left.right = current.left; right.left = current.right; current.left = dummy.right; current.right = dummy.left; this.root = current;
};
Tree.prototype.add = function (key) {
  const node = new Node(key);
  if (!this.root) { this.root = node; return; }
  this.splay(key);
  if (key === this.root.key) return;
  if (key > this.root.key) { node.left = this.root; node.right = this.root.right; this.root.right = null; } else { node.right = this.root; node.left = this.root.left; this.root.left = null; }
  this.root = node;
};
function keys(node, out) { if (!node) return out; keys(node.left, out); out.push(node.key); return keys(node.right, out); }
for (let turn = 0; turn < 40; turn++) {
  const births = [];
  const merged = merge(chain(turn % 7, 2), chain(turn % 5, 3)); births.push(new Link(-1, merged));
  const copied = copy(merged); births.push(new Link(-2, copied));
  const third = kept(copied, turn % 4); births.push(new Link(-3, third), new Link(-4, null));
  const tree = new Tree();
  for (let i = 0; i < 12; i++) { tree.add((i * 7 + turn) % 13); births.push(new Node(i)); }
  if (turn % 13 === 12) Bun.gc(true);
  if (turn % 4 === 3) console.log(text(merged) + "|" + text(copied) + "|" + text(third) + "|" + text(keep) + "|" + keys(tree.root, []).join() + "|" + births.slice(0, 4).map(text).join("/") + births.slice(4).map(n => n.key).join());
}
