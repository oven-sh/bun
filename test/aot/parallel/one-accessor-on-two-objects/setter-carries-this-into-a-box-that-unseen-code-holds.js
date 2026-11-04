// The setter stores `this` into a box that unseen code holds, so unseen code writes whichever object was stored to last.
const box = { last: null };
globalThis.box = box;
function make(raw) { return { raw, set value(next) { this.raw = next; box.last = this; } }; }
function put(held, next) { held.value = next; }
const first = make(1), second = make(2);
put(first, 5);
(0, eval)("box.last.raw = 'text'");
put(second, 6);
console.log(typeof first.raw, typeof second.raw, first.raw, second.raw);
(0, eval)("box.last.raw = 'more'");
console.log(typeof first.raw, typeof second.raw, first.raw, second.raw);
