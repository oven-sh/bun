// One site reads a name that each visitor finds in the storage of another prototype. An ordinary object holds the name itself and comes first; two chain visitors follow; then one of them alone; then all: the own value is read where it went.
const turns = Number(process.argv[2] ?? 900000), hide = value => [value][JSON.parse("0")];
function read(one) { return one.pipe; }
const looks = hide(read), said = [];
function fill(prototype, count, tag) { for (let at = 0; at < count; at++) prototype[tag + at] = at; }
function P() { this.x = 1; } function Q() { this.y = 2; } function S() { this.z = 3; } function T() { this.w = 4; }
fill(P.prototype, 12, "p"); fill(Q.prototype, 15, "q"); fill(S.prototype, 19, "s"); fill(T.prototype, 24, "t");
P.prototype.pipe = function () { return 11; }; Q.prototype.pipe = function () { return 22; }; S.prototype.pipe = function () { return 33; }; T.prototype.pipe = function () { return 44; };
const all = hide([JSON.parse('{"a":1,"pipe":5}'), new P, new Q]);
let sum = 0;
const tell = value => typeof value === "function" ? value.call(null) : typeof value === "number" ? value : typeof value === "string" ? value.length : value === undefined ? -1 : value === true ? 5 : value === false ? 6 : -3;
for (let turn = 0; turn < turns; turn++) {
    if (turn === turns >> 1) { all[0].pipe = 50; new Function("P", "delete P.prototype.pipe;")(P); }
    const one = turn < turns / 6 ? all[turn % 3] : turn < turns / 2 ? all[2] : all[turn % 3];
    const value = looks(one); sum += tell(value);
    if (turn % 4099 === 0) said.push(turn + ":" + tell(value));
    if (turn % 40009 === 0) all[0].pipe++;
}
console.log(sum, said.join(" "));
