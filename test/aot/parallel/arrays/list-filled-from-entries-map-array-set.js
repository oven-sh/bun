// A list is filled from what entries() answers, in a function that is hot with a Map and is then given an array and a Set. The capacity of the list is planned from the size of the Map, which is there only where a Map is walked.
function arrayFrom(iterator) { const result = []; for (const value of iterator) result.push(value); return result; }
class Sym { constructor(exports) { this.exports = exports; } }
function names(sym) { return arrayFrom(sym.exports.entries()).length; }
const map = new Map([["a", 1], ["b", 2]]);
let n = 0;
for (let r = 0; r < 1000; r++) n += names(new Sym(map));
console.log(n, names({ exports: [5, 6, 7] }), names({ exports: new Set([1]) }), names(new Sym(new Set([1, 2, 3, 4]))));
