// Loops that step a generator by hand, every turn once: what is sent, returned, thrown, left early and read behind the loop.
let state = 0;
const kept = [];
const lines = [];
const say = (...words) => lines.length < 2000 && lines.push(words.map(v => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v))).join(" "));
const list = JSON.parse("[3,1,4,1,5,9,2,6]");

function* range(a, b) { for (let k = a; k < b; k++) yield k; return "end"; }
function* sums(v) { let t = v; for (let k = 0; k < 5; k++) { const got = yield t; t += got === undefined ? 1 : got; } return t; }
function* guarded(v) { try { yield v; yield v + 1; if (v === 2) throw new Error("two"); yield v + 2; } catch (error) { yield error.message; } finally { state += 10; say("finally", v); } }
function* pairs(values) { for (const v of values) { yield [v, v * 2]; if (v === 9) return { at: v }; } }
function* outer(v) { const got = yield* range(v, v + 2); yield got; }
class Tree {
  constructor(depth) { this.value = depth; this.left = depth > 0 ? new Tree(depth - 1) : null; }
  *values() { if (this.left) yield* this.left.values(); yield this.value; }
  *twice(n) { for (let k = 0; k < n; k++) yield this.value * k; }
}

function byFor(a, b) { let s = 0; const it = range(a, b); for (let r = it.next(); !r.done; r = it.next()) s += r.value; return s; }
function byWhile(a, b) { const it = range(a, b); let r = it.next(); while (!r.done) { if (r.value === 5) break; r = it.next(); } return r.value + ":" + r.done; }
function inCondition(v) { const it = outer(v); let r; let text = ""; while (!(r = it.next()).done) text += r.value + ","; return text + r.value; }
function inBody(v) { const it = sums(v); const all = []; for (;;) { const r = it.next(); if (r.done) { all.push("last", r.value); break; } if (r.value > 12) continue; all.push(r.value); } return all.join(); }
function sending(v) { const it = sums(v); let s = 0; for (let r = it.next(); !r.done; r = it.next(r.value * 2)) s += r.value; return s; }
function sendingKinds(v) { const it = sums(v); let text = ""; let k = 0; for (let r = it.next(); !r.done; r = it.next(k & 1 ? "x" : k)) { text += r.value + ";"; k++; } return text; }
function throwing(v) { const it = guarded(v); const all = []; for (let r = it.next(); !r.done; r = it.next()) { all.push(r.value); if (all.length === 2 && v === 5) throw new TypeError("out"); if (v === 6) return "left " + all; } return all.join(); }
function keeping() { const it = pairs(list); for (let r = it.next(); !r.done; r = it.next()) { kept.push(r); if (kept.length > 3) kept.shift(); r.value[0]++; } return kept.map(r => r.done + "/" + r.value).join(" "); }
function writing() { const it = range(0, 5); let s = 0; for (let r = it.next(); !r.done; r = it.next()) { r.value = r.value * 10; r.more = 1; s += r.value + Object.keys(r).length; } return s; }
function nested(n) { let s = 0; const it = range(0, n); for (let r = it.next(); !r.done; r = it.next()) { const inner = range(r.value, n); let q; while (!(q = inner.next()).done) { if (q.value === 3) continue; s += q.value * r.value; } } return s; }
function closures() { const it = range(0, 4); const all = []; for (let r = it.next(); !r.done; r = it.next()) all.push(() => r.value + ":" + r.done); return all.map(f => f()).join(); }
function methods(tree, n) { let s = 0; const it = tree.twice(n); for (let r = it.next(); !r.done; r = it.next()) s += r.value; return s; }
function walk(tree) { let text = ""; const it = tree.values(); for (let r = it.next(); !r.done; r = it.next()) text += r.value; return text; }
function behind(v) { const it = range(v, v + 3); let r; for (r = it.next(); !r.done; r = it.next()) { if (r.value === 4) break; } return [r.done, r.value, it.next().value].join(); }

const tree = new Tree(3);
const attempt = f => { try { return f(); } catch (error) { return error.name + " " + error.message; } };
for (let turn = 0; turn < 40; turn++) {
  for (const v of list) {
    const answers = [byFor(0, v), byWhile(v, 8), inCondition(v), inBody(v), sending(v), sendingKinds(v), attempt(() => throwing(v)), keeping(), writing(), nested(v), closures(), methods(tree, v), walk(tree), behind(v)];
    if (turn % 39 === 0) say(...answers, state, kept.length);
  }
}
for (const line of lines.slice(0, 40).concat(lines.slice(-12))) console.log(line);
console.log(lines.length, state);
