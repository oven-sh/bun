// The object in front of a list that is being built is dropped where the function returns the list behind it. Its cell is given out again; whoever kept it keeps it, with what it held.
"use strict";
class Item { constructor(key, next) { this.key = key; this.next = next; } }
class Note { constructor(word, next) { this.word = word; this.next = next; } }
let kept = [];
function every(first, step) {
  const head = new Item(-1, null);
  let last = head, turn = 0;
  for (let at = first; at; at = at.next) if (turn++ % step === 0) { const item = new Item(at.key * 10, null); last.next = item; last = item; }
  return head.next;
}
function woven(a, b) {
  const head = new Item(0, null);
  let last = head;
  while (a && b) { if (a.key < b.key) { last.next = new Item(a.key, null); a = a.next; } else { last.next = new Item(b.key, null); b = b.next; } last = last.next; }
  return head.next;
}
function numbered(count) {
  const head = new Item(0, null);
  let last = head;
  for (let k = 0; k < count; k++) { last.next = new Item(k, null); last = last.next; }
  return head.next;
}
function noted(count, keepAt) {
  const head = new Note("head", null);
  let last = head;
  for (let k = 0; k < count; k++) { if (k === keepAt) kept.push(head); last.next = new Note("w" + k, null); last = last.next; }
  return head.next;
}
function asked(count, ask) {
  const head = new Note("asked", null);
  let last = head;
  for (let k = 0; k < count; k++) { last.next = new Note("s" + k * k, null); last = last.next; }
  if (ask) kept.push(() => head.word + words(head.next));
  return head.next;
}
function thrown(first, limit) {
  const head = new Note("thrown", null);
  let last = head;
  try { for (let at = first; at; at = at.next) { if (at.key > limit) throw head; last = last.next = new Note("t" + at.key, null); } } catch (caught) { if (caught instanceof Note) return caught; throw caught; }
  return head.next;
}
function text(list) { let out = ""; for (let at = list, n = 0; at && n < 40; at = at.next, n++) out += at.key + " "; return out; }
function words(list) { let out = ""; for (let at = list, n = 0; at && n < 40; at = at.next, n++) out += at.word + " "; return out; }
function chain(keys) { let first = null; for (let k = keys.length - 1; k >= 0; k--) first = new Item(keys[k], first); return first; }
const lines = [];
for (let round = 0; round < 40; round++) {
  const keys = Array.from({ length: round % 9 }, (_, k) => (k * 7 + round) % 13), list = chain(keys);
  const one = every(list, 1 + round % 3), two = woven(list, one), three = numbered(round % 7);
  lines.push([text(one), text(two), text(three), words(noted(round % 7, round % 5 ? -1 : 2)), words(asked(round % 6, round % 4 === 0)), words(thrown(two, round)), text(list)].join("/"));
  if (round % 10 === 9) { lines.push(kept.map(note => (typeof note === "function" ? note() : note.word + ":" + words(note.next))).join("|")); if (round % 20 === 19) kept = []; }
}
lines.push(text(every(chain([1, 2, 3, 4, 5]), 2)), text(every(null, 1)), text(woven(chain([1, 2]), null)), text(woven(null, null)), text(numbered(4)), text(numbered(0)), words(noted(3, 9)), words(asked(3, false)), words(asked(2, true)), words(thrown(chain([1, 9]), 5)), words(thrown(chain([1, 2]), 5)), kept.length);
console.log(lines.join("\n"));
