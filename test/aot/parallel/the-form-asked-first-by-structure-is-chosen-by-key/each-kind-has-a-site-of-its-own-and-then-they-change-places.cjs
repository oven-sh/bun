const kinds = require("./lib-kinds-of-holders.cjs")(41);
const turns = Number(process.argv[2] ?? 60000), half = turns >> 1, hide = value => [value][JSON.parse("0")];
const readers = hide([
    one => one.wanted, one => one.wanted, one => one.wanted, one => one.wanted, one => one.wanted, one => one.wanted,
    one => one.wanted, one => one.wanted, one => one.wanted, one => one.wanted, one => one.wanted, one => one.wanted,
]);
const name = hide("wanted"), all = hide(kinds);
const tell = value => value === undefined ? -1 : typeof value === "number" ? value : -7;
let sum = 0, wrong = 0;
for (let turn = 0; turn < turns; turn++) {
    for (let at = 0; at < readers.length; at++) {
        const kind = all[turn < half ? at : (at + (turn >> 6)) % all.length], one = kind[turn % kind.length], value = readers[at](one);
        sum += tell(value) * (at + 1);
        if ((turn % 499 === 0 || (turn >= half && turn < half + 96)) && Reflect.get(one, name) !== value) wrong++;
    }
}
console.log("SAID", sum, wrong);
