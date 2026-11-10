const { wantedOf, Listed } = require("./lib-reads.cjs");
const turns = Number(process.argv[2] ?? 60000), half = turns >> 1, hide = value => [value][JSON.parse("0")];
class Bare { constructor(count) { this.count = count; } }
const all = hide([]);
for (let at = 0; at < 6; at++) all.push(new Bare(at + 1));
all.push(new Listed(30));
const first = (0, eval)(`(function (all) { for (const one of all.slice(0, 6)) Object.defineProperty(one, "wanted", { get() { return this.count * 2; }, configurable: true, enumerable: true }); })`);
const change = (0, eval)(`(function (all) {
    Object.defineProperty(all[0], "wanted", { get() { return this.count * 5; }, configurable: true });
    Object.defineProperty(all[1], "wanted", { value: 1000, configurable: true, writable: true });
    delete all[2].wanted;
    Object.getPrototypeOf(all[2]).wanted = 2000;
    Object.defineProperty(all[4], "wanted", { get: undefined, set(value) {}, configurable: true });
    all[3].count = 400;
})`);
first(all);
let sum = 0, wrong = 0;
for (let turn = 0; turn < turns; turn++) {
    if (turn === half) change(all);
    const one = all[turn % all.length], wanted = wantedOf(one);
    sum += wanted === undefined ? -1 : wanted;
    if ((turn % 499 === 0 || (turn >= half && turn < half + 96)) && Reflect.get(one, "wanted") !== wanted) wrong++;
}
console.log("SAID", sum, wrong);
