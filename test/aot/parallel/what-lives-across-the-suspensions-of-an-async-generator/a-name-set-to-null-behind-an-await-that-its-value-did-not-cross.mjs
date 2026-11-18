// A value lives across a yield, is read for the last time, an await follows, and only then the name is set to null: the hint behind the await names what is already dead.
// Under: --aot-check=Validate: behind each suspension the body names anew what it reads out of its frame in the heap; a compiler that checks itself looks at every such name
const out = [];
const make = (label, n) => ({ label, n, fill: new Array(8).fill(n) });
const use = (held, more) => out.push(held.label + held.n + more);
async function* one(wait) { let held = make("a", 1); yield 1; use(held, "x"); await wait; held = null; yield 2; out.push(String(held)); }
async function* inArms(flag, wait) { let held = make("b", 2), other = make("c", 3); yield 1; if (flag) { use(held, "t"); await wait; held = null; } else { use(other, "f"); await wait; other = null; } yield 2; out.push(String(held && held.label), String(other && other.label)); }
async function* inTurns(wait, turns) { for (let turn = 0; turn < turns; turn++) { let held = make("d", turn); yield turn; use(held, "r"); await wait; held = null; yield -turn; } }
function* plain(turns) { for (let turn = 0; turn < turns; turn++) { let held = make("e", turn); yield turn; use(held, "p"); yield -turn; held = null; yield 0; } }
for (const it of [one(Promise.resolve(0)), one(0), inArms(true, Promise.resolve(0)), inArms(false, 0), inTurns(Promise.resolve(0), 3)]) for await (const step of it) out.push(step);
for (const step of plain(2)) out.push(step);
console.log(out.join("|"));
