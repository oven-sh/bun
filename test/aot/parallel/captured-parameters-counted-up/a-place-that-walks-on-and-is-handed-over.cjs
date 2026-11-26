// A parameter is counted up by the body, and a function that the body makes behind it holds it: the scope begins with what the caller passed, whatever that is, and the number comes later. The build once stopped here.
'use strict';
function reading(pages, page, marks) {
  let turned = 0;
  do { page += 1 + (page % 3 || 0); turned++; if (page % 2) marks.push({ at: () => page, back() { page -= 1; return page; }, by: turned }); } while (page < pages && turned < 40);
  return marks;
}
function passedOn(n, left, done) { n -= 1; const more = v => (left > 0 ? passedOn(v, left - 1, done) : done(n, v)); return n > 2 ? more(n / 2) : more(n + 3); }
function meter(from, by) { const marks = []; while (from < 9) { from += by; marks.push(() => from); } return marks.map(m => m()).join(); }
function seats(row, seat) { seat++; const next = () => { seat++; return row + seat; }; seat *= 2; return [next(), next(), seat].join(); }
function half(share, rounds) { share -= 0.5; const keep = { get: () => share, put: v => { share = v; } }; for (let i = 0; i < rounds; i++) share /= 2; keep.put(keep.get() + rounds); return [share, keep.get()].join(); }
function late(step, flag) { let peek; if (flag) peek = () => step; ++step; return peek ? peek() : step; }
function turns(step) { const all = []; do { all.push((k => () => k + ':' + step)(step)); } while (step++ < 3); return all.map(f => f()).join(); }
function* ticks(tick, end) { const now = () => tick; while (tick < end) { yield now() * 10; tick++; } return now(); }
async function waits(n, list) { const log = () => list.push(n); while (n-- > 0) { log(); await null; } log(); return list.join(); }
class Gate { constructor(opened) { opened++; this.count = () => opened; this.open = (by = 1) => (opened += by); } static of(...rest) { return rest.map(n => new Gate(n)); } }
function given(a = 2, { b = a } = {}, ...c) { a++; b += a; const see = () => [a, b, c.length].join('-'); c.push(a); return see(); }
const told = run => { try { return String(run()); } catch (error) { return error.constructor.name; } };
function marked(pages, page) { const marks = reading(pages, page, []); return marks.map(m => m.by + '@' + m.at()).join(' ') + (marks.length ? ' back ' + marks[0].back() + ' ' + marks[marks.length - 1].at() : ' none'); }
for (let k = 0; k < 50; k++) { marked(k % 9, k & 3); passedOn(k, 2, (a, b) => a + b); meter(k % 4, 2); seats(k, k); half(k, 2); late(k, k & 1); turns(k % 3); given(k); }
console.log([[12, 0], [3, 2], [0, 5], [9, 0.5], [8, '1'], [7, -4], [5, null], [6, NaN], [2 ** 32, 2147483646]].map(([a, b]) => told(() => marked(a, b))).join(' | '), told(() => marked(9, 1n)), told(() => reading(4, 0, null)));
console.log(passedOn(9, 3, (a, b) => a + '/' + b), passedOn('7', 2, (a, b) => a + '/' + b), passedOn(0.5, 4, (a, b) => a + '/' + b), told(() => passedOn(5n, 1, String)), passedOn(undefined, 1, (a, b) => a + '/' + b), told(() => passedOn(1, 0, null)));
console.log(meter(0, 2), meter(0.5, 2.25), told(() => meter('1', 1)), meter(-1, 4), told(() => meter(9n, 1n)), meter(NaN, 1) === '', meter(null, 5), meter(undefined, 1) === '');
console.log(seats('r', 1), seats(2, 3), seats('', -1), told(() => seats('q', 4n)), seats('t', '5'), seats(null, undefined), told(() => seats(1, Symbol())), seats('m', 2147483647), seats('v', { valueOf: () => 6 }));
console.log(half(8, 3), half('6', 1), half(-0.5, 0), half(undefined, 2), half(Infinity, 1), told(() => half(1n, 1)), half([4], 2));
console.log(late(1, true), late(1, false), late('1', true), late(1.5, 1), late(null, 1), told(() => late(5n, 1)), late(true, 0), turns(0), turns(2.5), turns(-2), turns('2'), turns(4));
console.log([...ticks(1, 4)].join(), [...ticks('2', 4)].join(), [...ticks(0.5, 2)].join(), JSON.stringify(ticks(7, 3).next()));
const gates = Gate.of(0, 1.5, '2', -1, null); gates.forEach(g => g.open()); gates[1].open(0.25); console.log(gates.map(g => g.count()).join(), told(() => new Gate(1n).open(1)), told(() => new Gate(3n).open(2n)), new Gate().count(), gates[2].open('x'));
console.log(given(), given(1), given(1, { b: 5 }), given(undefined, undefined, 1, 2), given('3', { b: '4' }), given(0.5, {}, 0), told(() => given(1, null)));
Promise.all([waits(3, []), waits(0, []), waits(1.5, []), waits('2', [])]).then(all => console.log(all.join(' | ')));
