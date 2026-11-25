// A module variable that is stored again before anybody can read it is stored once. Reads, calls, throws and other variables between the stores see the first.
let seed = 1, other = 0;
function next() { seed = (seed * 5 + 3) | 0; seed = seed ^ (seed >>> 7); seed = (seed + 0x7ed55d16) | 0; return seed & 255; }
function draw(count) { let s = 0; for (let i = 0; i < count; i++) s = (s * 31 + next()) | 0; return s; }
function between(x) { seed = x; const before = seed; seed = x + 1; return before; }
function called(x) { seed = x; look(); seed = x + 1; }
const seen = [];
function look() { seen.push(seed); }
function thrown(x) { seed = 'first'; const n = x.n; seed = 'second'; return n; }
function swapped() { seed = 1; other = seed + 1; seed = 2; other = other * 10 + seed; }
function converted(x) { seed = 'before'; const n = +x; seed = n; }
let list = [1, 2, 3], text = '';
function replaced() { list = null; list = [4]; list = 5; text = 'a'; text = text + 'b'; text += list; return list + text; }
function inFinally(x) { try { seed = 10; if (x) throw new Error('left'); seed = 20; } catch { seen.push(seed); } finally { seed = seed + 1; seed = seed * 2; } return seed; }
export { seed, other };
console.log(draw(0), draw(1), draw(1000), seed);
console.log(between(7), seed);
called(3); called(9); console.log(seen.join(), seed);
try { thrown(null); } catch (e) { console.log(e.name, seed); }
console.log(thrown({ n: 1 }), seed, thrown({ get n() { return seed; } }), seed);
swapped(); console.log(seed, other);
converted({ valueOf() { look(); return 6; } }); console.log(seen.at(-1), seed);
try { converted(Symbol()); } catch (e) { console.log(e.name, seed); }
console.log(replaced(), list, text, inFinally(false), inFinally(true), seen.join());
import(import.meta.url).then(self => { console.log(self.seed, self.other); called(1); console.log(self.seed); });
