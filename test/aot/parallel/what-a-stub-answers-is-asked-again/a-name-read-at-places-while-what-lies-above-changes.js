// Flags: --aot-testing=CheckWalkAtRunTime
// A closed read by name is answered by a stub: out of the place of the read, a site, or the table of slots. Under the word that checks the walk the caller asks receiver and name again behind every such read, behind `in`, behind hasOwn and behind a read that only gives its truth, unless a getter or the run time stood behind the answer.
// What lies above the receivers changes between the rounds: a value is laid, becomes an accessor, is taken away; another object is laid between. Where the table does not drop what hangs on a chain every round but the first stops by name.
// COUNTER: FastPathResultsVerified >= 3000
const unseen = (0, eval)("(x) => x");
class Kind { constructor(i) { this.own = i; if (i % 2) this.sometimes = i; } get seen() { return this.own + 1; } }
const above = unseen({ high: 1 }), middle = unseen(Object.setPrototypeOf({ mid: 2 }, above)), low = [];
for (let i = 0; i < 4; i++) low.push(unseen(Object.setPrototypeOf(i < 2 ? new Kind(i) : JSON.parse('{"own":' + i + '}'), middle)));
let sum = 0;
function note(v) { const text = String(v); for (let k = 0; k < text.length; k++) sum = (sum * 31 + text.charCodeAt(k)) | 0; }
function read(x) { return x.late; }
function readAgain(x) { return x.late; }
function truth(x) { return x.late ? 1 : 0; }
function isThere(x) { return "late" in x; }
function hasOwn(x) { return Object.hasOwn(x, "late"); }
function own(x) { return x.own + " " + x.sometimes + " " + x.mid + " " + x.high; }
function round() { for (let i = 0; i < 80; i++) { const x = low[i & 3]; note(read(x)); note(readAgain(x)); note(truth(x)); note(isThere(x)); note(hasOwn(x)); note(own(x)); } }
round();
above.late = 7; round();
Object.defineProperty(above, "late", { get() { return "got " + this.own; }, configurable: true }); round();
try { middle.late = 0; } catch (error) { note(error.name); } round();
Object.defineProperty(middle, "late", { value: 0, writable: true, configurable: true }); round();
low[1].late = "own"; round();
delete middle.late; round();
delete above.late; round();
Object.setPrototypeOf(middle, { late: "another above", high: 9 }); round();
Object.setPrototypeOf(low[2], null); round();
delete low[1].late; delete low[0].own; round();
console.log(sum);
