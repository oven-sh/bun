const turns = Number(process.argv[2] ?? 120000), hide = value => [value][JSON.parse("0")];
function read(one) { return one.pipe; }
const looks = hide(read), name = hide("pipe");
function fill(prototype, count, tag) { for (let at = 0; at < count; at++) prototype[tag + at] = at; }
let BaseP = function () {}, BaseQ = function () {}, BaseS = function () {};
function P() { this.x = 1; } function Q() { this.y = 2; } function S() { this.z = 3; }
Object.setPrototypeOf(P.prototype, BaseP.prototype); Object.setPrototypeOf(Q.prototype, BaseQ.prototype); Object.setPrototypeOf(S.prototype, BaseS.prototype);
fill(BaseP.prototype, 12, "p"); fill(BaseQ.prototype, 15, "q"); fill(BaseS.prototype, 19, "s");
let armed = false, more = "";
BaseP.prototype.pipe = 11; BaseQ.prototype.pipe = 22; BaseS.prototype.pipe = 33;
const all = hide([new P, new Q, new S]), half = turns >> 1;
let sum = 0, wrong = 0;
const tell = value => typeof value === "function" ? value.call(null) : typeof value === "number" ? value : typeof value === "string" ? value.length : value === undefined ? -1 : value === true ? 5 : value === false ? 6 : -3;
for (let turn = 0; turn < turns; turn++) {
    if (turn === half) { Object.defineProperty(BaseQ.prototype, "pipe", { get() { return 4040; }, configurable: true }); Object.defineProperty(BaseS.prototype, "pipe", { set(value) {}, configurable: true }); }
    const one = all[turn % all.length];
    const value = looks(one), told = tell(value); sum += told;
    if (turn % 997 === 0 || (turn >= half && turn < half + 600)) { if (tell(Reflect.get(one, name)) !== told) wrong++; }
}
console.log("SAID", sum, wrong + more);
