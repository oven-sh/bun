// A setter lies on Answer.prototype; `_Answer` is linked below it at run time through a parameter, so the build lists `status` as a field that an _Answer may gain; three fields of birth fill the cell.
// The setter lays an extra property under a symbol. Every turn makes a fresh object; compiled code stores, then code out of `new Function` stores into another fresh one.
const turns = Number(process.argv[2] ?? 40), hide = value => [value][JSON.parse("0")];
const kKept = Symbol("kept");
function Answer(raw) { this.raw = raw; this.code = 200; this.tag = null; }
function build(R) { function _Answer(raw) { this.raw = raw; this.code = 200; this.tag = null; } Object.setPrototypeOf(_Answer.prototype, R.prototype); Object.setPrototypeOf(_Answer, R); return _Answer; }
const Built = build(Answer);
const store = (one, value) => { one.status = value; };
const fromText = new Function("one", "value", "one.status = value");
const show = one => [one.code, one.tag, one.kept, one[kKept], Object.keys(one).join(), Object.hasOwn(one, "status"), Object.getOwnPropertyDescriptor(one, "status")?.value, Object.isFrozen(one), Object.getPrototypeOf(one) === Built.prototype];
const said = [];
Object.defineProperty(Answer.prototype, "status", { set(value) { this[kKept] = value; }, configurable: true });
for (let turn = 0; turn < turns; turn++) { for (const write of [store, fromText]) { const one = hide(new Built(turn)); try { write(one, turn); write(one, turn + 1000); } catch (error) { said.push(error.constructor.name); } said.push(show(one)); } }
console.log(JSON.stringify(said));
