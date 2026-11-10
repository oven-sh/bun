// Flags: --aot-testing=CheckWalkAtRunTime
// Where a stub answers a closed read by name with "an accessor", it enters the getter itself. What the getter gives cannot be checked afterwards, so under the word that checks the walk the choice of the getter is checked before the call: the caller records receiver and name, and the stub asks whether that name still finds that getter.
// The getter above is shadowed by another on the object between, uncovered again, taken away and laid anew. Where the table of slots does not drop what depends on a chain, the second round enters the old getter in silence and the fourth dies; under the word the second round stops by name.
// The second half holds what must not ring: a getter whose first step is a call through another accessor of the same receiver, a trap of a proxy that does the same, a read that throws and is followed by such a call, getters of a class, and a native getter.
// COUNTER: AnswersAskedAgain >= 400
const unseen = (0, eval)("(x) => x");
const top = unseen({ get late() { return "top " + this.own; } });
const middle = unseen(Object.setPrototypeOf({ mid: 1 }, top));
const low = [];
for (let i = 0; i < 4; i++) low.push(unseen(Object.setPrototypeOf({ own: i }, middle)));
function read(x) { return x.late; }
function truth(x) { return x.late ? "yes" : "no"; }
const out = [];
function round() { let text = ""; for (let i = 0; i < 40; i++) text = read(low[i & 3]) + " " + truth(low[i & 3]); out.push(text); }
round();
Object.defineProperty(middle, "late", { get() { return "middle " + this.own; }, configurable: true }); round();
delete middle.late; round();
delete top.late; Object.defineProperty(middle, "late", { get() { return "again " + this.own; }, configurable: true }); round();
console.log(out.join());

class Kind {
  constructor(i) { this.own = i; }
  get helper() { return function () { return "helped " + this.own; }; }
  get first() { return this.helper(); }
  get plain() { return this.own * 2; }
  get fails() { throw new Error("no " + this.own); }
}
function first(x) { return x.first; }
function plain(x) { return x.plain; }
function fails(x) { try { return x.fails; } catch (error) { return x.helper() + " after " + error.message; } }
function size(x) { return x.size; }
const kinds = [new Kind(1), new Kind(2), unseen(new Kind(3))];
const proxy = new Proxy(new Kind(4), { get(target, key, receiver) { return key === "first" ? target.helper() + " by the trap" : Reflect.get(target, key, receiver); } });
const more = [];
for (let i = 0; i < 30; i++) {
  const x = kinds[i % 3];
  more.push(first(x), plain(x), fails(x), first(proxy), plain(proxy), size(unseen(i % 2 ? new Map([[1, 2]]) : new Set([1]))));
}
console.log(more.slice(-12).join());
