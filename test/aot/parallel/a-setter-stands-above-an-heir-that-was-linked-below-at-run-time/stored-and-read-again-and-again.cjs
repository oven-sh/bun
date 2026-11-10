// An accessor lies on Answer.prototype. `_Answer` is made in build(R); its prototype object is linked below R.prototype by a statement, R being a parameter: the build does not know that an accessor stands above an _Answer,
// and lists `status` as a field that an _Answer may gain. Three fields of birth fill the cell, so that field lies in the extension and may exist, as undefined, without storage.
const turns = Number(process.argv[2] ?? 40), hide = value => [value][JSON.parse("0")];
let heard = [];
function Answer(raw) { this.raw = raw; this.code = 200; this.tag = null; }
Object.defineProperties(Answer.prototype, { status: { get() { return this.code; }, set(value) { heard.push(value); this.code = value; }, configurable: true } });
function build(R) { function _Answer(raw) { this.raw = raw; this.code = 200; this.tag = null; } Object.setPrototypeOf(_Answer.prototype, R.prototype); Object.setPrototypeOf(_Answer, R); return _Answer; }
const Built = build(Answer);
const store = (one, value) => { one.status = value; };
const read = one => one.status;
const show = one => [read(one), one.code, Object.keys(one).join(), Object.hasOwn(one, "status"), "status" in one];
const said = [];
for (let turn = 0; turn < turns; turn++) { const one = hide(new Built(turn)); store(one, turn); said.push(read(one)); }
said.push(show(new Built(0)));
console.log(JSON.stringify(said)); console.log(heard.length, heard.slice(-3).join());
