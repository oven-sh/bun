const out = [];
const log = (...values) => out.push(values.map(v => (v instanceof Error ? v.name + ":" + v.message : String(v))).join(" "));
const list = JSON.parse("[3,1,4,1,5,9,2,6]"), mixed = JSON.parse('[1,"2",null,4.5,true,7]');
let open = 0, closed = 0;
class File {
  constructor(n) { this.n = n; open++; }
  read() { return this.n & 7; }
  [Symbol.dispose]() { open--; closed += this.n | 0; }
}
class Loud extends File { [Symbol.dispose]() { super[Symbol.dispose](); log("loud", this.n); } }
class Failing extends File { [Symbol.dispose]() { open--; throw new Error("dispose " + this.n); } }
function fresh(vs) { let s = 0; for (let i = 0; i < vs.length; i++) { const x = vs[i]; using f = new File(x); s = (s + f.read()) | 0; } return s; }
function two(vs) { let s = 0; for (let i = 0; i < vs.length; i++) { using f = new File(vs[i]); using g = new Loud(i); s = (s + f.read() * 2 + g.read()) | 0; if (s > 40) break; } return s; }
function some(vs) { let s = 0; for (const x of vs) { using f = x > 2 ? new File(x) : null; s += f ? f.read() : 1; if (x === 9) continue; s += 10; } return s; }
function fails(vs) { let s = 0; for (const x of vs) { try { using f = x & 1 ? new Failing(x) : new File(x); s += f.read(); if (x === 5) throw new RangeError("body"); } catch (error) { log(error, error.error ?? "", error.suppressed ?? ""); } } return s; }
function kept(vs, one) { let s = 0; for (const x of vs) { using f = one; s += x; } return s; }
function chosen(vs, first, second) { let s = 0; for (const x of vs) { const f = x > 3 ? first : second ?? first; s = (s + f(x)) | 0; } return s; }
function called(vs, holder) { let s = 0; for (const x of vs) { const f = holder.f ?? (y => y - 1); s = (s + f(x)) | 0; } return s; }
function run(what) {
  for (const vs of [list, mixed, [], list]) {
    for (const turn of [fresh, two, some, fails]) { try { log(what, turn.name, turn(vs), open, closed); } catch (error) { log(what, turn.name, error); } }
    log(chosen(vs, v => v + 1, v => v * 2), chosen(vs, v => v + 1), called(vs, { f: v => v * 3 }), called(vs, {}), called(vs, { get f() { return closed++ & 1 ? v => 7 : v => 8; } }));
  }
  log(kept(list, { [Symbol.dispose]() { closed++; } }), closed);
  try { kept(list, { [Symbol.dispose]: 5 }); } catch (error) { log(error.name); }
  try { kept(list, 5); } catch (error) { log(error.name); }
}
run("as made");
File.prototype[Symbol.dispose] = function () { open--; closed -= 1; };
run("replaced");
Object.defineProperty(Loud.prototype, Symbol.dispose, { get() { log("read"); return () => { closed += 100; }; } });
run("getter");
delete File.prototype[Symbol.dispose];
try { run("deleted"); } catch (error) { log(error.name); }
console.log(out.join("\n"));
