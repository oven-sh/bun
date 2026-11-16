const { nameOf, lengthOf, hasName, Listed } = require("./lib-reads.cjs");
const turns = Number(process.argv[2] ?? 60000), half = turns >> 1, hide = value => [value][JSON.parse("0")];
function first(a) { return a; }
const second = function (a, b) { return b; }, third = (a, b, c) => c;
class Fourth { method(a, b, c, d) { return d; } static fixed() {} }
const all = hide([first, second, third, Fourth, Fourth.prototype.method, function () {}, Fourth.fixed, () => 1, first.bind(null, 1), new Listed(4), { name: "plain", length: 9 }]);
const change = (0, eval)(`(function (all) {
    Object.defineProperty(all[0], "name", { value: "renamed" });
    delete all[1].name;
    Object.defineProperty(all[2], "name", { get() { return "got"; }, configurable: true });
    Object.defineProperty(all[3], "length", { value: 77 });
    delete all[4].length;
    all[5].extra = 1;
    Object.setPrototypeOf(all[6], { name: "above", length: 55 });
    delete all[6].name;
    delete all[6].length;
    Object.setPrototypeOf(all[7], { name: "never seen" });
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
