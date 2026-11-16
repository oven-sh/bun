// One site reads a name that each visitor finds in the storage of another prototype. Halfway code out of a text replaces, deletes, shadows and defines; code out of a text reads beside.
const turns = Number(process.argv[2] ?? 120000), hide = value => [value][JSON.parse("0")];
function read(one) { return one.pipe; }
const looks = hide(read), said = [];
function fill(prototype, count, tag) { for (let at = 0; at < count; at++) prototype[tag + at] = at; }
function P() { this.x = 1; } function Q() { this.y = 2; } function S() { this.z = 3; } function T() { this.w = 4; }
fill(P.prototype, 12, "p"); fill(Q.prototype, 15, "q"); fill(S.prototype, 19, "s"); fill(T.prototype, 24, "t");
P.prototype.pipe = function () { return 11; }; Q.prototype.pipe = function () { return 22; }; S.prototype.pipe = function () { return 33; }; T.prototype.pipe = function () { return 44; };
const fromText = new Function("one", "return one.pipe");
const all = hide([new P, new Q, new S]);
let sum = 0;
const tell = value => typeof value === "function" ? value.call(null) : typeof value === "number" ? value : typeof value === "string" ? value.length : value === undefined ? -1 : value === true ? 5 : value === false ? 6 : -3;
for (let turn = 0; turn < turns; turn++) {
    if (turn === turns >> 1) { new Function("P", "Q", "S", "all", "Q.prototype.pipe = 21; delete S.prototype.pipe; all[0].pipe = 3; Object.defineProperty(P.prototype, 'pipe', { get() { return 1; }, configurable: true }); delete all[0].pipe;")(P, Q, S, all); }
    const one = all[turn % all.length];
    const value = looks(one); sum += tell(value);
    if (turn % 4099 === 0) said.push(turn + ":" + tell(value));
    if (turn % 3001 === 0) sum += tell(fromText(one));
}
console.log(sum, said.join(" "));
