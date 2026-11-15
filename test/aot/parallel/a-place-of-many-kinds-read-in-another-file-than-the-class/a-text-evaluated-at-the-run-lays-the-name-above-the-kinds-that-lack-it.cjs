const { Kept, Other, Sparse } = require("./lib-kinds.cjs");
const turns = Number(process.argv[2] ?? 90000), half = turns >> 1, hide = value => [value][JSON.parse("0")];
function read(one) { return one.wanted; }
const looks = hide(read), name = hide("wanted"), above = hide({ shared: 1 }), all = hide([]);
const tell = value => value === undefined ? -1 : typeof value === "number" ? value : typeof value === "string" ? value.length + 1000 : -7;
for (const key of ["a", "b", "c", "d", "e"]) { const one = Object.create(above); one[key] = 1; all.push(one); }
all.push(new Kept(21, 1), new Other(22), new Sparse(23, true), new Sparse(24, false), JSON.parse('{"wanted":25}'), JSON.parse('{"x":1,"wanted":26}'));
const change = (0, eval)(`(function (all, above) { above.wanted = 7000; })`);
let sum = 0, wrong = 0;
for (let turn = 0; turn < turns; turn++) {
    if (turn === half) change(all, above);
    const one = all[turn % all.length], value = looks(one);
    sum += tell(value);
    if ((turn % 499 === 0 || (turn >= half && turn < half + 132)) && Reflect.get(one, name) !== value) wrong++;
}
console.log("SAID", sum, wrong);
