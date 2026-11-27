const { encodingOf, Listed } = require("./lib-reads.cjs");
const turns = Number(process.argv[2] ?? 60000), half = turns >> 1, hide = value => [value][JSON.parse("0")];
class Below extends TextDecoder { }
const all = hide([new Below(), new Below("utf-16le"), new Below(), new Listed(2)]);
const change = (0, eval)(`(function (all) { Object.defineProperty(Object.getPrototypeOf(all[0]), "encoding", { value: "laid between", configurable: true, writable: true }); })`);
const back = (0, eval)(`(function (all) { delete Object.getPrototypeOf(all[0]).encoding; })`);
let sum = 0, wrong = 0;
for (let turn = 0; turn < turns; turn++) {
    if (turn === half) change(all);
    if (turn === turns - 2000) back(all);
    const one = all[turn & 3], encoding = encodingOf(one);
    sum += encoding.length * 7 + encoding.charCodeAt(0);
    if ((turn % 499 === 0 || (turn >= half && turn < half + 96) || turn >= turns - 2000 && turn < turns - 1900) && Reflect.get(one, "encoding") !== encoding) wrong++;
}
console.log("SAID", sum, wrong);
