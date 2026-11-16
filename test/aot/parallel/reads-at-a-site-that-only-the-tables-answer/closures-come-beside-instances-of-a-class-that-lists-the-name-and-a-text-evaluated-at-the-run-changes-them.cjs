const { nameOf, lengthOf, hasName, Listed } = require("./lib-reads.cjs");
const turns = Number(process.argv[2] ?? 60000), half = turns >> 1, hide = value => [value][JSON.parse("0")];
const all = hide([function first(a) { return a; }, function second(a, b) { return b; }, function third(a, b, c) { return c; }, function () {}, function fifth() {}, new Listed(4), new Listed(5)]);
const change = (0, eval)(`(function (all) {
    Object.defineProperty(all[0], "name", { value: "renamed" });
    delete all[1].name;
    Object.defineProperty(all[2], "name", { get() { return "got"; }, configurable: true });
    Object.defineProperty(all[3], "length", { value: 77 });
    delete all[0].length;
    delete all[5].name;
})`);
const weigh = value => typeof value === "string" ? value.length * 7 + (value.charCodeAt(0) || 0) : typeof value === "number" ? value : -3;
let sum = 0, wrong = 0;
for (let turn = 0; turn < turns; turn++) {
    if (turn === half) change(all);
    const one = all[turn % all.length], name = nameOf(one), length = lengthOf(one);
    sum += weigh(name) + 3 * weigh(length) + hasName(one);
    if ((turn % 499 === 0 || (turn >= half && turn < half + 96)) && (Reflect.get(one, "name") !== name || Reflect.get(one, "length") !== length)) wrong++;
}
console.log("SAID", sum, wrong);
