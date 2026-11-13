// STATISTIC: SteppedCalleesExpected >= 1
// for (const f of list) f(x): a loop tells the list's few closures apart.
let total = 0, count = 0;
const list = [x => x + 1, x => x ^ 5, x => (x * 3) & 65535];
const numbers = JSON.parse('[3, 1, 0.5, -2, "7", 100]');
function run(turns) {
  let s = 0;
  for (let i = 0; i < turns; i++) for (const f of list) s = f(s) | 0;
  return s;
}
console.log(run(0), run(1), run(1000), total);
function each(value) { let s = ""; for (const f of list) s += f(value) + ","; return s; }
for (const value of [...numbers, undefined, null, { valueOf() { return ++count; } }]) console.log(each(value), total, count);
try { console.log(each(2n)); } catch (error) { console.log(error.name); }
const changed = [x => x + 2, x => { total += x; return x; }];
function runChanged(turns) {
  let s = 0;
  for (let i = 0; i < turns; i++) for (const f of changed) s = f(s) | 0;
  return s;
}
console.log(runChanged(9), total);
const given = new Map([["a", changed], ["b", [x => x - 1]]]);
function emit(name, value) { let s = 0; for (const f of given.get(name) ?? []) s += f(value); return s; }
for (let i = 0; i < 9; i++) console.log(emit(i % 3 === 0 ? "a" : i % 3 === 1 ? "b" : "c", i), total);
class Emitter {
  constructor() { this.on = []; }
  add(f) { this.on.push(f); return this; }
  emit(value) { for (const f of this.on) f.call(this, value); }
}
const emitter = new Emitter().add(x => { total = x; }).add(function (x) { count += this.on.length + x; });
for (let i = 0; i < 50; i++) emitter.emit(i);
console.log(total, count);
emitter.add(Math.abs).add(class { static x = 1; });
try { emitter.emit(1); } catch (error) { console.log(error.name, total, count); }
changed[1] = value => { if (changed.length < 9) changed.push(x => 1000 + x); return value; };
console.log(runChanged(2), changed.length);
changed[0] = undefined;
try { runChanged(1); } catch (error) { console.log(error.name); }
changed.length = 1;
changed[0] = Math.max;
console.log(runChanged(5), each(4));
