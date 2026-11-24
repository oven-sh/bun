const holders = require("./lib-kinds-of-holders.cjs");
const turns = Number(process.argv[2] ?? 60000), half = turns >> 1, hide = value => [value][JSON.parse("0")];
const askers = hide([
    one => one.wanted ? 1 : 0, one => one.wanted ? 1 : 0, one => one.wanted ? 1 : 0, one => one.wanted ? 1 : 0, one => one.wanted ? 1 : 0, one => one.wanted ? 1 : 0,
    one => one.wanted ? 1 : 0, one => one.wanted ? 1 : 0, one => one.wanted ? 1 : 0, one => one.wanted ? 1 : 0, one => one.wanted ? 1 : 0, one => one.wanted ? 1 : 0,
]);
const name = hide("wanted"), truthy = holders("yes"), falsy = holders(0), all = hide(truthy.map((kind, at) => kind.concat(falsy[at])));
let sum = 0, wrong = 0;
for (let turn = 0; turn < turns; turn++) {
    for (let at = 0; at < askers.length; at++) {
        const kind = all[turn < half ? at : (at + (turn >> 6)) % all.length], one = kind[turn % kind.length], said = askers[at](one);
        sum += said * (at + 1);
        if ((turn % 499 === 0 || (turn >= half && turn < half + 96)) && (Reflect.get(one, name) ? 1 : 0) !== said) wrong++;
    }
}
console.log("SAID", sum, wrong);
