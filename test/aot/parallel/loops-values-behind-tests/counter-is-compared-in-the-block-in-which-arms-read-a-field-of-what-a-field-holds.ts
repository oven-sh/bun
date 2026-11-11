// the test of a loop reads a field off what another field holds and then compares the counter with an int32, and the turn counts on from what the comparison leaves of the counter
class Inner { tick = 1; }
class Outer { inner: Inner = new Inner(); }
function subject(o: Outer, n: number) { const m = n | 0; let sum = 0; for (let i = 0; (sum += o.inner.tick, i < m); i++) sum += i; return sum; }
function deed(n: number) { return subject(new Outer(), n); }
console.log(String(deed(0)), String(deed(1)), String(deed(10)));
let total = 0;
for (let turn = 0; turn < 300; turn++) total += deed(turn % 7);
console.log(String(total));
const other = new Outer();
(other as any).inner = { tick: 0.5 };
console.log(String(subject(other, 4)), String(subject(other, JSON.parse("2.9"))));
