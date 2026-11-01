// A callback that is lent makes a callback of its own and lends it, a thousand deep, with collections on the way; some level keeps what it got.
const pick = new Function("list", "i", process.argv.length < 99 ? "return list[i]" : "");
const kept = [];
const callees = [f => f(), f => f() + 1, f => { kept.push(f); return f(); }];
function down(n, text) {
  if (!n) return text.length;
  if (n % 97 === 0 && typeof Bun !== "undefined") Bun.gc(true);
  return pick(callees, n % 3)(() => down(n - 1, text + (n & 1 ? "a" : "b")));
}
console.log(down(1000, ""));
console.log(kept.length);
let sum = 0; for (let i = 0; i < kept.length; i += 50) sum += kept[i]();
console.log(sum, kept.length);
// An exception goes up through lent callbacks.
function thrower(n) { if (!n) throw new Error("bottom"); try { return pick(callees, n % 3)(() => thrower(n - 1)); } finally { sum++; } }
try { thrower(300); } catch (e) { console.log(e.message, sum); }
// Tail calls that take a callback and go round a million times leave no frame behind, whoever is called.
let turns = 0;
function roundA(n, f) { turns += f(); return n ? pick(rounds, n & 1)(n - 1, () => n & 3) : turns; }
function roundB(n, f) { turns += f(); return n ? pick(rounds, n % 3 ? 0 : 1)(n - 1, () => 1) : turns; }
const rounds = [roundA, roundB];
console.log(roundA(1000000, () => 0));
// In tail position: a callee that returns to its caller, one that keeps the callback, one that returns it.
function tail(i, k) { return pick(callees, i)(() => k); }
function tailReturned(k) { return pick([f => f], 0)(() => k); }
let tails = 0; for (let i = 0; i < 3000; i++) tails += tail(i % 3, i) + tailReturned(i)();
console.log(tails, kept.length, kept[kept.length - 1]());
