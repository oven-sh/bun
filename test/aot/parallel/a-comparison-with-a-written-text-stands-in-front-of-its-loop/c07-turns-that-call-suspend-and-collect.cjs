// STATISTIC: ComparisonsWithTextsThatStandInFrontOfLoops >= 1
"use strict";
const turns = +process.argv[2] || 7;
function chain(n) { let at; for (let i = 0; i < n; i++) at = { weight: i + 1, above: at }; return at; }
const half = process.argv.length > 90 ? "x" : "con";
const subjects = () => ["const", "konst", half + "st", half + "sx", half + "stant", "", "cons", 5, 0, NaN, null, undefined, true, {}, [], new String("const"), Symbol("const"), 10n, "cоnst", half + "sт", () => "const", ["const"]];
const name = s => typeof s === "symbol" ? "symbol" : typeof s === "bigint" ? "bigint" : typeof s === "function" ? "function" : typeof s === "object" && s !== null ? "object:" + Object.prototype.toString.call(s) : typeof s + ":" + String(s);

const log = [];
function note(x) { log.push(x); if (log.length % 5 === 0 && typeof Bun !== "undefined") Bun.gc(true); return x; }
function climb(at, word) {
    let sum = 0;
    while (at) {
        if (word === "const")
            sum += 1000;
        sum += note(at.weight);
        at = at.above;
    }
    return sum;
}
function* step(at, word) {
    while (at) {
        if (word === "const")
            yield "hit " + at.weight;
        else
            yield at.weight;
        at = at.above;
    }
}
async function wait(at, word) {
    let sum = 0;
    while (at) {
        if (word === "const")
            sum += 1000;
        sum += await at.weight;
        at = at.above;
    }
    return sum;
}
(async () => {
    for (const s of subjects()) console.log(name(s), climb(chain(turns), s), [...step(chain(3), s)].join(), await wait(chain(turns), s));
    console.log(log.length);
})();
