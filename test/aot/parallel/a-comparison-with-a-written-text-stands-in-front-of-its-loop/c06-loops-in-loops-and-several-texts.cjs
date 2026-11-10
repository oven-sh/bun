// STATISTIC: StringLiteralComparisonsHoisted >= 1
"use strict";
const turns = +process.argv[2] || 7;
function chain(n) { let at; for (let i = 0; i < n; i++) at = { weight: i + 1, above: at }; return at; }
const half = process.argv.length > 90 ? "x" : "con";
const subjects = () => ["const", "konst", half + "st", half + "sx", half + "stant", "", "cons", 5, 0, NaN, null, undefined, true, {}, [], new String("const"), Symbol("const"), 10n, "cоnst", half + "sт", () => "const", ["const"]];
const name = s => typeof s === "symbol" ? "symbol" : typeof s === "bigint" ? "bigint" : typeof s === "function" ? "function" : typeof s === "object" && s !== null ? "object:" + Object.prototype.toString.call(s) : typeof s + ":" + String(s);

function climb(top, word, other) {
    let sum = 0;
    for (let row = 0; row < 3; row++) {
        let at = top;
        while (at) {
            if (word === "const")
                sum += 1000;
            if (other !== "let")
                sum += 7;
            if ("var" === word)
                sum += 100000;
            sum += at.weight * (row + 1);
            at = at.above;
        }
        if (row === 1)
            other = "l" + "et".slice(0, turns);
    }
    return sum;
}
for (const s of subjects()) for (const o of ["let", "le" + half.slice(3) + "t", "var", 4]) console.log(name(s), name(o), climb(chain(turns), s, o), climb(undefined, s, o));
console.log(climb(chain(turns), "var", "let"), climb(chain(turns), "v" + half.slice(3) + "ar", "x"));
