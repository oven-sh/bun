const { Kept, Other, Third, Sparse } = require("./lib-kinds.cjs");
const turns = Number(process.argv[2] ?? 60000), half = turns >> 1, hide = value => [value][JSON.parse("0")];
function read(one) { return one.wanted; }
const looks = hide(read), name = hide("wanted"), all = hide([]);
const tell = value => value === undefined ? -1 : typeof value === "number" ? value : typeof value === "string" ? value.length + 1000 : -7;
let sum = 0, wrong = 0;
for (let at = 0; at < 8; at++) all.push(new Kept(at + 10, at));
const more = (0, eval)(`(function (all, Other, Third, Sparse) { all.push(new Other(91), JSON.parse('{"wanted":92}'), new Third(93), JSON.parse('{"x":1}'), new Sparse(94, false), Object.create({ wanted: 95 }), Object.create(null)); })`);
for (let turn = 0; turn < turns; turn++) {
    if (turn === half) { more(all, Other, Third, Sparse); }
    const one = all[turn % all.length], value = looks(one);
    sum += tell(value);
    if ((turn % 499 === 0 || (turn >= half && turn < half + 96)) && Reflect.get(one, name) !== value) wrong++;
}
console.log("SAID", sum, wrong);
