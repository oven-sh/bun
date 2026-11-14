// Sums that take integers out of boxes, in loops with and without calls.
// STATISTIC: SumsCarriedAsIntegers >= 1
const show = x => Object.is(x, -0) ? "-0" : String(x);
const map = new Map([["a", 1], ["b", 2147483647], ["c", -5]]), list = [3, "x", null, 2147483647, -2147483648, undefined], text = "words and more words";
function values(turns) { let n = 0; for (let k = 0; k < turns; k++) for (const v of map.values()) n += v; return n; }
function keys(turns) { let n = 0; for (let k = 0; k < turns; k++) { for (const x of map.keys()) n += x.length; for (const v of map.values()) n -= v; } return n; }
function numbers(turns) { let n = 0; for (let k = 0; k < turns; k++) { const x = list[k % 6]; if (typeof x === "number") n += x; } return n; }
function searched() { let n = 0; for (let k = 0; k < 500; k++) n += text.search(/more/) + text.indexOf("w", k & 7); return n; }
function lengths(turns) { let n = 0; for (let k = 0; k < turns; k++) n += Object.keys(list).length + text.search(/[xyz]/); return n; }
for (const turns of [0, 1, 5, 100, 4000]) console.log(show(values(turns)), show(keys(turns)), show(numbers(turns)), searched(), show(lengths(turns)));
