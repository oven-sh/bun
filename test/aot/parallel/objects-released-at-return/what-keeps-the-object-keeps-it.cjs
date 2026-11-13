// The object at the head of a list that is being built is kept by a variable, a list, a closure or a node in some iteration: its cell is not given out again.
"use strict";
class Link { constructor(value, next) { this.value = value; this.next = next; } }
function chain(n) { let head = null; for (let i = n; i > 0; i--) head = new Link(i, head); return head; }
let kept = null; const list = []; const owner = { link: null };
function byVariable(a, when) {
  let head = new Link("variable " + when, null), tail = head;
  for (let i = 0; a; a = a.next, i++) { const link = a; if (i === when) kept = tail; tail.next = link; tail = link; }
  return head.next;
}
function byList(a, when) {
  let head = new Link("list " + when, null), tail = head;
  for (let i = 0; a; a = a.next, i++) { const link = a; if (i === when) list.push(tail); tail.next = link; tail = link; }
  return head.next;
}
function byNode(a, when) {
  let head = new Link("node " + when, null), tail = head;
  for (let i = 0; a; a = a.next, i++) { const link = a; if (i === when) owner.link = tail; tail.next = link; tail = link; }
  return head.next;
}
function byField(a, when) {
  let head = new Link("field " + when, null), tail = head;
  for (let i = 0; a; a = a.next, i++) { const link = a; if (i === when) link.value = tail; tail.next = link; tail = link; }
  return head.next;
}
function byThrow(a, when) {
  let head = new Link("throw " + when, null), tail = head;
  try { for (let i = 0; a; a = a.next, i++) { const link = a; if (i === when) throw tail; tail.next = link; tail = link; } } catch (thrown) { return thrown; }
  return head.next;
}
for (let turn = 0; turn < 24; turn++) {
  const when = turn % 3;
  byVariable(chain(4), when); const first = new Link("birth 1", null);
  byList(chain(4), when); const second = new Link("birth 2", null);
  byNode(chain(4), when); const third = new Link("birth 3", null);
  const built = byField(chain(4), when); const fourth = new Link("birth 4", null);
  const thrown = byThrow(chain(4), when); const fifth = new Link("birth 5", null);
  let at = built; for (let i = 0; i < when; i++) at = at.next;
  if (turn % 10 === 9) Bun.gc(true);
  console.log(kept.value, list.at(-1).value, owner.link.value, at.value.value, thrown.value, first.value, second.value, third.value, fourth.value, fifth.value);
}
