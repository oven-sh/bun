// Flags: --aot-testing=CheckWalkAtRunTime
// What a class, a function and their prototype objects hold is made late: at the first look. Under the word that checks the walk the asking goes through lazy prototypes as the run time's own filing does, and passes a slim closure by: it makes nothing that the program has not made. Six rounds of sixteen readers over five subjects answer alike.
// COUNTER: AnswersAskedAgain >= 100
const unseen = (x) => [x][JSON.parse("0")];
class Base { constructor(i) { this.own = i; } method() { return this.own; } get seen() { return this.own + 1; } static make(i) { return new this(i); } static kept = 5; }
class Heir extends Base { other() { return 2; } }
function plain(a, b) { return a + b; }
const subjects = [() => new Base(1), () => new Heir(2), () => Base, () => Heir, () => plain];
const readers = [x => x.method, x => x.other, x => x.seen, x => x.constructor, x => x.make, x => x.kept, x => x.prototype,
  x => (x.method ? 1 : 0), x => (x.prototype ? 1 : 0), x => "method" in x, x => "prototype" in x, x => "make" in x,
  x => Object.hasOwn(x, "method"), x => Object.hasOwn(x, "prototype"), x => Object.hasOwn(x, "make"), x => Object.hasOwn(x, "kept")];
const first = [], rounds = [];
for (let round = 0; round < 6; round++) { const out = [];
  for (let s = 0; s < subjects.length; s++) for (let r = 0; r < readers.length; r++) {
    const v = readers[r](unseen(subjects[s]())), at = s * readers.length + r;
    if (!round) first[at] = v;
    out.push(typeof v === "function" || typeof v === "object" ? (v === first[at] ? "same" : "other") : String(v)); }
  rounds.push(out); }
for (let s = 0; s < subjects.length; s++) console.log(rounds[0].slice(s * 16, s * 16 + 16).join(" "));
console.log(rounds.every(out => out.join() === rounds[0].join()));
