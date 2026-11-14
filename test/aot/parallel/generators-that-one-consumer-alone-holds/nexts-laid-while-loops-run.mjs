// A next or a throw that is laid on what generators inherit while a loop over one runs: the loop has read next before.
const notes = [];
function* steps(limit) { for (let i = 0; i < limit; i++) yield i; }
const kept = steps(2), above = Object.getPrototypeOf(kept);
function next() { let n = 0; for (const v of steps(3)) { steps.prototype.next = function () { notes.push("next"); return { done: true }; }; if (++n === 2) break; } delete steps.prototype.next; return n; }
function throwing() { let n = 0; for (const v of steps(3)) { above.throw = function () { notes.push("throw"); }; if (++n === 2) break; } delete above.throw; return n; }
for (let call = 0; call < 3; call++) { notes.length = 0; console.log(next(), throwing(), notes.join()); }
console.log([...kept].join());
