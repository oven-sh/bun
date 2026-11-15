const { nameOf, Listed } = require("./lib-reads.cjs");
const turns = Number(process.argv[2] ?? 60000) + 60000, hide = value => [value][JSON.parse("0")];
class Second { constructor(count) { this.before = count; this.name = "second" + count; } }
const first = hide([new Listed(1), new Listed(2)]), between = hide([function one() {}, function two() {}]), last = hide([new Second(3), new Second(4)]);
let sum = 0;
for (let turn = 0; turn < turns; turn++) {
    const one = turn < 20000 ? first[turn & 1] : turn < 40000 ? between[turn & 1] : turn < 60000 ? last[turn & 1] : turn & 1 ? first[turn >> 1 & 1] : last[turn >> 1 & 1];
    sum += nameOf(one).length;
}
console.log("SAID", sum);
