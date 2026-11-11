const { Sparse } = require("./lib-kinds.cjs");
const turns = Number(process.argv[2] ?? 60000), half = turns >> 1, hide = value => [value][JSON.parse("0")];
function asks(one) { return "wanted" in one; }
const looks = hide(asks), name = hide("wanted"), all = hide([]);
let sum = 0, wrong = 0;
for (let at = 0; at < 8; at++) all.push(new Sparse(at + 10, at % 3 !== 1));
const change = (0, eval)("(function (one, other) { Object.getPrototypeOf(one).wanted = 1; other.wanted = 2; })");
for (let turn = 0; turn < turns; turn++) {
    if (turn === half) { change(all[0], all[4]); }
    const one = all[turn % all.length], value = looks(one);
    sum += value ? 3 : 5;
    if ((turn % 499 === 0 || (turn >= half && turn < half + 96)) && (name in one) !== value) wrong++;
}
console.log("SAID", sum, wrong);
