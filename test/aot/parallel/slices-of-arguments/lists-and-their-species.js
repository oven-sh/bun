// Of a list the species is asked: by its own `constructor`, by the one above lists, and by Symbol.species of Array.
// STATISTIC: SlicesFoldedToArrayLiterals >= 1
function plain(a) { return [a, 1, 2].slice(1).join(); }
function own(a) { var list = [a, 1, 2]; list.constructor = { [Symbol.species]: function (n) { return { made: "own", length: 0 }; } }; var out = list.slice(1); return out.made + "|" + Array.isArray(out); }
function run(n) { var out; for (var i = 0; i < n; i++) out = plain(i) + " " + own(i); return out; }
console.log(run(20));
