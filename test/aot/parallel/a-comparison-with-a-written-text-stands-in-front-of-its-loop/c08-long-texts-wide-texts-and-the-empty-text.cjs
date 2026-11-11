// STATISTIC: StringLiteralComparisonsHoisted >= 1
"use strict";
const turns = +process.argv[2] || 7;
function chain(n) { let at; for (let i = 0; i < n; i++) at = { weight: i + 1, above: at }; return at; }
const half = process.argv.length > 90 ? "x" : "con";
const subjects = () => ["const", "konst", half + "st", half + "sx", half + "stant", "", "cons", 5, 0, NaN, null, undefined, true, {}, [], new String("const"), Symbol("const"), 10n, "cоnst", half + "sт", () => "const", ["const"]];
const name = s => typeof s === "symbol" ? "symbol" : typeof s === "bigint" ? "bigint" : typeof s === "function" ? "function" : typeof s === "object" && s !== null ? "object:" + Object.prototype.toString.call(s) : typeof s + ":" + String(s);

function climb(at, word) {
    let sum = 0;
    while (at) {
        if (word === "a text of thirty-two characters!") sum += 1;
        if (word === "a text of thirty-three characters") sum += 10;
        if (word === "") sum += 100;
        if (word === "cоnst") sum += 1000;
        if (word === "c") sum += 10000;
        sum += at.weight * 100000;
        at = at.above;
    }
    return sum;
}
const tail = process.argv.length > 90 ? "x" : " characters";
for (const s of [...subjects(), "a text of thirty-two" + tail + "!", "a text of thirty-three" + tail, "c", half.slice(0, 1), half.slice(3), "c" + "о" + half.slice(2) + "st"]) console.log(name(s), climb(chain(turns), s), climb(undefined, s));
