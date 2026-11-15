const most = Number(process.argv[2] ?? 6), hide = value => [value][JSON.parse("0")];
const values = JSON.parse('[1,"two",null,{"three":3},4.5,true,"seven",8,[9],false,11,"twelve"]');
function above() { function Answer(raw) { this.raw = raw; this.code = 200; } return Answer; }
function build(R) { function _Answer(raw) { this.raw = raw; this.code = 200; } Object.setPrototypeOf(_Answer.prototype, R.prototype); Object.setPrototypeOf(_Answer, R); return _Answer; }
const store = (one, value) => { one.status = value; };
const lay = (one, value) => { one.kept = value; };
const show = one => [Object.keys(one).join(), Object.hasOwn(one, "status"), Object.hasOwn(one, "kept"), JSON.stringify(one.status), JSON.stringify(one.kept)].join(" ");
const out = [];
lay(hide(new (build(above()))(0)), values[0]);
for (let last = 1; last <= most; last++) {
    const R = above(), Built = build(R);
    let calls = 0;
    Object.defineProperty(R.prototype, "status", { set(value) { lay(this, value); if (++calls === last) Object.defineProperty(R.prototype, "status", { value: 0, writable: true, enumerable: false, configurable: true }); }, configurable: true });
    for (let turn = 0; turn < 12; turn++) { const one = hide(new Built(turn)); store(one, values[turn]); out.push("SAID " + last + " " + turn + " " + show(one)); }
}
console.log(out.join("\n"));
