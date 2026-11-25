// next() of match iterators by hand: typed and untyped receivers, own next, replaced prototypes, other receivers of next, results that are kept, done iterators, subclasses with their own exec.
const word = /([a-z]+)(\d*)/g, empty = /x*/gu, texts = ["alpha1 beta22 gamma", "", "xxaxx\u{1F600}x", "a1".repeat(5)];
class Every extends RegExp { exec(s) { return calls++ % 4 === 3 ? null : super.exec(s); } }
let calls = 0;
function indexes(s, re) { const it = s.matchAll(re), out = []; let step; while (!(step = it.next()).done) out.push(step.value.index, step.value[0]); return out.join(); }
function kept(s) { const it = s.matchAll(word), steps = []; for (let k = 0; k < 5; k++) steps.push(it.next()); steps[0].extra = 1; return steps.map(step => Object.keys(step).join() + step.done + (step.value ? step.value[0] : step.value)).join(" "); }
function own(s) { const it = s.matchAll(word); let left = 2; it.next = () => ({ done: !left--, value: ["own"] }); const out = []; let step; while (!(step = it.next()).done) out.push(step.value[0]); return out.join() + Object.keys(it); }
function moved(s) { const it = s.matchAll(word); Object.setPrototypeOf(it, { next() { return { done: calls++ % 3 === 2, value: ["moved"] }; } }); const out = []; let step; while (!(step = it.next()).done) out.push(step.value[0]); return out.join(); }
function borrowed(s) { const next = "".matchAll(/a/g).next, it = s.matchAll(word); const out = []; for (let step; !(step = next.call(it)).done;) out.push(step.value[0]); for (const bad of [null, 1, {}, [], s]) { try { next.call(bad); } catch (error) { out.push(error.name); } } return out.join(); }
function first(s) { const step = s.matchAll(word).next(); return step.done ? "none" : step.value[0] + step.value.index + step.value.input.length + step.value.length; }
function self(s) { const it = s.matchAll(word); return it[Symbol.iterator]() === it && [...it].length + Object.prototype.toString.call(it) + (it instanceof Iterator) + String(Object.getPrototypeOf(it) === Object.getPrototypeOf("".matchAll(/b/g))); }
function either(s, k) { const it = k & 1 ? s.matchAll(word) : [["a"], ["b"]].values(); const out = []; for (let step; !(step = it.next()).done;) out.push(step.value[0]); return out.join(); }
for (let round = 0; round < 30; round++) for (const s of texts) { const line = [indexes(s, word), indexes(s, empty), indexes(s, new Every(word.source, "g")), kept(s), own(s), moved(s), borrowed(s), first(s), self(s), either(s, round)].join(" | "); if (round < 2 || round === 29) console.log(line); }
console.log(calls);
