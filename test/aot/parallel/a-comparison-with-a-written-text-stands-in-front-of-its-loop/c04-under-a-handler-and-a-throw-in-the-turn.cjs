// STATISTIC: StringLiteralComparisonsHoisted >= 0
"use strict";
const turns = +process.argv[2] || 7;
function chain(n) { let at; for (let i = 0; i < n; i++) at = { weight: i + 1, above: at }; return at; }
const half = process.argv.length > 90 ? "x" : "con";
const subjects = () => ["const", "konst", half + "st", half + "sx", half + "stant", "", "cons", 5, 0, NaN, null, undefined, true, {}, [], new String("const"), Symbol("const"), 10n, "cоnst", half + "sт", () => "const", ["const"]];
const name = s => typeof s === "symbol" ? "symbol" : typeof s === "bigint" ? "bigint" : typeof s === "function" ? "function" : typeof s === "object" && s !== null ? "object:" + Object.prototype.toString.call(s) : typeof s + ":" + String(s);

function climb(at, word, bad) {
    let sum = 0, seen = "";
    try {
        while (at) {
            if (word === "const")
                sum += 1000;
            seen += at.weight;
            if (at.weight === bad)
                throw new RangeError("at " + at.weight);
            sum += at.weight;
            at = at.above;
        }
    } catch (error) {
        return "caught " + error.message + " " + sum + " " + seen;
    }
    return sum + " " + seen;
}
for (const s of subjects()) console.log(name(s), climb(chain(turns), s, 3), climb(chain(turns), s, -1), climb(undefined, s, 1));
