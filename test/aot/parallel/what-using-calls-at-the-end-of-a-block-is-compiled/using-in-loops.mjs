// Resources in loops over numbers: fresh, shared, none, two, conditional; throws in the block, in the disposal, in both; values that are read after it.
let open = 0;
const lines = [];
const say = (...words) => lines.length < 3000 && lines.push(words.map(v => (v instanceof Error ? `${v.name}:${v.message}` : String(v))).join(" "));
const numbers = JSON.parse("[3,1,4,1,5,9,2,6]"), mixed = JSON.parse('[1,"2",4.5,null,7]');
class File {
  constructor(n) { this.n = n; open++; }
  read() { if (this.n === 9) throw new RangeError("nine"); return this.n & 7; }
  [Symbol.dispose]() { open--; if (this.n === 4) throw new TypeError("disposal of four"); }
}
const shared = { [Symbol.dispose]() { open += 10; } };
const none = null;
const lock = () => ({ [Symbol.dispose]() { open += 100; } });
function fresh(list) { let s = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; using f = new File(x); s = s + f.read(); say(s, open); } return s; }
function ofNone(list) { let s = 0; for (const x of list) { using f = none; s += x; } return s; }
function kept(list) { let s = 0; for (const x of list) { using f = shared; if (x === 2) continue; s += x; if (x === 6) break; } return s; }
function two(list) { let s = 0, last = null; for (let i = 0; i < list.length; i++) { using f = new File(list[i]); using g = new File(i); last = f; s = (s + f.read() * 2 + g.n) | 0; } return [s, last.n].join(); }
function maybe(list) { let s = 0; for (const x of list) { using f = x & 1 ? new File(x) : null; s += f ? f.n : 1; } return s; }
function returned(list) { for (const x of list) { using f = new File(x); if (x === 5) return f.n + open; } return -1; }
function literal(list) { let s = 0; for (const x of list) { using f = lock(); s += x; } return s; }
function caught(list) { let s = 0; for (let i = 0; i < list.length; i++) { try { using f = new File(list[i]); s += f.read(); } catch (error) { say(error, s, open); s -= 1; } finally { s += 100; } } return s; }
function nested(list) { let s = 0; for (const x of list) { using f = new File(x === 4 ? 3 : x === 9 ? 8 : x); for (let k = 0; k < 2; k++) { using g = new File(k); s += f.read() + g.read(); } } return s; }
function both(list) { let s = 0; for (const x of list) { using f = new File(4); if (x === 5) throw new Error("body"); s += x; } return s; }
function* yields(list) { let s = 0; for (const x of list) { using f = new File(x === 4 ? 2 : x); s += f.n; yield s; } return open; }
for (let turn = 0; turn < 3; turn++) {
  for (const f of [fresh, ofNone, kept, two, maybe, returned, literal, caught, nested, both]) {
    for (const list of [numbers, mixed, numbers.slice(0, 2), []]) {
      try { say(f.name, f(list), open); } catch (error) { say(f.name, error, error.error ?? "", error.suppressed ?? "", open); }
    }
  }
  for (const v of yields(numbers)) { if (v > 20) break; say(v, open); }
}
for (const line of lines) console.log(line);
console.log(lines.length, open);
