// One function is the setter of two literals and stores `this` into a box that unseen code holds: so unseen code writes whichever was stored to last.
const box = { last: null };
globalThis.box = box;
function put(next) { this.raw = next; box.last = this; }
const first = { raw: 1 }, second = { raw: 2, more: 0 };
Object.defineProperty(first, "value", { set: put });
Object.defineProperty(second, "value", { set: put });
function touch(held, next) { held.value = next; }
touch(first, 5);
(0, eval)("box.last.raw = 'text'");
touch(second, 6);
console.log(typeof first.raw, typeof second.raw, first.raw, second.raw);
(0, eval)("box.last.raw = 'more'; box.last.extra = 1");
console.log(typeof first.raw, typeof second.raw, first.raw, second.raw, typeof second.extra);
